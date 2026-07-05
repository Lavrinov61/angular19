/**
 * Fleet Management HTTP API — мониторинг парка принтеров.
 *
 * Источники данных:
 *   - `printers`                    — справочник активных устройств.
 *   - `printer_telemetry`           — сырые SNMP-снэпшоты (raw).
 *   - `printer_current_status`      — VIEW: latest row из telemetry + printers join.
 *   - `printer_telemetry_hourly`    — materialized rollup (45d retention).
 *   - `printer_telemetry_daily`     — materialized rollup (365d retention).
 *   - `printer_alerts`              — state-machine активных/исторических алертов.
 *   - `printer_supplies_replacements` — ручные отметки замен расходников.
 *   - `printer_burn_rate_7d`        — view: pages/day за последние 7д из daily rollup.
 *   - `print_jobs`                  — задачи печати (now: `print_source`, `external_job_id`).
 *
 * Permissions:
 *   - GET-endpoints — любой аутентифицированный сотрудник.
 *   - POST /:id/supplies/replace и POST /:id/telemetry/refresh — `settings:manage`.
 */

import express, { NextFunction, Response } from 'express';
import { z } from 'zod';

import db from '../database/db.js';
import { authenticateToken, AuthRequest, requirePermission, requireUser } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { pollPrinterOnce } from '../services/fleet/snmp-poller.service.js';
import {
  fleetDashboardSummaryQueriesTotal,
  fleetPrinterDetailViewsTotal,
  fleetSuppliesReplaceTotal,
} from '../services/metrics.service.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const log = createLogger('fleet.routes');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SupplyEntryJson {
  index?: number;
  description?: string;
  type?: string;
  level_pct?: number | null;
  max_capacity?: number;
  colorant?: string | null;
}

interface TrayEntryJson {
  index?: number;
  name?: string;
  description?: string;
  current_level?: number | null;
  max_capacity?: number;
  media_name?: string | null;
  media_type?: string | null;
}

interface CountersJson {
  lifetime?: number | null;
  power_on?: number | null;
}

interface PrinterListRow {
  id: string;
  name: string;
  printer_type: string;
  studio_id: string | null;
  is_active: boolean;
  cups_printer_name: string | null;
  tele_is_online: boolean | null;
  tele_state: string | null;
  tele_collected_at: string | null;
  tele_supplies: SupplyEntryJson[] | null;
  tele_trays: TrayEntryJson[] | null;
  alerts_critical: string;
  alerts_warn: string;
  alerts_info: string;
}

interface PrinterBasicRow {
  id: string;
  name: string;
  printer_type: string;
  studio_id: string | null;
  is_active: boolean;
  cups_printer_name: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Загружает принтер по id; бросает 404, если не найден.
 * Используется всеми `/printers/:id/...` endpoints.
 */
async function loadPrinterOrThrow(id: string): Promise<PrinterBasicRow> {
  const row = await db.queryOne<PrinterBasicRow>(
    `SELECT id, name, printer_type, studio_id, is_active, cups_printer_name
       FROM printers
      WHERE id = $1`,
    [id],
  );
  if (!row) {
    throw new AppError(404, 'Printer not found', 'PRINTER_NOT_FOUND');
  }
  return row;
}

/** Краткая сводка по supply: { index, colorant|description, level_pct, type }. */
function summarizeSupplies(supplies: SupplyEntryJson[] | null): Array<{
  index: number | null;
  colorant: string | null;
  description: string | null;
  level_pct: number | null;
  type: string | null;
}> {
  if (!Array.isArray(supplies)) return [];
  return supplies.map((s) => ({
    index: typeof s.index === 'number' ? s.index : null,
    colorant: s.colorant ?? null,
    description: s.description ?? null,
    level_pct: typeof s.level_pct === 'number' ? s.level_pct : null,
    type: s.type ?? null,
  }));
}

/** Краткая сводка по tray: { index, name, current_level, max_capacity, pct }. */
function summarizeTrays(trays: TrayEntryJson[] | null): Array<{
  index: number | null;
  name: string | null;
  current_level: number | null;
  max_capacity: number | null;
  pct: number | null;
}> {
  if (!Array.isArray(trays)) return [];
  return trays.map((t) => {
    const lvl = typeof t.current_level === 'number' ? t.current_level : null;
    const cap = typeof t.max_capacity === 'number' ? t.max_capacity : null;
    let pct: number | null = null;
    if (lvl !== null && cap !== null && cap > 0 && lvl >= 0) {
      pct = Math.max(0, Math.min(100, Math.round((lvl / cap) * 100)));
    }
    return {
      index: typeof t.index === 'number' ? t.index : null,
      name: t.name ?? null,
      current_level: lvl,
      max_capacity: cap,
      pct,
    };
  });
}

/** ISO-string → Date; AppError(400) при невалидном формате. */
function parseIsoOrThrow(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(400, `${field}: invalid ISO timestamp`, 'INVALID_TIMESTAMP');
  }
  return d;
}

