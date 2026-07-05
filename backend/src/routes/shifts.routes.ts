import express, { Response } from 'express';
import db from '../database/db.js';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import type {
  AdminEmployeeEarningsRow,
  CountResult,
  EmployeeCompensationRow,
  EmployeeDashboardTaskSummary,
  EarningsQueryRow,
  EmployeeEarningsView,
  IdResult,
  ManualRevenueRow,
  OnlineEarningsSummaryRow,
  ScheduleRequestRawRow,
  ShiftStudioRateRow,
  ShiftCheckoutSummaryRow,
  TaxDeductionCreateRow,
  TaxDeductionRow,
  TodayOrderStats,
  WorkTaskBrief,
} from '../types/views/index.js';
import { calculateNdfl, calculateEmployerContributions, calculatePensionPoints } from '../utils/payroll-calc.js';
import type Users from '../types/generated/public/Users.js';
import type EmployeeShifts from '../types/generated/public/EmployeeShifts.js';
import type PosShifts from '../types/generated/public/PosShifts.js';
import { generateShiftBriefing } from '../services/task-ai.service.js';
import { validateShiftPattern, generateShiftsFromPattern } from '../services/schedule-validation.service.js';
import { NotificationService } from '../services/notification.service.js';
import {
  ONLINE_SHIFT_LOCATION_CODE,
  ensureOnlineEmployeeShift,
  studioBasePayRateSql,
  studioShiftKindSql,
} from '../services/virtual-shift.service.js';
import { toShiftResponse } from '../mappers/shift.mapper.js';
import { closeShift } from '../services/pos.service.js';
import { enqueueShiftFiscalCommand } from '../services/pos-fiscal-command.service.js';
import { isFiscalShiftOpenForShift } from '../services/pos-fiscal-shift.service.js';
import { enqueueShiftReconciliation } from '../services/pos-reconciliation.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('shifts');

/** Minimal interface for the socket methods we use in this module */
interface ShiftNotificationPayload {
  type: string;
  title?: string;
  body?: string;
  data?: unknown;
  request_id?: string;
  shifts_created?: number;
}

interface ShiftSocketServer {
  sendNotificationToUser(userId: string, payload: ShiftNotificationPayload): void;
}

interface BulkApproveResult {
  approved: number;
  failed: { request_id: string; error: string }[];
  total_shifts_created: number;
}

interface WorkdayStartWarning {
  key: 'no-scheduled-shift' | 'scheduled-address-mismatch' | 'studio-occupied';
  message: string;
  fine_applies: boolean;
  shift_id?: string;
  employee_id?: string;
  employee_name?: string;
}

interface WorkdayStartTodayShiftRow {
  id: string;
  studio_id: string;
  status: string | null;
}

interface WorkdayStartStudioRow {
  is_virtual: boolean;
}

interface WorkdayStartActiveShiftRow {
  id: string;
  employee_id: string;
  employee_name: string | null;
}

interface EmployeeShiftCashRow extends EmployeeShifts {
  cash_at_open: string | null;
  cash_at_close: string | null;
  shift_kind?: string | null;
}

type RequestedShiftAction = 'work' | 'change_address' | 'cancel_shift';

interface RequestedShiftPayload {
  date: string;
  start_time: string;
  end_time: string;
  studio_id?: string;
  action: RequestedShiftAction;
  shift_id?: string;
  current_studio_id?: string;
  reason?: string;
}

interface RequestedShiftJson {
  date?: unknown;
  start_time?: unknown;
  startTime?: unknown;
  end_time?: unknown;
  endTime?: unknown;
  studio_id?: unknown;
  studioId?: unknown;
  action?: unknown;
  shift_id?: unknown;
  shiftId?: unknown;
  current_studio_id?: unknown;
  currentStudioId?: unknown;
  reason?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const SHIFT_ASSIGNABLE_ROLES = ['admin', 'manager', 'employee', 'photographer'] as const;

type ShiftAssigneeRow = Pick<Users, 'id' | 'role' | 'is_active'>;

function isShiftAssignableRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'employee' || role === 'photographer';
}

async function assertUsersCanHaveShifts(employeeIds: readonly string[]): Promise<void> {
  const uniqueEmployeeIds = [...new Set(employeeIds.filter(id => id.trim().length > 0))];
  if (uniqueEmployeeIds.length === 0) {
    throw new AppError(400, 'employee_id is required');
  }

  const users = await db.query<ShiftAssigneeRow>(
    `SELECT id, role, is_active FROM users WHERE id = ANY($1::uuid[])`,
    [uniqueEmployeeIds],
  );
  const usersById = new Map(users.map(user => [String(user.id), user]));

  for (const employeeId of uniqueEmployeeIds) {
    const user = usersById.get(employeeId);
    if (!user) {
      throw new AppError(400, 'Сотрудник не найден');
    }
    if (!user.is_active) {
      throw new AppError(400, 'Нельзя назначить смену неактивному пользователю');
    }
    if (!isShiftAssignableRole(user.role)) {
      throw new AppError(400, 'Смены можно назначать только сотрудникам и администраторам');
    }
  }
}

async function assertUserCanHaveShift(employeeId: string): Promise<void> {
  await assertUsersCanHaveShifts([employeeId]);
}

function toRequestedShiftJson(value: unknown): RequestedShiftJson | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as RequestedShiftJson;
}

function stringField(record: RequestedShiftJson, key: keyof RequestedShiftJson): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeRequestedShiftAction(value: string | undefined): RequestedShiftAction {
  if (value === 'change_address' || value === 'cancel_shift') return value;
  return 'work';
}

function normalizeRequestedShift(value: unknown): RequestedShiftPayload | null {
  const record = toRequestedShiftJson(value);
  if (!record) return null;

  const date = stringField(record, 'date');
  if (!date) return null;

  const startTime = stringField(record, 'start_time') ?? stringField(record, 'startTime') ?? '09:00';
  const endTime = stringField(record, 'end_time') ?? stringField(record, 'endTime') ?? '19:30';
  const studioId = stringField(record, 'studio_id') ?? stringField(record, 'studioId');
  const action = normalizeRequestedShiftAction(stringField(record, 'action'));
  const shiftId = stringField(record, 'shift_id') ?? stringField(record, 'shiftId');
  const currentStudioId = stringField(record, 'current_studio_id') ?? stringField(record, 'currentStudioId');
  const reason = stringField(record, 'reason');

  return {
    date,
    start_time: startTime,
    end_time: endTime,
    action,
    ...(studioId ? { studio_id: studioId } : {}),
    ...(shiftId ? { shift_id: shiftId } : {}),
    ...(currentStudioId ? { current_studio_id: currentStudioId } : {}),
    ...(reason ? { reason } : {}),
  };
}

function parseRequestedShifts(raw: unknown): RequestedShiftPayload[] {
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(normalizeRequestedShift)
    .filter((shift): shift is RequestedShiftPayload => shift !== null);
}

function uniqueStudioIds(shifts: readonly RequestedShiftPayload[]): string[] {
  return [...new Set(shifts.map(shift => shift.studio_id).filter((id): id is string => Boolean(id)))];
}

function requestedShiftDateRange(shifts: readonly RequestedShiftPayload[]): { start: string; end: string } {
  const dates = shifts.map(shift => shift.date).sort();
  const start = dates[0];
  const end = dates.at(-1);
  if (!start || !end) {
    throw new AppError(400, 'В запросе нет дат смен');
  }
  return { start, end };
}

async function assertStudioIdsExist(studioIds: readonly string[]): Promise<void> {
  if (studioIds.length === 0) return;

  const invalid = studioIds.find(id => !UUID_RE.test(id));
  if (invalid) {
    throw new AppError(400, `Некорректный studio_id: ${invalid}`);
  }

  const rows = await db.query<IdResult>(
    `SELECT id FROM studios WHERE id = ANY($1::uuid[])`,
    [studioIds],
  );
  const found = new Set(rows.map(row => row.id));
  const missing = studioIds.filter(id => !found.has(id));
  if (missing.length > 0) {
    throw new AppError(400, `Студия не найдена: ${missing.join(', ')}`);
  }
}

async function writeShiftRequestHistory(shiftId: string, changedBy: string, values: unknown): Promise<void> {
  await db.query(
    `INSERT INTO shift_history_log (shift_id, action, changed_by, new_values)
     VALUES ($1, 'updated', $2, $3::jsonb)`,
    [shiftId, changedBy, JSON.stringify(values)],
  ).catch(err => log.error('Failed to write schedule request audit log', { error: String(err), shiftId }));
}

async function applyApprovedRequestedShift(
  employeeId: string,
  shift: RequestedShiftPayload,
  fallbackStudioId: string | undefined,
  changedBy: string,
): Promise<boolean> {
  if (shift.shift_id && !UUID_RE.test(shift.shift_id)) {
    throw new AppError(400, `Некорректный shift_id: ${shift.shift_id}`);
  }

  if (shift.action === 'cancel_shift') {
    const params: unknown[] = [employeeId, shift.shift_id ?? shift.date];
    const idOrDateCondition = shift.shift_id ? 'id = $2' : 'shift_date = $2::date';
    const cancelled = await db.queryOne<EmployeeShifts>(
      `UPDATE employee_shifts
       SET status = 'cancelled', updated_at = NOW()
       WHERE employee_id = $1
         AND ${idOrDateCondition}
         AND status = 'scheduled'
         AND shift_date >= CURRENT_DATE
       RETURNING *, shift_date::text as shift_date`,
      params,
    );

    if (!cancelled) return false;
    await writeShiftRequestHistory(cancelled.id, changedBy, {
      source: 'schedule_request_approval',
      request_action: shift.action,
      date: shift.date,
      reason: shift.reason ?? null,
    });
    return true;
  }

  const shiftStudioId = shift.studio_id ?? fallbackStudioId;
  if (!shiftStudioId) {
    throw new AppError(400, 'studio_id обязателен для создания смены или смены адреса');
  }

  if (shift.action === 'change_address') {
    const params: unknown[] = [employeeId, shiftStudioId, shift.start_time, shift.end_time, shift.shift_id ?? shift.date];
    const idOrDateCondition = shift.shift_id ? 'id = $5' : 'shift_date = $5::date';
    const updated = await db.queryOne<EmployeeShifts>(
      `UPDATE employee_shifts
       SET studio_id = $2,
           start_time = $3,
           end_time = $4,
           base_pay_rate = ${studioBasePayRateSql('$2')},
           shift_kind = ${studioShiftKindSql('$2')},
           updated_at = NOW()
       WHERE employee_id = $1
         AND ${idOrDateCondition}
         AND status = 'scheduled'
         AND shift_date >= CURRENT_DATE
       RETURNING *, shift_date::text as shift_date`,
      params,
    );

    if (!updated) return false;
    await writeShiftRequestHistory(updated.id, changedBy, {
      source: 'schedule_request_approval',
      request_action: shift.action,
      date: shift.date,
      previous_studio_id: shift.current_studio_id ?? null,
      studio_id: shiftStudioId,
    });
    return true;
  }

  const created = await db.queryOne<EmployeeShifts>(
    `INSERT INTO employee_shifts (employee_id, studio_id, shift_date, start_time, end_time, base_pay_rate, shift_kind)
     VALUES ($1, $2, $3, $4, $5, ${studioBasePayRateSql('$2')}, ${studioShiftKindSql('$2')})
     ON CONFLICT (employee_id, shift_date) WHERE status IN ('scheduled', 'active') DO UPDATE SET
       studio_id = EXCLUDED.studio_id,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       base_pay_rate = EXCLUDED.base_pay_rate,
       shift_kind = EXCLUDED.shift_kind,
       updated_at = NOW()
     RETURNING *, shift_date::text as shift_date`,
    [employeeId, shiftStudioId, shift.date, shift.start_time, shift.end_time],
  );
  return Boolean(created);
}

async function resolveCoveredWorkScheduleRequests(
  employeeId: string,
  changedBy: string,
  touchedDates: readonly string[],
): Promise<number> {
  const dates = [...new Set(
    touchedDates
      .map(date => date.slice(0, 10))
      .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)),
  )];
  if (dates.length === 0) return 0;

  const resolved = await db.query<IdResult>(
    `UPDATE schedule_requests sr
     SET status = 'approved',
         admin_id = $2,
         updated_at = NOW()
     WHERE sr.employee_id = $1
       AND sr.status IN ('pending', 'revision_requested')
       AND (sr.status = 'revision_requested' OR sr.admin_id IS NULL)
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(sr.requested_shifts, '[]'::jsonb)) item
         WHERE COALESCE(item->>'action', 'work') = 'work'
           AND item->>'date' = ANY($3::text[])
       )
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(sr.requested_shifts, '[]'::jsonb)) item
         WHERE COALESCE(item->>'action', 'work') <> 'work'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(sr.requested_shifts, '[]'::jsonb)) item
         WHERE COALESCE(item->>'action', 'work') = 'work'
           AND NOT EXISTS (
             SELECT 1
             FROM employee_shifts es
             WHERE es.employee_id = sr.employee_id
               AND es.shift_date::text = item->>'date'
               AND es.status <> 'cancelled'
           )
       )
     RETURNING id`,
    [employeeId, changedBy, dates],
  );

  if (resolved.length > 0) {
    log.info('Resolved covered schedule requests after direct shift assignment', {
      employeeId,
      requestIds: resolved.map(row => row.id),
    });
  }

  return resolved.length;
}

function requireTimeValue(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !TIME_RE.test(value)) {
    throw new AppError(400, `${fieldName} должен быть временем в формате HH:MM`);
  }
  return value;
}

