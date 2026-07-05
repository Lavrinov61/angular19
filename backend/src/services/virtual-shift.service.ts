import type { PoolClient } from 'pg';
import { ErrorCode } from '../constants/error-codes.js';
import { AppError } from '../middleware/errorHandler.js';

export type EmployeeShiftKind = 'studio' | 'virtual';

export interface OnlineEmployeeShiftRow {
  id: string;
  employee_id: string;
  studio_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  status: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  cash_at_open: string | null;
  cash_at_close: string | null;
  pos_shift_id: string | null;
  commission_total: string | null;
  sales_total: string | null;
  receipts_count: number | null;
  online_earnings: string | null;
  online_count: number | null;
  base_pay_rate: string | null;
  shift_kind: EmployeeShiftKind;
  studio_name?: string;
  studio_address?: string | null;
  location_code?: string | null;
}

export interface EnsureOnlineEmployeeShiftResult {
  shift: OnlineEmployeeShiftRow;
  created: boolean;
  activated: boolean;
}

interface EnsureOnlineEmployeeShiftOptions {
  activateExisting?: boolean;
  failIfCompleted?: boolean;
  allowRestartAfterCompleted?: boolean;
  studioId?: string;
}

interface StudioLookupRow {
  id: string;
}

interface StudioShiftKindRow {
  shift_kind: EmployeeShiftKind;
}

interface ShiftIdRow {
  id: string;
}

export const ONLINE_SHIFT_LOCATION_CODE = 'online';
const VIRTUAL_SHIFT_NOTE = 'Рабочий день для оплат по ссылке в чате';
const WORKDAY_END_TIME = '19:45:00';

export function studioBasePayRateSql(studioIdExpression: string): string {
  return `(SELECT COALESCE(rate_studio.employee_shift_rate,
                          CASE WHEN rate_studio.location_code = 'barrikadnaya-4' THEN 2000 ELSE 1500 END)
            FROM studios rate_studio
            WHERE rate_studio.id = ${studioIdExpression})`;
}

export function studioShiftKindSql(studioIdExpression: string): string {
  return `(SELECT CASE
              WHEN kind_studio.location_code = '${ONLINE_SHIFT_LOCATION_CODE}'
                OR kind_studio.location_type = 'virtual'
              THEN 'virtual'
              ELSE 'studio'
            END
            FROM studios kind_studio
            WHERE kind_studio.id = ${studioIdExpression})`;
}

async function resolveStudioShiftKind(
  client: PoolClient,
  studioId: string,
): Promise<EmployeeShiftKind> {
  const result = await client.query<StudioShiftKindRow>(
    `SELECT COALESCE(${studioShiftKindSql('$1')}, 'studio') AS shift_kind`,
    [studioId],
  );
  return result.rows[0]?.shift_kind ?? 'studio';
}

async function ensureShiftBasePayRate(client: PoolClient, shiftId: string): Promise<void> {
  await client.query(
    `UPDATE employee_shifts
     SET base_pay_rate = COALESCE(base_pay_rate, ${studioBasePayRateSql('employee_shifts.studio_id')}),
         updated_at = NOW()
     WHERE id = $1 AND base_pay_rate IS NULL`,
    [shiftId],
  );
}

async function selectShiftById(
  client: PoolClient,
  shiftId: string,
): Promise<OnlineEmployeeShiftRow> {
  const result = await client.query<OnlineEmployeeShiftRow>(
    `SELECT es.*, es.shift_date::text AS shift_date,
            s.name AS studio_name, s.address AS studio_address, s.location_code
     FROM employee_shifts es
     JOIN studios s ON s.id = es.studio_id
     WHERE es.id = $1`,
    [shiftId],
  );
  const shift = result.rows[0];
  if (!shift) {
    throw new AppError(404, 'Shift not found after update');
  }
  return shift;
}

