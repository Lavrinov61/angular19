/**
 * Unit tests for alert-rules pure evaluators.
 *
 * No DB, no SNMP — each test builds a synthetic TelemetrySnapshotForRules and
 * inspects the verdict returned by the rule under test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __test__,
  getThresholds,
  type TelemetrySnapshotForRules,
} from '../alert-rules.js';
import type { SupplyEntry, TrayEntry, AlertEntry } from '../snmp-client.js';

const { offlineRule, tonerLowRule, paperLowRule, paperJamRule } = __test__;

// ─── Snapshot builder ───────────────────────────────────────────────────────

interface BuildOpts {
  is_online?: boolean;
  state?: string | null;
  supplies?: SupplyEntry[];
  trays?: TrayEntry[];
  errors?: AlertEntry[];
  collected_at?: Date;
}

function snap(o: BuildOpts = {}): TelemetrySnapshotForRules {
  return {
    is_online: o.is_online ?? true,
    state: o.state ?? 'idle',
    supplies: o.supplies ?? [],
    trays: o.trays ?? [],
    errors: o.errors ?? [],
    collected_at: o.collected_at ?? new Date('2026-04-21T12:00:00Z'),
  };
}

function supply(level_pct: number | null, colorant = 'Black'): SupplyEntry {
  return {
    index: 1,
    description: `${colorant} Toner`,
    type: 'toner',
    level_pct,
    max_capacity: 100,
    colorant,
  };
}

function tray(current_level: number, max_capacity = 500, index = 1): TrayEntry {
  return {
    index,
    name: `Tray ${index}`,
    description: `Tray ${index}`,
    current_level,
    max_capacity,
    media_name: 'A4',
    media_type: 'plain',
  };
}

function err(description: string, severity: AlertEntry['severity'] = 'critical'): AlertEntry {
  return { severity, description, code: null };
}

// ─── Env reset helper ───────────────────────────────────────────────────────

const ENV_KEYS = [
  'FLEET_ALERT_TONER_WARN_PCT',
  'FLEET_ALERT_TONER_CRIT_PCT',
  'FLEET_ALERT_PAPER_WARN_PCT',
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─── Thresholds helper ──────────────────────────────────────────────────────

describe('getThresholds', () => {
  it('returns defaults when env unset', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    expect(getThresholds()).toEqual({
      tonerWarnPct: 15,
      tonerCritPct: 5,
      paperWarnPct: 20,
    });
  });

  it('honours valid env overrides', () => {
    process.env['FLEET_ALERT_TONER_WARN_PCT'] = '25';
    process.env['FLEET_ALERT_TONER_CRIT_PCT'] = '10';
    process.env['FLEET_ALERT_PAPER_WARN_PCT'] = '30';
    expect(getThresholds()).toEqual({
      tonerWarnPct: 25,
      tonerCritPct: 10,
      paperWarnPct: 30,
    });
  });

  it('falls back on invalid input', () => {
    process.env['FLEET_ALERT_TONER_WARN_PCT'] = 'nope';
    process.env['FLEET_ALERT_TONER_CRIT_PCT'] = '-5';
    process.env['FLEET_ALERT_PAPER_WARN_PCT'] = '200';
    expect(getThresholds()).toEqual({
      tonerWarnPct: 15,
      tonerCritPct: 5,
      paperWarnPct: 20,
    });
  });
});

// ─── offline ────────────────────────────────────────────────────────────────

describe('offlineRule', () => {
  it('fires when is_online=false', () => {
    const v = offlineRule.evaluate(snap({ is_online: false }));
    expect(v).not.toBeNull();
    expect(v?.active).toBe(true);
    expect(v?.severity).toBe('critical');
    expect(v?.message).toMatch(/не отвеча/i);
    expect(v?.value).toMatchObject({ last_seen_at: expect.any(String) });
  });

  it('does NOT fire when is_online=true', () => {
    const v = offlineRule.evaluate(snap({ is_online: true }));
    expect(v?.active).toBe(false);
  });
});

// ─── toner_low ──────────────────────────────────────────────────────────────

describe('tonerLowRule', () => {
  it('does NOT fire at 20%', () => {
    const v = tonerLowRule.evaluate(snap({ supplies: [supply(20)] }));
    expect(v?.active).toBe(false);
  });

  it('fires at 10% with severity=warn', () => {
    const v = tonerLowRule.evaluate(snap({ supplies: [supply(10)] }));
    expect(v?.active).toBe(true);
    expect(v?.severity).toBe('warn');
    expect(v?.value).toMatchObject({ worst_pct: 10 });
  });

  it('escalates at 3% to critical', () => {
    const v = tonerLowRule.evaluate(snap({ supplies: [supply(3)] }));
    expect(v?.active).toBe(true);
    expect(v?.severity).toBe('critical');
    expect(v?.value).toMatchObject({ worst_pct: 3 });
  });

  it('fires on ANY low color among many (C/M/Y full, K low)', () => {
    const v = tonerLowRule.evaluate(
      snap({
        supplies: [
          supply(80, 'Cyan'),
          supply(70, 'Magenta'),
          supply(60, 'Yellow'),
          supply(4, 'Black'),
        ],
      }),
    );
    expect(v?.active).toBe(true);
    expect(v?.severity).toBe('critical');
    expect(v?.value).toMatchObject({ worst_pct: 4, worst_color: 'Black' });
  });

  it('returns null when ALL supplies have level_pct=null (not measurable)', () => {
    const v = tonerLowRule.evaluate(
      snap({ supplies: [supply(null, 'Cyan'), supply(null, 'Black')] }),
    );
    expect(v).toBeNull();
  });

  it('skips null-level supply but still checks measurable ones', () => {
    const v = tonerLowRule.evaluate(
      snap({ supplies: [supply(null, 'Cyan'), supply(2, 'Black')] }),
    );
    expect(v?.active).toBe(true);
    expect(v?.severity).toBe('critical');
    expect(v?.value).toMatchObject({ worst_color: 'Black' });
  });

  it('honours env threshold override', () => {
    process.env['FLEET_ALERT_TONER_WARN_PCT'] = '30';
    const v = tonerLowRule.evaluate(snap({ supplies: [supply(25)] }));
    expect(v?.active).toBe(true);
    expect(v?.severity).toBe('warn');
  });
});

// ─── paper_low ──────────────────────────────────────────────────────────────

describe('paperLowRule', () => {
  it('does NOT fire at 50% (250/500)', () => {
    const v = paperLowRule.evaluate(snap({ trays: [tray(250, 500)] }));
    expect(v?.active).toBe(false);
  });

  it('fires warn at 15% (75/500)', () => {
    const v = paperLowRule.evaluate(snap({ trays: [tray(75, 500)] }));
    expect(v?.active).toBe(true);
    expect(v?.severity).toBe('warn');
    expect(v?.value).toMatchObject({ pct: 15 });
  });

  it('fires critical at current_level=0 (empty)', () => {
    const v = paperLowRule.evaluate(snap({ trays: [tray(0, 500)] }));
    expect(v?.active).toBe(true);
    expect(v?.severity).toBe('critical');
    expect(v?.message).toMatch(/пуст/i);
  });

  it('treats current_level=-3 (at least one) as NOT low', () => {
    const v = paperLowRule.evaluate(snap({ trays: [tray(-3, 500)] }));
    // Tray counted as "at least one present" — no numeric pct to compare,
    // so verdict is inactive.
    expect(v?.active).toBe(false);
  });

  it('skips current_level=-2 (unknown)', () => {
    const v = paperLowRule.evaluate(snap({ trays: [tray(-2, 500)] }));
    expect(v).toBeNull();
  });

  it('skips current_level=-1 (other)', () => {
    const v = paperLowRule.evaluate(snap({ trays: [tray(-1, 500)] }));
    expect(v).toBeNull();
  });

  it('returns null when trays empty', () => {
    const v = paperLowRule.evaluate(snap({ trays: [] }));
    expect(v).toBeNull();
  });

  it('raises on lowest tray when multiple present', () => {
    const v = paperLowRule.evaluate(
      snap({ trays: [tray(400, 500, 1), tray(30, 500, 2), tray(-3, 500, 3)] }),
    );
    expect(v?.active).toBe(true);
    expect(v?.severity).toBe('warn');
    expect(v?.value).toMatchObject({ tray_index: 2, pct: 6 });
  });
});

// ─── paper_jam ──────────────────────────────────────────────────────────────

describe('paperJamRule', () => {
  it('fires on English "jam" (case-insensitive)', () => {
    const v = paperJamRule.evaluate(snap({ errors: [err('Paper Jam in Tray 2')] }));
    expect(v?.active).toBe(true);
    expect(v?.severity).toBe('critical');
  });

  it('fires on lowercase "jam"', () => {
    const v = paperJamRule.evaluate(snap({ errors: [err('media jam detected')] }));
    expect(v?.active).toBe(true);
  });

  it('fires on Russian "замятие" and "замят"', () => {
    const v1 = paperJamRule.evaluate(snap({ errors: [err('замятие бумаги')] }));
    expect(v1?.active).toBe(true);

    const v2 = paperJamRule.evaluate(snap({ errors: [err('Бумага замята в лотке')] }));
    expect(v2?.active).toBe(true);
  });

  it('does NOT fire when no matching error', () => {
    const v = paperJamRule.evaluate(
      snap({ errors: [err('Cover open'), err('Toner low', 'warning')] }),
    );
    expect(v?.active).toBe(false);
  });

  it('does NOT fire when errors empty', () => {
    const v = paperJamRule.evaluate(snap({ errors: [] }));
    expect(v?.active).toBe(false);
  });
});
