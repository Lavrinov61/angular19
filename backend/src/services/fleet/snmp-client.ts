/**
 * SNMP client for Fleet Management.
 *
 * Wraps net-snmp Session with:
 *   - RFC 3805 subtree walks over prtMarkerSuppliesTable / prtInputTable / prtAlertTable
 *   - Per-OID error resilience (collect whatever parses, don't fail entire snapshot)
 *   - Per-IP opossum CircuitBreaker (fail-fast when printer is consistently down)
 *
 * The default fallback on any transport-level error → `is_online: false` snapshot with
 * all nulls, so the caller can still write a telemetry row and dashboards see "offline".
 *
 * net-snmp has no bundled TypeScript declarations; the package exports a CommonJS API
 * that we interop with via `import * as snmp from 'net-snmp'`. The module is loaded
 * with narrow `unknown` types and guarded call sites — no `any` leakage.
 */

import CircuitBreakerCtor from 'opossum';
import type CircuitBreakerType from 'opossum';
import * as snmpLib from 'net-snmp';

import { createLogger } from '../../utils/logger.js';
import {
  STANDARD_OIDS,
  SUPPLY_TYPE_BY_CODE,
  ALERT_SEVERITY_BY_CODE,
  DEVICE_STATE_BY_CODE,
} from './snmp-oids.js';

const log = createLogger('fleet:snmp-client');

// Public types

export interface SupplyEntry {
  index: number;
  description: string;
  type: 'toner' | 'ink' | 'drum' | 'other';
  level_pct: number | null;
  max_capacity: number;
  colorant: string | null;
}

export interface TrayEntry {
  index: number;
  name: string;
  description: string;
  current_level: number | null;
  max_capacity: number;
  media_name: string | null;
  media_type: string | null;
}

export interface AlertEntry {
  severity: 'critical' | 'warning' | 'info';
  description: string;
  code: number | null;
}

export interface TelemetrySnapshot {
  is_online: boolean;
  sys_descr: string | null;
  state: string | null;
  supplies: SupplyEntry[];
  trays: TrayEntry[];
  alerts: AlertEntry[];
  counters: {
    lifetime: number | null;
    power_on: number | null;
  };
  firmware_version: string | null;
  serial_number: string | null;
  fetched_at: Date;
}

export interface FetchTelemetryOptions {
  /** SNMP version. Defaults to 2c for Printer MIB walks. */
  version?: '1' | '2c';
  /** Per-OID request timeout in ms. */
  timeoutMs?: number;
  /** Retries per OID request. */
  retries?: number;
  /** Overall circuit-breaker timeout (wraps the whole fetch). */
  breakerTimeoutMs?: number;
  /** UDP port. */
  port?: number;
}

// net-snmp interop (narrow types, no `any` escape)

interface Varbind {
  oid: string;
  type: number;
  value: unknown;
}

interface SnmpSession {
  get(oids: string[], cb: (err: Error | null, varbinds?: Varbind[]) => void): void;
  subtree(
    oid: string,
    maxRepetitions: number,
    feedCb: (varbinds: Varbind[]) => void,
    doneCb: (err: Error | null) => void,
  ): void;
  close(): void;
  on(event: 'close' | 'error', listener: (err?: Error) => void): void;
}

interface SnmpModule {
  createSession: (
    target: string,
    community: string,
    opts: {
      version: number;
      timeout: number;
      retries: number;
      transport?: string;
      port?: number;
    },
  ) => SnmpSession;
  isVarbindError: (vb: Varbind) => boolean;
  varbindError: (vb: Varbind) => string;
  Version1: number;
  Version2c: number;
  ObjectType: Record<string, number>;
}

function loadSnmp(): SnmpModule {
  return snmpLib as unknown as SnmpModule;
}

// Circuit breaker registry (per-IP)

type FetchFn = (
  ip: string,
  community: string,
  options: FetchTelemetryOptions,
) => Promise<TelemetrySnapshot>;

type Breaker = CircuitBreakerType<Parameters<FetchFn>, TelemetrySnapshot>;

const breakers = new Map<string, Breaker>();