async function selectTodayShiftForUpdate(
  client: PoolClient,
  employeeId: string,
): Promise<OnlineEmployeeShiftRow | null> {
  const result = await client.query<OnlineEmployeeShiftRow>(
    `SELECT es.*, es.shift_date::text AS shift_date,
            s.name AS studio_name, s.address AS studio_address, s.location_code
     FROM employee_shifts es
     JOIN studios s ON s.id = es.studio_id
     WHERE es.employee_id = $1 AND es.shift_date = CURRENT_DATE
     ORDER BY CASE es.status
       WHEN 'active' THEN 0
       WHEN 'scheduled' THEN 1
       WHEN 'cancelled' THEN 2
       WHEN 'completed' THEN 3
       ELSE 4
     END,
     es.checked_in_at DESC NULLS LAST,
     es.updated_at DESC NULLS LAST,
     es.created_at DESC NULLS LAST
     LIMIT 1
     FOR UPDATE OF es`,
    [employeeId],
  );
  return result.rows[0] ?? null;
}

export async function requireActiveEmployeeShiftForPaymentLink(
  client: PoolClient,
  employeeId: string,
): Promise<OnlineEmployeeShiftRow> {
  const result = await client.query<OnlineEmployeeShiftRow>(
    `SELECT es.*, es.shift_date::text AS shift_date,
            s.name AS studio_name, s.address AS studio_address, s.location_code
     FROM employee_shifts es
     JOIN studios s ON s.id = es.studio_id
     WHERE es.employee_id = $1
       AND es.shift_date = CURRENT_DATE
       AND es.status = 'active'
     ORDER BY es.checked_in_at DESC NULLS LAST, es.created_at DESC NULLS LAST
     LIMIT 1
     FOR UPDATE OF es`,
    [employeeId],
  );
  const shift = result.rows[0];
  if (!shift) {
    throw new AppError(
      409,
      'Сначала начните рабочий день, чтобы выставить ссылку на оплату',
      ErrorCode.WORKDAY_NOT_STARTED,
    );
  }

  if (shift.base_pay_rate === null) {
    await ensureShiftBasePayRate(client, shift.id);
    return selectShiftById(client, shift.id);
  }

  return shift;
}

async function resolveVirtualShiftStudioId(
  client: PoolClient,
  employeeId: string,
): Promise<string> {
  const onlineStudio = await client.query<StudioLookupRow>(
    `SELECT id
     FROM studios
     WHERE location_code = $1
     LIMIT 1`,
    [ONLINE_SHIFT_LOCATION_CODE],
  );
  if (onlineStudio.rows[0]) {
    return onlineStudio.rows[0].id;
  }

  const previousShift = await client.query<StudioLookupRow>(
    `SELECT studio_id AS id
     FROM employee_shifts
     WHERE employee_id = $1 AND status <> 'cancelled'
     ORDER BY shift_date DESC, created_at DESC NULLS LAST
     LIMIT 1`,
    [employeeId],
  );
  if (previousShift.rows[0]) {
    return previousShift.rows[0].id;
  }

  const studio = await client.query<StudioLookupRow>(
    `SELECT id
     FROM studios
     WHERE status = 'open'
     ORDER BY is_featured DESC NULLS LAST,
              is_popular DESC NULLS LAST,
              created_at ASC NULLS LAST
     LIMIT 1`,
  );
  if (studio.rows[0]) {
    return studio.rows[0].id;
  }

  throw new AppError(409, 'Нет доступной студии для рабочего дня');
}

async function insertActiveEmployeeShift(
  client: PoolClient,
  employeeId: string,
  studioId: string,
): Promise<EnsureOnlineEmployeeShiftResult> {
  const shiftKind = await resolveStudioShiftKind(client, studioId);
  const inserted = await client.query<ShiftIdRow>(
    `INSERT INTO employee_shifts
       (employee_id, studio_id, shift_date, start_time, end_time, status,
        checked_in_at, notes, base_pay_rate, shift_kind)
     VALUES ($1, $2, CURRENT_DATE, LOCALTIME(0), $4::time, 'active',
             NOW(), $3, ${studioBasePayRateSql('$2')}, $5)
     RETURNING id`,
    [employeeId, studioId, VIRTUAL_SHIFT_NOTE, WORKDAY_END_TIME, shiftKind],
  );

  return {
    shift: await selectShiftById(client, inserted.rows[0].id),
    created: true,
    activated: true,
  };
}