function requireCashAmount(value: unknown, fieldName: 'cash_at_open' | 'cash_at_close'): number {
  if (value === undefined || value === null || value === '') {
    throw new AppError(400, `${fieldName} обязателен`);
  }

  const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AppError(400, `${fieldName} должен быть числом >= 0`);
  }

  return Math.round(amount * 100) / 100;
}

function isShiftSocketServer(value: unknown): value is ShiftSocketServer {
  if (typeof value !== 'object' || value === null) return false;
  if (!('sendNotificationToUser' in value)) return false;
  const candidate = value as ShiftSocketServer;
  return typeof candidate.sendNotificationToUser === 'function';
}

/** Safely retrieve socket server from Express app — set in server.ts as app.socketServer */
function getShiftSocketServer(req: express.Request): ShiftSocketServer | undefined {
  const app = req.app;
  if (!Object.hasOwn(app, 'socketServer')) return undefined;
  const candidate: unknown = Reflect.get(app, 'socketServer');
  return isShiftSocketServer(candidate) ? candidate : undefined;
}

const router = express.Router();

const TRIAL_BONUS_PER_SHIFT = 500;
const TRIAL_SHIFT_COUNT = 5;
const WORKDAY_WRONG_ADDRESS_FINE = 500;

async function buildWorkdayStartWarnings(employeeId: string, studioId: string): Promise<WorkdayStartWarning[]> {
  const warnings: WorkdayStartWarning[] = [];
  const selectedStudio = await db.queryOne<WorkdayStartStudioRow>(
    `SELECT (location_code = $2 OR location_type = 'virtual') AS is_virtual
     FROM studios
     WHERE id = $1`,
    [studioId, ONLINE_SHIFT_LOCATION_CODE],
  );
  const selectedStudioIsVirtual = selectedStudio?.is_virtual === true;

  const todayShift = await db.queryOne<WorkdayStartTodayShiftRow>(
    `SELECT id, studio_id, status
     FROM employee_shifts
     WHERE employee_id = $1
       AND shift_date = CURRENT_DATE
       AND status <> 'cancelled'
     ORDER BY CASE status
       WHEN 'active' THEN 0
       WHEN 'scheduled' THEN 1
       WHEN 'completed' THEN 2
       ELSE 3
     END,
     checked_in_at DESC NULLS LAST,
     updated_at DESC NULLS LAST,
     created_at DESC NULLS LAST
     LIMIT 1`,
    [employeeId],
  );

  if (!todayShift) {
    warnings.push({
      key: 'no-scheduled-shift',
      message: 'На сегодня нет согласованной смены в календаре. Открывайте рабочий день только на согласованной точке.',
      fine_applies: true,
    });
  } else if (todayShift.studio_id !== studioId) {
    warnings.push({
      key: 'scheduled-address-mismatch',
      message: 'Выбранная точка отличается от согласованной смены на сегодня.',
      fine_applies: true,
      shift_id: todayShift.id,
    });
  }

  const occupiedShift = selectedStudioIsVirtual ? null : await db.queryOne<WorkdayStartActiveShiftRow>(
    `SELECT es.id,
            es.employee_id,
            COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(u.first_name), ''), u.email) AS employee_name
     FROM employee_shifts es
     JOIN users u ON u.id = es.employee_id
     WHERE es.studio_id = $1
       AND es.shift_date = CURRENT_DATE
       AND es.status = 'active'
       AND es.employee_id <> $2
     ORDER BY es.checked_in_at DESC NULLS LAST, es.updated_at DESC NULLS LAST
     LIMIT 1`,
    [studioId, employeeId],
  );

  if (occupiedShift) {
    const warning: WorkdayStartWarning = {
      key: 'studio-occupied',
      message: 'На выбранной точке уже открыт рабочий день другого сотрудника.',
      fine_applies: true,
      shift_id: occupiedShift.id,
      employee_id: occupiedShift.employee_id,
    };
    if (occupiedShift.employee_name) {
      warning.employee_name = occupiedShift.employee_name;
    }
    warnings.push(warning);
  }

  return warnings;
}

async function startWorkday(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) return;
  const userId = req.user.id;
  const rawStudioId: unknown = req.body?.studio_id;
  const warningAcknowledged = req.body?.warning_acknowledged === true;
  const cashAtOpen = requireCashAmount(req.body?.cash_at_open, 'cash_at_open');
  let studioId: string | undefined;

  if (rawStudioId !== undefined) {
    if (typeof rawStudioId !== 'string' || !rawStudioId.trim()) {
      throw new AppError(400, 'studio_id должен быть корректным UUID');
    }
    studioId = rawStudioId.trim();
    await assertStudioIdsExist([studioId]);
  }

  if (studioId) {
    const warnings = await buildWorkdayStartWarnings(userId, studioId);
    if (warnings.length > 0 && !warningAcknowledged) {
      res.status(409).json({
        success: false,
        code: 'WORKDAY_START_WARNING_REQUIRED',
        message: 'Подтвердите предупреждение перед началом рабочего дня',
        warnings,
        fine_amount: warnings.some(warning => warning.fine_applies) ? WORKDAY_WRONG_ADDRESS_FINE : 0,
      });
      return;
    }
  }

  const ensureOptions: { activateExisting: true; allowRestartAfterCompleted: true; studioId?: string } = {
    activateExisting: true,
    allowRestartAfterCompleted: true,
  };
  if (studioId) {
    ensureOptions.studioId = studioId;
  }

  const result = await db.transaction(async (client) => {
    const ensured = await ensureOnlineEmployeeShift(client, userId, ensureOptions);
    const overwriteCashAtOpen = ensured.created || ensured.activated;
    const updated = await client.query<EmployeeShiftCashRow>(
      `UPDATE employee_shifts
       SET cash_at_open = CASE
             WHEN $3::boolean THEN $2
             ELSE COALESCE(cash_at_open, $2)
           END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *, shift_date::text as shift_date`,
      [ensured.shift.id, cashAtOpen, overwriteCashAtOpen],
    );
    return {
      ...ensured,
      shift: updated.rows[0] ?? ensured.shift,
    };
  });

  await db.query(
    `INSERT INTO shift_history_log (shift_id, action, changed_by, new_values)
     VALUES ($1, 'checked_in', $2, $3::jsonb)`,
    [result.shift.id, userId, JSON.stringify({
      source: 'workday_start',
      created: result.created,
      activated: result.activated,
      studio_id: result.shift.studio_id,
      cash_at_open: cashAtOpen,
    })],
  ).catch(err => log.error('Failed to write workday audit log', { error: String(err) }));

  log.info('[Shifts] Workday started', {
    employeeId: userId,
    shiftId: result.shift.id,
    studioId: result.shift.studio_id,
    cashAtOpen,
    created: result.created,
    activated: result.activated,
  });

  res.status(result.created ? 201 : 200).json({
    success: true,
    data: toShiftResponse(result.shift),
    meta: {
      created: result.created,
      activated: result.activated,
      workday: true,
      virtual: result.shift.shift_kind === 'virtual',
    },
  });
}

