/**
 * Fleet Alert Rules — pure evaluators for printer telemetry snapshots.
 *
 * Every rule is a pure function: given a `TelemetrySnapshot` it returns either
 *   - `null` — rule is not applicable to this snapshot (e.g. no trays),
 *   - `{ active: false, ... }` — rule applies but condition is currently clear,
 *   - `{ active: true, value, message }` — rule fires; engine will raise / update alert.
 *
 * The engine (alerts-engine.service.ts) is the only caller. Thresholds are sourced
 * from env vars so prod can tune without redeploy:
 *   - FLEET_ALERT_TONER_WARN_PCT   (default 15)
 *   - FLEET_ALERT_TONER_CRIT_PCT   (default 5)
 *   - FLEET_ALERT_PAPER_WARN_PCT   (default 20)
 *   - FLEET_ALERT_STALE_SNAPSHOT_MINUTES (default 15; consumed by the engine)
 *
 * All per-color/per-tray/per-error aggregation is done *inside* each rule — one
 * rule evaluator returns at most one verdict per printer (e.g. "any toner low"),
 * so the engine can maintain a single open row per `(printer_id, alert_type)`.
 *
 * Special sentinel values from RFC 3805 (printer MIB):
 *   - current_level === -3 → "at least one sheet present" (not a real count) — NOT low
 *   - current_level === -2 → "level unknown"                                 — skip
 *   - current_level === -1 → "other"                                          — skip
 *   - level_pct === null   → SNMP returned no value                           — skip
 */

import type { SupplyEntry, TrayEntry, AlertEntry } from './snmp-client.js';

// ─── Input shape (subset of persisted printer_telemetry row) ─────────────────

/**
 * Snapshot passed to rule evaluators. Accepts both the live `TelemetrySnapshot`
 * from snmp-client and a DB row re-hydrated from `printer_telemetry` (where the
 * JSONB columns are already parsed to arrays).
 *
 * Note: the `errors` field mirrors the DB column name (which snmp-poller populates
 * from the snapshot's `alerts` array filtered to severity==='critical'). However,
 * the engine queries the raw JSONB and can contain all severities.
 */
export interface TelemetrySnapshotForRules {
  readonly is_online: boolean;
  readonly state: string | null;
  readonly supplies: readonly SupplyEntry[];
  readonly trays: readonly TrayEntry[];
  readonly errors: readonly AlertEntry[];
  readonly collected_at: Date;
}

// ─── Rule contract ──────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warn' | 'critical';

export interface RuleVerdict {
  readonly active: boolean;
  readonly severity?: AlertSeverity;
  readonly value?: Record<string, unknown>;
  readonly message?: string;
}

export interface AlertRule {
  readonly type: string;
  /** Default severity — may be overridden per-verdict (e.g. toner warn→critical). */
  readonly severity: AlertSeverity;
  readonly evaluate: (snapshot: TelemetrySnapshotForRules) => RuleVerdict | null;
}

// ─── Env thresholds ──────────────────────────────────────────────────────────

function readPct(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
  return n;
}

/** Public helper — the engine re-reads these each tick so env changes propagate. */
export function getThresholds(): {
  tonerWarnPct: number;
  tonerCritPct: number;
  paperWarnPct: number;
} {
  return {
    tonerWarnPct: readPct('FLEET_ALERT_TONER_WARN_PCT', 15),
    tonerCritPct: readPct('FLEET_ALERT_TONER_CRIT_PCT', 5),
    paperWarnPct: readPct('FLEET_ALERT_PAPER_WARN_PCT', 20),
  };
}

// ─── Rule implementations ────────────────────────────────────────────────────

/**
 * offline — printer did not respond on last poll.
 * Fires whenever `is_online === false`. Value carries last_seen_at for UI display.
 */
const offlineRule: AlertRule = {
  type: 'offline',
  severity: 'critical',
  evaluate: (s) => ({
    active: s.is_online === false,
    severity: 'critical',
    value: { last_seen_at: s.collected_at.toISOString() },
    message: 'Принтер не отвечает',
  }),
};

/**
 * toner_low — per-color aggregation. Fires at `level_pct` below warn threshold
 * and escalates to critical below crit threshold.
 *
 * Skips supplies with `level_pct === null` (SNMP unable to measure). If ALL supplies
 * are unmeasurable, returns null (rule not applicable — don't raise, don't clear).
 */
const tonerLowRule: AlertRule = {
  type: 'toner_low',
  severity: 'warn',
  evaluate: (s) => {
    const { tonerWarnPct, tonerCritPct } = getThresholds();

    const measurable = s.supplies.filter((x) => x.level_pct !== null);
    if (measurable.length === 0) return null;

    let worstPct: number | null = null;
    let worstColor: string | null = null;
    for (const sup of measurable) {
      const pct = sup.level_pct as number; // narrowed by filter above
      if (worstPct === null || pct < worstPct) {
        worstPct = pct;
        worstColor = sup.colorant ?? sup.description ?? `supply_${sup.index}`;
      }
    }

    if (worstPct === null || worstPct >= tonerWarnPct) {
      return { active: false };
    }

    const severity: AlertSeverity = worstPct < tonerCritPct ? 'critical' : 'warn';
    const colors = measurable
      .filter((x) => (x.level_pct as number) < tonerWarnPct)
      .map((x) => ({
        index: x.index,
        color: x.colorant ?? x.description ?? `supply_${x.index}`,
        level_pct: x.level_pct,
      }));

    return {
      active: true,
      severity,
      value: { worst_pct: worstPct, worst_color: worstColor, colors },
      message: `Тонер заканчивается (${worstColor ?? '?'}: ${worstPct}%)`,
    };
  },
};

