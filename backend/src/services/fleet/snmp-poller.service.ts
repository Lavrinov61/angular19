/**
 * Fleet SNMP Poller — periodic telemetry collector.
 *
 * Every `FLEET_SNMP_POLL_INTERVAL_MS` (default 300_000) walks every active printer in
 * `printers` table, resolves its IP via `lpstat -v <cups_printer_name>`, fetches a
 * telemetry snapshot over SNMP, writes it to `printer_telemetry`, updates Prometheus
 * gauges, and emits `printer:telemetry-updated` on the `employee:dashboard` room.
 *
 * Leader-election is the caller's responsibility — `startSnmpPoller()` should only be
 * invoked by the leader process (see `scheduler-leader.ts`).
 *
 * Per-printer failures are isolated: one down device can't prevent snapshots for the
 * rest of the fleet. `p-queue` bounds concurrency to avoid UDP-socket storms.
 *
 * IP resolution uses `spawn('lpstat', ['-v', cupsName])` (arg-array, no shell) and is
 * cached in-memory with 1h TTL. Cache can be busted via `clearIpCache()` or by setting
 * `FLEET_PRINTER_IP_<cupsName>` env override (useful for dev without CUPS).
 */

import { spawn } from 'node:child_process';

import PQueue from 'p-queue';

import db from '../../database/db.js';
import { createLogger } from '../../utils/logger.js';
import { broadcastToRoom } from '../../websocket/broadcast-to-room.js';
import {
  printerIsOnline,
  printerPaperPct,
  printerPollDurationSeconds,
  printerTelemetryPollsTotal,
  printerTonerPct,
} from '../metrics.service.js';

import { fetchTelemetry, type TelemetrySnapshot } from './snmp-client.js';

const log = createLogger('fleet:snmp-poller');

// Config

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_COMMUNITY = 'public';
const DEFAULT_INITIAL_DELAY_MS = 15_000;
const IP_CACHE_TTL_MS = 60 * 60 * 1000;

const SOCKET_URI_RE = /socket:\/\/([0-9A-Fa-f.:-]+?)(?::(\d+))?(?:[/?]|$)/;

// State

interface ActivePrinterRow {
  id: string;
  name: string;
  studio_id: string | null;
  cups_printer_name: string | null;
}

interface IpCacheEntry {
  ip: string | null;
  fetchedAt: number;
}

const ipCache = new Map<string, IpCacheEntry>();

let pollInterval: ReturnType<typeof setInterval> | null = null;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let stopped = true;
const queue = new PQueue({ concurrency: DEFAULT_CONCURRENCY });

// Public API