// ============================================================================
// POST /api/shifts/requests — Сотрудник создаёт запрос на график
// ============================================================================
router.post('/requests', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  if (!isShiftAssignableRole(req.user.role)) {
    throw new AppError(403, 'График доступен только сотрудникам и администраторам');
  }
  const { shift_pattern, pattern_start_date, end_date, requested_shifts, start_time, end_time, studio_id } = req.body;

  if (!shift_pattern || !pattern_start_date) {
    throw new AppError(400, 'shift_pattern и pattern_start_date обязательны');
  }

  const validPatterns = ['2/2', '1/1', '3/3', '5/2', 'custom'];
  if (!validPatterns.includes(shift_pattern)) {
    throw new AppError(400, `shift_pattern должен быть одним из: ${validPatterns.join(', ')}`);
  }

  // Если смены не переданы — генерировать автоматически
  let shifts = parseRequestedShifts(requested_shifts);
  if (requested_shifts !== undefined && !Array.isArray(requested_shifts)) {
    throw new AppError(400, 'requested_shifts должен быть массивом');
  }

  if (shifts.length === 0) {
    if (shift_pattern === 'custom') {
      throw new AppError(400, 'Для паттерна "custom" необходимо передать requested_shifts');
    }
    const computedEndDate = end_date || (() => {
      const d = new Date(pattern_start_date + 'T00:00:00');
      d.setDate(d.getDate() + 30);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    })();
    const defaultStartTime = requireTimeValue(start_time, 'start_time') ?? '09:00';
    const defaultEndTime = requireTimeValue(end_time, 'end_time') ?? '19:30';
    shifts = generateShiftsFromPattern(shift_pattern, pattern_start_date, computedEndDate, defaultStartTime, defaultEndTime)
      .map(shift => ({ ...shift, action: 'work' }));
    if (typeof studio_id === 'string' && studio_id.trim()) {
      const defaultStudioId = studio_id.trim();
      shifts = shifts.map(shift => ({ ...shift, studio_id: defaultStudioId }));
    }
  }

  // Валидировать паттерн
  const validation = validateShiftPattern(shifts, shift_pattern, pattern_start_date);
  if (!validation.valid) {
    throw new AppError(400, validation.errors.join('; '));
  }
  await assertStudioIdsExist(uniqueStudioIds(shifts));

  const request = await db.queryOne(
    `INSERT INTO schedule_requests
       (employee_id, shift_pattern, pattern_start_date, end_date, requested_shifts)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [req.user.id, shift_pattern, pattern_start_date, end_date || null, JSON.stringify(shifts)],
  );

  // In-app уведомление всем admin
  const admins = await db.query<IdResult>(`SELECT id FROM users WHERE role = 'admin'`);
  for (const admin of admins) {
    NotificationService.create({
      userId: admin.id,
      title: 'Запрос на график',
      body: `${req.user.display_name || 'Сотрудник'} запрашивает график ${shift_pattern}`,
      type: 'schedule_request',
      data: { request_id: request?.id, pattern: shift_pattern },
    }).catch(err => log.error('Failed to create schedule request notification', { error: String(err), adminId: admin.id }));
  }

  res.status(201).json({ success: true, data: request });
});

// ============================================================================
// POST /api/shifts/requests/propose — Admin предлагает смены сотруднику
// ============================================================================
router.post('/requests/propose', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Требуются права администратора или менеджера');
  }

  const { employee_id, requested_shifts, comment } = req.body;
  if (typeof employee_id !== 'string' || !employee_id.trim()) {
    throw new AppError(400, 'employee_id обязателен');
  }
  const employeeId = employee_id.trim();
  if (!Array.isArray(requested_shifts) || requested_shifts.length === 0) {
    throw new AppError(400, 'requested_shifts должен быть непустым массивом');
  }

  await assertUserCanHaveShift(employeeId);

  const shifts = parseRequestedShifts(requested_shifts).map(shift => ({ ...shift, action: 'work' as const }));
  if (shifts.length === 0) {
    throw new AppError(400, 'В предложении нет смен');
  }
  const missingStudio = shifts.some(shift => !shift.studio_id);
  if (missingStudio) {
    throw new AppError(400, 'Для каждой предложенной смены нужен studio_id');
  }
  await assertStudioIdsExist(uniqueStudioIds(shifts));

  const { start, end } = requestedShiftDateRange(shifts);
  const request = await db.queryOne<ScheduleRequestRawRow>(
    `INSERT INTO schedule_requests
       (employee_id, shift_pattern, pattern_start_date, end_date, requested_shifts, status, admin_id, admin_comment)
     VALUES ($1, 'custom', $2, $3, $4::jsonb, 'pending', $5, $6)
     RETURNING *`,
    [employeeId, start, end, JSON.stringify(shifts), req.user.id, typeof comment === 'string' && comment.trim() ? comment.trim() : null],
  );

  NotificationService.create({
    userId: employeeId,
    title: 'Предложены рабочие дни',
    body: `Администратор предложил ${shifts.length} смен. Подтвердите или отклоните предложение.`,
    type: 'schedule_request',
    data: { request_id: request?.id, action: 'admin_proposed' },
  }).catch(err => log.error('Failed to create schedule proposal notification', { error: String(err), employeeId }));

  const proposalSocket = getShiftSocketServer(req);
  if (proposalSocket) {
    proposalSocket.sendNotificationToUser(employeeId, {
      type: 'schedule_request',
      title: 'Предложены рабочие дни',
      body: `Администратор предложил ${shifts.length} смен. Подтвердите или отклоните предложение.`,
      data: { request_id: request?.id, action: 'admin_proposed' },
    });
  }

  res.status(201).json({ success: true, data: request });
});

// ============================================================================
// GET /api/shifts/requests/my — Мои запросы на график
// ============================================================================
router.get('/requests/my', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  if (!isShiftAssignableRole(req.user.role)) {
    throw new AppError(403, 'График доступен только сотрудникам и администраторам');
  }

  const requests = await db.query(
    `SELECT sr.*,
            u.display_name as admin_name
     FROM schedule_requests sr
     LEFT JOIN users u ON u.id = sr.admin_id
     WHERE sr.employee_id = $1
     ORDER BY sr.created_at DESC
     LIMIT 20`,
    [req.user.id],
  );

  res.json({ success: true, data: requests });
});

// ============================================================================
// GET /api/shifts/requests — Все запросы (admin only)
// ============================================================================
router.get('/requests', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Требуются права администратора или менеджера');
  }
  const { status, employee_id } = req.query;
  const conditions: string[] = [`e.role = ANY($1::text[])`];
  const params: unknown[] = [SHIFT_ASSIGNABLE_ROLES];
  let idx = 2;

  if (status) { conditions.push(`sr.status = $${idx++}`); params.push(status); }
  if (employee_id) { conditions.push(`sr.employee_id = $${idx++}`); params.push(employee_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const requests = await db.query(
    `SELECT sr.*,
            e.display_name as employee_name, e.phone as employee_phone,
            a.display_name as admin_name
     FROM schedule_requests sr
     JOIN users e ON e.id = sr.employee_id
     LEFT JOIN users a ON a.id = sr.admin_id
     ${where}
     ORDER BY
       CASE sr.status WHEN 'pending' THEN 0 ELSE 1 END,
       sr.created_at DESC`,
    params,
  );

  res.json({ success: true, data: requests });
});

// ============================================================================
// PUT /api/shifts/requests/:id/accept — Сотрудник принимает предложение смен
// ============================================================================
router.put('/requests/:id/accept', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  if (!isShiftAssignableRole(req.user.role)) {
    throw new AppError(403, 'График доступен только сотрудникам и администраторам');
  }

  const id = req.params['id'];
  const request = await db.queryOne<ScheduleRequestRawRow>(
    `SELECT * FROM schedule_requests
     WHERE id = $1
       AND employee_id = $2
       AND status = 'pending'
       AND admin_id IS NOT NULL`,
    [id, req.user.id],
  );

  if (!request) {
    throw new AppError(404, 'Предложение не найдено или уже обработано');
  }
  await assertUserCanHaveShift(request.employee_id);

  const shifts = parseRequestedShifts(request.requested_shifts);
  if (shifts.length === 0) {
    throw new AppError(400, 'В предложении нет смен');
  }
  const missingStudio = shifts.some(shift => shift.action !== 'cancel_shift' && !shift.studio_id);
  if (missingStudio) {
    throw new AppError(400, 'В предложении есть смены без адреса');
  }
  await assertStudioIdsExist(uniqueStudioIds(shifts));

  const acceptedRequest = await db.queryOne<ScheduleRequestRawRow>(
    `UPDATE schedule_requests
     SET status = 'approved', updated_at = NOW()
     WHERE id = $1
       AND employee_id = $2
       AND status = 'pending'
       AND admin_id IS NOT NULL
     RETURNING *`,
    [id, req.user.id],
  );

  if (!acceptedRequest) {
    throw new AppError(404, 'Предложение не найдено или уже обработано');
  }

  let appliedCount = 0;
  const failedDates: string[] = [];
  for (const shift of shifts) {
    try {
      const applied = await applyApprovedRequestedShift(request.employee_id, shift, undefined, req.user.id);
      if (applied) {
        appliedCount++;
      } else {
        failedDates.push(shift.date);
      }
    } catch (err) {
      failedDates.push(shift.date);
      log.error('Failed to apply accepted schedule proposal shift', { error: String(err), requestId: id, date: shift.date });
    }
  }

  if (request.admin_id) {
    NotificationService.create({
      userId: request.admin_id,
      title: 'Предложение смен принято',
      body: `${req.user.display_name || 'Сотрудник'} подтвердил предложенные рабочие дни`,
      type: 'schedule_request',
      data: { request_id: id, action: 'proposal_accepted', shifts_created: appliedCount },
    }).catch(err => log.error('Failed to create proposal acceptance notification', { error: String(err), requestId: id }));

    const acceptSocket = getShiftSocketServer(req);
    if (acceptSocket) {
      acceptSocket.sendNotificationToUser(request.admin_id, {
        type: 'schedule_request',
        title: 'Предложение смен принято',
        body: `${req.user.display_name || 'Сотрудник'} подтвердил предложенные рабочие дни`,
        data: { request_id: id, action: 'proposal_accepted', shifts_created: appliedCount },
      });
    }
  }

  res.json({ success: true, data: acceptedRequest, created_shifts: appliedCount, failed_dates: failedDates });
});

// ============================================================================
// PUT /api/shifts/requests/:id/decline — Сотрудник отклоняет предложение смен
// ============================================================================
router.put('/requests/:id/decline', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  if (!isShiftAssignableRole(req.user.role)) {
    throw new AppError(403, 'График доступен только сотрудникам и администраторам');
  }

  const id = req.params['id'];
  const rawComment: unknown = req.body?.comment;
  const comment = typeof rawComment === 'string' && rawComment.trim() ? rawComment.trim() : null;

  const declinedRequest = await db.queryOne<ScheduleRequestRawRow>(
    `UPDATE schedule_requests
     SET status = 'rejected',
         admin_comment = CASE
           WHEN $3::text IS NULL THEN admin_comment
           WHEN admin_comment IS NULL OR admin_comment = '' THEN 'Ответ сотрудника: ' || $3::text
           ELSE admin_comment || E'\nОтвет сотрудника: ' || $3::text
         END,
         updated_at = NOW()
     WHERE id = $1
       AND employee_id = $2
       AND status = 'pending'
       AND admin_id IS NOT NULL
     RETURNING *`,
    [id, req.user.id, comment],
  );

  if (!declinedRequest) {
    throw new AppError(404, 'Предложение не найдено или уже обработано');
  }

  if (declinedRequest.admin_id) {
    NotificationService.create({
      userId: declinedRequest.admin_id,
      title: 'Предложение смен отклонено',
      body: `${req.user.display_name || 'Сотрудник'} отклонил предложенные рабочие дни`,
      type: 'schedule_request',
      data: { request_id: id, action: 'proposal_declined' },
    }).catch(err => log.error('Failed to create proposal decline notification', { error: String(err), requestId: id }));

    const declineSocket = getShiftSocketServer(req);
    if (declineSocket) {
      declineSocket.sendNotificationToUser(declinedRequest.admin_id, {
        type: 'schedule_request',
        title: 'Предложение смен отклонено',
        body: `${req.user.display_name || 'Сотрудник'} отклонил предложенные рабочие дни`,
        data: { request_id: id, action: 'proposal_declined' },
      });
    }
  }

  res.json({ success: true, data: declinedRequest });
});

// ============================================================================
// PUT /api/shifts/requests/:id/approve — Admin утверждает и создаёт смены
// ============================================================================
router.put('/requests/:id/approve', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Требуются права администратора или менеджера');
  }

  const id = req.params['id'];
  const { studio_id } = req.body;

  if (studio_id !== undefined && typeof studio_id !== 'string') {
    throw new AppError(400, 'studio_id должен быть строкой');
  }

  const request = await db.queryOne<ScheduleRequestRawRow>(
    `SELECT * FROM schedule_requests WHERE id = $1 AND status IN ('pending', 'revision_requested')`,
    [id],
  );

  if (!request) {
    throw new AppError(404, 'Запрос не найден или уже обработан');
  }
  await assertUserCanHaveShift(request.employee_id);

  // Применить смены из approved shifts. Если заявка хранит адрес по каждому дню,
  // администратор может утвердить её без общего studio_id. Заявки на отмену
  // адрес не требуют.
  const shifts = parseRequestedShifts(request.requested_shifts);
  if (shifts.length === 0) {
    throw new AppError(400, 'В запросе нет смен для утверждения');
  }
  const fallbackStudioId = typeof studio_id === 'string' && studio_id.trim() ? studio_id.trim() : undefined;
  const missingStudio = shifts.some(shift => shift.action !== 'cancel_shift' && !shift.studio_id && !fallbackStudioId);
  if (missingStudio) {
    throw new AppError(400, 'studio_id обязателен, если в заявке не указан адрес для каждого дня');
  }
  await assertStudioIdsExist([...uniqueStudioIds(shifts), ...(fallbackStudioId ? [fallbackStudioId] : [])]);

  const approvedRequest = await db.queryOne<ScheduleRequestRawRow>(
    `UPDATE schedule_requests SET status = 'approved', admin_id = $2, updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'revision_requested')
     RETURNING *`,
    [id, req.user.id],
  );
  if (!approvedRequest) {
    throw new AppError(404, 'Запрос не найден или уже обработан');
  }

  let appliedCount = 0;
  const failedDates: string[] = [];
  for (const shift of shifts) {
    try {
      const applied = await applyApprovedRequestedShift(request.employee_id, shift, fallbackStudioId, req.user.id);
      if (applied) {
        appliedCount++;
      } else {
        failedDates.push(shift.date);
      }
    } catch (err) {
      // Собираем ошибки, чтобы вернуть partial result — не глотаем молча
      failedDates.push(shift.date);
      log.error(`[shifts] Не удалось применить смену ${shift.date}:`, { error: String(err), action: shift.action });
    }
  }

  // Уведомление сотруднику
  NotificationService.create({
    userId: request.employee_id,
    title: 'График утверждён',
    body: `Ваш график ${request.shift_pattern} утверждён администратором`,
    type: 'schedule_request',
    data: { request_id: id },
  }).catch(err => log.error('Failed to create approval notification', { error: String(err), requestId: id }));

  const approveSocket = getShiftSocketServer(req);
  if (approveSocket) {
    approveSocket.sendNotificationToUser(request.employee_id, {
      type: 'schedule_request',
      title: 'График утверждён',
      body: `Ваш график ${request.shift_pattern} утверждён администратором`,
      data: { request_id: id, action: 'approved' },
    });
  }

  res.json({ success: true, data: approvedRequest, created_shifts: appliedCount, failed_dates: failedDates });
});

// ============================================================================
// PUT /api/shifts/requests/:id/reject — Admin отклоняет запрос
// ============================================================================
router.put('/requests/:id/reject', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Требуются права администратора или менеджера');
  }

  const id = req.params['id'];
  const { comment } = req.body;

  const request = await db.queryOne<ScheduleRequestRawRow>(
    `UPDATE schedule_requests SET status = 'rejected', admin_id = $2, admin_comment = $3, updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'revision_requested')
     RETURNING *`,
    [id, req.user.id, comment || null],
  );

  if (!request) {
    throw new AppError(404, 'Запрос не найден или уже обработан');
  }

  NotificationService.create({
    userId: request.employee_id,
    title: 'График отклонён',
    body: comment ? `График отклонён: ${comment}` : 'Ваш запрос на график был отклонён',
    type: 'schedule_request',
    data: { request_id: id },
  }).catch(err => log.error('Failed to create rejection notification', { error: String(err), requestId: id }));

  const rejectSocket = getShiftSocketServer(req);
  if (rejectSocket) {
    rejectSocket.sendNotificationToUser(request.employee_id, {
      type: 'schedule_request',
      title: 'График отклонён',
      body: comment ? `График отклонён: ${comment}` : 'Ваш запрос на график был отклонён',
      data: { request_id: id, action: 'rejected' },
    });
  }

  res.json({ success: true, data: request });
});

// ============================================================================
// PUT /api/shifts/requests/:id/revision — Admin просит доработать
// ============================================================================
router.put('/requests/:id/revision', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Требуются права администратора или менеджера');
  }

  const id = req.params['id'];
  const { comment } = req.body;

  if (!comment) {
    throw new AppError(400, 'Комментарий обязателен при запросе доработки');
  }

  const request = await db.queryOne<ScheduleRequestRawRow>(
    `UPDATE schedule_requests SET status = 'revision_requested', admin_id = $2, admin_comment = $3, updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [id, req.user.id, comment],
  );

  if (!request) {
    throw new AppError(404, 'Запрос не найден или уже обработан');
  }

  NotificationService.create({
    userId: request.employee_id,
    title: 'Нужна доработка графика',
    body: `Комментарий: ${comment}`,
    type: 'schedule_request',
    data: { request_id: id },
  }).catch(err => log.error('Failed to create revision notification', { error: String(err), requestId: id }));

  const revisionSocket = getShiftSocketServer(req);
  if (revisionSocket) {
    revisionSocket.sendNotificationToUser(request.employee_id, {
      type: 'schedule_request',
      title: 'Нужна доработка графика',
      body: `Комментарий: ${comment}`,
      data: { request_id: id, action: 'revision_requested' },
    });
  }

  res.json({ success: true, data: request });
});

