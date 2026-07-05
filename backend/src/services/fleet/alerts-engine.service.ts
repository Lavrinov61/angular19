/**
 * Fleet Alerts Engine — evaluates rules on each printer's latest telemetry
 * snapshot and maintains a state machine in `printer_alerts`:
 *
 *   rule.active === true  + no open row  → INSERT + WS emit  (alert-raised)
 *   rule.active === true  + open row     → UPDATE last_seen_at / last_value
 *   rule.active === false + open row     → UPDATE resolved_at + WS emit (alert-resolved)
 *   rule.active === false + no open row  → no-op
 *
 * Special: `snmp_unreachable` is raised when the *most-recent* snapshot per
 * printer is older than FLEET_ALERT_STALE_SNAPSHOT_MINUTES — or when no
 * snapshot exists at all for an active printer.
 *
 * Isolation: per-printer evaluation is wrapped in try/catch — a single malformed
 * telemetry row must not halt the sweep. DB query failures per printer are
 * logged and skipped.
 *
 * Leader-election is the caller's responsibility — only leader process should
 * call `startAlertsEngine()`.
 */

import db from '../../database/db.js';
import { createLogger } from '../../utils/logger.js';
import { broadcastToRoom } from '../../websocket/broadcast-to-room.js';
import {
  printerAlertsActive,
  printerAlertsRaisedTotal,
} from '../metrics.service.js';

import {
  RULES,
  SNMP_UNREACHABLE_RULE,
  type AlertRule,
  type AlertSeverity,
  type RuleVerdict,
  type TelemetrySnapshotForRules,
} from './alert-rules.js';
import type { SupplyEntry, TrayEntry, AlertEntry } from './snmp-client.js';

const log = createLogger('fleet:alerts-engine');

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_STALE_MINUTES = 15;
const DEFAULT_INITIAL_DELAY_MS = 20_000;

function resolveIntervalMs(): number {
  const raw = process.env['FLEET_ALERTS_CHECK_INTERVAL_MS'];
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 5_000) {
    log.warn('Invalid FLEET_ALERTS_CHECK_INTERVAL_MS — falling back to default', { raw });
    return DEFAULT_INTERVAL_MS;
  }
  return n;
}

function resolveStaleMinutes(): number {
  const raw = process.env['FLEET_ALERT_STALE_SNAPSHOT_MINUTES'];
  if (!raw) return DEFAULT_STALE_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_STALE_MINUTES;
  return n;
}

// ─── State ──────────────────────────────────────────────────────────────────

let tickInterval: ReturnType<typeof setInterval> | null = null;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let stopped = true;

// ─── DB row shapes ──────────────────────────────────────────────────────────

interface LatestSnapshotRow {
  printer_id: string;
  printer_name: string;
  studio_id: string | null;
  snapshot_id: string | null;
  is_online: boolean | null;
  state: string | null;
  supplies: SupplyEntry[] | null;
  trays: TrayEntry[] | null;
  errors: AlertEntry[] | null;
  collected_at: Date | null;
}

interface OpenAlertRow {
  id: string;
  printer_id: string;
  alert_type: string;
  severity: AlertSeverity;
  first_seen_at: Date;
}

interface ActiveCountRow {
  severity: AlertSeverity;
  cnt: string | number;
}

// ─── Public lifecycle ────────────────────────────────────────────────────────

export function startAlertsEngine(): void {
  if (!stopped) {
    log.warn('startAlertsEngine called while already running — ignoring');
    return;
  }

  const intervalMs = resolveIntervalMs();
  stopped = false;
  log.info('Starting Alerts Engine', {
    intervalMs,
    initialDelayMs: DEFAULT_INITIAL_DELAY_MS,
    staleMinutes: resolveStaleMinutes(),
  });

  const tick = (): void => {
    if (stopped) return;
    if (inFlight) {
      log.warn('Previous alerts tick still in flight — skipping');
      return;
    }
    inFlight = runOnce()
      .catch((err: unknown) => {
        log.error('Alerts engine tick failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        inFlight = null;
      });
  };

  initialTimeout = setTimeout(tick, DEFAULT_INITIAL_DELAY_MS);
  tickInterval = setInterval(tick, intervalMs);
}

export async function stopAlertsEngine(): Promise<void> {
  if (stopped) return;
  stopped = true;

  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }

  if (inFlight) {
    try {
      await inFlight;
    } catch {
      /* logged already */
    }
  }
  log.info('Alerts Engine stopped');
}

// ─── Core sweep ──────────────────────────────────────────────────────────────

