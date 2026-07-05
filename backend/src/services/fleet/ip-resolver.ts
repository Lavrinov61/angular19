/**
 * Shared CUPS to IP resolution for Fleet services.
 *
 * Extracted from `snmp-poller.service.ts` so the Canon Remote UI scraper and any
 * future fleet service share one cache and one implementation.
 *
 * IP is obtained by shelling out to `lpstat -v <queueName>` via `spawn` with an
 * arg-array (no shell) and scraping the `socket://<host>[:port]` URI. Result is
 * cached in-memory with 1h TTL. Tests or ops can bust the cache via
 * `clearIpCache()`. An `FLEET_PRINTER_IP_<queueName>` env override bypasses the
 * lookup entirely (used on dev hosts without CUPS).
 */
import { spawn } from 'node:child_process';

import { createLogger } from '../../utils/logger.js';

const log = createLogger('fleet:ip-resolver');

const SOCKET_URI_RE = /socket:\/\/([0-9A-Fa-f.:-]+?)(?::(\d+))?(?:[/?]|$)/;
const IP_CACHE_TTL_MS = 60 * 60 * 1000;
const LPSTAT_TIMEOUT_MS = 5000;

interface IpCacheEntry {
  ip: string | null;
  fetchedAt: number;
}

const ipCache = new Map<string, IpCacheEntry>();

export function clearIpCache(): void {
  ipCache.clear();
}

export async function resolvePrinterIp(cupsPrinterName: string | null): Promise<string | null> {
  if (!cupsPrinterName) return null;

  const envOverride = process.env[`FLEET_PRINTER_IP_${cupsPrinterName}`];
  if (envOverride) return envOverride;

  const cached = ipCache.get(cupsPrinterName);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < IP_CACHE_TTL_MS) {
    return cached.ip;
  }

  const ip = await queryLpstat(cupsPrinterName);
  ipCache.set(cupsPrinterName, { ip, fetchedAt: now });
  return ip;
}

// `spawn` (not exec) with an arg-array; no shell interpolation happens.
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
    }, LPSTAT_TIMEOUT_MS);

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
        log.debug('lpstat output did not contain socket URI', { cupsName });
        resolve(null);
        return;
      }
      resolve(match[1] ?? null);
    });
  });
}

/** @internal Exposed for tests only. */
export const __test__ = { SOCKET_URI_RE };