// ============================================================================
// POST /api/shifts/requests/bulk-approve — Массовое утверждение запросов
// ============================================================================
router.post('/requests/bulk-approve', authenticateToken, requirePermission('users:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const { request_ids, studio_id } = req.body;

  if (!request_ids || !Array.isArray(request_ids) || request_ids.length === 0) {
    throw new AppError(400, 'request_ids[] обязательны');
  }
  if (studio_id !== undefined && typeof studio_id !== 'string') {
    throw new AppError(400, 'studio_id должен быть строкой');
  }
  const fallbackStudioId = typeof studio_id === 'string' && studio_id.trim() ? studio_id.trim() : undefined;

  const results: BulkApproveResult = { approved: 0, failed: [], total_shifts_created: 0 };
  const socketServer = getShiftSocketServer(req);

  for (const requestId of request_ids) {
    try {
      const request = await db.queryOne<ScheduleRequestRawRow>(
        `SELECT * FROM schedule_requests WHERE id = $1 AND status IN ('pending', 'revision_requested')`,
        [requestId]
      );
      if (!request) {
        results.failed.push({ request_id: requestId, error: 'Запрос не найден или уже обработан' });
        continue;
      }
      await assertUserCanHaveShift(request.employee_id);

      const shifts = parseRequestedShifts(request.requested_shifts);
      const missingStudio = shifts.some(shift => shift.action !== 'cancel_shift' && !shift.studio_id && !fallbackStudioId);
      if (missingStudio) {
        results.failed.push({ request_id: requestId, error: 'studio_id обязателен, если в заявке не указан адрес для каждого дня' });
        continue;
      }
      await assertStudioIdsExist([...uniqueStudioIds(shifts), ...(fallbackStudioId ? [fallbackStudioId] : [])]);

      let created = 0;

      for (const shift of shifts) {
        try {
          const applied = await applyApprovedRequestedShift(request.employee_id, shift, fallbackStudioId, req.user.id);
          if (applied) created++;
        } catch (shiftErr: unknown) {
          log.warn('Bulk approve: skip failed shift request action', {
            requestId,
            date: shift.date,
            action: shift.action,
            error: String(shiftErr),
          });
        }
      }

      await db.query(
        `UPDATE schedule_requests SET status = 'approved', admin_id = $1, updated_at = now() WHERE id = $2`,
        [req.user.id, requestId]
      );

      results.approved++;
      results.total_shifts_created += created;

      NotificationService.create({
        userId: request.employee_id,
        title: 'График утверждён',
        body: `Ваш запрос на график ${request.shift_pattern} утверждён. Применено ${created} действий.`,
        type: 'schedule_request',
        data: { request_id: requestId, shifts_created: created },
      }).catch(err => log.error('Failed to create bulk-approve notification', { error: String(err) }));

      if (socketServer) {
        socketServer.sendNotificationToUser(request.employee_id, {
          type: 'schedule_request',
          request_id: requestId,
          shifts_created: created,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
      results.failed.push({ request_id: requestId, error: message });
    }
  }

  log.info('Bulk approve completed', { approved: results.approved, failed: results.failed.length, shiftsCreated: results.total_shifts_created });
  res.json({ success: true, data: results });
});

// ============================================================================
// GET /api/shifts — List shifts
// ============================================================================
router.get('/', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { studio_id, date_from, date_to, employee_id } = req.query;

  const conditions: string[] = [`u.role = ANY($1::text[])`];
  const params: unknown[] = [SHIFT_ASSIGNABLE_ROLES];
  let idx = 2;

  if (studio_id) { conditions.push(`es.studio_id = $${idx++}`); params.push(studio_id); }
  if (date_from) { conditions.push(`es.shift_date >= $${idx++}`); params.push(date_from); }
  if (date_to) { conditions.push(`es.shift_date <= $${idx++}`); params.push(date_to); }
  if (employee_id) { conditions.push(`es.employee_id = $${idx++}`); params.push(employee_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const shifts = await db.query(
    `SELECT es.*, es.shift_date::text as shift_date,
            u.display_name as employee_name, u.phone as employee_phone,
            s.name as studio_name, s.location_code
     FROM employee_shifts es
     JOIN users u ON u.id = es.employee_id
     JOIN studios s ON s.id = es.studio_id
     ${where}
     ORDER BY es.shift_date ASC, s.location_code ASC`,
    params
  );

  res.json({ success: true, data: shifts.map(toShiftResponse) });
});

// ============================================================================
// GET /api/shifts/today — Who's working today
// ============================================================================
router.get('/today', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  const shifts = await db.query(
    `SELECT es.*, es.shift_date::text as shift_date,
            u.display_name as employee_name, u.phone as employee_phone,
            u.linked_accounts,
            s.name as studio_name, s.location_code
     FROM employee_shifts es
     JOIN users u ON u.id = es.employee_id
     JOIN studios s ON s.id = es.studio_id
     WHERE es.shift_date = CURRENT_DATE
       AND es.status IN ('scheduled', 'active')
       AND u.role = ANY($1::text[])
     ORDER BY s.location_code ASC`,
    [SHIFT_ASSIGNABLE_ROLES],
  );

  res.json({ success: true, data: shifts.map(toShiftResponse) });
});

// ============================================================================
// GET /api/shifts/studios — Studios available for employee schedule requests
// ============================================================================
router.get('/studios', authenticateToken, requirePermission('shifts:manage'), async (_req: AuthRequest, res: Response): Promise<void> => {
  const studios = await db.query<ShiftStudioRateRow>(
    `SELECT id, name, address, location_code, COALESCE(status, 'active') AS status,
            COALESCE(
              employee_shift_rate,
              CASE WHEN location_code = 'barrikadnaya-4' THEN 2000 ELSE 1500 END
            )::float8 as shift_rate,
            (location_code = '${ONLINE_SHIFT_LOCATION_CODE}' OR location_type = 'virtual') AS is_virtual
     FROM studios
     WHERE location_code IS NOT NULL
     ORDER BY CASE WHEN location_code = '${ONLINE_SHIFT_LOCATION_CODE}' THEN 1 ELSE 0 END, name ASC`,
  );

  res.json({ success: true, data: studios });
});

// ============================================================================
// GET /api/shifts/my — My shifts
// ============================================================================
router.get('/my', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const { date_from, date_to } = req.query;
  const from = date_from || new Date().toISOString().split('T')[0];
  const to = date_to || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const shifts = await db.query(
    `SELECT es.*, es.shift_date::text as shift_date,
            s.name as studio_name, s.location_code
     FROM employee_shifts es
     JOIN studios s ON s.id = es.studio_id
     WHERE es.employee_id = $1 AND es.shift_date BETWEEN $2 AND $3
     ORDER BY es.shift_date ASC`,
    [req.user.id, from, to]
  );

  res.json({ success: true, data: shifts.map(toShiftResponse) });
});

// ============================================================================
// GET /api/shifts/my/earnings — Employee earnings for a month (with tax details)
// ============================================================================
router.get('/my/earnings', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;

  const monthParam = (req.query['month'] as string) || new Date().toISOString().slice(0, 7);
  const [year, month] = monthParam.split('-').map(Number);
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).toISOString().split('T')[0];
  const nextMonth = `${year}-${String(month + 1 > 12 ? 1 : month + 1).padStart(2, '0')}-01`;

  const row = await db.queryOne<EarningsQueryRow>(
    `WITH comp AS (
       SELECT daily_rate, commission_rate
       FROM employee_compensation
       WHERE employee_id = $1
         AND effective_from <= $3::date
         AND COALESCE(effective_until, '9999-12-31'::date) > $2::date
       ORDER BY effective_from DESC LIMIT 1
     ),
     shifts AS (
       SELECT
         COUNT(*) FILTER (WHERE es.status = 'completed') as completed,
         COUNT(*) as total,
         COALESCE(SUM(
           CASE WHEN es.status = 'completed' THEN
             COALESCE(
               es.base_pay_rate,
               s.employee_shift_rate,
               CASE WHEN s.location_code = 'barrikadnaya-4' THEN 2000 ELSE COALESCE((SELECT daily_rate FROM comp), 1500) END
             )
           ELSE 0 END
         ), 0) as base_pay
       FROM employee_shifts es
       LEFT JOIN studios s ON s.id = es.studio_id
       WHERE es.employee_id = $1 AND es.shift_date BETWEEN $2 AND $3
     ),
     pos_rev AS (
       SELECT
         COALESCE(SUM(total::numeric), 0) as revenue,
         COUNT(*) as orders_count
       FROM pos_receipts
       WHERE employee_id = $1 AND is_refund = false
         AND created_at >= $2::date AND created_at < $4::date
     ),
     last_studio AS (
       SELECT
         s.name as studio_name,
         s.location_code,
         COALESCE(
           es.base_pay_rate,
           s.employee_shift_rate,
           CASE WHEN s.location_code = 'barrikadnaya-4' THEN 2000 ELSE COALESCE((SELECT daily_rate FROM comp), 1500) END
         ) as daily_rate
       FROM employee_shifts es
       JOIN studios s ON s.id = es.studio_id
       WHERE es.employee_id = $1 AND es.shift_date BETWEEN $2 AND $3
       ORDER BY es.shift_date DESC LIMIT 1
     ),
     manual_rev AS (
       SELECT COALESCE(amount, 0) as amount
       FROM employee_manual_revenue
       WHERE employee_id = $1 AND month = $5
     ),
     trial AS (
       SELECT COUNT(*) as cnt FROM (
         SELECT shift_date, ROW_NUMBER() OVER (ORDER BY shift_date) as rn
         FROM employee_shifts
         WHERE employee_id = $1 AND status = 'completed'
           AND shift_date >= (SELECT hired_date FROM users WHERE id = $1)
       ) ranked
       WHERE rn <= ${TRIAL_SHIFT_COUNT} AND shift_date BETWEEN $2 AND $3
         AND EXISTS (SELECT 1 FROM users WHERE id = $1 AND hired_date IS NOT NULL)
     ),
     working_days AS (
       SELECT COUNT(*) as cnt
       FROM generate_series($2::date, $3::date, '1 day'::interval) d
       WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
     ),
     ytd_earnings AS (
       SELECT
         COALESCE(SUM(es_base.base_pay), 0) as ytd_base,
         COALESCE(SUM(
           pr.rev * COALESCE(ec.commission_rate, 10) / 100
         ), 0) as ytd_commission,
         COALESCE(SUM(emr.amount), 0) as ytd_manual_revenue
       FROM generate_series(1, $7::int) m(n)
       LEFT JOIN LATERAL (
         SELECT daily_rate, commission_rate
         FROM employee_compensation
         WHERE employee_id = $1
           AND effective_from <= (make_date($6::int, m.n, 1) + '1 month'::interval - '1 day'::interval)::date
           AND COALESCE(effective_until, '9999-12-31'::date) > make_date($6::int, m.n, 1)
         ORDER BY effective_from DESC LIMIT 1
       ) ec ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(
           COALESCE(
             es.base_pay_rate,
             s.employee_shift_rate,
             CASE WHEN s.location_code = 'barrikadnaya-4' THEN 2000 ELSE COALESCE(ec.daily_rate, 1500) END
           )
         ), 0) as base_pay
         FROM employee_shifts es
         LEFT JOIN studios s ON s.id = es.studio_id
         WHERE es.employee_id = $1
           AND es.status = 'completed'
           AND EXTRACT(YEAR FROM es.shift_date) = $6::int
           AND EXTRACT(MONTH FROM es.shift_date) = m.n
       ) es_base ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(total::numeric), 0) as rev
         FROM pos_receipts
         WHERE employee_id = $1 AND is_refund = false
           AND created_at >= make_date($6::int, m.n, 1)
           AND created_at < (make_date($6::int, m.n, 1) + '1 month'::interval)
       ) pr ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(amount, 0) as amount
         FROM employee_manual_revenue
         WHERE employee_id = $1
           AND month = $6::int || '-' || LPAD(m.n::text, 2, '0')
       ) emr ON true
     ),
     online_rev AS (
       SELECT
         COALESCE(SUM(sale.receipt_total), 0) as total_amount,
         COALESCE(SUM(sale.commission_amount), 0) as commission,
         COUNT(*) as orders_count
       FROM employee_sales sale
       LEFT JOIN employee_shifts es ON es.id = sale.shift_id
       WHERE sale.employee_id = $1 AND sale.source = 'online'
         AND COALESCE(es.shift_date, sale.created_at::date) >= $2::date
         AND COALESCE(es.shift_date, sale.created_at::date) < $4::date
     ),
     ytd_trial AS (
       SELECT COALESCE(SUM(
         CASE WHEN ranked.shift_date < $2::date THEN 1 ELSE 0 END
       ), 0) * ${TRIAL_BONUS_PER_SHIFT} as ytd_trial_bonus
       FROM (
         SELECT shift_date, ROW_NUMBER() OVER (ORDER BY shift_date) as rn
         FROM employee_shifts
         WHERE employee_id = $1 AND status = 'completed'
           AND shift_date >= (SELECT hired_date FROM users WHERE id = $1)
       ) ranked
       WHERE rn <= ${TRIAL_SHIFT_COUNT}
         AND EXTRACT(YEAR FROM ranked.shift_date) = $6::int
         AND ranked.shift_date < $2::date
         AND EXISTS (SELECT 1 FROM users WHERE id = $1 AND hired_date IS NOT NULL)
     )
     SELECT
       COALESCE(last_studio.daily_rate, comp.daily_rate, 1500) as daily_rate,
       COALESCE(comp.commission_rate, 10) as commission_rate,
       COALESCE(shifts.completed, 0) as completed_shifts,
       COALESCE(shifts.total, 0) as total_shifts,
       COALESCE(shifts.base_pay, 0) as base_pay,
       COALESCE(pos_rev.revenue, 0) as revenue,
       COALESCE(pos_rev.orders_count, 0) as orders_count,
       COALESCE(manual_rev.amount, 0) as manual_revenue,
       last_studio.studio_name,
       last_studio.location_code,
       COALESCE(trial.cnt, 0) as trial_shifts,
       COALESCE(working_days.cnt, 0) as working_days,
       COALESCE(ytd_earnings.ytd_base, 0) as ytd_base_pay,
       COALESCE(ytd_earnings.ytd_commission, 0) as ytd_commission,
       COALESCE(ytd_trial.ytd_trial_bonus, 0) as ytd_trial_bonus,
       COALESCE(ytd_earnings.ytd_manual_revenue, 0) as ytd_manual_revenue,
       COALESCE(online_rev.total_amount, 0) as online_revenue,
       COALESCE(online_rev.commission, 0) as online_commission,
       COALESCE(online_rev.orders_count, 0) as online_orders_count
     FROM comp
     FULL JOIN shifts ON true
     FULL JOIN pos_rev ON true
     FULL JOIN last_studio ON true
     FULL JOIN manual_rev ON true
     FULL JOIN trial ON true
     FULL JOIN working_days ON true
     FULL JOIN ytd_earnings ON true
     FULL JOIN ytd_trial ON true
     FULL JOIN online_rev ON true`,
    [req.user.id, firstDay, lastDay, nextMonth, monthParam, year, month - 1],
  );

  const dailyRate = parseFloat(row?.daily_rate || '1500');
  const commissionRate = parseFloat(row?.commission_rate || '10');
  const completedShifts = parseInt(row?.completed_shifts || '0', 10);
  const totalShifts = parseInt(row?.total_shifts || '0', 10);
  const posRevenue = parseFloat(row?.revenue || '0');
  const manualRevenue = parseFloat(row?.manual_revenue || '0');
  const onlineRevenue = parseFloat(row?.online_revenue || '0');
  const onlineCommission = parseFloat(row?.online_commission || '0');
  const onlineOrdersCount = parseInt(row?.online_orders_count || '0', 10);
  const totalRevenue = posRevenue + manualRevenue;
  const trialShifts = parseInt(row?.trial_shifts || '0', 10);
  const trialBonus = trialShifts * TRIAL_BONUS_PER_SHIFT;
  const basePay = parseFloat(row?.base_pay || '0');
  const commission = Math.round(totalRevenue * commissionRate) / 100;
  const grossEarnings = basePay + commission + trialBonus + onlineCommission;
  const workingDays = parseInt(row?.working_days || '0', 10);

  // YTD earnings from previous months (for progressive NDFL)
  const ytdBasePay = parseFloat(row?.ytd_base_pay || '0');
  const ytdCommission = parseFloat(row?.ytd_commission || '0');
  const ytdTrialBonus = parseFloat(row?.ytd_trial_bonus || '0');
  const ytdManualRevenue = parseFloat(row?.ytd_manual_revenue || '0');
  const ytdBeforeThisMonth = ytdBasePay + ytdCommission + ytdTrialBonus + ytdManualRevenue;

  // Progressive NDFL calculation
  const ndfl = calculateNdfl(ytdBeforeThisMonth, grossEarnings);
  const netEarnings = grossEarnings - ndfl.ndfl_amount;

  // Employer contributions
  const employerContributions = calculateEmployerContributions(grossEarnings);
  const totalCompanyCost = grossEarnings + employerContributions.total;

  // Pension points
  const ytdGrossIncome = ytdBeforeThisMonth + grossEarnings;
  const pensionPoints = calculatePensionPoints(ytdGrossIncome, grossEarnings);

  const data: EmployeeEarningsView = {
    month: monthParam,
    daily_rate: dailyRate,
    commission_rate: commissionRate,
    completed_shifts: completedShifts,
    total_shifts: totalShifts,
    working_days_in_month: workingDays,
    base_pay: basePay,
    pos_revenue: posRevenue,
    manual_revenue: manualRevenue,
    revenue: totalRevenue,
    commission,
    trial_shifts: trialShifts,
    trial_bonus: trialBonus,
    gross_earnings: grossEarnings,
    ndfl,
    net_earnings: netEarnings,
    employer_contributions: employerContributions,
    total_company_cost: totalCompanyCost,
    pension_points: pensionPoints,
    studio_name: row?.studio_name || null,
    location_code: row?.location_code || null,
    online_revenue: onlineRevenue,
    online_commission: onlineCommission,
    online_orders_count: onlineOrdersCount,
  };

  res.json({ success: true, data });
});