interface BreakerOpts {
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
  rollingCountTimeout: number;
  rollingCountBuckets: number;
  volumeThreshold: number;
  name: string;
}

const DEFAULT_BREAKER_OPTS: BreakerOpts = {
  timeout: 8000,
  errorThresholdPercentage: 50,
  resetTimeout: 30_000,
  rollingCountTimeout: 60_000,
  rollingCountBuckets: 6,
  volumeThreshold: 3,
  name: 'fleet-snmp',
};

function getBreaker(ip: string): Breaker {
  let breaker = breakers.get(ip);
  if (breaker) return breaker;

  breaker = new CircuitBreakerCtor<Parameters<FetchFn>, TelemetrySnapshot>(
    actualFetchTelemetry,
    { ...DEFAULT_BREAKER_OPTS, name: `fleet-snmp:${ip}` },
  );

  breaker.on('open', () => log.warn('Circuit opened', { ip }));
  breaker.on('halfOpen', () => log.info('Circuit half-open', { ip }));
  breaker.on('close', () => log.info('Circuit closed', { ip }));

  breakers.set(ip, breaker);
  return breaker;
}

export function getCircuitState(ip: string): 'open' | 'half-open' | 'closed' {
  const breaker = breakers.get(ip);
  if (!breaker) return 'closed';
  if (breaker.opened) return 'open';
  if (breaker.halfOpen) return 'half-open';
  return 'closed';
}

/** Test helper. Clears the per-IP breaker registry. */
export function __resetBreakersForTests(): void {
  for (const b of breakers.values()) {
    try {
      b.shutdown();
    } catch {
      /* opossum versions <8.1 lack shutdown() */
    }
  }
  breakers.clear();
}

// Public entry point

/**
 * Fetch a full telemetry snapshot from `ip` using `community`.
 * Never throws. On transport failure the breaker returns an offline snapshot.
 */
export async function fetchTelemetry(
  ip: string,
  community: string,
  options: FetchTelemetryOptions = {},
): Promise<TelemetrySnapshot> {
  const breaker = getBreaker(ip);
  try {
    return await breaker.fire(ip, community, options);
  } catch (err: unknown) {
    log.warn('fetchTelemetry rejected by breaker or inner fn', {
      ip,
      error: err instanceof Error ? err.message : String(err),
    });
    return offlineSnapshot();
  }
}

// Parsing helpers