async function runOnce(): Promise<void> {
  const started = Date.now();
  const rows = await loadLatestSnapshots();
  const staleMinutes = resolveStaleMinutes();
  const now = new Date();

  let evaluated = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      await evaluatePrinter(row, now, staleMinutes);
      evaluated++;
    } catch (err: unknown) {
      errors++;
      log.warn('evaluatePrinter failed — continuing sweep', {
        printer: row.printer_name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    await refreshActiveGauge();
  } catch (err: unknown) {
    log.warn('refreshActiveGauge failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log.info('Alerts sweep finished', {
    printers: rows.length,
    evaluated,
    errors,
    durationMs: Date.now() - started,
  });
}

/**
 * Latest snapshot per active printer via DISTINCT ON. LEFT JOIN so printers
 * without any telemetry still appear — they'll trigger `snmp_unreachable`.
 */
async function loadLatestSnapshots(): Promise<LatestSnapshotRow[]> {
  return db.query<LatestSnapshotRow>(
    `SELECT
         p.id                 AS printer_id,
         p.name               AS printer_name,
         p.studio_id          AS studio_id,
         t.id                 AS snapshot_id,
         t.is_online          AS is_online,
         t.state              AS state,
         t.supplies           AS supplies,
         t.trays              AS trays,
         t.errors             AS errors,
         t.collected_at       AS collected_at
       FROM public.printers p
       LEFT JOIN LATERAL (
         SELECT id, is_online, state, supplies, trays, errors, collected_at
           FROM public.printer_telemetry
          WHERE printer_id = p.id
          ORDER BY collected_at DESC
          LIMIT 1
       ) t ON TRUE
      WHERE p.is_active = true
      ORDER BY p.name`,
  );
}

async function evaluatePrinter(
  row: LatestSnapshotRow,
  now: Date,
  staleMinutes: number,
): Promise<void> {
  const openAlerts = await loadOpenAlerts(row.printer_id);
  const openByType = new Map(openAlerts.map((a) => [a.alert_type, a]));

  // ── 1. Stale / absent snapshot → snmp_unreachable ─────────────────────────
  const collectedAt = row.collected_at;
  const ageMs = collectedAt ? now.getTime() - collectedAt.getTime() : Infinity;
  const isStale = ageMs > staleMinutes * 60_000;

  if (isStale) {
    const verdict: RuleVerdict = {
      active: true,
      severity: SNMP_UNREACHABLE_RULE.severity,
      value: {
        last_collected_at: collectedAt ? collectedAt.toISOString() : null,
        age_seconds: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
      },
      message: collectedAt
        ? `Телеметрия устарела (${Math.round(ageMs / 60_000)} мин)`
        : 'Нет данных телеметрии',
    };
    await applyVerdict(row, SNMP_UNREACHABLE_RULE, verdict, openByType.get(SNMP_UNREACHABLE_RULE.type));
  } else {
    // Clear snmp_unreachable if previously raised
    const existing = openByType.get(SNMP_UNREACHABLE_RULE.type);
    if (existing) {
      await resolveAlert(existing, row);
    }
  }

  // ── 2. If snapshot is absent/stale, don't run data-driven rules (supplies etc.
  //      will be stale or absent and produce bogus verdicts). Only snmp_unreachable
  //      was evaluated; let the rest stay as-is.
  if (!collectedAt || isStale || row.is_online === null) {
    return;
  }

  const snapshot: TelemetrySnapshotForRules = {
    is_online: row.is_online,
    state: row.state,
    supplies: row.supplies ?? [],
    trays: row.trays ?? [],
    errors: row.errors ?? [],
    collected_at: collectedAt,
  };

  for (const rule of RULES) {
    let verdict: RuleVerdict | null = null;
    try {
      verdict = rule.evaluate(snapshot);
    } catch (err: unknown) {
      log.warn('rule.evaluate threw — skipping', {
        printer: row.printer_name,
        rule: rule.type,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (verdict === null) continue;

    try {
      await applyVerdict(row, rule, verdict, openByType.get(rule.type));
    } catch (err: unknown) {
      log.warn('applyVerdict failed — continuing', {
        printer: row.printer_name,
        rule: rule.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function loadOpenAlerts(printerId: string): Promise<OpenAlertRow[]> {
  return db.query<OpenAlertRow>(
    `SELECT id, printer_id, alert_type, severity, first_seen_at
       FROM public.printer_alerts
      WHERE printer_id = $1 AND resolved_at IS NULL`,
    [printerId],
  );
}

// ─── State transitions ──────────────────────────────────────────────────────

async function applyVerdict(
  row: LatestSnapshotRow,
  rule: AlertRule,
  verdict: RuleVerdict,
  openRow: OpenAlertRow | undefined,
): Promise<void> {
  if (verdict.active) {
    const severity: AlertSeverity = verdict.severity ?? rule.severity;
    if (openRow) {
      await updateAlertSeen(openRow.id, verdict, severity);
    } else {
      await raiseAlert(row, rule, verdict, severity);
    }
  } else if (openRow) {
    await resolveAlert(openRow, row);
  }
}

async function raiseAlert(
  row: LatestSnapshotRow,
  rule: AlertRule,
  verdict: RuleVerdict,
  severity: AlertSeverity,
): Promise<void> {
  const valueJson = JSON.stringify(verdict.value ?? {});
  const inserted = await db.query<{ id: string; first_seen_at: Date }>(
    `INSERT INTO public.printer_alerts
        (printer_id, studio_id, alert_type, severity, first_seen_at, last_seen_at, last_value, message)
     VALUES ($1, $2, $3, $4, now(), now(), $5::jsonb, $6)
     ON CONFLICT (printer_id, alert_type) WHERE resolved_at IS NULL
     DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at,
                   last_value   = EXCLUDED.last_value,
                   severity     = EXCLUDED.severity,
                   message      = EXCLUDED.message
     RETURNING id, first_seen_at`,
    [
      row.printer_id,
      row.studio_id,
      rule.type,
      severity,
      valueJson,
      verdict.message ?? null,
    ],
  );

  const alertId = inserted[0]?.id;
  if (!alertId) {
    log.warn('raiseAlert INSERT returned no id', {
      printer: row.printer_name,
      rule: rule.type,
    });
    return;
  }

  printerAlertsRaisedTotal.inc({ type: rule.type, severity });

  try {
    broadcastToRoom('printer:alert-raised', 'employee:dashboard', {
      alertId,
      printerId: row.printer_id,
      printerName: row.printer_name,
      studioId: row.studio_id,
      alertType: rule.type,
      severity,
      message: verdict.message ?? null,
      value: verdict.value ?? null,
      firstSeenAt: inserted[0]?.first_seen_at.toISOString(),
    });
  } catch (err: unknown) {
    log.warn('broadcastToRoom alert-raised failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log.info('Alert raised', {
    printer: row.printer_name,
    type: rule.type,
    severity,
  });
}

async function updateAlertSeen(
  alertId: string,
  verdict: RuleVerdict,
  severity: AlertSeverity,
): Promise<void> {
  const valueJson = JSON.stringify(verdict.value ?? {});
  await db.query(
    `UPDATE public.printer_alerts
        SET last_seen_at = now(),
            last_value   = $2::jsonb,
            severity     = $3,
            message      = COALESCE($4, message)
      WHERE id = $1 AND resolved_at IS NULL`,
    [alertId, valueJson, severity, verdict.message ?? null],
  );
}

async function resolveAlert(openRow: OpenAlertRow, snap: LatestSnapshotRow): Promise<void> {
  const reason = await decideResolveReason(openRow);
  const updated = await db.query<{ id: string; resolved_at: Date; resolve_reason: string }>(
    `UPDATE public.printer_alerts
        SET resolved_at    = now(),
            resolve_reason = $2
      WHERE id = $1 AND resolved_at IS NULL
     RETURNING id, resolved_at, resolve_reason`,
    [openRow.id, reason],
  );
  if (updated.length === 0) return; // already resolved elsewhere

  try {
    broadcastToRoom('printer:alert-resolved', 'employee:dashboard', {
      alertId: openRow.id,
      printerId: snap.printer_id,
      printerName: snap.printer_name,
      studioId: snap.studio_id,
      alertType: openRow.alert_type,
      resolveReason: reason,
      resolvedAt: updated[0]?.resolved_at.toISOString(),
    });
  } catch (err: unknown) {
    log.warn('broadcastToRoom alert-resolved failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log.info('Alert resolved', {
    printer: snap.printer_name,
    type: openRow.alert_type,
    reason,
  });
}

const SUPPLY_RELATED_TYPES: ReadonlySet<string> = new Set([
  'toner_low',
  'toner_empty',
  'paper_low',
  'paper_empty',
]);

async function decideResolveReason(openRow: OpenAlertRow): Promise<'auto' | 'supply_replaced'> {
  if (!SUPPLY_RELATED_TYPES.has(openRow.alert_type)) return 'auto';

  const rows = await db.query<{ id: string }>(
    `SELECT id
       FROM public.printer_supplies_replacements
      WHERE printer_id = $1
        AND replaced_at > $2
      LIMIT 1`,
    [openRow.printer_id, openRow.first_seen_at],
  );
  return rows.length > 0 ? 'supply_replaced' : 'auto';
}

// ─── Gauge refresh ──────────────────────────────────────────────────────────

async function refreshActiveGauge(): Promise<void> {
  const rows = await db.query<ActiveCountRow>(
    `SELECT severity, COUNT(*)::text AS cnt
       FROM public.printer_alerts
      WHERE resolved_at IS NULL
      GROUP BY severity`,
  );

  const severities: readonly AlertSeverity[] = ['info', 'warn', 'critical'];
  const bySeverity = new Map<AlertSeverity, number>();
  for (const r of rows) {
    bySeverity.set(r.severity, Number(r.cnt));
  }
  for (const sev of severities) {
    printerAlertsActive.labels(sev).set(bySeverity.get(sev) ?? 0);
  }
}

// ─── Test-only exports ──────────────────────────────────────────────────────
/** @internal */
export const __test__ = {
  loadLatestSnapshots,
  loadOpenAlerts,
  evaluatePrinter,
  raiseAlert,
  resolveAlert,
  refreshActiveGauge,
  decideResolveReason,
  resolveIntervalMs,
  resolveStaleMinutes,
};