/**
 * paper_low — per-tray aggregation using `current_level / max_capacity * 100`.
 *
 * Honors RFC 3805 sentinels:
 *   - -3 → "at least one" → treat as NOT low
 *   - -2 → "unknown"       → skip this tray
 *   - -1 → "other"         → skip this tray
 *   - null                 → skip this tray
 *   -  0                   → critical (empty)
 *
 * If all trays skipped → null (rule not applicable).
 */
const paperLowRule: AlertRule = {
  type: 'paper_low',
  severity: 'warn',
  evaluate: (s) => {
    const { paperWarnPct } = getThresholds();

    interface Candidate {
      tray: TrayEntry;
      pct: number | null; // null means "don't count but tray present" (e.g. -3)
      isEmpty: boolean;
      isAtLeastOne: boolean;
    }

    const candidates: Candidate[] = [];
    for (const t of s.trays) {
      if (t.current_level === null) continue;
      if (t.current_level === -2 || t.current_level === -1) continue;

      if (t.current_level === -3) {
        // "at least one sheet present" — tray counted, but no numeric pct
        candidates.push({ tray: t, pct: null, isEmpty: false, isAtLeastOne: true });
        continue;
      }

      if (t.max_capacity <= 0) continue;

      const pct = Math.max(
        0,
        Math.min(100, Math.round((t.current_level / t.max_capacity) * 100)),
      );
      candidates.push({
        tray: t,
        pct,
        isEmpty: t.current_level === 0,
        isAtLeastOne: false,
      });
    }

    if (candidates.length === 0) return null;

    const anyEmpty = candidates.find((c) => c.isEmpty);
    if (anyEmpty) {
      return {
        active: true,
        severity: 'critical',
        value: {
          tray_index: anyEmpty.tray.index,
          tray_name: anyEmpty.tray.name,
          current_level: anyEmpty.tray.current_level,
        },
        message: `Лоток пуст (${anyEmpty.tray.name || `#${anyEmpty.tray.index}`})`,
      };
    }

    // Find lowest measurable tray (ignoring "-3 at least one" entries).
    let worst: Candidate | null = null;
    for (const c of candidates) {
      if (c.pct === null) continue;
      if (worst === null || (c.pct < (worst.pct as number))) worst = c;
    }

    if (!worst || worst.pct === null || worst.pct >= paperWarnPct) {
      return { active: false };
    }

    return {
      active: true,
      severity: 'warn',
      value: {
        tray_index: worst.tray.index,
        tray_name: worst.tray.name,
        pct: worst.pct,
        current_level: worst.tray.current_level,
        max_capacity: worst.tray.max_capacity,
      },
      message: `Мало бумаги в лотке ${worst.tray.name || `#${worst.tray.index}`} (${worst.pct}%)`,
    };
  },
};

/**
 * paper_jam — any error description matches jam keywords (RU/EN).
 */
const JAM_RE = /(jam|замят)/i;
const paperJamRule: AlertRule = {
  type: 'paper_jam',
  severity: 'critical',
  evaluate: (s) => {
    const hit = s.errors.find((e) => JAM_RE.test(e.description));
    if (!hit) return { active: false };
    return {
      active: true,
      severity: 'critical',
      value: { description: hit.description, code: hit.code },
      message: `Замятие бумаги: ${hit.description}`,
    };
  },
};

/**
 * cover_open — any error description matches cover/door keywords (RU/EN).
 */
const COVER_RE = /(cover|door|крышк)/i;
const coverOpenRule: AlertRule = {
  type: 'cover_open',
  severity: 'warn',
  evaluate: (s) => {
    const hit = s.errors.find((e) => COVER_RE.test(e.description));
    if (!hit) return { active: false };
    return {
      active: true,
      severity: 'warn',
      value: { description: hit.description, code: hit.code },
      message: `Открыта крышка: ${hit.description}`,
    };
  },
};

/**
 * snmp_unreachable — evaluated differently: the engine checks the *absence* of
 * recent snapshots per printer (older than FLEET_ALERT_STALE_SNAPSHOT_MINUTES).
 * The rule itself is a no-op for a fresh snapshot; the engine raises this alert
 * explicitly when querying the latest snapshot timestamp fails the freshness check.
 *
 * Kept here for type-level discoverability; the engine does NOT iterate this rule
 * in the normal per-snapshot loop.
 */
const snmpUnreachableRule: AlertRule = {
  type: 'snmp_unreachable',
  severity: 'warn',
  evaluate: () => null,
};

// ─── Public ruleset ──────────────────────────────────────────────────────────

export const RULES: readonly AlertRule[] = [
  offlineRule,
  tonerLowRule,
  paperLowRule,
  paperJamRule,
  coverOpenRule,
];

/** Exported separately — engine invokes this lookup explicitly for stale detection. */
export const SNMP_UNREACHABLE_RULE: AlertRule = snmpUnreachableRule;

/** @internal — test-only exports. */
export const __test__ = {
  offlineRule,
  tonerLowRule,
  paperLowRule,
  paperJamRule,
  coverOpenRule,
};