/**
 * supply_type → список подходящих alert_type для auto-resolve.
 *
 *   toner_* → [toner_low, toner_empty]
 *   ink_*   → [toner_low, toner_empty]  (ink/toner share rule engine)
 *   paper_tray_N → [paper_low, paper_empty]
 *   drum|fuser → [service_required]
 */
function supplyTypeToAlertTypes(supplyType: string): string[] {
  if (supplyType.startsWith('toner') || supplyType.startsWith('ink')) {
    return ['toner_low', 'toner_empty'];
  }
  if (supplyType.startsWith('paper_tray')) {
    return ['paper_low', 'paper_empty'];
  }
  if (supplyType === 'drum' || supplyType === 'fuser') {
    return ['service_required'];
  }
  return [];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// GET /api/fleet/printers — список с агрегатами
// ---------------------------------------------------------------------------

router.get(
  '/printers',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const studioRaw = typeof req.query['studio_id'] === 'string' ? req.query['studio_id'] : null;
    if (studioRaw !== null && !UUID_RE.test(studioRaw)) {
      throw new AppError(400, 'studio_id: invalid UUID', 'INVALID_STUDIO_ID');
    }

    const isActiveRaw = typeof req.query['is_active'] === 'string' ? req.query['is_active'] : null;
    let isActiveFilter: boolean | null = null;
    if (isActiveRaw !== null) {
      if (isActiveRaw === 'true') {
        isActiveFilter = true;
      } else if (isActiveRaw === 'false') {
        isActiveFilter = false;
      } else {
        throw new AppError(400, 'is_active must be true|false', 'INVALID_IS_ACTIVE');
      }
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    let pIdx = 1;
    if (studioRaw !== null) {
      conditions.push(`p.studio_id = $${pIdx++}::uuid`);
      params.push(studioRaw);
    }
    if (isActiveFilter === true) {
      conditions.push('p.is_active = TRUE');
    } else if (isActiveFilter === false) {
      conditions.push('p.is_active = FALSE');
    }
    const whereClause = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

    const rows = await db.query<PrinterListRow>(
      `SELECT
          p.id,
          p.name,
          p.printer_type,
          p.studio_id,
          p.is_active,
          p.cups_printer_name,
          pcs.is_online    AS tele_is_online,
          pcs.state        AS tele_state,
          pcs.collected_at AS tele_collected_at,
          pcs.supplies     AS tele_supplies,
          pcs.trays        AS tele_trays,
          COALESCE(a.critical, 0) AS alerts_critical,
          COALESCE(a.warn, 0)     AS alerts_warn,
          COALESCE(a.info, 0)     AS alerts_info
       FROM printers p
       LEFT JOIN printer_current_status pcs ON pcs.printer_id = p.id
       LEFT JOIN (
         SELECT
           printer_id,
           COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
           COUNT(*) FILTER (WHERE severity = 'warn')     AS warn,
           COUNT(*) FILTER (WHERE severity = 'info')     AS info
         FROM printer_alerts
         WHERE resolved_at IS NULL
         GROUP BY printer_id
       ) a ON a.printer_id = p.id${whereClause}
       ORDER BY p.name`,
      params,
    );

    const data = rows.map((r) => {
      const critical = parseInt(r.alerts_critical, 10) || 0;
      const warn = parseInt(r.alerts_warn, 10) || 0;
      const info = parseInt(r.alerts_info, 10) || 0;
      const hasTele =
        r.tele_collected_at !== null || r.tele_is_online !== null || r.tele_state !== null;

      return {
        id: r.id,
        name: r.name,
        printer_type: r.printer_type,
        studio_id: r.studio_id,
        is_active: r.is_active,
        cups_printer_name: r.cups_printer_name,
        last_telemetry: hasTele
          ? {
              is_online: r.tele_is_online,
              state: r.tele_state,
              collected_at: r.tele_collected_at,
              supplies_summary: summarizeSupplies(r.tele_supplies),
              trays_summary: summarizeTrays(r.tele_trays),
            }
          : null,
        active_alerts_count: critical + warn + info,
        active_alerts_by_severity: { critical, warn, info },
      };
    });

    res.json({ success: true, data });
  },
);

// ---------------------------------------------------------------------------
// GET /api/fleet/dashboard/summary — aggregate counters (fleet-wide or per-studio)
// ---------------------------------------------------------------------------

router.get(
  '/dashboard/summary',
  authenticateToken,
  requirePermission('catalog:manage'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const studioRaw = typeof req.query['studio_id'] === 'string' ? req.query['studio_id'] : null;
    if (studioRaw !== null && !UUID_RE.test(studioRaw)) {
      throw new AppError(400, 'studio_id: invalid UUID', 'INVALID_STUDIO_ID');
    }
    const studioId: string | null = studioRaw;

    fleetDashboardSummaryQueriesTotal.inc();

    interface DashboardSummaryRow {
      total: string; online: string; offline: string; unknown: string;
      critical: string; warn: string; info: string;
      jobs_today: string; replacements_today: string;
    }

    const row = await db.queryOne<DashboardSummaryRow>(
      `WITH
         aggregates AS (
           SELECT
             COUNT(*) FILTER (WHERE p.is_active)                                              AS total,
             COUNT(*) FILTER (WHERE p.is_active AND pcs.is_online IS TRUE)                    AS online,
             COUNT(*) FILTER (WHERE p.is_active AND pcs.is_online IS FALSE)                   AS offline,
             COUNT(*) FILTER (WHERE p.is_active AND pcs.is_online IS NULL)                    AS unknown
             FROM printers p
             LEFT JOIN printer_current_status pcs ON pcs.printer_id = p.id
            WHERE ($1::uuid IS NULL OR p.studio_id = $1::uuid)
         ),
         alert_aggregates AS (
           SELECT
             COUNT(*) FILTER (WHERE pa.severity = 'critical') AS critical,
             COUNT(*) FILTER (WHERE pa.severity = 'warn')     AS warn,
             COUNT(*) FILTER (WHERE pa.severity = 'info')     AS info
             FROM printer_alerts pa
             JOIN printers p ON p.id = pa.printer_id
            WHERE pa.resolved_at IS NULL AND p.is_active
              AND ($1::uuid IS NULL OR p.studio_id = $1::uuid)
         ),
         jobs_today AS (
           SELECT COUNT(*) AS c
             FROM print_jobs
            WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Moscow')
              AND ($1::uuid IS NULL OR printer_id IN (SELECT id FROM printers WHERE studio_id = $1::uuid))
         ),
         replacements_today AS (
           SELECT COUNT(*) AS c
             FROM printer_supplies_replacements
            WHERE replaced_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Moscow')
              AND ($1::uuid IS NULL OR printer_id IN (SELECT id FROM printers WHERE studio_id = $1::uuid))
         )
       SELECT a.total, a.online, a.offline, a.unknown,
              aa.critical, aa.warn, aa.info,
              jt.c AS jobs_today, rt.c AS replacements_today
         FROM aggregates a, alert_aggregates aa, jobs_today jt, replacements_today rt`,
      [studioId],
    );

    res.json({
      success: true,
      data: {
        total: Number(row?.total ?? 0),
        online: Number(row?.online ?? 0),
        offline: Number(row?.offline ?? 0),
        unknown: Number(row?.unknown ?? 0),
        alerts: {
          critical: Number(row?.critical ?? 0),
          warn: Number(row?.warn ?? 0),
          info: Number(row?.info ?? 0),
        },
        jobs_today: Number(row?.jobs_today ?? 0),
        replacements_today: Number(row?.replacements_today ?? 0),
      },
    });
  },
);

// ---------------------------------------------------------------------------
// GET /api/fleet/printers/:id — detail view
// ---------------------------------------------------------------------------

const IncludeTokens = new Set(['telemetry', 'alerts', 'replacements', 'jobs']);

router.get(
  '/printers/:id',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params as { id: string };
    const printer = await loadPrinterOrThrow(id);
    fleetPrinterDetailViewsTotal.inc({ printer: id });

    const includeRaw = typeof req.query['include'] === 'string' ? req.query['include'] : '';
    const requested = includeRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const include =
      requested.length === 0
        ? new Set<string>(IncludeTokens)
        : new Set<string>(requested.filter((t) => IncludeTokens.has(t)));

    interface TelemetryFullRow {
      is_online: boolean | null;
      state: string | null;
      state_reasons: string[] | null;
      supplies: SupplyEntryJson[] | null;
      trays: TrayEntryJson[] | null;
      counters: CountersJson | null;
      errors: unknown;
      model: string | null;
      manufacturer: string | null;
      serial_number: string | null;
      firmware_version: string | null;
      collected_at: string;
    }

    const [telemetry, alerts, replacements, jobs] = await Promise.all([
      include.has('telemetry')
        ? db.queryOne<TelemetryFullRow>(
            `SELECT is_online, state, state_reasons, supplies, trays, counters, errors,
                    model, manufacturer, serial_number, firmware_version, collected_at
               FROM printer_telemetry
              WHERE printer_id = $1
              ORDER BY collected_at DESC
              LIMIT 1`,
            [id],
          )
        : Promise.resolve(null),
      include.has('alerts')
        ? db.query(
            `SELECT id, printer_id, studio_id, alert_type, severity,
                    first_seen_at, last_seen_at, resolved_at, resolved_by, resolve_reason,
                    last_value, message, created_at, updated_at
               FROM printer_alerts
              WHERE printer_id = $1 AND resolved_at IS NULL
              ORDER BY first_seen_at DESC`,
            [id],
          )
        : Promise.resolve([]),
      include.has('replacements')
        ? db.query(
            `SELECT r.id, r.printer_id, r.supply_type, r.supply_index,
                    r.replaced_by, u.display_name AS replaced_by_name,
                    r.replaced_at, r.counter_at_replacement, r.note
               FROM printer_supplies_replacements r
               LEFT JOIN users u ON u.id = r.replaced_by
              WHERE r.printer_id = $1
              ORDER BY r.replaced_at DESC
              LIMIT 5`,
            [id],
          )
        : Promise.resolve([]),
      include.has('jobs')
        ? db.query(
            `SELECT j.id, j.created_at, j.completed_at, j.file_name,
                    j.created_by, u.display_name AS created_by_name,
                    j.pages_printed, j.copies, j.status, j.print_source, j.external_job_id
               FROM print_jobs j
               LEFT JOIN users u ON u.id = j.created_by
              WHERE j.printer_id = $1
              ORDER BY j.created_at DESC
              LIMIT 10`,
            [id],
          )
        : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      data: {
        printer,
        telemetry,
        active_alerts: alerts,
        recent_replacements: replacements,
        recent_jobs: jobs,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// GET /api/fleet/printers/:id/telemetry — timeseries
// ---------------------------------------------------------------------------

const INTERVAL_WINDOW_DAYS: Record<'raw' | 'hourly' | 'daily', number> = {
  raw: 90,
  hourly: 45,
  daily: 365,
};

router.get(
  '/printers/:id/telemetry',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params as { id: string };
    await loadPrinterOrThrow(id);

    const rawInterval = typeof req.query['interval'] === 'string' ? req.query['interval'] : 'raw';
    if (rawInterval !== 'raw' && rawInterval !== 'hourly' && rawInterval !== 'daily') {
      throw new AppError(400, 'interval must be raw|hourly|daily', 'INVALID_INTERVAL');
    }
    const interval: 'raw' | 'hourly' | 'daily' = rawInterval;

    const fromQ = typeof req.query['from'] === 'string' ? req.query['from'] : null;
    const toQ = typeof req.query['to'] === 'string' ? req.query['to'] : null;

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - INTERVAL_WINDOW_DAYS[interval] * 86_400_000);
    const from = fromQ ? parseIsoOrThrow(fromQ, 'from') : defaultFrom;
    const to = toQ ? parseIsoOrThrow(toQ, 'to') : now;

    // Enforce retention window (protects from scanning cold partitions / dropped rows).
    const oldestAllowed = new Date(now.getTime() - INTERVAL_WINDOW_DAYS[interval] * 86_400_000);
    if (from < oldestAllowed) {
      throw new AppError(
        400,
        `from must be within ${INTERVAL_WINDOW_DAYS[interval]}d for interval=${interval}`,
        'INTERVAL_WINDOW_EXCEEDED',
      );
    }
    if (to <= from) {
      throw new AppError(400, 'to must be after from', 'INVALID_RANGE');
    }

    let rows: unknown[];
    if (interval === 'raw') {
      rows = await db.query(
        `SELECT id, printer_id, studio_id, is_online, state, state_reasons,
                supplies, trays, counters, errors,
                model, manufacturer, serial_number, firmware_version, collected_at
           FROM printer_telemetry
          WHERE printer_id = $1 AND collected_at >= $2 AND collected_at <= $3
          ORDER BY collected_at DESC
          LIMIT 1000`,
        [id, from, to],
      );
    } else if (interval === 'hourly') {
      rows = await db.query(
        `SELECT printer_id, hour, samples, any_online, online_ratio,
                max_lifetime_count, min_lifetime_count, last_supplies, last_trays
           FROM printer_telemetry_hourly
          WHERE printer_id = $1 AND hour >= $2 AND hour <= $3
          ORDER BY hour DESC`,
        [id, from, to],
      );
    } else {
      rows = await db.query(
        `SELECT printer_id, day, samples, any_online, online_ratio,
                max_lifetime_count, min_lifetime_count
           FROM printer_telemetry_daily
          WHERE printer_id = $1 AND day >= $2 AND day <= $3
          ORDER BY day DESC`,
        [id, from, to],
      );
    }

    res.json({ success: true, data: { interval, rows } });
  },
);

// ---------------------------------------------------------------------------
// GET /api/fleet/printers/:id/jobs
// ---------------------------------------------------------------------------

const JOB_SOURCES = new Set(['rust_api', 'cups', 'canon_remote_ui', 'windows_event', 'bridge_agent']);

router.get(
  '/printers/:id/jobs',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params as { id: string };
    await loadPrinterOrThrow(id);

    const fromQ = typeof req.query['from'] === 'string' ? req.query['from'] : null;
    const toQ = typeof req.query['to'] === 'string' ? req.query['to'] : null;
    const limitQ = typeof req.query['limit'] === 'string' ? req.query['limit'] : '100';
    const sourceQ = typeof req.query['source'] === 'string' ? req.query['source'] : null;

    const limitParsed = parseInt(limitQ, 10);
    const limit = Number.isFinite(limitParsed)
      ? Math.max(1, Math.min(500, limitParsed))
      : 100;

    if (sourceQ !== null && !JOB_SOURCES.has(sourceQ)) {
      throw new AppError(400, 'source: invalid value', 'INVALID_SOURCE');
    }

    const conditions: string[] = ['j.printer_id = $1'];
    const params: unknown[] = [id];
    let pIdx = 2;

    if (fromQ) {
      conditions.push(`j.created_at >= $${pIdx++}`);
      params.push(parseIsoOrThrow(fromQ, 'from'));
    }
    if (toQ) {
      conditions.push(`j.created_at <= $${pIdx++}`);
      params.push(parseIsoOrThrow(toQ, 'to'));
    }
    if (sourceQ) {
      conditions.push(`j.print_source = $${pIdx++}`);
      params.push(sourceQ);
    }

    params.push(limit);

    const rows = await db.query(
      `SELECT j.id, j.created_at, j.completed_at, j.file_name,
              j.created_by, u.display_name AS created_by_name,
              j.pages_printed, j.copies, j.status, j.print_source, j.external_job_id
         FROM print_jobs j
         LEFT JOIN users u ON u.id = j.created_by
        WHERE ${conditions.join(' AND ')}
        ORDER BY j.created_at DESC
        LIMIT $${pIdx}`,
      params,
    );

    res.json({ success: true, data: rows });
  },
);

// ---------------------------------------------------------------------------
// GET /api/fleet/printers/:id/alerts
// ---------------------------------------------------------------------------

router.get(
  '/printers/:id/alerts',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params as { id: string };
    await loadPrinterOrThrow(id);

    const activeRaw = typeof req.query['active'] === 'string' ? req.query['active'] : 'true';
    if (activeRaw !== 'true' && activeRaw !== 'false' && activeRaw !== 'all') {
      throw new AppError(400, 'active must be true|false|all', 'INVALID_ACTIVE_FILTER');
    }

    const sinceQ = typeof req.query['since'] === 'string' ? req.query['since'] : null;

    const conditions: string[] = ['printer_id = $1'];
    const params: unknown[] = [id];
    let pIdx = 2;

    if (activeRaw === 'true') {
      conditions.push('resolved_at IS NULL');
    } else if (activeRaw === 'false') {
      conditions.push('resolved_at IS NOT NULL');
    }
    if (sinceQ) {
      conditions.push(`first_seen_at >= $${pIdx++}`);
      params.push(parseIsoOrThrow(sinceQ, 'since'));
    }

    const rows = await db.query(
      `SELECT id, printer_id, studio_id, alert_type, severity,
              first_seen_at, last_seen_at, resolved_at, resolved_by, resolve_reason,
              last_value, message, created_at, updated_at
         FROM printer_alerts
        WHERE ${conditions.join(' AND ')}
        ORDER BY first_seen_at DESC`,
      params,
    );

    res.json({ success: true, data: rows });
  },
);

// ---------------------------------------------------------------------------
// POST /api/fleet/printers/:id/supplies/replace
// ---------------------------------------------------------------------------

const SUPPLY_TYPE_RE = /^(toner_[a-z]+|ink_[a-z]+|drum|fuser|paper_tray_\d+)$/;

const ReplaceSupplySchema = z.object({
  supply_type: z
    .string()
    .min(1)
    .max(40)
    .regex(SUPPLY_TYPE_RE, 'supply_type должен соответствовать toner_*|ink_*|drum|fuser|paper_tray_N'),
  supply_index: z.number().int().min(1).max(20).optional(),
  note: z.string().max(500).optional(),
});

router.post(
  '/printers/:id/supplies/replace',
  authenticateToken,
  requirePermission('settings:manage'),
  validate(ReplaceSupplySchema),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const _handler = async (): Promise<void> => {
    requireUser(req);
    const { id } = req.params as { id: string };
    await loadPrinterOrThrow(id);

    const { supply_type, supply_index, note } = req.body as z.infer<typeof ReplaceSupplySchema>;
    const userId = req.user.id;

    // Последний снэпшот — для counter_at_replacement из counters->lifetime.
    const latest = await db.queryOne<{ counters: CountersJson | null }>(
      `SELECT counters
         FROM printer_telemetry
        WHERE printer_id = $1
        ORDER BY collected_at DESC
        LIMIT 1`,
      [id],
    );
    const lifetime =
      latest?.counters && typeof latest.counters.lifetime === 'number'
        ? latest.counters.lifetime
        : null;

    const inserted = await db.queryOne(
      `INSERT INTO printer_supplies_replacements
         (printer_id, supply_type, supply_index, replaced_by, counter_at_replacement, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, printer_id, supply_type, supply_index, replaced_by,
                 replaced_at, counter_at_replacement, note`,
      [id, supply_type, supply_index ?? null, userId, lifetime, note ?? null],
    );

    const alertTypes = supplyTypeToAlertTypes(supply_type);
    let resolvedAlerts = 0;
    if (alertTypes.length > 0) {
      const resolved = await db.query<{ id: string }>(
        `UPDATE printer_alerts
            SET resolved_at = now(),
                resolved_by = $1,
                resolve_reason = 'supply_replaced'
          WHERE printer_id = $2
            AND resolved_at IS NULL
            AND alert_type = ANY($3::text[])
          RETURNING id`,
        [userId, id, alertTypes],
      );
      resolvedAlerts = resolved.length;
    }

    log.info('supply replaced', {
      printer_id: id,
      supply_type,
      supply_index: supply_index ?? null,
      counter_at_replacement: lifetime,
      resolved_alerts: resolvedAlerts,
      user_id: userId,
    });

    fleetSuppliesReplaceTotal.inc({ supply_type, result: 'success' });

    res.status(201).json({
      success: true,
      data: inserted,
      auto_resolved_alerts: resolvedAlerts,
    });
    };
    try {
      await _handler();
    } catch (err) {
      const bt = 'unknown';
      fleetSuppliesReplaceTotal.inc({ supply_type: bt, result: 'error' });
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/fleet/printers/:id/telemetry/refresh
// ---------------------------------------------------------------------------

router.post(
  '/printers/:id/telemetry/refresh',
  authenticateToken,
  requirePermission('settings:manage'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const { id } = req.params as { id: string };
    await loadPrinterOrThrow(id);

    try {
      const result = await pollPrinterOnce(id);
      if (result.snapshot === null) {
        log.warn('pollPrinterOnce unreachable', {
          printer_id: id,
          user_id: req.user.id,
        });
        res.status(200).json({
          success: true,
          triggered: true,
          snapshot: null,
          reason: 'unreachable',
        });
        return;
      }

      // Возвращаем свежую строку из printer_telemetry (persistSnapshot уже записал).
      const row = await db.queryOne(
        `SELECT id, printer_id, studio_id, is_online, state, state_reasons,
                supplies, trays, counters, errors,
                model, manufacturer, serial_number, firmware_version, collected_at
           FROM printer_telemetry
          WHERE printer_id = $1
          ORDER BY collected_at DESC
          LIMIT 1`,
        [id],
      );

      log.info('manual telemetry refresh', {
        printer_id: id,
        user_id: req.user.id,
        is_online: result.snapshot.is_online,
      });

      res.json({ success: true, triggered: true, snapshot: row });
    } catch (err: unknown) {
      log.error('pollPrinterOnce threw', {
        printer_id: id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new AppError(500, 'Telemetry refresh failed', 'POLL_FAILED');
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/fleet/printers/:id/burn-rate
// ---------------------------------------------------------------------------

/** Грубая оценка tonеr capacity (страниц) по colorant — для days_left. */
const TONER_CAPACITY_ESTIMATE: Record<string, number> = {
  black: 6000,
  cyan: 4000,
  magenta: 4000,
  yellow: 4000,
};
const TONER_CAPACITY_DEFAULT = 4000;

router.get(
  '/printers/:id/burn-rate',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params as { id: string };
    await loadPrinterOrThrow(id);

    interface BurnRateRow {
      pages_printed_7d: string | number | null;
      pages_per_day_avg: string | number | null;
    }
    const burn = await db.queryOne<BurnRateRow>(
      `SELECT pages_printed_7d, pages_per_day_avg
         FROM printer_burn_rate_7d
        WHERE printer_id = $1`,
      [id],
    );

    const pagesPrinted7d = burn?.pages_printed_7d != null ? Number(burn.pages_printed_7d) : 0;
    const pagesPerDayAvg = burn?.pages_per_day_avg != null ? Number(burn.pages_per_day_avg) : 0;

    const latest = await db.queryOne<{ supplies: SupplyEntryJson[] | null }>(
      `SELECT supplies
         FROM printer_telemetry
        WHERE printer_id = $1
        ORDER BY collected_at DESC
        LIMIT 1`,
      [id],
    );
    const supplies: SupplyEntryJson[] = Array.isArray(latest?.supplies) ? latest.supplies : [];

    const estimates = supplies
      .filter((s) => s.type === 'toner' || s.type === 'ink')
      .map((s) => {
        const colorant = (s.colorant ?? s.description ?? '').toLowerCase();
        const supplyKey = s.colorant
          ? `toner_${s.colorant.toLowerCase()}`
          : `toner_supply_${s.index ?? '?'}`;
        const levelPct = typeof s.level_pct === 'number' ? s.level_pct : null;
        const maxCapacity = TONER_CAPACITY_ESTIMATE[colorant] ?? TONER_CAPACITY_DEFAULT;

        let daysLeft: number | null = null;
        if (levelPct !== null && pagesPerDayAvg > 0) {
          const pagesRemaining = (levelPct / 100) * maxCapacity;
          daysLeft = Math.round((pagesRemaining / pagesPerDayAvg) * 10) / 10;
        }

        return {
          supply_type: supplyKey,
          colorant: s.colorant ?? null,
          level_pct: levelPct,
          days_left: daysLeft,
        };
      });

    res.json({
      success: true,
      data: {
        pages_printed_7d: pagesPrinted7d,
        pages_per_day_avg: pagesPerDayAvg,
        estimated_days_remaining_by_supply: estimates,
      },
    });
  },
);

export default router;
