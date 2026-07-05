import { createLogger } from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';

const logger = createLogger('telephony-split-readiness');

const TELEPHONY_READY_TTL_MS = 5_000;
const TELEPHONY_FAILURE_TTL_MS = 2_000;

interface TelephonyReadinessCacheEntry {
  expiresAt: number;
  ready: boolean;
}

interface TelephonyHealthResponse {
  ready?: unknown;
}

let readinessCache: TelephonyReadinessCacheEntry | null = null;
let readinessPromise: Promise<boolean> | null = null;

function getTelephonyHealthUrl(): string {
  const port = process.env['TELEPHONY_PORT'] || '3009';
  return `http://127.0.0.1:${port}/health`;
}

function isTelephonyHealthResponse(value: unknown): value is TelephonyHealthResponse {
  return typeof value === 'object' && value !== null;
}

async function probeTelephonyReadinessUncached(): Promise<boolean> {
  const response = await fetchWithTimeout(getTelephonyHealthUrl(), {
    method: 'GET',
    timeout: 1_500,
  });

  if (!response.ok) {
    return false;
  }

  const body = await response.json() as unknown;
  if (!isTelephonyHealthResponse(body)) {
    return false;
  }

  return body.ready === true;
}

export async function isTelephonySplitReady(): Promise<boolean> {
  const now = Date.now();
  if (readinessCache && now < readinessCache.expiresAt) {
    return readinessCache.ready;
  }

  if (readinessPromise) {
    return readinessPromise;
  }

  readinessPromise = probeTelephonyReadinessUncached()
    .then((ready) => {
      readinessCache = {
        ready,
        expiresAt: Date.now() + (ready ? TELEPHONY_READY_TTL_MS : TELEPHONY_FAILURE_TTL_MS),
      };
      return ready;
    })
    .catch((error: unknown) => {
      logger.warn('Telephony split readiness probe failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      readinessCache = {
        ready: false,
        expiresAt: Date.now() + TELEPHONY_FAILURE_TTL_MS,
      };
      return false;
    })
    .finally(() => {
      readinessPromise = null;
    });

  return readinessPromise;
}

export function resetTelephonySplitReadinessCacheForTests(): void {
  readinessCache = null;
  readinessPromise = null;
}
