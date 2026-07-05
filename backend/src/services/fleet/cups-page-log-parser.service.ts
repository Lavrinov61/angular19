/**
 * CUPS PageLog parser — Fleet Management ingestion pipeline.
 *
 * Tails `/var/log/cups/page_log` (format configured by `backend/ops/fleet-cups-pagelog-setup.md`),
 * parses each appended line, resolves the CUPS queue name to a `printers.id`, and
 * upserts a row into `print_jobs` with `print_source='cups'`.
 *
 * Lifecycle — exported start/stop; NOT self-registered. Task 7 wires this into
 * the scheduler process via `PROCESS_ROLE=scheduler` + leader-election.
 *
 * Crash-safety:
 *  - Last-read byte offset is persisted in Redis (`fleet:cups:pagelog:offset`).
 *  - On startup we read the offset, stat the file, and:
 *      * size >= offset -> seek to offset, continue from there.
 *      * size <  offset -> logrotate happened, reset to 0 and re-tail the new file.
 *  - INSERT uses ON CONFLICT (printer_id, external_job_id, print_source) DO UPDATE,
 *    so even if the offset is stale after restart the parser never double-counts.
 *
 * Intentionally framework-free: the service owns its own fs watcher, its own
 * read buffer, and its own Redis handle. Safe to import from a worker process.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';

import type Redis from 'ioredis';

import db from '../../database/db.js';
import { createResilientRedis } from '../redis-factory.js';
import { broadcastToRoom } from '../../websocket/broadcast-to-room.js';
import { createLogger } from '../../utils/logger.js';
import { printerJobsRecordedTotal } from '../metrics.service.js';

const log = createLogger('cups-page-log-parser');

// --- Config -----------------------------------------------------------------

const DEFAULT_PAGE_LOG_PATH = '/var/log/cups/page_log';
const REDIS_OFFSET_KEY = 'fleet:cups:pagelog:offset';
const PRINTER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const WATCH_INTERVAL_MS = 2_000;
const READ_CHUNK_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB per tick

/**
 * Regex parsing the PageLogFormat:
 *   "%p %u %j %T %P %C %{job-impressions-completed} %{job-media-sheets-completed} %{job-name} %{media} %{sides}"
 *
 * Groups (1-based):
 *   1 printer_name
 *   2 username
 *   3 cups_job_id
 *   4 timestamp_str         (inside [...])
 *   5 page_num
 *   6 copies
 *   7 impressions_completed (digits or "-")
 *   8 media_sheets_completed
 *   9 job_name inside quotes (null when CUPS emits unquoted sentinel like "NONE")
 *  10 media
 *  11 sides
 */
export const CUPS_PAGE_LOG_REGEX =
  /^(\S+)\s+(\S+)\s+(\d+)\s+\[([^\]]+)\]\s+(\d+)\s+(\d+)\s+(\d+|-)\s+(\d+|-)\s+(?:"([^"]*)"|\S+)\s+(\S+)\s+(\S+)\s*$/;

// --- Parser -----------------------------------------------------------------

export interface ParsedPageLogLine {
  printerName: string;
  username: string;
  cupsJobId: string;
  timestampStr: string;
  timestamp: Date;
  pageNum: number;
  copies: number;
  impressionsCompleted: number | null;
  mediaSheetsCompleted: number | null;
  jobName: string | null;
  media: string | null;
  sides: string | null;
  duplex: boolean;
}

/**
 * Parse a single CUPS PageLog line. Returns `null` on invalid/partial input —
 * never throws. Keep the parser resilient to the occasional truncated line
 * from logrotate / partial write boundary.
 */
