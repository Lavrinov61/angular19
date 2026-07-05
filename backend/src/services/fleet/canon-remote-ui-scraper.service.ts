/**
 * Canon Remote UI Scraper — periodic Job Log ingestion.
 *
 * Every `FLEET_CANON_RUI_POLL_INTERVAL_MS` (default 600_000 / 10 min) polls
 * every active printer matching `name ILIKE '%Canon%'` AND NOT `%SC-F100%'`
 * (the Epson SC-F100 DTG is marketed as "Canon-compatible" but has no RUI).
 *
 * Per printer:
 *   1. Resolve IP via shared `resolvePrinterIp()` (CUPS lpstat cache).
 *   2. Look up studio-specific credentials from env.
 *   3. Call `fetchJobLog()` — circuit-breaker-protected; we catch + log, never
 *      let one printer fail the whole sweep.
 *   4. For each row: UPSERT into `print_jobs` with `print_source='canon_remote_ui'`.
 *   5. Try to merge with a concurrent CUPS row (same printer, same pages,
 *      same minute) — keep the Canon row (has document name), delete the
 *      CUPS row, record the dedup in `external_job_ids_merged`.
 *   6. Bump `printer_jobs_recorded_total{source='canon_remote_ui'}` +
 *      `canon_ui_auth_total{printer,result}`; emit `printer:job-recorded`
 *      on `employee:dashboard`.
 *
 * Leader-election is the caller's responsibility — `startCanonRemoteUiScraper()`
 * should only be invoked in the leader/scheduler process (see
 * scheduler-leader.ts & split-PM2 PROCESS_ROLE gating).
 */
import db from '../../database/db.js';
import { createLogger } from '../../utils/logger.js';
import { broadcastToRoom } from '../../websocket/broadcast-to-room.js';
import {
  canonUiAuthTotal,
  canonUiJobsMergedTotal,
  printerJobsRecordedTotal,
} from '../metrics.service.js';

import {
  CanonRemoteUiError,
  fetchJobLog,
  type CanonJob,
} from './canon-remote-ui-client.js';
import { resolvePrinterIp } from './ip-resolver.js';

const log = createLogger('fleet:canon-ui-scraper');

// ─── Config ────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 30_000;
const CANON_UI_PORT = Number.parseInt(process.env['FLEET_CANON_RUI_PORT'] ?? '8000', 10);
const MERGE_WINDOW_SEC = 15; // ±15s window for same-timestamp match
const MERGE_LOOKBACK_MIN = 15;