// ============================================================================
// GET /api/shifts/my/history — Employee shift history (paginated)
// ============================================================================
router.get('/my/history', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;

  const monthParam = req.query['month'] as string | undefined;
  const limit = Math.min(parseInt(req.query['limit'] as string, 10) || 20, 100);
  const offset = parseInt(req.query['offset'] as string, 10) || 0;

  let dateFilter = '';
  const params: unknown[] = [req.user.id];

  if (monthParam) {
    const [year, month] = monthParam.split('-').map(Number);
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).toISOString().split('T')[0];
    dateFilter = ` AND es.shift_date BETWEEN $4 AND $5`;
    params.push(limit, offset, firstDay, lastDay);
  } else {
    params.push(limit, offset);
  }

  const shifts = await db.query(
    `SELECT es.*, s.name as studio_name, s.location_code
     FROM employee_shifts es
     JOIN studios s ON s.id = es.studio_id
     WHERE es.employee_id = $1${dateFilter}
     ORDER BY es.shift_date DESC
     LIMIT $2 OFFSET $3`,
    params,
  );

  const totalRow = await db.queryOne<CountResult>(
    `SELECT COUNT(*)::text as count FROM employee_shifts es
     WHERE es.employee_id = $1${monthParam ? ` AND es.shift_date BETWEEN $2 AND $3` : ''}`,
    monthParam
      ? [req.user.id, `${monthParam}-01`, new Date(parseInt(monthParam.split('-')[0], 10), parseInt(monthParam.split('-')[1], 10), 0).toISOString().split('T')[0]]
      : [req.user.id],
  );

  res.json({
    success: true,
    data: shifts,
    total: parseInt(totalRow?.count || '0', 10),
  });
});

// ============================================================================
// POST /api/shifts/check-conflicts — Проверка конфликтов перед созданием смены
// ============================================================================
router.post('/check-conflicts', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { employee_id, dates, exclude_shift_id } = req.body;

  if (!employee_id || !dates || !Array.isArray(dates) || dates.length === 0) {
    throw new AppError(400, 'employee_id и dates[] обязательны');
  }

  const conflicts = await db.query(
    `SELECT es.id, es.shift_date::text, es.start_time::text, es.end_time::text, es.status,
            s.name as studio_name
     FROM employee_shifts es
     JOIN studios s ON s.id = es.studio_id
     WHERE es.employee_id = $1
       AND es.shift_date = ANY($2::date[])
       AND es.status != 'cancelled'
       AND ($3::uuid IS NULL OR es.id != $3)
     ORDER BY es.shift_date`,
    [employee_id, dates, exclude_shift_id || null]
  );

  res.json({
    success: true,
    data: {
      conflicts,
      has_conflicts: conflicts.length > 0,
    },
  });
});

// ============================================================================
// POST /api/shifts — Create shift (admin)
// ============================================================================
router.post('/', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Требуются права администратора или менеджера');
  }
  const { employee_id, studio_id, shift_date, start_time, end_time, notes } = req.body;

  if (typeof employee_id !== 'string' || !employee_id.trim() || !studio_id || !shift_date) {
    throw new AppError(400, 'employee_id, studio_id, and shift_date are required');
  }
  await assertUserCanHaveShift(employee_id);

  const shift = await db.queryOne(
    `INSERT INTO employee_shifts (employee_id, studio_id, shift_date, start_time, end_time, notes, base_pay_rate, shift_kind)
     VALUES ($1, $2, $3, $4, $5, $6, ${studioBasePayRateSql('$2')}, ${studioShiftKindSql('$2')})
     RETURNING *, shift_date::text as shift_date`,
    [employee_id, studio_id, shift_date, start_time || '09:00', end_time || '19:30', notes || null]
  );

  const assignedShiftDate = String(shift?.shift_date ?? shift_date);

  // Audit log
  if (shift) {
    await db.query(
      `INSERT INTO shift_history_log (shift_id, action, changed_by) VALUES ($1, 'created', $2)`,
      [shift.id, req.user.id]
    ).catch(err => log.error('Failed to write shift create audit log', { error: String(err) }));

    await resolveCoveredWorkScheduleRequests(employee_id, req.user.id, [assignedShiftDate])
      .catch(err => log.error('Failed to resolve covered schedule requests after shift create', {
        error: String(err),
        employee_id,
        shift_date: assignedShiftDate,
      }));
  }

  // Notify employee about admin-assigned shift
  NotificationService.create({
    userId: employee_id,
    title: 'Назначена смена',
    body: `Вам назначена смена на ${assignedShiftDate}`,
    type: 'schedule_request',
    data: { action: 'admin_assigned', shift_date: assignedShiftDate },
  }).catch(err => log.error('Failed to create shift assignment notification', { error: String(err), employee_id, shift_date: assignedShiftDate }));

  const createSocket = getShiftSocketServer(req);
  if (createSocket) {
    createSocket.sendNotificationToUser(employee_id, {
      type: 'schedule_request',
      title: 'Назначена смена',
      body: `Вам назначена смена на ${assignedShiftDate}`,
      data: { action: 'admin_assigned', shift_date: assignedShiftDate },
    });
  }

  res.status(201).json({ success: true, data: toShiftResponse(shift) });
});

// ============================================================================
// POST /api/shifts/bulk — Bulk create shifts (admin)
// ============================================================================
router.post('/bulk', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Требуются права администратора или менеджера');
  }
  const { shifts } = req.body;

  if (!shifts || !Array.isArray(shifts) || shifts.length === 0) {
    throw new AppError(400, 'shifts array is required');
  }

  const employeeIds: string[] = [];
  for (const shift of shifts) {
    if (
      !shift
      || typeof shift !== 'object'
      || typeof shift.employee_id !== 'string'
      || !shift.employee_id.trim()
      || !shift.studio_id
      || !shift.shift_date
    ) {
      throw new AppError(400, 'Each shift requires employee_id, studio_id, and shift_date');
    }
    employeeIds.push(shift.employee_id);
  }
  await assertUsersCanHaveShifts(employeeIds);

  const created: Parameters<typeof toShiftResponse>[0][] = [];
  const touchedDatesByEmployee = new Map<string, string[]>();
  for (const s of shifts) {
    try {
      const shift = await db.queryOne(
        `INSERT INTO employee_shifts (employee_id, studio_id, shift_date, start_time, end_time, notes, base_pay_rate, shift_kind)
         VALUES ($1, $2, $3, $4, $5, $6, ${studioBasePayRateSql('$2')}, ${studioShiftKindSql('$2')})
         ON CONFLICT (employee_id, shift_date) WHERE status IN ('scheduled', 'active') DO UPDATE SET
           studio_id = EXCLUDED.studio_id,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           notes = EXCLUDED.notes,
           base_pay_rate = EXCLUDED.base_pay_rate,
           shift_kind = EXCLUDED.shift_kind,
           updated_at = NOW()
         RETURNING *, shift_date::text as shift_date`,
        [s.employee_id, s.studio_id, s.shift_date, s.start_time || '09:00', s.end_time || '19:30', s.notes || null]
      );
      if (!shift) continue;
      created.push(shift);
      const shiftDate = String(shift?.shift_date ?? s.shift_date);
      touchedDatesByEmployee.set(s.employee_id, [
        ...(touchedDatesByEmployee.get(s.employee_id) ?? []),
        shiftDate,
      ]);
    } catch (err) {
      log.error('Failed to create bulk shift', {
        error: String(err),
        employee_id: String(s.employee_id),
        shift_date: String(s.shift_date),
      });
      // Skip individual shift failures, continue with the rest.
    }
  }

  for (const [employeeId, dates] of touchedDatesByEmployee.entries()) {
    await resolveCoveredWorkScheduleRequests(employeeId, req.user.id, dates)
      .catch(err => log.error('Failed to resolve covered schedule requests after bulk shift create', {
        error: String(err),
        employee_id: employeeId,
        dates,
      }));
  }

  res.status(201).json({ success: true, data: created.map(toShiftResponse), count: created.length });
});

// ============================================================================
// POST /api/shifts/workday/start — Start workday for pult payment links
// ============================================================================
router.post('/workday/start', authenticateToken, requirePermission('shifts:manage'), startWorkday);

// ============================================================================
// POST /api/shifts/virtual/open — legacy alias for existing clients
// ============================================================================
router.post('/virtual/open', authenticateToken, requirePermission('shifts:manage'), startWorkday);

// ============================================================================
// PUT /api/shifts/my/:id — Employee edits own not-yet-started shift
// ============================================================================
router.put('/my/:id', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;

  const id = req.params['id'];
  const { studio_id, start_time, end_time } = req.body;

  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (studio_id !== undefined) {
    if (typeof studio_id !== 'string' || !UUID_RE.test(studio_id)) {
      throw new AppError(400, 'studio_id должен быть корректным UUID');
    }
    await assertStudioIdsExist([studio_id]);
    fields.push(`studio_id = $${idx}`);
    fields.push(`base_pay_rate = ${studioBasePayRateSql(`$${idx}`)}`);
    fields.push(`shift_kind = ${studioShiftKindSql(`$${idx}`)}`);
    params.push(studio_id);
    idx++;
  }

  const nextStartTime = requireTimeValue(start_time, 'start_time');
  if (nextStartTime !== undefined) {
    fields.push(`start_time = $${idx++}`);
    params.push(nextStartTime);
  }

  const nextEndTime = requireTimeValue(end_time, 'end_time');
  if (nextEndTime !== undefined) {
    fields.push(`end_time = $${idx++}`);
    params.push(nextEndTime);
  }

  if (fields.length === 0) {
    throw new AppError(400, 'Нет полей для изменения');
  }

  params.push(id, req.user.id);
  const shift = await db.queryOne<EmployeeShifts>(
    `UPDATE employee_shifts
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${idx}
       AND employee_id = $${idx + 1}
       AND status = 'scheduled'
       AND shift_date >= CURRENT_DATE
     RETURNING *, shift_date::text as shift_date`,
    params,
  );

  if (!shift) {
    throw new AppError(404, 'Рабочий день не найден или уже начат');
  }

  await db.query(
    `INSERT INTO shift_history_log (shift_id, action, changed_by, new_values)
     VALUES ($1, 'updated', $2, $3::jsonb)`,
    [shift.id, req.user.id, JSON.stringify({ source: 'employee_workday_dialog', studio_id, start_time, end_time })],
  ).catch(err => log.error('Failed to write employee shift update audit log', { error: String(err), shiftId: shift.id }));

  res.json({ success: true, data: toShiftResponse(shift) });
});