function offlineSnapshot(): TelemetrySnapshot {
  return {
    is_online: false,
    sys_descr: null,
    state: null,
    supplies: [],
    trays: [],
    alerts: [],
    counters: { lifetime: null, power_on: null },
    firmware_version: null,
    serial_number: null,
    fetched_at: new Date(),
  };
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8').replace(/ +$/, '').trim() || null;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (Buffer.isBuffer(value) && value.length <= 8) {
    const hex = value.toString('hex');
    if (!hex) return null;
    const n = parseInt(hex, 16);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Extract the tail index from an OID under a known base.
 *   base = '1.3.6.1.2.1.43.11.1.1.9.1'
 *   oid  = '1.3.6.1.2.1.43.11.1.1.9.1.3'  -> index=3
 * Returns null if `oid` does not live under `base`.
 */
function extractIndex(baseOid: string, oid: string): number | null {
  if (!oid.startsWith(baseOid + '.')) return null;
  const tail = oid.slice(baseOid.length + 1);
  const firstDot = tail.indexOf('.');
  const firstSegment = firstDot === -1 ? tail : tail.slice(0, firstDot);
  const idx = Number(firstSegment);
  return Number.isFinite(idx) ? idx : null;
}

/**
 * Walk `baseOid` on `session`, returning a map of index -> value.
 * Errors are logged and swallowed.
 */
function walkOidToIndexMap(
  session: SnmpSession,
  baseOid: string,
  decode: (v: Varbind) => string | number | null,
): Promise<Map<number, string | number | null>> {
  return new Promise((resolve) => {
    const out = new Map<number, string | number | null>();
    const mod = loadSnmp();

    const feedCb = (varbinds: Varbind[]): void => {
      for (const vb of varbinds) {
        try {
          if (mod.isVarbindError(vb)) continue;
          const idx = extractIndex(baseOid, vb.oid);
          if (idx == null) continue;
          out.set(idx, decode(vb));
        } catch {
          /* skip malformed varbind */
        }
      }
    };

    const doneCb = (err: Error | null): void => {
      if (err) {
        log.debug('subtree walk completed with error', { baseOid, error: err.message });
      }
      resolve(out);
    };

    try {
      session.subtree(baseOid, 20, feedCb, doneCb);
    } catch (err: unknown) {
      log.debug('subtree threw synchronously', {
        baseOid,
        error: err instanceof Error ? err.message : String(err),
      });
      resolve(out);
    }
  });
}

function getScalars(
  session: SnmpSession,
  oids: string[],
): Promise<Map<string, Varbind | null>> {
  return new Promise((resolve) => {
    const mod = loadSnmp();
    try {
      session.get(oids, (err, varbinds) => {
        const out = new Map<string, Varbind | null>();
        if (err || !varbinds) {
          for (const oid of oids) out.set(oid, null);
          resolve(out);
          return;
        }
        for (let i = 0; i < varbinds.length; i++) {
          const vb = varbinds[i];
          const key = oids[i];
          if (!vb || !key) continue;
          if (mod.isVarbindError(vb)) {
            out.set(key, null);
          } else {
            out.set(key, vb);
          }
        }
        resolve(out);
      });
    } catch {
      const out = new Map<string, Varbind | null>();
      for (const oid of oids) out.set(oid, null);
      resolve(out);
    }
  });
}

// Assembly

function buildSupplies(
  levels: Map<number, string | number | null>,
  descriptions: Map<number, string | number | null>,
  capacities: Map<number, string | number | null>,
  types: Map<number, string | number | null>,
  colorantIndexes: Map<number, string | number | null>,
  colorants: Map<number, string | number | null>,
): SupplyEntry[] {
  const indices = new Set<number>([
    ...levels.keys(),
    ...descriptions.keys(),
    ...capacities.keys(),
    ...types.keys(),
  ]);

  const out: SupplyEntry[] = [];
  for (const idx of Array.from(indices).sort((a, b) => a - b)) {
    const maxRaw = capacities.get(idx);
    const levelRaw = levels.get(idx);
    const typeRaw = types.get(idx);
    const maxCapacity = typeof maxRaw === 'number' ? maxRaw : Number(maxRaw ?? 0) || 0;
    const levelVal = typeof levelRaw === 'number' ? levelRaw : Number(levelRaw ?? NaN);

    // RFC 3805: level=-1 "unknown", -2 "some remains", -3 "no value".
    let level_pct: number | null = null;
    if (Number.isFinite(levelVal) && maxCapacity > 0 && levelVal >= 0) {
      level_pct = Math.max(0, Math.min(100, Math.round((levelVal / maxCapacity) * 100)));
    }

    const typeCode = typeof typeRaw === 'number' ? typeRaw : Number(typeRaw ?? NaN);
    const type: SupplyEntry['type'] = Number.isFinite(typeCode)
      ? (SUPPLY_TYPE_BY_CODE[typeCode] ?? 'other')
      : 'other';

    const colorantIdx = colorantIndexes.get(idx);
    const colorantIdxNum = typeof colorantIdx === 'number' ? colorantIdx : Number(colorantIdx ?? NaN);
    const colorantRaw = Number.isFinite(colorantIdxNum) ? colorants.get(colorantIdxNum) : null;
    const colorant = typeof colorantRaw === 'string' && colorantRaw.length > 0 ? colorantRaw : null;

    const descRaw = descriptions.get(idx);
    const description = typeof descRaw === 'string' ? descRaw : String(descRaw ?? `Supply ${idx}`);

    out.push({
      index: idx,
      description,
      type,
      level_pct,
      max_capacity: maxCapacity,
      colorant,
    });
  }
  return out;
}

function buildTrays(
  levels: Map<number, string | number | null>,
  maxs: Map<number, string | number | null>,
  names: Map<number, string | number | null>,
  descriptions: Map<number, string | number | null>,
  mediaNames: Map<number, string | number | null>,
  mediaTypes: Map<number, string | number | null>,
): TrayEntry[] {
  const indices = new Set<number>([
    ...levels.keys(),
    ...maxs.keys(),
    ...names.keys(),
    ...descriptions.keys(),
  ]);

  const out: TrayEntry[] = [];
  for (const idx of Array.from(indices).sort((a, b) => a - b)) {
    const levelRaw = levels.get(idx);
    const levelVal = typeof levelRaw === 'number' ? levelRaw : Number(levelRaw ?? NaN);
    const maxRaw = maxs.get(idx);
    const maxCapacity = typeof maxRaw === 'number' ? maxRaw : Number(maxRaw ?? 0) || 0;

    const nameRaw = names.get(idx);
    const descRaw = descriptions.get(idx);
    const mediaNameRaw = mediaNames.get(idx);
    const mediaTypeRaw = mediaTypes.get(idx);

    out.push({
      index: idx,
      name: typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? `Tray ${idx}`),
      description: typeof descRaw === 'string' ? descRaw : String(descRaw ?? ''),
      current_level: Number.isFinite(levelVal) && levelVal >= 0 ? levelVal : null,
      max_capacity: maxCapacity,
      media_name: typeof mediaNameRaw === 'string' && mediaNameRaw.length > 0 ? mediaNameRaw : null,
      media_type: typeof mediaTypeRaw === 'string' && mediaTypeRaw.length > 0 ? mediaTypeRaw : null,
    });
  }
  return out;
}