const CANON_TS_RE = /^(\d{2})\/(\d{2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;
const COPIES_X_PAGES_RE = /^(\d+)\s*x\s*(\d+)$/i;

// ─── Types ─────────────────────────────────────────────────────────────────

interface ActivePrinterRow {
  id: string;
  name: string;
  studio_id: string | null;
  cups_printer_name: string | null;
  location_code: string | null;
}

interface Credentials {
  username: string;
  password: string;
}

// ─── State ─────────────────────────────────────────────────────────────────

let pollInterval: ReturnType<typeof setInterval> | null = null;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let abortCtl: AbortController | null = null;
let stopped = true;
let systemUserId: string | null = null;

// ─── Public API ────────────────────────────────────────────────────────────

export function startCanonRemoteUiScraper(): void {
  if (!stopped) {
    log.warn('startCanonRemoteUiScraper called while already running — ignoring');
    return;
  }
  const intervalMs = resolveIntervalMs();
  stopped = false;
  abortCtl = new AbortController();

  log.info('Starting Canon Remote UI scraper', {
    intervalMs,
    initialDelayMs: DEFAULT_INITIAL_DELAY_MS,
    port: CANON_UI_PORT,
  });

  const tick = (): void => {
    if (stopped) return;
    if (inFlight) {
      log.warn('Previous Canon RUI sweep still in flight — skipping this tick');
      return;
    }
    inFlight = runOnce()
      .catch((err: unknown) => {
        log.error('Canon RUI sweep failed', {
          error: err instanceof Error ? err.message : 'unknown',
        });
      })
      .finally(() => {
        inFlight = null;
      });
  };

  initialTimeout = setTimeout(tick, DEFAULT_INITIAL_DELAY_MS);
  pollInterval = setInterval(tick, intervalMs);
}

export async function stopCanonRemoteUiScraper(): Promise<void> {
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

  if (abortCtl) {
    try {
      abortCtl.abort('shutdown');
    } catch {
      /* ignore */
    }
    abortCtl = null;
  }

  if (inFlight) {
    try {
      await inFlight;
    } catch {
      /* already logged */
    }
  }

  log.info('Canon Remote UI scraper stopped');
}

// ─── Core loop ─────────────────────────────────────────────────────────────

async function runOnce(): Promise<void> {
  if (!systemUserId) {
    systemUserId = await resolveSystemUserId();
  }
  if (!systemUserId) {
    log.warn(
      'Canon RUI scraper: no system user id configured (FLEET_CUPS_SYSTEM_USER_ID / first user) — skipping sweep',
    );
    return;
  }

  const started = Date.now();
  const printers = await loadActiveCanonPrinters();
  if (printers.length === 0) {
    log.info('No Canon printers found for Remote UI scrape');
    return;
  }

  // One failure must not block others — run serially-per-printer with
  // isolated try/catch. The inner circuit breaker keeps slow hosts bounded.
  for (const printer of printers) {
    if (stopped) break;
    try {
      await scrapePrinter(printer);
    } catch (err: unknown) {
      log.warn('scrapePrinter threw unexpectedly', {
        printer: printer.name,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  log.info('Canon RUI sweep finished', {
    count: printers.length,
    durationMs: Date.now() - started,
  });
}

async function scrapePrinter(printer: ActivePrinterRow): Promise<void> {
  const ip = await resolvePrinterIp(printer.cups_printer_name);
  if (!ip) {
    log.debug('Canon RUI: could not resolve IP — skipping', {
      printer: printer.name,
      cups: printer.cups_printer_name,
    });
    canonUiAuthTotal.labels(printer.name, 'http_error').inc();
    return;
  }

  const creds = resolveCredentials(printer);
  if (!creds) {
    log.warn('Canon RUI: no credentials for studio — skipping', {
      printer: printer.name,
      location_code: printer.location_code,
    });
    canonUiAuthTotal.labels(printer.name, 'bad_credentials').inc();
    return;
  }

  const baseUrl = `http://${ip}:${CANON_UI_PORT}`;

  let rows: CanonJob[];
  try {
    rows = await fetchJobLog(baseUrl, creds.username, creds.password);
  } catch (err: unknown) {
    if (err instanceof CanonRemoteUiError) {
      canonUiAuthTotal.labels(printer.name, err.reason).inc();
      if (err.reason === 'circuit_open') {
        log.warn('Canon RUI circuit open — skipping this cycle', {
          printer: printer.name,
        });
      } else {
        log.warn('Canon RUI fetch failed', {
          printer: printer.name,
          reason: err.reason,
        });
      }
      return;
    }
    canonUiAuthTotal.labels(printer.name, 'http_error').inc();
    log.warn('Canon RUI fetch threw non-typed error', {
      printer: printer.name,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return;
  }

  canonUiAuthTotal.labels(printer.name, 'success').inc();
  if (rows.length === 0) {
    log.debug('Canon RUI: empty job log', { printer: printer.name });
    return;
  }

  let upsertedCount = 0;
  let mergedCount = 0;
  for (const row of rows) {
    try {
      const result = await upsertJob(printer, row);
      if (result) {
        upsertedCount += 1;
        broadcastToRoom('printer:job-recorded', 'employee:dashboard', {
          jobId: result.id,
          printerId: printer.id,
          printerName: printer.name,
          studioId: printer.studio_id,
          canonJobId: row.canon_job_id,
          pagesPrinted: row.pages,
          fileName: sanitizeFileName(row.document_name) ?? `canon-${row.canon_job_id}`,
          status: row.status === 'OK' ? 'completed' : 'failed',
          completedAt: result.completedAt.toISOString(),
          source: 'canon_remote_ui',
          inserted: result.inserted,
        });
        printerJobsRecordedTotal.inc({ source: 'canon_remote_ui' }, 1);

        const merged = await tryMergeWithCups(printer, result.id, row.pages, result.completedAt);
        if (merged) {
          mergedCount += 1;
          canonUiJobsMergedTotal.labels(printer.name).inc();
        }
      }
    } catch (err: unknown) {
      log.warn('Canon RUI upsert failed for row', {
        printer: printer.name,
        canon_job_id: row.canon_job_id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  log.info('Canon RUI printer scraped', {
    printer: printer.name,
    rowsFetched: rows.length,
    rowsUpserted: upsertedCount,
    rowsMergedWithCups: mergedCount,
  });
}

// ─── DB helpers ────────────────────────────────────────────────────────────

async function loadActiveCanonPrinters(): Promise<ActivePrinterRow[]> {
  const rows = await db.query<ActivePrinterRow>(
    `SELECT p.id, p.name, p.studio_id, p.cups_printer_name, s.location_code
       FROM printers p
       LEFT JOIN studios s ON s.id = p.studio_id
      WHERE p.is_active = true
        AND p.name ILIKE '%Canon%'
        AND p.name NOT ILIKE '%SC-F100%'
      ORDER BY p.name`,
  );
  return rows;
}

interface UpsertResult {
  id: string;
  inserted: boolean;
  completedAt: Date;
}

async function upsertJob(
  printer: ActivePrinterRow,
  row: CanonJob,
): Promise<UpsertResult | null> {
  if (!systemUserId) return null;

  let completedAt: Date | null =
    parseCanonTimestamp(row.start_time_local)
    ?? parseCanonTimestamp(row.end_time_local);
  if (!completedAt) {
    log.warn('Canon RUI: unparseable timestamp — using now()', {
      printer: printer.name,
      canon_job_id: row.canon_job_id,
      start: row.start_time_local,
      end: row.end_time_local,
    });
    completedAt = new Date();
  }

  const copies = parseCopiesXPages(row.copies_x_pages);
  const status = row.status === 'OK' ? 'completed' : 'failed';
  const pages = Math.max(1, row.pages);
  const fileName = sanitizeFileName(row.document_name) ?? `canon-${row.canon_job_id}`;
  const fileUrl = `canon-rui://${printer.id}/${row.canon_job_id}`;

  const sql = `
    INSERT INTO print_jobs (
      printer_id, studio_id, external_job_id, print_source,
      file_url, file_name, paper_size,
      pages_printed, copies, status,
      created_by, created_at, completed_at
    )
    VALUES (
      $1::uuid, $2::uuid, $3, 'canon_remote_ui',
      $4, $5, $6,
      $7, $8, $9,
      $10::uuid, $11, $11
    )
    ON CONFLICT (printer_id, external_job_id, print_source)
    DO UPDATE SET
      pages_printed = EXCLUDED.pages_printed,
      status        = EXCLUDED.status,
      file_name     = COALESCE(NULLIF(EXCLUDED.file_name, ''), print_jobs.file_name),
      completed_at  = GREATEST(print_jobs.completed_at, EXCLUDED.completed_at)
    RETURNING id, (xmax = 0) AS inserted
  `;

  const params: unknown[] = [
    printer.id,
    printer.studio_id,
    row.canon_job_id,
    fileUrl,
    fileName.slice(0, 255),
    'A4',
    pages,
    Math.max(1, copies),
    status,
    systemUserId,
    completedAt,
  ];

  const res = await db.query<{ id: string; inserted: boolean }>(sql, params);
  const first = res[0];
  if (!first) return null;
  return { id: first.id, inserted: first.inserted === true, completedAt };
}

async function tryMergeWithCups(
  printer: ActivePrinterRow,
  canonJobPkId: string,
  pages: number,
  completedAt: Date,
): Promise<boolean> {
  const windowFromMs = new Date(completedAt.getTime() - MERGE_LOOKBACK_MIN * 60_000);
  const windowToMs = new Date(completedAt.getTime() + MERGE_LOOKBACK_MIN * 60_000);

  const cupsRows = await db.query<{
    id: string;
    external_job_id: string | null;
    completed_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, external_job_id, completed_at, created_at
       FROM print_jobs
      WHERE printer_id = $1::uuid
        AND print_source = 'cups'
        AND pages_printed = $2
        AND created_at BETWEEN $3 AND $4
      ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - $5::timestamptz))) ASC
      LIMIT 5`,
    [printer.id, pages, windowFromMs, windowToMs, completedAt],
  );

  if (cupsRows.length === 0) return false;

  const best = cupsRows[0];
  if (!best) return false;
  const dtSec = Math.abs((best.created_at.getTime() - completedAt.getTime()) / 1000);
  if (dtSec > MERGE_WINDOW_SEC) {
    log.debug('Canon RUI: nearest CUPS row outside merge window — keeping both', {
      printer: printer.name,
      cupsId: best.id,
      dtSec,
    });
    return false;
  }

  // Merge: record both external ids on the canon row, delete the cups row.
  const mergedPayload = JSON.stringify({
    canon_remote_ui: canonJobPkId,
    cups: best.external_job_id,
  });

  await db.query(
    `UPDATE print_jobs
        SET external_job_ids_merged = $2::jsonb,
            updated_at              = now()
      WHERE id = $1::uuid`,
    [canonJobPkId, mergedPayload],
  );
  await db.query(`DELETE FROM print_jobs WHERE id = $1::uuid`, [best.id]);

  log.info('Canon RUI: merged CUPS row into Canon row', {
    printer: printer.name,
    canonJobPkId,
    cupsPkId: best.id,
    cupsExternalId: best.external_job_id,
    dtSec,
  });
  return true;
}

async function resolveSystemUserId(): Promise<string | null> {
  const fromEnv = process.env['FLEET_CUPS_SYSTEM_USER_ID']?.trim();
  if (fromEnv && /^[0-9a-f-]{36}$/i.test(fromEnv)) return fromEnv;
  try {
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM users ORDER BY created_at ASC LIMIT 1`,
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    log.warn('resolveSystemUserId failed', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

// ─── Credentials ───────────────────────────────────────────────────────────

function resolveCredentials(printer: ActivePrinterRow): Credentials | null {
  // Dev fallback. In prod, env vars must be set — we warn once per printer.
  if (printer.location_code === 'soborny') {
    const u = process.env['CANON_RUI_USER_SOBORNY'];
    const p = process.env['CANON_RUI_PASSWORD_SOBORNY'];
    if (u && p) return { username: u, password: p };
    warnDevFallback(printer);
    return { username: 'rostv', password: '32zxrg90' };
  }
  if (printer.location_code === 'barrikadnaya-4') {
    const u = process.env['CANON_RUI_USER_BARRIKADNAYA'];
    const p = process.env['CANON_RUI_PASSWORD_BARRIKADNAYA'];
    if (u && p) return { username: u, password: p };
    log.warn('Canon RUI: no env credentials for Barrikadnaya — skipping', {
      printer: printer.name,
    });
    return null;
  }
  // Unknown studio — try generic env as last resort.
  const u = process.env['CANON_RUI_USER'];
  const p = process.env['CANON_RUI_PASSWORD'];
  if (u && p) return { username: u, password: p };
  return null;
}

const devFallbackWarned = new Set<string>();
function warnDevFallback(printer: ActivePrinterRow): void {
  if (devFallbackWarned.has(printer.id)) return;
  devFallbackWarned.add(printer.id);
  log.warn(
    'Canon RUI: using DEV FALLBACK credentials — set CANON_RUI_USER_SOBORNY/PASSWORD_SOBORNY in prod .env',
    { printer: printer.name, location_code: printer.location_code },
  );
}

// ─── Parsing helpers ───────────────────────────────────────────────────────

/**
 * Canon UI shows timestamps like `20/04 2006 16:42:19` — the `2006` is a
 * firmware quirk (reference-year placeholder); the actual year is 2026.
 * We correct only when the resulting date is within +/- 1 year of now.
 */
export function parseCanonTimestamp(raw: string): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Format: DD/MM YYYY HH:MM:SS
  const m = trimmed.match(CANON_TS_RE);
  if (!m) return null;
  const dd = m[1];
  const mm = m[2];
  const yearRaw = m[3];
  const hh = m[4];
  const mi = m[5];
  const ss = m[6];
  if (!dd || !mm || !yearRaw || !hh || !mi || !ss) return null;

  let yyyy = Number.parseInt(yearRaw, 10);
  if (!Number.isFinite(yyyy)) return null;

  const nowYear = new Date().getFullYear();
  if (yyyy === 2006 && nowYear >= 2020) {
    // Known firmware bug: 2006 → use nowYear.
    yyyy = nowYear;
  }

  // Build local-time ISO (Europe/Moscow) — the UI shows printer-local time.
  const tz = process.env['FLEET_CANON_RUI_TZ'] ?? '+03:00';
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${tz}`;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;

  // Sanity: if the parsed date is >14 days in the future or >2 years past, bail.
  const diffMs = d.getTime() - Date.now();
  if (diffMs > 14 * 24 * 3600_000) return null;
  if (diffMs < -2 * 365 * 24 * 3600_000) return null;
  return d;
}

export function parseCopiesXPages(raw: string): number {
  if (!raw) return 1;
  const m = raw.trim().match(COPIES_X_PAGES_RE);
  if (!m) return 1;
  const n = Number.parseInt(m[1] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function sanitizeFileName(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t || t === '-' || t === 'NONE') return null;
  return t;
}

// ─── Env helpers ───────────────────────────────────────────────────────────

function resolveIntervalMs(): number {
  const raw = process.env['FLEET_CANON_RUI_POLL_INTERVAL_MS'];
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) {
    log.warn('Invalid FLEET_CANON_RUI_POLL_INTERVAL_MS — falling back to default', {
      raw,
    });
    return DEFAULT_INTERVAL_MS;
  }
  return n;
}

// ─── Test-only exports ─────────────────────────────────────────────────────

/** @internal */
export const __test__ = {
  loadActiveCanonPrinters,
  upsertJob,
  tryMergeWithCups,
  resolveCredentials,
  resolveSystemUserId,
};