// ============================================================================
// PUT /api/shifts/:id — Update shift (admin)
// ============================================================================
router.put('/:id', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Требуются права администратора или менеджера');
  }
  const id = req.params['id'];
  const { studio_id, shift_date, start_time, end_time, status, notes } = req.body;

  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (studio_id !== undefined) {
    fields.push(`studio_id = $${idx}`);
    fields.push(`base_pay_rate = ${studioBasePayRateSql(`$${idx}`)}`);
    fields.push(`shift_kind = ${studioShiftKindSql(`$${idx}`)}`);
    params.push(studio_id);
    idx++;
  }
  if (shift_date !== undefined) { fields.push(`shift_date = $${idx++}`); params.push(shift_date); }
  if (start_time !== undefined) { fields.push(`start_time = $${idx++}`); params.push(start_time); }
  if (end_time !== undefined) { fields.push(`end_time = $${idx++}`); params.push(end_time); }
  if (status !== undefined) { fields.push(`status = $${idx++}`); params.push(status); }
  if (notes !== undefined) { fields.push(`notes = $${idx++}`); params.push(notes); }

  if (fields.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  params.push(id);
  const shift = await db.queryOne<EmployeeShifts>(
    `UPDATE employee_shifts SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *, shift_date::text as shift_date`,
    params
  );

  if (!shift) {
    throw new AppError(404, 'Shift not found');
  }

  // Notify employee about shift modification
  NotificationService.create({
    userId: shift.employee_id,
    title: 'Смена изменена',
    body: `Ваша смена на ${shift.shift_date} была изменена администратором`,
    type: 'schedule_request',
    data: { action: 'admin_modified', shift_id: id },
  }).catch(err => log.error('Failed to create shift modification notification', { error: String(err), shiftId: id }));

  const updateSocket = getShiftSocketServer(req);
  if (updateSocket) {
    updateSocket.sendNotificationToUser(shift.employee_id, {
      type: 'schedule_request',
      title: 'Смена изменена',
      body: `Ваша смена на ${shift.shift_date} была изменена администратором`,
      data: { action: 'admin_modified', shift_id: id },
    });
  }

  res.json({ success: true, data: toShiftResponse(shift) });
});

// ============================================================================
// DELETE /api/shifts/:id — Delete shift (admin)
// ============================================================================
router.delete('/:id', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Требуются права администратора или менеджера');
  }
  const id = req.params['id'];

  const deleted = await db.queryOne<Pick<EmployeeShifts, 'id' | 'employee_id' | 'shift_date'>>(
    'DELETE FROM employee_shifts WHERE id = $1 RETURNING id, employee_id, shift_date',
    [id]
  );

  if (!deleted) {
    throw new AppError(404, 'Shift not found');
  }

  // Notify employee about shift cancellation
  NotificationService.create({
    userId: deleted.employee_id,
    title: 'Смена отменена',
    body: `Ваша смена на ${deleted.shift_date} была отменена администратором`,
    type: 'schedule_request',
    data: { action: 'admin_cancelled', shift_id: id },
  }).catch(err => log.error('Failed to create shift cancellation notification', { error: String(err), shiftId: id }));

  const deleteSocket = getShiftSocketServer(req);
  if (deleteSocket) {
    deleteSocket.sendNotificationToUser(deleted.employee_id, {
      type: 'schedule_request',
      title: 'Смена отменена',
      body: `Ваша смена на ${deleted.shift_date} была отменена администратором`,
      data: { action: 'admin_cancelled', shift_id: id },
    });
  }

  res.json({ success: true, data: { deleted: true } });
});

// ============================================================================
// POST /api/shifts/:id/check-in — Start shift
// ============================================================================
router.post('/:id/check-in', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const id = req.params['id'];
  const cashAtOpen = requireCashAmount(req.body?.cash_at_open, 'cash_at_open');

  const shift = await db.queryOne<EmployeeShiftCashRow>(
    `UPDATE employee_shifts
     SET status = 'active',
         checked_in_at = NOW(),
         cash_at_open = $3,
         base_pay_rate = COALESCE(base_pay_rate, ${studioBasePayRateSql('employee_shifts.studio_id')}),
         updated_at = NOW()
     WHERE id = $1 AND employee_id = $2 AND status = 'scheduled'
     RETURNING *, shift_date::text as shift_date`,
    [id, req.user.id, cashAtOpen]
  );

  if (!shift) {
    throw new AppError(404, 'Shift not found or already active');
  }

  // Автоматически связать с открытой POS-сменой если есть
  const openPosShift = await db.queryOne<Pick<PosShifts, 'id'>>(
    `SELECT id FROM pos_shifts WHERE employee_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
    [req.user.id],
  );
  if (openPosShift) {
    await db.queryOne(
      `UPDATE employee_shifts SET pos_shift_id = $1 WHERE id = $2 AND pos_shift_id IS NULL`,
      [openPosShift.id, id],
    );
  }


  // Audit log
  await db.query(
    `INSERT INTO shift_history_log (shift_id, action, changed_by, new_values) VALUES ($1, 'checked_in', $2, $3::jsonb)`,
    [req.params['id'], req.user.id, JSON.stringify({ cash_at_open: cashAtOpen })]
  ).catch(err => log.error('Failed to write check-in audit log', { error: String(err) }));

  log.info(`[Shifts] Check-in: ${req.user.id} at studio ${shift.studio_id}, cash_at_open: ${cashAtOpen}, pos_shift: ${openPosShift?.id ?? 'none'}`);

  res.json({ success: true, data: toShiftResponse(shift) });
});

// ============================================================================
// POST /api/shifts/:id/check-out — End shift
// ============================================================================
router.post('/:id/check-out', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const id = req.params['id'];
  const cashAtClose = requireCashAmount(req.body?.cash_at_close, 'cash_at_close');

  let shift = await db.queryOne<EmployeeShiftCashRow>(
    `UPDATE employee_shifts SET status = 'completed', checked_out_at = NOW(), cash_at_close = $3, updated_at = NOW()
     WHERE id = $1 AND employee_id = $2 AND status = 'active'
     RETURNING *, shift_date::text as shift_date`,
    [id, req.user.id, cashAtClose]
  );
  let completedByPreviousRequest = false;

  if (!shift) {
    completedByPreviousRequest = true;
    shift = await db.queryOne<EmployeeShiftCashRow>(
      `SELECT *, shift_date::text as shift_date
       FROM employee_shifts
       WHERE id = $1 AND employee_id = $2 AND status = 'completed'`,
      [id, req.user.id],
    );

    if (!shift) {
      throw new AppError(404, 'Shift not found or not active');
    }
  }

  // Кэшировать все итоги за смену (online + total + commission)
  const refreshedShift = await db.queryOne<EmployeeShiftCashRow>(
    `UPDATE employee_shifts SET
       online_earnings = COALESCE(online_sub.amount, 0),
       online_count = COALESCE(online_sub.cnt, 0),
       sales_total = COALESCE(all_sub.total, 0),
       commission_total = COALESCE(all_sub.commission, 0),
       receipts_count = COALESCE(all_sub.cnt, 0)
     FROM (
       SELECT COALESCE(SUM(receipt_total), 0) as amount, COUNT(*) as cnt
       FROM employee_sales WHERE shift_id = $1 AND source = 'online'
     ) online_sub,
     (
       SELECT COALESCE(SUM(receipt_total), 0) as total,
              COALESCE(SUM(commission_amount), 0) as commission,
              COUNT(*) as cnt
       FROM employee_sales WHERE shift_id = $1
     ) all_sub
     WHERE employee_shifts.id = $1 AND employee_shifts.employee_id = $2
     RETURNING employee_shifts.*, employee_shifts.shift_date::text as shift_date`,
    [id, req.user.id],
  );
  shift = refreshedShift ?? shift;


  if (!completedByPreviousRequest) {
    // Audit log
    await db.query(
      `INSERT INTO shift_history_log (shift_id, action, changed_by, new_values) VALUES ($1, 'checked_out', $2, $3::jsonb)`,
      [id, req.user.id, JSON.stringify({ shift_id: id, cash_at_close: cashAtClose })]
    ).catch(err => log.error('Failed to write check-out audit log', { error: String(err) }));
  }

  // Авто-закрытие привязанной кассовой смены (pos_shifts) тем же остатком, что ввёл
  // сотрудник при закрытии рабочего дня. Отдельный ручной ввод суммы для кассы не нужен:
  // если pos_shift открыта и принадлежит этому сотруднику — закрываем её здесь, без участия
  // 12-часового таймера. Best-effort: ошибка (уже закрыта / нет смены / сбой ФР) не должна
  // ломать сам check-out — остаток рабочего дня уже сохранён выше.
  if (!completedByPreviousRequest && shift.pos_shift_id) {
    const posShiftId = shift.pos_shift_id;
    const checkoutEmployeeId = req.user.id;
    try {
      let fiscalShiftWasOpen = false;
      try {
        fiscalShiftWasOpen = await isFiscalShiftOpenForShift(posShiftId);
      } catch (fiscalStatusErr: unknown) {
        log.warn('[Shifts] Fiscal shift status check failed on check-out', {
          posShiftId,
          error: String(fiscalStatusErr),
        });
      }

      const { shift: closedPosShift } = await closeShift({ shift_id: posShiftId, employee_id: checkoutEmployeeId, cash_at_close: cashAtClose });
      log.info(`[Shifts] Auto-closed POS shift ${posShiftId} on check-out, cash_at_close: ${cashAtClose}`);

      // Контур #2: сверка эквайринга (op59) при закрытии последней смены студии.
      // Check-out — основной путь закрытия кассы (кассиры редко закрывают вручную через
      // /pos/shifts/close), поэтому сверку вешаем и здесь, рядом с авто-закрытием pos_shift.
      // Fire-and-forget: закрытие НЕ ждёт op59 и не падает при ошибке сверки.
      // enqueueShiftReconciliation идемпотентна по shift_id и дедуплицирует op59.
      const openShifts = await db.queryOne<CountResult>(
        `SELECT COUNT(*)::text AS count FROM pos_shifts WHERE status = 'open' AND studio_id = $1`,
        [closedPosShift.studio_id],
      );
      if (parseInt(openShifts?.count || '0', 10) === 0) {
        if (fiscalShiftWasOpen) {
          const fiscalTransactionId = await enqueueShiftFiscalCommand(
            closedPosShift.studio_id,
            'shift_close',
            checkoutEmployeeId,
          );
          if (fiscalTransactionId) {
            log.info('[Shifts] Fiscal shift_close enqueued on check-out', {
              posShiftId,
              studioId: closedPosShift.studio_id,
              fiscalTransactionId,
            });
          } else {
            log.warn('[Shifts] Fiscal shift_close was needed on check-out but no active POS-agent was available', {
              posShiftId,
              studioId: closedPosShift.studio_id,
            });
          }
        }

        enqueueShiftReconciliation(posShiftId, closedPosShift.studio_id).catch((reconErr: unknown) => {
          log.error('[Shifts] Shift reconciliation enqueue failed on check-out', {
            posShiftId,
            studioId: closedPosShift.studio_id,
            error: String(reconErr),
          });
        });
      }
    } catch (err) {
      log.warn('[Shifts] POS shift auto-close on check-out skipped', { posShiftId, error: String(err) });
    }
  }

  // Checkout summary
  const checkoutSummary = await db.queryOne<ShiftCheckoutSummaryRow>(
    `SELECT
       EXTRACT(EPOCH FROM (es.checked_out_at - es.checked_in_at)) / 3600 as hours_worked,
       es.receipts_count as pos_count,
       es.sales_total as pos_total,
       es.commission_total,
       es.online_count,
       es.online_earnings as online_total
     FROM employee_shifts es WHERE es.id = $1`,
    [id]
  );

  // Check for tasks that need handoff
  const pendingTasks = await db.query(
    `SELECT id, task_number, title, status FROM work_tasks
     WHERE assigned_to = $1 AND status IN ('in_progress', 'assigned', 'waiting')`,
    [req.user.id]
  );

  log.info(`[Shifts] Check-out: shift ${shift.id}, employee ${req.user.id}, cash_at_close: ${shift.cash_at_close ?? cashAtClose}, pending tasks: ${pendingTasks.length}, replay: ${completedByPreviousRequest}`);

  if (!completedByPreviousRequest) {
    const checkoutUserId = req.user.id;
    import('../services/employee-gamification.service.js')
      .then(({ awardXP }) => awardXP(checkoutUserId, 'shift_completed', shift.id, 'Смена завершена'))
      .catch(err => log.error('Failed to award shift completion XP', { error: String(err), userId: checkoutUserId, shiftId: shift.id }));
  }

  res.json({
    success: true,
    data: toShiftResponse(shift),
    checkout_summary: checkoutSummary ? {
      hours_worked: parseFloat(checkoutSummary.hours_worked || '0'),
      pos_sales: parseFloat(checkoutSummary.pos_total || '0'),
      pos_count: parseInt(checkoutSummary.pos_count || '0', 10),
      online_sales: parseFloat(checkoutSummary.online_total || '0'),
      online_count: parseInt(checkoutSummary.online_count || '0', 10),
      total_commission: parseFloat(checkoutSummary.commission_total || '0'),
      total_revenue: parseFloat(checkoutSummary.pos_total || '0') + parseFloat(checkoutSummary.online_total || '0'),
    } : null,
    pending_tasks: pendingTasks,
    warning: pendingTasks.length > 0 ? `У вас ${pendingTasks.length} незавершённых задач. Передайте их следующей смене.` : null,
  });
});

// ============================================================================
// GET /api/shifts/:id/online-earnings — Online payments attributed to this shift
// ============================================================================
router.get('/:id/online-earnings', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const id = req.params['id'];

  const row = await db.queryOne<OnlineEarningsSummaryRow>(
    `SELECT COUNT(*)::text as count,
            COALESCE(SUM(receipt_total), 0)::text as amount,
            COALESCE(SUM(commission_amount), 0)::text as commission
     FROM employee_sales es
     JOIN employee_shifts esh ON esh.id = es.shift_id
     WHERE es.shift_id = $1 AND es.source = 'online'
       AND esh.employee_id = $2`,
    [id, req.user.id],
  );

  res.json({
    success: true,
    data: {
      count: parseInt(row?.count || '0', 10),
      amount: parseFloat(row?.amount || '0'),
      commission: parseFloat(row?.commission || '0'),
    },
  });
});

// ============================================================================
// GET /api/shifts/:id/briefing — Get AI briefing for shift
// ============================================================================
router.get('/:id/briefing', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const id = req.params['id'];

  // Get existing briefing
  let briefing = await db.queryOne(
    'SELECT id, shift_id, employee_id, studio_id, briefing_date, summary, structured_data, is_read, read_at, generated_at, created_at FROM shift_briefings WHERE shift_id = $1',
    [id]
  );

  if (!briefing) {
    // Generate structured briefing from data
    const shift = await db.queryOne(
      `SELECT es.*, s.name as studio_name, s.location_code
       FROM employee_shifts es JOIN studios s ON s.id = es.studio_id
       WHERE es.id = $1`,
      [id]
    );

    if (!shift) {
      throw new AppError(404, 'Shift not found');
    }

    // Gather data for briefing
    const activeTasks = await db.query<WorkTaskBrief>(
      `SELECT id, task_number, title, task_type, status, priority, client_name, client_phone, client_channel, assigned_to, assigned_studio_id, due_date, description, metadata, created_at, updated_at
       FROM work_tasks
       WHERE assigned_studio_id = $1::uuid AND status IN ('open', 'assigned', 'in_progress', 'waiting', 'handed_off')
       ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at ASC`,
      [shift.studio_id]
    );

    const pendingHandoffs = await db.query(
      `SELECT h.*, t.title, t.task_number, t.client_name, u.display_name as from_name
       FROM task_handoffs h
       JOIN work_tasks t ON t.id = h.task_id
       JOIN users u ON u.id = h.from_employee_id
       WHERE h.acknowledged = FALSE
         AND (h.to_employee_id = $1 OR h.to_employee_id IS NULL)
         AND t.assigned_studio_id = $2::uuid`,
      [shift.employee_id, shift.studio_id]
    );

    const todayBookings = await db.query(
      `SELECT b.*, u.display_name as client_name
       FROM bookings b
       LEFT JOIN users u ON u.id = b.client_id
       WHERE DATE(b.start_time) = $1 AND b.status IN ('pending', 'confirmed')
       ORDER BY b.start_time ASC`,
      [shift.shift_date]
    );

    // Попробуем сгенерировать AI-сводку
    const aiResult = await generateShiftBriefing(shift.employee_id, shift.studio_id, shift.shift_date);

    let summary: string;
    let structured: unknown;

    if (aiResult) {
      summary = aiResult.summary;
      structured = aiResult.structuredData;
    } else {
      // Fallback: ручная сводка
      structured = {
        active_tasks: activeTasks.length,
        urgent_tasks: activeTasks.filter(t => t.priority === 'urgent' || t.priority === 'high').length,
        handed_off_tasks: pendingHandoffs.length,
        todays_bookings: todayBookings.length,
      };
      const lines: string[] = [];
      const urgentTasks = activeTasks.filter(t => t.priority === 'urgent' || t.priority === 'high');
      if (urgentTasks.length > 0) {
        lines.push(`Срочные задачи (${urgentTasks.length}):`);
        for (const t of urgentTasks) {
          lines.push(`  - #${t.task_number} ${t.title} (${t.client_name || 'без клиента'})`);
        }
      }
      if (pendingHandoffs.length > 0) {
        lines.push(`Переданные задачи (${pendingHandoffs.length}):`);
        for (const h of pendingHandoffs) {
          lines.push(`  - #${h.task_number} ${h.title} от ${h.from_name}: ${(h.handoff_note || '').substring(0, 100)}`);
        }
      }
      if (todayBookings.length > 0) {
        lines.push(`Бронирования на сегодня (${todayBookings.length}):`);
        for (const b of todayBookings) {
          const time = new Date(b.start_time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          lines.push(`  - ${time} — ${b.client_name || 'Клиент'}`);
        }
      }
      if (activeTasks.length > 0 && urgentTasks.length === 0) {
        lines.push(`Активные задачи: ${activeTasks.length}`);
      }
      if (lines.length === 0) {
        lines.push('Нет активных задач и передач. Спокойная смена!');
      }
      summary = lines.join('\n');
    }

    briefing = await db.queryOne(
      `INSERT INTO shift_briefings (shift_id, employee_id, studio_id, briefing_date, summary, structured_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (shift_id) DO UPDATE SET summary = $5, structured_data = $6, generated_at = NOW()
       RETURNING *`,
      [id, shift.employee_id, shift.studio_id, shift.shift_date, summary, JSON.stringify(structured)]
    );
  }

  res.json({ success: true, data: briefing });
});