function buildAlerts(
  severities: Map<number, string | number | null>,
  descriptions: Map<number, string | number | null>,
  codes: Map<number, string | number | null>,
): AlertEntry[] {
  const indices = new Set<number>([
    ...severities.keys(),
    ...descriptions.keys(),
    ...codes.keys(),
  ]);
  const out: AlertEntry[] = [];
  for (const idx of Array.from(indices).sort((a, b) => a - b)) {
    const sevRaw = severities.get(idx);
    const sevCode = typeof sevRaw === 'number' ? sevRaw : Number(sevRaw ?? NaN);
    const severity: AlertEntry['severity'] = Number.isFinite(sevCode)
      ? (ALERT_SEVERITY_BY_CODE[sevCode] ?? 'info')
      : 'info';

    const descRaw = descriptions.get(idx);
    const description = typeof descRaw === 'string' ? descRaw : String(descRaw ?? '');

    const codeRaw = codes.get(idx);
    const codeNum = typeof codeRaw === 'number' ? codeRaw : Number(codeRaw ?? NaN);
    const code = Number.isFinite(codeNum) ? codeNum : null;

    out.push({ severity, description, code });
  }
  return out;
}

// Inner fetch (wrapped by circuit breaker)

async function actualFetchTelemetry(
  ip: string,
  community: string,
  options: FetchTelemetryOptions,
): Promise<TelemetrySnapshot> {
  const mod = loadSnmp();
  const timeout = options.timeoutMs ?? 5000;
  const retries = options.retries ?? 2;
  const version = options.version === '1' ? mod.Version1 : mod.Version2c;

  let session: SnmpSession;
  try {
    const sessOpts: { version: number; timeout: number; retries: number; port?: number } = {
      version,
      timeout,
      retries,
    };
    if (options.port !== undefined) sessOpts.port = options.port;
    session = mod.createSession(ip, community, sessOpts);
  } catch (err: unknown) {
    log.warn('SNMP createSession failed', {
      ip,
      error: err instanceof Error ? err.message : String(err),
    });
    return offlineSnapshot();
  }

  session.on('error', (err?: Error) => {
    if (err) log.debug('SNMP session error', { ip, error: err.message });
  });

  try {
    // Step 1: scalars
    const scalarOids = [
      STANDARD_OIDS.sysDescr,
      STANDARD_OIDS.sysName,
      STANDARD_OIDS.hrDeviceStatus,
      STANDARD_OIDS.hrPrinterStatus,
      STANDARD_OIDS.prtMarkerLifeCount,
      STANDARD_OIDS.prtMarkerPowerOnCount,
    ];
    const scalars = await getScalars(session, scalarOids);

    const sysDescrVb = scalars.get(STANDARD_OIDS.sysDescr);
    const hrDeviceStatusVb = scalars.get(STANDARD_OIDS.hrDeviceStatus);
    const lifetimeVb = scalars.get(STANDARD_OIDS.prtMarkerLifeCount);
    const poweronVb = scalars.get(STANDARD_OIDS.prtMarkerPowerOnCount);

    const sysDescr = sysDescrVb ? asString(sysDescrVb.value) : null;
    const hrDeviceCode = hrDeviceStatusVb ? asNumber(hrDeviceStatusVb.value) : null;
    const state =
      hrDeviceCode != null ? (DEVICE_STATE_BY_CODE[hrDeviceCode] ?? 'unknown') : null;

    const allScalarsNull = Array.from(scalars.values()).every((v) => v === null);

    // Step 2: parallel walks
    const [
      supplyLevels,
      supplyDescriptions,
      supplyCapacities,
      supplyTypes,
      colorantIndexes,
      colorantValues,
      trayLevels,
      trayMaxs,
      trayNames,
      trayDescriptions,
      mediaNames,
      mediaTypes,
      alertSeverities,
      alertDescriptions,
      alertCodes,
    ] = await Promise.all([
      walkOidToIndexMap(session, STANDARD_OIDS.prtMarkerSuppliesLevel, (v) => asNumber(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtMarkerSuppliesDescription, (v) => asString(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtMarkerSuppliesMaxCapacity, (v) => asNumber(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtMarkerSuppliesType, (v) => asNumber(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtMarkerSuppliesColorantIndex, (v) => asNumber(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtMarkerColorantValue, (v) => asString(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtInputCurrentLevel, (v) => asNumber(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtInputMaxCapacity, (v) => asNumber(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtInputName, (v) => asString(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtInputDescription, (v) => asString(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtInputMediaName, (v) => asString(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtInputMediaType, (v) => asString(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtAlertSeverityLevel, (v) => asNumber(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtAlertDescription, (v) => asString(v.value)),
      walkOidToIndexMap(session, STANDARD_OIDS.prtAlertCode, (v) => asNumber(v.value)),
    ]);

    const supplies = buildSupplies(
      supplyLevels,
      supplyDescriptions,
      supplyCapacities,
      supplyTypes,
      colorantIndexes,
      colorantValues,
    );
    const trays = buildTrays(
      trayLevels,
      trayMaxs,
      trayNames,
      trayDescriptions,
      mediaNames,
      mediaTypes,
    );
    const alerts = buildAlerts(alertSeverities, alertDescriptions, alertCodes);

    const nothingReturned =
      allScalarsNull && supplies.length === 0 && trays.length === 0 && alerts.length === 0;

    // Heuristic parse of firmware / serial from sysDescr.
    let firmware_version: string | null = null;
    let serial_number: string | null = null;
    if (sysDescr) {
      const fw = /(?:firmware|ver(?:sion)?|fw)[:\s]+([A-Za-z0-9._-]+)/i.exec(sysDescr);
      if (fw?.[1]) firmware_version = fw[1];
      const sn = /(?:s\/n|serial|sn)[:\s]+([A-Za-z0-9-]+)/i.exec(sysDescr);
      if (sn?.[1]) serial_number = sn[1];
    }

    return {
      is_online: !nothingReturned,
      sys_descr: sysDescr,
      state,
      supplies,
      trays,
      alerts,
      counters: {
        lifetime: lifetimeVb ? asNumber(lifetimeVb.value) : null,
        power_on: poweronVb ? asNumber(poweronVb.value) : null,
      },
      firmware_version,
      serial_number,
      fetched_at: new Date(),
    };
  } finally {
    try {
      session.close();
    } catch {
      /* already closed */
    }
  }
}

// Test-only exports (not part of the stable API)
/** @internal */
export const __test__ = {
  actualFetchTelemetry,
  loadSnmp,
  buildSupplies,
  buildTrays,
  buildAlerts,
  extractIndex,
  asNumber,
  asString,
};