export async function ensureOnlineEmployeeShift(
  client: PoolClient,
  employeeId: string,
  options: EnsureOnlineEmployeeShiftOptions = {},
): Promise<EnsureOnlineEmployeeShiftResult> {
  const existing = await selectTodayShiftForUpdate(client, employeeId);
  const requestedStudioId = options.studioId;

  if (existing) {
    if (existing.status === 'completed' && options.allowRestartAfterCompleted) {
      const studioId = requestedStudioId ?? (await resolveVirtualShiftStudioId(client, employeeId));
      return insertActiveEmployeeShift(client, employeeId, studioId);
    }

    if (existing.status === 'completed' && options.failIfCompleted) {
      throw new AppError(409, 'Сегодняшняя смена уже завершена');
    }

    if (existing.status === 'active' && requestedStudioId && existing.studio_id !== requestedStudioId) {
      throw new AppError(409, 'Рабочий день уже начат в другой точке');
    }

    if (existing.status === 'scheduled' && options.activateExisting) {
      const studioId = requestedStudioId ?? existing.studio_id;
      const shiftKind = await resolveStudioShiftKind(client, studioId);
      const updated = await client.query<ShiftIdRow>(
        `UPDATE employee_shifts
         SET status = 'active',
             studio_id = $2,
             shift_kind = $3,
             checked_in_at = COALESCE(checked_in_at, NOW()),
             base_pay_rate = CASE
               WHEN employee_shifts.studio_id IS DISTINCT FROM $2 THEN ${studioBasePayRateSql('$2')}
               ELSE COALESCE(base_pay_rate, ${studioBasePayRateSql('$2')})
             END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [existing.id, studioId, shiftKind],
      );
      return {
        shift: await selectShiftById(client, updated.rows[0].id),
        created: false,
        activated: true,
      };
    }

    if (existing.status === 'cancelled') {
      const studioId = requestedStudioId ?? existing.studio_id;
      const shiftKind = await resolveStudioShiftKind(client, studioId);
      const updated = await client.query<ShiftIdRow>(
        `UPDATE employee_shifts
         SET status = 'active',
             studio_id = $3,
             shift_kind = $5,
             checked_in_at = NOW(),
             checked_out_at = NULL,
             start_time = LOCALTIME(0),
             end_time = $4::time,
             base_pay_rate = CASE
               WHEN employee_shifts.studio_id IS DISTINCT FROM $3 THEN ${studioBasePayRateSql('$3')}
               ELSE COALESCE(base_pay_rate, ${studioBasePayRateSql('$3')})
             END,
             notes = COALESCE(notes, $2),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [existing.id, VIRTUAL_SHIFT_NOTE, studioId, WORKDAY_END_TIME, shiftKind],
      );
      return {
        shift: await selectShiftById(client, updated.rows[0].id),
        created: false,
        activated: true,
      };
    }

    if (existing.base_pay_rate === null) {
      await ensureShiftBasePayRate(client, existing.id);
      return { shift: await selectShiftById(client, existing.id), created: false, activated: false };
    }

    return { shift: existing, created: false, activated: false };
  }

  const studioId = requestedStudioId ?? (await resolveVirtualShiftStudioId(client, employeeId));
  return insertActiveEmployeeShift(client, employeeId, studioId);
}

export async function refreshEmployeeShiftSalesCache(
  client: PoolClient,
  shiftId: string,
): Promise<void> {
  await client.query(
    `UPDATE employee_shifts SET
       online_earnings = COALESCE(online_sub.amount, 0),
       online_count = COALESCE(online_sub.cnt, 0),
       sales_total = COALESCE(all_sub.total, 0),
       commission_total = COALESCE(all_sub.commission, 0),
       receipts_count = COALESCE(all_sub.cnt, 0)
     FROM (
       SELECT COALESCE(SUM(receipt_total), 0) AS amount, COUNT(*) AS cnt
       FROM employee_sales WHERE shift_id = $1 AND source = 'online'
     ) online_sub,
     (
       SELECT COALESCE(SUM(receipt_total), 0) AS total,
              COALESCE(SUM(commission_amount), 0) AS commission,
              COUNT(*) AS cnt
       FROM employee_sales WHERE shift_id = $1
     ) all_sub
     WHERE employee_shifts.id = $1`,
    [shiftId],
  );
}