export function parseCupsPageLogLine(line: string): ParsedPageLogLine | null {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  const m = CUPS_PAGE_LOG_REGEX.exec(trimmed);
  if (!m) return null;

  const [
    ,
    printerName,
    username,
    cupsJobId,
    timestampStr,
    pageNumStr,
    copiesStr,
    impressionsStr,
    mediaSheetsStr,
    jobNameQuoted,
    media,
    sides,
  ] = m;

  if (!printerName || !cupsJobId || !timestampStr) return null;

  const timestamp = parseCupsTimestamp(timestampStr);
  if (!timestamp) return null;

  const pageNum = Number.parseInt(pageNumStr ?? '', 10);
  const copies = Number.parseInt(copiesStr ?? '', 10);
  if (!Number.isFinite(pageNum) || !Number.isFinite(copies)) return null;

  const impRaw = impressionsStr === '-' ? null : Number.parseInt(impressionsStr ?? '', 10);
  const sheetRaw = mediaSheetsStr === '-' ? null : Number.parseInt(mediaSheetsStr ?? '', 10);

  const duplex = sides === 'two-sided-long-edge' || sides === 'two-sided-short-edge';

  return {
    printerName,
    username: username ?? '',
    cupsJobId,
    timestampStr,
    timestamp,
    pageNum,
    copies,
    impressionsCompleted: impRaw != null && Number.isFinite(impRaw) ? impRaw : null,
    mediaSheetsCompleted: sheetRaw != null && Number.isFinite(sheetRaw) ? sheetRaw : null,
    jobName: jobNameQuoted ?? null,
    media: media && media !== '-' ? media : null,
    sides: sides && sides !== '-' ? sides : null,
    duplex,
  };
}

/**
 * Parse CUPS default timestamp `DD/Mon/YYYY:HH:MM:SS +/-HHMM`.
 * Returns null on unexpected shape.
 */