// ============================================================================
// POST /api/shifts/:id/briefing/read — Mark briefing as read
// ============================================================================
router.post('/:id/briefing/read', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const id = req.params['id'];

  const briefing = await db.queryOne(
    `UPDATE shift_briefings SET is_read = TRUE, read_at = NOW()
     WHERE shift_id = $1 AND employee_id = $2
     RETURNING *`,
    [id, req.user.id]
  );

  if (!briefing) {
    throw new AppError(404, 'Briefing not found');
  }

  res.json({ success: true, data: briefing });
});

// ============================================================================
// GET /api/employee-dashboard — Employee dashboard summary
// ============================================================================
router.get('/employee-dashboard', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  // Current shift
  const myShift = await db.queryOne(
    `SELECT es.*, s.name as studio_name, s.address as studio_address, s.location_code
     FROM employee_shifts es
     JOIN studios s ON s.id = es.studio_id
     WHERE es.employee_id = $1 AND es.shift_date = CURRENT_DATE
       AND es.status IN ('scheduled', 'active')
     LIMIT 1`,
    [req.user.id]
  );

  // My tasks
  const myTasks = await db.query(
    `SELECT id, task_number, title, status, priority, task_type, client_name, due_date
     FROM work_tasks
     WHERE assigned_to = $1 AND status NOT IN ('completed', 'cancelled')
     ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at ASC`,
    [req.user.id]
  );

  // Pending handoffs for me
  const pendingHandoffs = await db.query(
    `SELECT h.id, h.handoff_note, h.created_at,
            t.id as task_id, t.task_number, t.title, t.client_name,
            u.display_name as from_name
     FROM task_handoffs h
     JOIN work_tasks t ON t.id = h.task_id
     JOIN users u ON u.id = h.from_employee_id
     WHERE h.acknowledged = FALSE
       AND (h.to_employee_id = $1 OR (h.to_employee_id IS NULL AND t.assigned_studio_id = $2::uuid))`,
    [req.user.id, myShift?.studio_id || null]
  );

  // Unread briefing
  const unreadBriefing = myShift ? await db.queryOne(
    `SELECT id, summary FROM shift_briefings
     WHERE shift_id = $1 AND is_read = FALSE`,
    [myShift.id]
  ) : null;

  // Colleague on other location
  let colleague = null;
  if (myShift) {
    colleague = await db.queryOne(
      `SELECT u.display_name, u.phone, s.name as studio_name, s.location_code
       FROM employee_shifts es
       JOIN users u ON u.id = es.employee_id
       JOIN studios s ON s.id = es.studio_id
       WHERE es.shift_date = CURRENT_DATE
         AND es.studio_id != $1
         AND es.status IN ('scheduled', 'active')
       LIMIT 1`,
      [myShift.studio_id]
    );
  }

  // Studio tasks summary
  const tasksSummary = myShift ? await db.queryOne<EmployeeDashboardTaskSummary>(
    `SELECT
       COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled')) as total,
       COUNT(*) FILTER (WHERE priority IN ('urgent', 'high') AND status NOT IN ('completed', 'cancelled')) as urgent,
       COUNT(*) FILTER (WHERE status = 'waiting') as waiting
     FROM work_tasks
     WHERE assigned_studio_id = $1::uuid`,
    [myShift.studio_id]
  ) : null;

  // Recent orders (last 10)
  const recentOrders = await db.query(
    `SELECT order_id, contact_name, contact_phone, total_price, status, payment_status, priority, created_at
     FROM photo_print_orders
     ORDER BY created_at DESC LIMIT 10`
  );

  // Today's stats
  const todayStats = await db.queryOne<TodayOrderStats>(
    `SELECT
       COUNT(*) as orders_today,
       COALESCE(SUM(total_price), 0) as revenue_today
     FROM photo_print_orders
     WHERE created_at >= CURRENT_DATE AND payment_status = 'paid'`
  );

  res.json({
    success: true,
    data: {
      shift: myShift,
      my_tasks: myTasks,
      pending_handoffs: pendingHandoffs,
      unread_briefing: unreadBriefing,
      colleague,
      tasks_summary: tasksSummary ? {
        total: parseInt(tasksSummary.total || '0'),
        urgent: parseInt(tasksSummary.urgent || '0'),
        waiting: parseInt(tasksSummary.waiting || '0'),
      } : null,
      recent_orders: recentOrders,
      today_stats: {
        orders_today: parseInt(todayStats?.orders_today || '0'),
        revenue_today: parseFloat(todayStats?.revenue_today || '0'),
      },
    },
  });
});

// ============================================================================
// TAX DEDUCTIONS (Налоговые вычеты — возврат НДФЛ)
// ============================================================================

const TAX_CATEGORY_LABELS: Record<string, string> = {
  medical: 'Лечение',
  education: 'Обучение',
  sport: 'Спорт',
  property: 'Имущественный',
  children: 'Стандартный на детей',
  charity: 'Благотворительность',
  professional: 'Профессиональный',
  other: 'Прочее',
};

const VALID_TAX_CATEGORIES = Object.keys(TAX_CATEGORY_LABELS);

// GET /api/shifts/my/tax-deductions?year=2026
router.get('/my/tax-deductions', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const year = parseInt(req.query['year'] as string) || new Date().getFullYear();

  const rows = await db.query<TaxDeductionRow>(
    `SELECT id, deduction_category, amount, refund_amount, description,
            tax_year, status, document_url, notes, approved_at, created_at
     FROM employee_tax_deductions
     WHERE employee_id = $1 AND tax_year = $2
     ORDER BY created_at DESC`,
    [req.user.id, year]
  );

  const data = rows.map(r => ({
    ...r,
    amount: parseFloat(r.amount),
    refund_amount: parseFloat(r.refund_amount ?? '0'),
    category_label: TAX_CATEGORY_LABELS[r.deduction_category] || r.deduction_category,
  }));

  res.json({ success: true, data });
});

// POST /api/shifts/my/tax-deductions — подать заявку на вычет
router.post('/my/tax-deductions', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const { deduction_category, amount, description, tax_year, document_url } = req.body;

  if (!deduction_category || !amount || !description) {
    throw new AppError(400, 'deduction_category, amount и description обязательны');
  }
  if (!VALID_TAX_CATEGORIES.includes(deduction_category)) {
    throw new AppError(400, `Категория должна быть: ${VALID_TAX_CATEGORIES.join(', ')}`);
  }
  if (typeof amount !== 'number' || amount <= 0) {
    throw new AppError(400, 'amount должен быть положительным числом');
  }

  const year = tax_year || new Date().getFullYear();

  const row = await db.queryOne<TaxDeductionCreateRow>(
    `INSERT INTO employee_tax_deductions (employee_id, deduction_category, amount, description, tax_year, document_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, deduction_category, amount, refund_amount, status, created_at`,
    [req.user.id, deduction_category, amount, description, year, document_url || null]
  );

  res.status(201).json({
    success: true,
    data: row ? {
      ...row,
      amount: parseFloat(row.amount),
      refund_amount: parseFloat(row.refund_amount ?? '0'),
      category_label: TAX_CATEGORY_LABELS[deduction_category] || deduction_category,
    } : null,
  });
});

// PUT /api/shifts/tax-deductions/:id/status — админ меняет статус
router.put('/tax-deductions/:id/status', authenticateToken, requirePermission('users:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const { id } = req.params;
  const { status, notes } = req.body;
  const validStatuses = ['pending', 'approved', 'applied', 'rejected'];

  if (!status || !validStatuses.includes(status)) {
    throw new AppError(400, `status должен быть: ${validStatuses.join(', ')}`);
  }

  const approvedFields = ['approved', 'applied'].includes(status)
    ? ', approved_by = $4, approved_at = NOW()'
    : '';

  const params: unknown[] = [status, notes || null, id];
  if (approvedFields) params.push(req.user.id);

  const row = await db.queryOne(
    `UPDATE employee_tax_deductions
     SET status = $1, notes = $2${approvedFields}
     WHERE id = $3
     RETURNING *`,
    params
  );

  if (!row) throw new AppError(404, 'Вычет не найден');
  res.json({ success: true, data: row });
});

// DELETE /api/shifts/my/tax-deductions/:id — сотрудник удаляет свою заявку (только pending)
router.delete('/my/tax-deductions/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const { id } = req.params;

  const deleted = await db.queryOne(
    `DELETE FROM employee_tax_deductions
     WHERE id = $1 AND employee_id = $2 AND status = 'pending'
     RETURNING id`,
    [id, req.user.id]
  );

  if (!deleted) throw new AppError(404, 'Вычет не найден или уже обработан');
  res.json({ success: true });
});

