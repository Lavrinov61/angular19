/**
 * ClamAV Service — unified antivirus scanning.
 *
 * Three scan modes:
 * - scanFile(filePath)  — scan a local file via clamdscan CLI
 * - scanBuffer(buffer)  — write buffer to temp file, scan, clean up
 * - scanS3Object(s3Key) — download from S3 to temp, scan, clean up
 *
 * Uses clamdscan (daemon mode) for performance. Falls back to clamscan
 * (standalone) if daemon is unavailable.
 *
 * Security: uses execFile (not exec) — arguments are passed as array,
 * no shell interpolation, no command injection risk.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import { storageService } from './storage.service.js';

const execFileAsync = promisify(execFile);
const log = createLogger('clamav-service');

export interface ScanResult {
  clean: boolean;
  virus?: string;
  error?: string;
}

const CLAMDSCAN_PATH = '/usr/bin/clamdscan';
const CLAMSCAN_PATH = '/usr/bin/clamscan';
const SCAN_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Scan a local file for viruses.
 * Tries clamdscan first (daemon, fast), falls back to clamscan (standalone, slow).
 */
export async function scanFile(filePath: string): Promise<ScanResult> {
  try {
    return await runClamdscan(filePath);
  } catch (daemonErr) {
    log.warn('clamdscan failed, falling back to clamscan', {
      filePath,
      error: String(daemonErr),
    });
    try {
      return await runClamscan(filePath);
    } catch (fallbackErr) {
      const errorMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      log.error('clamscan fallback also failed', { filePath, error: errorMsg });
      return { clean: false, error: `scan failed: ${errorMsg}` };
    }
  }
}

/**
 * Scan an in-memory buffer for viruses.
 * Writes to a temp file, scans, then cleans up.
 */
export async function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  const tmpDir = path.join(os.tmpdir(), 'clamav-scan');
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `scan-${crypto.randomUUID()}.tmp`);

  try {
    await fs.writeFile(tmpFile, buffer);
    return await scanFile(tmpFile);
  } finally {
    await fs.unlink(tmpFile).catch(() => { /* cleanup best-effort */ });
  }
}

/**
 * Scan an S3 object for viruses.
 * Downloads to temp via storageService, scans, then cleans up.
 */
export async function scanS3Object(s3Key: string): Promise<ScanResult> {
  try {
    const tempPath = await storageService.downloadToTemp(s3Key);
    return await scanFile(tempPath);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error('S3 download for scan failed', { s3Key, error: errorMsg });
    return { clean: false, error: `s3 download failed: ${errorMsg}` };
  }
}

// ─── Internal scanners ───────────────────────────────────────────────────────

async function runClamdscan(filePath: string): Promise<ScanResult> {
  return runScanner(CLAMDSCAN_PATH, ['--no-summary', filePath]);
}

async function runClamscan(filePath: string): Promise<ScanResult> {
  return runScanner(CLAMSCAN_PATH, ['--no-summary', filePath]);
}

/**
 * Run a ClamAV scanner binary via execFile (no shell, no injection risk).
 * Exit codes: 0 = clean, 1 = infected, 2 = error.
 */
async function runScanner(binary: string, args: string[]): Promise<ScanResult> {
  try {
    const { stdout } = await execFileAsync(binary, args, {
      timeout: SCAN_TIMEOUT_MS,
    });

    log.debug('scan clean', { binary, stdout: stdout.trim() });
    return { clean: true };
  } catch (err: unknown) {
    if (isExecError(err)) {
      if (err.code === 1) {
        // Infected
        const virusName = parseVirusName(err.stdout || '');
        log.warn('virus detected', { binary, virus: virusName, stdout: err.stdout?.trim() });
        return { clean: false, virus: virusName };
      }
      if (err.code === 2) {
        // Scanner error
        const errorMsg = (err.stderr || err.stdout || '').trim();
        log.error('scanner error', { binary, stderr: errorMsg });
        return { clean: false, error: `scanner error: ${errorMsg}` };
      }
    }
    throw err;
  }
}

function parseVirusName(output: string): string {
  // clamdscan output: "/path/to/file: Eicar-Signature FOUND"
  const match = /:\s+(.+?)\s+FOUND/.exec(output);
  return match ? match[1] : 'unknown';
}

interface ExecError extends Error {
  code: number;
  stdout?: string;
  stderr?: string;
}

function isExecError(err: unknown): err is ExecError {
  return (
    err instanceof Error &&
    'code' in err &&
    typeof (err as ExecError).code === 'number'
  );
}