export function parseCupsTimestamp(s: string): Date | null {
  // Example: 21/Apr/2026:21:22:59 +0300
  const m = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [, dd, monStr, yyyy, hh, mm, ss, tz] = m;
  const monthIdx = MONTHS.indexOf((monStr ?? '').toLowerCase());
  if (monthIdx < 0) return null;

  const tzIso = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : '+00:00';
  const iso = `${yyyy}-${String(monthIdx + 1).padStart(2, '0')}-${dd}T${hh}:${mm}:${ss}${tzIso}`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

// --- Service state ----------------------------------------------------------

interface ParserState {
  filePath: string;
  byteOffset: number;
  lineBuffer: string;
  running: boolean;
  printerCache: Map<string, { printerId: string | null; cachedAt: number }>;
  redis: Redis | null;
  systemUserId: string | null;
}

let state: ParserState | null = null;

// --- Public API -------------------------------------------------------------

export interface StartOptions {
  /** Override log path (for tests). Defaults to /var/log/cups/page_log. */
  filePath?: string;
  /** Override watch poll interval (ms). */
  watchIntervalMs?: number;
}

export async function startCupsPageLogParser(opts: StartOptions = {}): Promise<void> {
  if (state?.running) {
    log.warn('startCupsPageLogParser called while already running - ignoring');
    return;
  }

  const filePath = opts.filePath ?? process.env['FLEET_CUPS_PAGE_LOG_PATH'] ?? DEFAULT_PAGE_LOG_PATH;
  const watchIntervalMs = opts.watchIntervalMs ?? WATCH_INTERVAL_MS;

  const redis = createResilientRedis('fleet-cups-pagelog', {
    lazyConnect: false,
    enableOfflineQueue: true,
  });

  const systemUserId = await resolveSystemUserId();

  state = {
    filePath,
    byteOffset: 0,
    lineBuffer: '',
    running: true,
    printerCache: new Map(),
    redis,
    systemUserId,
  };

  try {
    const stored = await redis.get(REDIS_OFFSET_KEY);
    const offset = stored ? Number.parseInt(stored, 10) : 0;
    state.byteOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
  } catch (err) {
    log.warn('failed to read offset from Redis - starting from 0', {
      error: err instanceof Error ? err.message : String(err),
    });
    state.byteOffset = 0;
  }

  if (!fs.existsSync(filePath)) {
    log.warn('page_log does not exist yet - parser will pick up once CUPS writes the first entry', {
      filePath,
    });
  } else {
    try {
      const st = await fsp.stat(filePath);
      if (state.byteOffset > st.size) {
        log.info('page_log truncated/rotated - resetting offset to 0', {
          previousOffset: state.byteOffset,
          currentSize: st.size,
        });
        state.byteOffset = 0;
      }
    } catch {
      /* ignore - the watcher will surface read errors later */
    }
  }

  log.info('CUPS page_log parser started', {
    filePath,
    initialOffset: state.byteOffset,
    watchIntervalMs,
    systemUserIdConfigured: systemUserId != null,
  });

  // fs.watchFile is portable, survives log rotation, no inotify dependency.
  fs.watchFile(filePath, { interval: watchIntervalMs, persistent: false }, (curr, _prev) => {
    if (!state?.running) return;

    if (curr.size < state.byteOffset) {
      log.info('page_log shrank during tail - resetting offset', {
        previousOffset: state.byteOffset,
        newSize: curr.size,
      });
      state.byteOffset = 0;
      state.lineBuffer = '';
    }

    if (curr.size === state.byteOffset) return;

    void drainNewBytes().catch((err: unknown) => {
      log.error('drainNewBytes failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}

export async function stopCupsPageLogParser(): Promise<void> {
  if (!state) return;

  const s = state;
  s.running = false;

  try {
    fs.unwatchFile(s.filePath);
  } catch {
    /* ignore */
  }

  try {
    if (s.redis && s.redis.status !== 'end') {
      await s.redis.quit();
    }
  } catch (err) {
    log.warn('redis quit failed during stop', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  state = null;
  log.info('CUPS page_log parser stopped');
}

// --- Internal: drain --------------------------------------------------------

async function drainNewBytes(): Promise<void> {
  if (!state) return;
  const s = state;

  let fh: fsp.FileHandle | null = null;
  try {
    fh = await fsp.open(s.filePath, 'r');
    const st = await fh.stat();

    if (st.size <= s.byteOffset) return;

    const toRead = Math.min(st.size - s.byteOffset, READ_CHUNK_MAX_BYTES);
    const buf = Buffer.alloc(toRead);
    const { bytesRead } = await fh.read(buf, 0, toRead, s.byteOffset);
    if (bytesRead <= 0) return;

    s.byteOffset += bytesRead;

    const chunk = s.lineBuffer + buf.subarray(0, bytesRead).toString('utf-8');
    const lines = chunk.split('\n');
    s.lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line) continue;
      try {
        await handleLine(line);
      } catch (err) {
        log.warn('handleLine threw - skipping entry', {
          error: err instanceof Error ? err.message : String(err),
          linePreview: line.slice(0, 160),
        });
      }
    }

    try {
      if (s.redis && s.redis.status === 'ready') {
        await s.redis.set(REDIS_OFFSET_KEY, String(s.byteOffset));
      }
    } catch (err) {
      log.warn('failed to persist offset - will retry next tick', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    if (fh) {
      try { await fh.close(); } catch { /* ignore */ }
    }
  }
}

// --- Internal: per-line processing -----------------------------------------

async function handleLine(rawLine: string): Promise<void> {
  const parsed = parseCupsPageLogLine(rawLine);
  if (!parsed) return;

  if (!state) return;
  const s = state;

  const printerId = await resolvePrinterId(parsed.printerName);
  if (!printerId) {
    log.debug('skip: unknown CUPS queue name', {
      queue: parsed.printerName,
      cupsJobId: parsed.cupsJobId,
    });
    return;
  }

  if (!s.systemUserId) {
    log.warn('skip: no FLEET_CUPS_SYSTEM_USER_ID configured - cannot insert (created_by NOT NULL)', {
      queue: parsed.printerName,
      cupsJobId: parsed.cupsJobId,
    });
    return;
  }

  const pagesPrinted = parsed.impressionsCompleted != null && parsed.impressionsCompleted > 0
    ? parsed.impressionsCompleted
    : 1;

  const paperSize = parsed.media ?? 'A4';
  const fileName = parsed.jobName && parsed.jobName.length > 0 && parsed.jobName !== 'NONE'
    ? parsed.jobName.slice(0, 255)
    : `cups-${parsed.cupsJobId}`;

  // file_url is NOT NULL in schema; synthesize a stable sentinel URL.
  const fileUrl = `cups://${parsed.cupsJobId}`;

  const sql = `
    INSERT INTO print_jobs (
      printer_id, external_job_id, print_source,
      file_url, file_name, paper_size, duplex,
      pages_printed, copies, status,
      created_by, created_at, completed_at
    )
    VALUES (
      $1::uuid, $2, 'cups',
      $3, $4, $5, $6,
      $7, $8, 'completed',
      $9::uuid, $10, $10
    )
    ON CONFLICT (printer_id, external_job_id, print_source)
    DO UPDATE SET
      pages_printed = EXCLUDED.pages_printed,
      completed_at  = GREATEST(print_jobs.completed_at, EXCLUDED.completed_at),
      updated_at    = now()
    RETURNING id, (xmax = 0) AS inserted
  `;

  const params: unknown[] = [
    printerId,
    parsed.cupsJobId,
    fileUrl,
    fileName,
    paperSize,
    parsed.duplex,
    pagesPrinted,
    Math.max(1, parsed.copies),
    s.systemUserId,
    parsed.timestamp,
  ];

  let jobId: string | null = null;
  let inserted = false;
  try {
    const rows = await db.query<{ id: string; inserted: boolean }>(sql, params);
    if (rows[0]) {
      jobId = rows[0].id;
      inserted = rows[0].inserted === true;
    }
  } catch (err) {
    log.error('INSERT into print_jobs failed for CUPS event', {
      error: err instanceof Error ? err.message : String(err),
      queue: parsed.printerName,
      cupsJobId: parsed.cupsJobId,
      printerId,
    });
    return;
  }

  printerJobsRecordedTotal.inc({ source: 'cups' }, 1);

  broadcastToRoom('printer:job-recorded', 'employee:dashboard', {
    jobId,
    printerId,
    cupsJobId: parsed.cupsJobId,
    printerName: parsed.printerName,
    pagesPrinted,
    duplex: parsed.duplex,
    paperSize,
    fileName,
    completedAt: parsed.timestamp.toISOString(),
    source: 'cups',
    inserted,
  });
}

// --- Printer cache ----------------------------------------------------------

async function resolvePrinterId(cupsQueueName: string): Promise<string | null> {
  if (!state) return null;
  const s = state;

  const cached = s.printerCache.get(cupsQueueName);
  const now = Date.now();
  if (cached && now - cached.cachedAt < PRINTER_CACHE_TTL_MS) {
    return cached.printerId;
  }

  try {
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM printers WHERE cups_printer_name = $1 LIMIT 1`,
      [cupsQueueName],
    );
    const printerId = rows[0]?.id ?? null;
    s.printerCache.set(cupsQueueName, { printerId, cachedAt: now });
    return printerId;
  } catch (err) {
    log.warn('printer lookup failed', {
      queue: cupsQueueName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// --- System user for NOT NULL created_by -----------------------------------

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
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// --- Test-only helpers ------------------------------------------------------

/** @internal - used by tests to reach into state. Do not import in prod code. */
export const __TEST_ONLY__ = {
  parseTimestamp: parseCupsTimestamp,
  regex: CUPS_PAGE_LOG_REGEX,
};

export const CUPS_PAGE_LOG_PATH = DEFAULT_PAGE_LOG_PATH;