// ============================================================================
// ADMIN: GET /api/shifts/admin/earnings — All employees earnings for a month
// ============================================================================
router.get('/admin/earnings', authenticateToken, requirePermission('users:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;

  const monthParam = (req.query['month'] as string) || new Date().toISOString().slice(0, 7);
  const [year, month] = monthParam.split('-').map(Number);
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).toISOString().split('T')[0];
  const nextMonth = `${month + 1 > 12 ? year + 1 : year}-${String(month + 1 > 12 ? 1 : month + 1).padStart(2, '0')}-01`;

  const rows = await db.query<AdminEmployeeEarningsRow>(
    `WITH active_staff AS (
       SELECT id, display_name, role, photo_url
       FROM users
       WHERE role NOT IN ('client', 'partner') AND is_active = true
     ),
     comp AS (
       SELECT DISTINCT ON (ec.employee_id)
         ec.employee_id, ec.daily_rate, ec.commission_rate
       FROM employee_compensation ec
       WHERE ec.effective_from <= $2::date
         AND COALESCE(ec.effective_until, '9999-12-31'::date) > $1::date
       ORDER BY ec.employee_id, ec.effective_from DESC
     ),
     shifts AS (
       SELECT es.employee_id,
         COUNT(*) FILTER (WHERE es.status = 'completed') as completed,
         COUNT(*) as total,
         COALESCE(SUM(
           CASE WHEN es.status = 'completed' THEN
             COALESCE(
               es.base_pay_rate,
               st.employee_shift_rate,
               CASE WHEN st.location_code = 'barrikadnaya-4' THEN 2000 ELSE 1500 END
             )
           ELSE 0 END
         ), 0) as base_pay
       FROM employee_shifts es
       LEFT JOIN studios st ON st.id = es.studio_id
       WHERE es.shift_date BETWEEN $1 AND $2
       GROUP BY es.employee_id
     ),
     pos_rev AS (
       SELECT employee_id,
         COALESCE(SUM(total::numeric), 0) as revenue,
         COUNT(*) as orders_count
       FROM pos_receipts
       WHERE is_refund = false
         AND created_at >= $1::date AND created_at < $3::date
       GROUP BY employee_id
     ),
     manual_rev AS (
       SELECT employee_id, COALESCE(amount, 0) as amount
       FROM employee_manual_revenue
       WHERE month = $4
     ),
     trial_data AS (
       SELECT employee_id, COUNT(*) as trial_shifts FROM (
         SELECT es.employee_id, es.shift_date,
           ROW_NUMBER() OVER (PARTITION BY es.employee_id ORDER BY es.shift_date) as rn
         FROM employee_shifts es
         JOIN users u ON u.id = es.employee_id AND u.hired_date IS NOT NULL
         WHERE es.status = 'completed' AND es.shift_date >= u.hired_date
       ) ranked
       WHERE rn <= ${TRIAL_SHIFT_COUNT} AND shift_date BETWEEN $1 AND $2
       GROUP BY employee_id
     ),
     online_rev AS (
       SELECT sale.employee_id,
         COALESCE(SUM(sale.receipt_total), 0) as online_revenue,
         COALESCE(SUM(sale.commission_amount), 0) as online_commission,
         COUNT(*) as online_orders_count
       FROM employee_sales sale
       LEFT JOIN employee_shifts es ON es.id = sale.shift_id
       WHERE sale.source = 'online'
         AND COALESCE(es.shift_date, sale.created_at::date) >= $1::date
         AND COALESCE(es.shift_date, sale.created_at::date) < $3::date
       GROUP BY sale.employee_id
     )
     SELECT
       s.id as employee_id,
       s.display_name,
       s.role,
       s.photo_url,
       COALESCE(c.daily_rate, 1500) as daily_rate,
       COALESCE(c.commission_rate, 10) as commission_rate,
       COALESCE(sh.completed, 0) as completed_shifts,
       COALESCE(sh.total, 0) as total_shifts,
       COALESCE(sh.base_pay, 0) as base_pay,
       COALESCE(pr.revenue, 0) as revenue,
       COALESCE(pr.orders_count, 0) as orders_count,
       COALESCE(mr.amount, 0) as manual_revenue,
       COALESCE(td.trial_shifts, 0) as trial_shifts,
       COALESCE(olr.online_revenue, 0) as online_revenue,
       COALESCE(olr.online_commission, 0) as online_commission,
       COALESCE(olr.online_orders_count, 0) as online_orders_count
     FROM active_staff s
     LEFT JOIN comp c ON c.employee_id = s.id
     LEFT JOIN shifts sh ON sh.employee_id = s.id
     LEFT JOIN pos_rev pr ON pr.employee_id = s.id
     LEFT JOIN manual_rev mr ON mr.employee_id = s.id
     LEFT JOIN trial_data td ON td.employee_id = s.id
     LEFT JOIN online_rev olr ON olr.employee_id = s.id
     ORDER BY s.display_name`,
    [firstDay, lastDay, nextMonth, monthParam],
  );

  const data = rows.map(r => {
    const dailyRate = parseFloat(r.daily_rate || '1500');
    const commissionRate = parseFloat(r.commission_rate || '10');
    const completedShifts = parseInt(r.completed_shifts || '0', 10);
    const totalShifts = parseInt(r.total_shifts || '0', 10);
    const posRevenue = parseFloat(r.revenue || '0');
    const manualRevenue = parseFloat(r.manual_revenue || '0');
    const ordersCount = parseInt(r.orders_count || '0', 10);
    const trialShifts = parseInt(r.trial_shifts || '0', 10);
    const trialBonus = trialShifts * TRIAL_BONUS_PER_SHIFT;
    const onlineRevenue = parseFloat(r.online_revenue || '0');
    const onlineCommission = parseFloat(r.online_commission || '0');
    const onlineOrdersCount = parseInt(r.online_orders_count || '0', 10);
    const totalRevenue = posRevenue + manualRevenue;
    const basePay = parseFloat(r.base_pay || '0');
    const commission = Math.round(totalRevenue * commissionRate) / 100;
    const totalEarnings = basePay + commission + trialBonus + onlineCommission;

    return {
      employee_id: r.employee_id,
      display_name: r.display_name,
      role: r.role,
      photo_url: r.photo_url,
      daily_rate: dailyRate,
      commission_rate: commissionRate,
      completed_shifts: completedShifts,
      total_shifts: totalShifts,
      pos_revenue: posRevenue,
      manual_revenue: manualRevenue,
      revenue: totalRevenue,
      orders_count: ordersCount,
      base_pay: basePay,
      commission,
      trial_shifts: trialShifts,
      trial_bonus: trialBonus,
      online_revenue: onlineRevenue,
      online_commission: onlineCommission,
      online_orders_count: onlineOrdersCount,
      total_earnings: totalEarnings,
    };
  });

  res.json({ success: true, data });
});

// ============================================================================
// ADMIN: GET /api/shifts/admin/compensation/:employeeId — compensation history
// ============================================================================
router.get('/admin/compensation/:employeeId', authenticateToken, requirePermission('users:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const { employeeId } = req.params;

  const rows = await db.query<EmployeeCompensationRow>(
    `SELECT id, employee_id, daily_rate, commission_rate, effective_from, effective_until, notes, created_by, created_at
     FROM employee_compensation
     WHERE employee_id = $1
     ORDER BY effective_from DESC`,
    [employeeId],
  );

  res.json({ success: true, data: rows });
});

// ============================================================================
// ADMIN: PUT /api/shifts/admin/compensation/:employeeId — update rates
// ============================================================================
router.put('/admin/compensation/:employeeId', authenticateToken, requirePermission('users:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const { employeeId } = req.params;
  const { daily_rate, commission_rate, notes } = req.body;

  if (typeof daily_rate !== 'number' || daily_rate <= 0) {
    throw new AppError(400, 'daily_rate должен быть положительным числом');
  }
  if (typeof commission_rate !== 'number' || commission_rate < 0 || commission_rate > 100) {
    throw new AppError(400, 'commission_rate должен быть от 0 до 100');
  }

  // Verify employee exists
  const employee = await db.queryOne<Pick<Users, 'id'>>(
    `SELECT id FROM users WHERE id = $1 AND role NOT IN ('client', 'partner')`,
    [employeeId],
  );
  if (!employee) throw new AppError(404, 'Сотрудник не найден');

  const today = new Date().toISOString().split('T')[0];

  const result = await db.transaction(async (client) => {
    await client.query(
      `UPDATE employee_compensation
       SET effective_until = $2::date - INTERVAL '1 day', updated_at = NOW()
       WHERE employee_id = $1 AND effective_until IS NULL AND effective_from < $2::date`,
      [employeeId, today],
    );

    const { rows } = await client.query(
      `INSERT INTO employee_compensation (id, employee_id, daily_rate, commission_rate, effective_from, notes, created_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4::date, $5, $6, NOW(), NOW())
       RETURNING *`,
      [employeeId, daily_rate, commission_rate, today, notes || null, req.user!.id],
    );

    return rows[0];
  });

  res.json({ success: true, data: result });
});

// ============================================================================
// ADMIN: POST /api/shifts/admin/manual-revenue — upsert manual revenue
// ============================================================================
router.post('/admin/manual-revenue', authenticateToken, requirePermission('users:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const { employee_id, month, amount, description } = req.body;

  if (!employee_id || !month) throw new AppError(400, 'employee_id и month обязательны');
  if (typeof amount !== 'number' || amount < 0) throw new AppError(400, 'amount должен быть >= 0');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError(400, 'month должен быть в формате YYYY-MM');

  const row = await db.queryOne<ManualRevenueRow>(
    `INSERT INTO employee_manual_revenue (employee_id, month, amount, description, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (employee_id, month) DO UPDATE
       SET amount = EXCLUDED.amount, description = EXCLUDED.description, updated_at = NOW()
     RETURNING *`,
    [employee_id, month, amount, description || null, req.user.id],
  );

  res.json({ success: true, data: row });
});

// ============================================================================
// ADMIN: DELETE /api/shifts/admin/manual-revenue/:id — delete manual revenue
// ============================================================================
router.delete('/admin/manual-revenue/:id', authenticateToken, requirePermission('users:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const { id } = req.params;

  const deleted = await db.queryOne<Pick<ManualRevenueRow, 'id'>>(
    `DELETE FROM employee_manual_revenue WHERE id = $1 RETURNING id`,
    [id],
  );
  if (!deleted) throw new AppError(404, 'Запись не найдена');

  res.json({ success: true });
});

// ============================================================================
// GET /api/shifts/admin/weekly-summary — Недельная сводка
// ============================================================================
router.get('/admin/weekly-summary', authenticateToken, requirePermission('users:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { week_start, studio_id } = req.query;

  if (!week_start) {
    throw new AppError(400, 'week_start обязателен (YYYY-MM-DD)');
  }

  const weekStartStr = String(week_start);
  const rows = await db.query(
    `WITH week_shifts AS (
       SELECT es.*, u.display_name as employee_name, s.name as studio_name, s.location_code
       FROM employee_shifts es
       JOIN users u ON u.id = es.employee_id
       JOIN studios s ON s.id = es.studio_id
       WHERE es.shift_date BETWEEN $1::date AND ($1::date + 6)
         AND es.status != 'cancelled'
         AND ($2::uuid IS NULL OR es.studio_id = $2)
       ORDER BY es.shift_date, s.name, u.display_name
     )
     SELECT * FROM week_shifts`,
    [weekStartStr, studio_id || null]
  );

  // Группируем по дням
  const dayMap = new Map<string, typeof rows>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartStr + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split('T')[0];
    dayMap.set(key, []);
  }
  for (const row of rows) {
    const key = typeof row.shift_date === 'string' ? row.shift_date : String(row.shift_date).split('T')[0];
    dayMap.get(key)?.push(row);
  }

  const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const days = [...dayMap.entries()].map(([date, shifts]) => ({
    date,
    day_name: DAY_NAMES[new Date(date + 'T00:00:00').getDay()],
    employees_scheduled: shifts.length,
    employees: shifts.map(s => ({
      employee_id: s.employee_id,
      display_name: s.employee_name,
      start_time: s.start_time,
      end_time: s.end_time,
      status: s.status,
      studio_name: s.studio_name,
    })),
    has_gap: shifts.length === 0,
  }));

  const uniqueEmployees = new Set(rows.map(r => r.employee_id));

  res.json({
    success: true,
    data: {
      week_start: weekStartStr,
      week_end: days[6]?.date,
      days,
      totals: {
        total_shifts: rows.length,
        unique_employees: uniqueEmployees.size,
        gaps_count: days.filter(d => d.has_gap).length,
        avg_employees_per_day: rows.length / 7,
      },
    },
  });
});

// ============================================================================
// PATCH /api/shifts/:id/notes — Обновление заметок смены
// ============================================================================
router.patch('/:id/notes', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;
  const { notes } = req.body;

  const shift = await db.queryOne(
    `UPDATE employee_shifts SET notes = $1, updated_at = now()
     WHERE id = $2 AND (employee_id = $3 OR $4 = true)
     RETURNING *`,
    [notes || '', req.params['id'], req.user.id, req.user.role === 'admin' || req.user.role === 'manager']
  );

  if (!shift) throw new AppError(404, 'Смена не найдена или нет доступа');

  // Audit log
  await db.query(
    `INSERT INTO shift_history_log (shift_id, action, changed_by, new_values)
     VALUES ($1, 'notes_updated', $2, $3::jsonb)`,
    [req.params['id'], req.user.id, JSON.stringify({ notes })]
  ).catch(err => log.error('Failed to write notes audit log', { error: String(err) }));

  res.json({ success: true, data: toShiftResponse(shift) });
});

// ============================================================================
// GET /api/shifts/:id/history — История изменений смены
// ============================================================================
router.get('/:id/history', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  const history = await db.query(
    `SELECT h.*, u.display_name as changer_name
     FROM shift_history_log h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.shift_id = $1
     ORDER BY h.created_at DESC
     LIMIT 50`,
    [req.params['id']]
  );

  res.json({ success: true, data: history });
});


export default router;
