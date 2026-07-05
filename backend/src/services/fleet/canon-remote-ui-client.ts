/**
 * Canon Remote UI — full "fetch job log" flow.
 *
 * Orchestrates the reverse-engineered session-state machine:
 *   1. login() — auth + session cookies (see canon-remote-ui-auth.ts)
 *   2. GET /                                                 (warm up portal)
 *   3. GET /portal/indicate                                  (portal-nav)
 *   4. GET /rps/nativetop.cgi?…&CorePGTAG=PGTAG_DEV_STAT     (status panel)
 *   5. GET /rps/jlp.cgi?Flag=Html_Data&LogType=0&CorePGTAG=2 (job log HTML)
 *
 * Calls 2-4 are NOT decorative — the Canon firmware enforces a state machine
 * and returns an "expired session" page for jlp.cgi if you jump straight to it.
 * `Referer` must be set to the status-panel URL on the final hop.
 *
 * `fetchJobLog()` is wrapped in a per-host opossum CircuitBreaker so a fleet
 * full of offline Canons can't drag the whole scraper cycle down.
 *
 * Parsing uses cheerio on the jlp.cgi HTML. Row 0 is typically a JS-polluted
 * header; any row whose col0 isn't purely numeric is skipped.
 */
import CircuitBreakerCtor from 'opossum';
import type CircuitBreakerType from 'opossum';
import { load as cheerioLoad } from 'cheerio';

import { createLogger } from '../../utils/logger.js';
import {
  joinCookieHeader,
  login,
  type LoginFailureReason,
  type LoginResult,
} from './canon-remote-ui-auth.js';

const log = createLogger('fleet:canon-ui-client');

// ─── Public types ──────────────────────────────────────────────────────────

export interface CanonJob {
  canon_job_id: string;
  start_time_local: string;
  end_time_local: string;
  document_name: string;
  user: string;
  pages: number;
  copies_x_pages: string;
  status: string;
}

export type FetchJobLogFailureReason =
  | LoginFailureReason
  | 'parse_fail'
  | 'nav_http_error'
  | 'circuit_open';

export class CanonRemoteUiError extends Error {
  readonly reason: FetchJobLogFailureReason;
  constructor(reason: FetchJobLogFailureReason, message?: string) {
    super(message ?? reason);
    this.name = 'CanonRemoteUiError';
    this.reason = reason;
  }
}

// ─── Internals ─────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT =
  'Mozilla/5.0 (Fleet-Management; CanonRemoteUI-Scraper) AppleWebKit/537.36';

type Breaker = CircuitBreakerType<[string, string, string], CanonJob[]>;

interface BreakerOptions {
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
  rollingCountTimeout: number;
  rollingCountBuckets: number;
  volumeThreshold: number;
  name: string;
}

const DEFAULT_BREAKER_OPTS: BreakerOptions = {
  timeout: 45_000,
  errorThresholdPercentage: 50,
  resetTimeout: 5 * 60_000,
  rollingCountTimeout: 5 * 60_000,
  rollingCountBuckets: 5,
  volumeThreshold: 3,
  name: 'fleet-canon-ui',
};

const breakers = new Map<string, Breaker>();

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function getBreaker(baseUrl: string): Breaker {
  const key = normalizeBaseUrl(baseUrl);
  let b = breakers.get(key);
  if (b) return b;

  b = new CircuitBreakerCtor<[string, string, string], CanonJob[]>(
    fetchJobLogInner,
    { ...DEFAULT_BREAKER_OPTS, name: `fleet-canon-ui:${key}` },
  );
  b.on('open', () => log.warn('canon-ui circuit opened', { baseUrl: key }));
  b.on('halfOpen', () => log.info('canon-ui circuit half-open', { baseUrl: key }));
  b.on('close', () => log.info('canon-ui circuit closed', { baseUrl: key }));

  breakers.set(key, b);
  return b;
}

export function getCircuitState(baseUrl: string): 'open' | 'half-open' | 'closed' {
  const b = breakers.get(normalizeBaseUrl(baseUrl));
  if (!b) return 'closed';
  if (b.opened) return 'open';
  if (b.halfOpen) return 'half-open';
  return 'closed';
}

/** Test helper. Clear the per-host breaker registry. */
export function __resetBreakersForTests(): void {
  for (const b of breakers.values()) {
    try {
      b.shutdown();
    } catch {
      /* older opossum */
    }
  }
  breakers.clear();
}

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Fetch the Canon job log from `baseUrl`. On circuit-open, throws a
 * `CanonRemoteUiError('circuit_open')`. Caller is expected to catch-and-log;
 * scraper level turns this into a `result=circuit_open` metric.
 */