export function startSnmpPoller(): void {
  if (!stopped) {
    log.warn('startSnmpPoller called while already running — ignoring');
    return;
  }

  const intervalMs = resolveIntervalMs();
  stopped = false;
  log.info('Starting SNMP poller', { intervalMs, initialDelayMs: DEFAULT_INITIAL_DELAY_MS });

  const tick = (): void => {
    if (stopped) return;
    if (inFlight) {
      log.warn('Previous poll still in flight — skipping this tick');
      return;
    }
    inFlight = runOnce()
      .catch((err: unknown) => {
        log.error('SNMP poll sweep failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        inFlight = null;
      });
  };

  initialTimeout = setTimeout(tick, DEFAULT_INITIAL_DELAY_MS);
  pollInterval = setInterval(tick, intervalMs);
}

export async function stopSnmpPoller(): Promise<void> {
  if (stopped) return;
  stopped = true;

  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  queue.pause();
  queue.clear();

  if (inFlight) {
    try {
      await inFlight;
    } catch {
      /* logged already */
    }
  }

  await queue.onIdle();
  log.info('SNMP poller stopped');
}

/** Exposed for ops tooling / tests. */
export function clearIpCache(): void {
  ipCache.clear();
}

/**
 * One-off poll for a single printer by id.
 *
 * Used by `POST /api/fleet/printers/:id/telemetry/refresh`. Unlike `pollOne`
 * (which is fire-and-forget inside the sweep), this returns the fresh
 * telemetry row and surfaces an `unreachable` flag when the printer can't
 * be contacted (lpstat failed OR SNMP circuit-breaker timed out).
 *
 * Never throws on transport errors — wraps them into `{ snapshot: null,
 * reason: 'unreachable' }` so the HTTP handler returns 200. A real
 * exception (DB write failure, printer not found) still bubbles up.
 */
export async function pollPrinterOnce(
  printerId: string,
): Promise<{ snapshot: TelemetrySnapshot | null; reason: 'unreachable' | null; printer: ActivePrinterRow }> {
  const row = await db.queryOne<ActivePrinterRow>(
    `SELECT id, name, studio_id, cups_printer_name
       FROM printers
      WHERE id = $1`,
    [printerId],
  );
  if (!row) {
    throw new Error(`Printer ${printerId} not found`);
  }

  const community = process.env['FLEET_SNMP_COMMUNITY'] ?? DEFAULT_COMMUNITY;
  const ip = await resolvePrinterIp(row);
  if (!ip) {
    log.warn('pollPrinterOnce: IP unresolved', { printer: row.name });
    const snap = offlineRowFromUnknownIp();
    try {
      await persistSnapshot(row, snap);
    } catch (err: unknown) {
      log.error('pollPrinterOnce: persist offline row failed', {
        printer: row.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { snapshot: null, reason: 'unreachable', printer: row };
  }

  let snapshot: TelemetrySnapshot;
  try {
    snapshot = await fetchTelemetry(ip, community);
  } catch (err: unknown) {
    log.warn('pollPrinterOnce: fetchTelemetry threw', {
      printer: row.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return { snapshot: null, reason: 'unreachable', printer: row };
  }

  printerIsOnline.labels(row.name).set(snapshot.is_online ? 1 : 0);
  updateGaugesFromSnapshot(row.name, snapshot);
  await persistSnapshot(row, snapshot);

  return { snapshot, reason: null, printer: row };
}

// Core loop

async function runOnce(): Promise<void> {
  const started = Date.now();
  const printers = await loadActivePrinters();
  if (printers.length === 0) {
    log.info('No active printers to poll');
    return;
  }

  const tasks = printers.map((printer) =>
    queue.add(async () => pollOne(printer)).catch((err: unknown) => {
      log.warn('pollOne threw unexpectedly', {
        printer: printer.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }),
  );
  await Promise.all(tasks);

  log.info('SNMP sweep finished', {
    count: printers.length,
    durationMs: Date.now() - started,
  });
}

async function pollOne(printer: ActivePrinterRow): Promise<void> {
  const community = process.env['FLEET_SNMP_COMMUNITY'] ?? DEFAULT_COMMUNITY;
  const ip = await resolvePrinterIp(printer);
  if (!ip) {
    printerTelemetryPollsTotal.labels(printer.name, 'offline').inc();
    log.debug('Skipping printer — could not resolve IP', {
      printer: printer.name,
      cups: printer.cups_printer_name,
    });
    await persistSnapshot(printer, offlineRowFromUnknownIp());
    return;
  }

  const timer = printerPollDurationSeconds.startTimer({ printer: printer.name });
  let snapshot: TelemetrySnapshot;
  try {
    snapshot = await fetchTelemetry(ip, community);
  } catch (err: unknown) {
    log.warn('fetchTelemetry threw', {
      printer: printer.name,
      error: err instanceof Error ? err.message : String(err),
    });
    printerTelemetryPollsTotal.labels(printer.name, 'error').inc();
    timer();
    return;
  }
  timer();

  const result = snapshot.is_online ? 'success' : 'offline';
  printerTelemetryPollsTotal.labels(printer.name, result).inc();
  printerIsOnline.labels(printer.name).set(snapshot.is_online ? 1 : 0);
  updateGaugesFromSnapshot(printer.name, snapshot);

  try {
    await persistSnapshot(printer, snapshot);
  } catch (err: unknown) {
    log.error('Failed to persist telemetry snapshot', {
      printer: printer.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    broadcastToRoom('printer:telemetry-updated', 'employee:dashboard', {
      printerId: printer.id,
      printerName: printer.name,
      studioId: printer.studio_id,
      isOnline: snapshot.is_online,
      state: snapshot.state,
      supplies: snapshot.supplies,
      trays: snapshot.trays,
      alerts: snapshot.alerts,
      collectedAt: snapshot.fetched_at.toISOString(),
    });
  } catch (err: unknown) {
    log.warn('broadcastToRoom failed (non-fatal)', {
      printer: printer.name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// DB

async function loadActivePrinters(): Promise<ActivePrinterRow[]> {
  const rows = await db.query<ActivePrinterRow>(
    `SELECT id, name, studio_id, cups_printer_name
       FROM printers
      WHERE is_active = true
      ORDER BY name`,
  );
  return rows;
}

async function persistSnapshot(
  printer: ActivePrinterRow,
  snapshot: TelemetrySnapshot,
): Promise<void> {
  const errors = snapshot.alerts.filter((a) => a.severity === 'critical');
  const stateReasons = snapshot.alerts.map((a) => a.description).filter((s) => s.length > 0);

  await db.query(
    `INSERT INTO printer_telemetry (
        printer_id, studio_id, is_online, state, state_reasons,
        supplies, trays, counters, errors,
        model, manufacturer, serial_number, firmware_version, collected_at
     ) VALUES (
        $1, $2, $3, $4, $5,
        $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
        $10, $11, $12, $13, $14
     )`,
    [
      printer.id,
      printer.studio_id,
      snapshot.is_online,
      snapshot.state,
      stateReasons.length > 0 ? stateReasons : null,
      JSON.stringify(snapshot.supplies),
      JSON.stringify(snapshot.trays),
      JSON.stringify(snapshot.counters),
      JSON.stringify(errors),
      extractModelFromSysDescr(snapshot.sys_descr),
      extractManufacturerFromSysDescr(snapshot.sys_descr),
      snapshot.serial_number,
      snapshot.firmware_version,
      snapshot.fetched_at,
    ],
  );
}

// IP resolution (CUPS lpstat -v)

async function resolvePrinterIp(printer: ActivePrinterRow): Promise<string | null> {
  if (!printer.cups_printer_name) return null;

  const envOverride = process.env[`FLEET_PRINTER_IP_${printer.cups_printer_name}`];
  if (envOverride) return envOverride;

  const cached = ipCache.get(printer.cups_printer_name);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < IP_CACHE_TTL_MS) {
    return cached.ip;
  }

  const ip = await queryLpstat(printer.cups_printer_name);
  ipCache.set(printer.cups_printer_name, { ip, fetchedAt: now });
  return ip;
}

/**
 * Invoke `lpstat -v <cupsName>` via spawn (arg-array, no shell). Args are never
 * interpolated into a shell command string, so there is no injection surface.
 */
function queryLpstat(cupsName: string): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const child = spawn('lpstat', ['-v', cupsName], { shell: false });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* already exited */
      }
      log.warn('lpstat timed out', { cupsName });
      resolve(null);
    }, 5000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log.warn('lpstat spawn failed', { cupsName, error: err.message });
      resolve(null);
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        log.debug('lpstat exited non-zero', { cupsName, code });
        resolve(null);
        return;
      }
      const match = SOCKET_URI_RE.exec(stdout);
      if (!match) {
        log.debug('lpstat output did not contain socket:// URI', { cupsName });
        resolve(null);
        return;
      }
      resolve(match[1] ?? null);
    });
  });
}

// Derived data

function offlineRowFromUnknownIp(): TelemetrySnapshot {
  return {
    is_online: false,
    sys_descr: null,
    state: 'unreachable',
    supplies: [],
    trays: [],
    alerts: [],
    counters: { lifetime: null, power_on: null },
    firmware_version: null,
    serial_number: null,
    fetched_at: new Date(),
  };
}

function extractModelFromSysDescr(sysDescr: string | null): string | null {
  if (!sysDescr) return null;
  const m = /^(?:[A-Z][A-Za-z]+\s+)?([A-Za-z]+[-\s][A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)/.exec(sysDescr);
  return m?.[1]?.trim() ?? sysDescr.slice(0, 120);
}

function extractManufacturerFromSysDescr(sysDescr: string | null): string | null {
  if (!sysDescr) return null;
  if (/canon/i.test(sysDescr)) return 'Canon';
  if (/epson/i.test(sysDescr)) return 'Epson';
  if (/hp|hewlett/i.test(sysDescr)) return 'HP';
  if (/kyocera/i.test(sysDescr)) return 'Kyocera';
  if (/ricoh/i.test(sysDescr)) return 'Ricoh';
  if (/brother/i.test(sysDescr)) return 'Brother';
  if (/xerox/i.test(sysDescr)) return 'Xerox';
  if (/konica/i.test(sysDescr)) return 'Konica Minolta';
  return null;
}

function updateGaugesFromSnapshot(printer: string, snapshot: TelemetrySnapshot): void {
  for (const s of snapshot.supplies) {
    const color = s.colorant ?? s.description ?? `supply_${s.index}`;
    if (s.level_pct == null) {
      printerTonerPct.remove(printer, color);
    } else {
      printerTonerPct.labels(printer, color).set(s.level_pct);
    }
  }
  for (const t of snapshot.trays) {
    const tray = t.name && t.name.length > 0 ? t.name : `tray_${t.index}`;
    if (t.current_level == null || t.max_capacity <= 0) {
      printerPaperPct.remove(printer, tray);
      continue;
    }
    const pct = Math.max(0, Math.min(100, Math.round((t.current_level / t.max_capacity) * 100)));
    printerPaperPct.labels(printer, tray).set(pct);
  }
}

// Env helpers

function resolveIntervalMs(): number {
  const raw = process.env['FLEET_SNMP_POLL_INTERVAL_MS'];
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 10_000) {
    log.warn('Invalid FLEET_SNMP_POLL_INTERVAL_MS — falling back to default', { raw });
    return DEFAULT_INTERVAL_MS;
  }
  return n;
}

// Test-only exports
/** @internal */
export const __test__ = {
  loadActivePrinters,
  persistSnapshot,
  resolvePrinterIp,
  queryLpstat,
  updateGaugesFromSnapshot,
  extractModelFromSysDescr,
  extractManufacturerFromSysDescr,
  SOCKET_URI_RE,
};