export async function fetchJobLog(
  baseUrl: string,
  username: string,
  password: string,
): Promise<CanonJob[]> {
  const key = normalizeBaseUrl(baseUrl);
  const breaker = getBreaker(key);
  try {
    return await breaker.fire(key, username, password);
  } catch (err: unknown) {
    if (err instanceof CanonRemoteUiError) throw err;
    if (breaker.opened) {
      throw new CanonRemoteUiError('circuit_open', 'breaker open');
    }
    log.warn('canon fetchJobLog rejected (non-typed)', {
      base: key,
      error: err instanceof Error ? err.message : 'unknown',
    });
    throw new CanonRemoteUiError('nav_http_error');
  }
}

// ─── Flow implementation ───────────────────────────────────────────────────

async function fetchJobLogInner(
  baseUrl: string,
  username: string,
  password: string,
): Promise<CanonJob[]> {
  const ac = new AbortController();
  const loginTimer = setTimeout(() => ac.abort('timeout'), DEFAULT_TIMEOUT_MS);
  let loginResult: LoginResult;
  try {
    loginResult = await login(baseUrl, username, password, ac.signal);
  } finally {
    clearTimeout(loginTimer);
  }

  if (!loginResult.valid) {
    throw new CanonRemoteUiError(loginResult.reason);
  }
  const { cookies } = loginResult;
  const cookieHeader = joinCookieHeader(cookies);

  // Step 2-4: navigate in order with correct Referer chain.
  const navChain: Array<{ path: string; referer: string }> = [
    { path: '/', referer: `${baseUrl}/` },
    { path: '/portal/indicate', referer: `${baseUrl}/` },
    {
      path: '/rps/nativetop.cgi?RUIPNxBundle=default&CorePGTAG=PGTAG_DEV_STAT',
      referer: `${baseUrl}/portal/indicate`,
    },
  ];

  for (const step of navChain) {
    const r = await navGet(`${baseUrl}${step.path}`, cookieHeader, step.referer);
    if (r.status >= 400) {
      log.warn('canon nav hop returned non-2xx', {
        path: step.path,
        status: r.status,
      });
      throw new CanonRemoteUiError('nav_http_error');
    }
  }

  // Step 5: the job log itself.
  const statRef = `${baseUrl}/rps/nativetop.cgi?RUIPNxBundle=default&CorePGTAG=PGTAG_DEV_STAT`;
  const jlpRes = await navGet(
    `${baseUrl}/rps/jlp.cgi?Flag=Html_Data&LogType=0&CorePGTAG=2`,
    cookieHeader,
    statRef,
  );
  if (jlpRes.status >= 400) {
    throw new CanonRemoteUiError('nav_http_error');
  }
  const html = await jlpRes.text();
  return parseJobLogHtml(html);
}

async function navGet(
  url: string,
  cookieHeader: string,
  referer: string,
): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort('timeout'), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,*/*',
        Cookie: cookieHeader,
        Referer: referer,
      },
      signal: ac.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

// ─── Parser ────────────────────────────────────────────────────────────────

/**
 * Parse `jlp.cgi` HTML. Returns one entry per job row. Malformed / header rows
 * (non-numeric col0, insufficient column count) are silently skipped.
 */
export function parseJobLogHtml(html: string): CanonJob[] {
  if (!html || typeof html !== 'string') return [];

  const $ = cheerioLoad(html);
  const rows = $('table tr');
  if (rows.length === 0) return [];

  const MIN_COLS = 12;
  const out: CanonJob[] = [];

  rows.each((_i, el) => {
    const cells = $(el)
      .find('td')
      .map((_j, td) => $(td).text().trim().replace(/\s+/g, ' '))
      .get();

    if (cells.length < MIN_COLS) return;

    const canonJobId = cells[0] ?? '';
    if (!/^\d+$/.test(canonJobId)) return;

    const startTime = cells[2] ?? '';
    const endTime = cells[3] ?? '';
    const docName = cells[6] ?? '';
    const user = cells[7] ?? '';
    const pagesRaw = cells[9] ?? '';
    const copiesXPages = cells[10] ?? '';
    const status = cells[11] ?? '';

    const pages = Number.parseInt(pagesRaw, 10);
    if (!Number.isFinite(pages)) return;

    out.push({
      canon_job_id: canonJobId,
      start_time_local: startTime,
      end_time_local: endTime,
      document_name: docName,
      user,
      pages,
      copies_x_pages: copiesXPages,
      status,
    });
  });

  return out;
}

/** @internal test-only */
export const __test__ = {
  fetchJobLogInner,
  DEFAULT_BREAKER_OPTS,
};
