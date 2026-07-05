/**
 * Canon iR Remote UI — authentication step.
 *
 * Canon's web UI (:8000) ships a per-session RSA public key and a random
 * "CHALLENGE" hex nonce embedded in the landing page's login form. The browser
 * encrypts `password + challenge` with PKCS#1 v1.5 and POSTs everything back
 * to `/login`; a successful login replies with `302` + Set-Cookie (the session
 * cookies we carry through every subsequent request).
 *
 * This module isolates steps 1-3 of that flow:
 *   1. GET / — parse CHALLENGE + PK PEM, capture Set-Cookie values.
 *   2. RSA-encrypt (password || challenge) with PKCS1 v1.5, base64.
 *   3. POST /login form-urlencoded, assert 302 redirect, return combined cookies.
 *
 * No secret ever appears in a log line or an Error message — errors use
 * typed reason codes only ('rsa_fail', 'http_error', 'parse_fail', 'timeout',
 * 'bad_credentials'). The higher-level scraper turns those into
 * `canon_ui_auth_total{result=...}` counters.
 */
import crypto from 'node:crypto';

import { createLogger } from '../../utils/logger.js';

const log = createLogger('fleet:canon-ui-auth');

export type LoginFailureReason =
  | 'parse_fail'
  | 'rsa_fail'
  | 'http_error'
  | 'timeout'
  | 'bad_credentials';

export interface LoginSuccess {
  valid: true;
  cookies: string[];
}

export interface LoginFailure {
  valid: false;
  reason: LoginFailureReason;
  status?: number;
}

export type LoginResult = LoginSuccess | LoginFailure;

const DEFAULT_TIMEOUT_MS = 10_000;
const USER_AGENT =
  'Mozilla/5.0 (Fleet-Management; CanonRemoteUI-Scraper) AppleWebKit/537.36';

const CHALLENGE_RE = /name\s*=\s*"CHALLENGE"[^>]*value\s*=\s*"([0-9a-fA-F]+)"/;
const PK_RE =
  /name\s*=\s*"PK"[^>]*value\s*=\s*"(-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----)"/;

/**
 * Login against Canon Remote UI. Returns `valid:true` with the Cookie-header
 * values to reuse on subsequent GETs, or `valid:false` with a typed reason.
 *
 * `baseUrl` must be the scheme+host+port — e.g. `http://192.168.1.146:8000`,
 * no trailing slash required (we always append explicit paths).
 */
export async function login(
  baseUrl: string,
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<LoginResult> {
  const base = stripTrailingSlash(baseUrl);

  // 1) Landing page: CHALLENGE + PK PEM + session cookies
  let landingHtml: string;
  let landingCookies: string[];
  try {
    const res = await fetchWithTimeout(`${base}/`, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal,
    });

    if (res.status >= 500) {
      log.warn('canon landing returned 5xx', { base, status: res.status });
      return { valid: false, reason: 'http_error', status: res.status };
    }
    landingHtml = await res.text();
    landingCookies = extractCookiesFromHeaders(res.headers);
  } catch (err: unknown) {
    if (isAbortError(err)) return { valid: false, reason: 'timeout' };
    log.warn('canon landing fetch threw', {
      base,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return { valid: false, reason: 'http_error' };
  }

  const parsed = parseLoginChallenge(landingHtml);
  if (!parsed) {
    log.warn('canon landing did not contain CHALLENGE/PK', { base });
    return { valid: false, reason: 'parse_fail' };
  }
  const { challenge, pkPem } = parsed;

  // 2) RSA-encrypt (password + challenge)
  let cipher: string;
  try {
    cipher = rsaEncryptPassword(pkPem, password, challenge);
  } catch (err: unknown) {
    log.warn('canon RSA encrypt failed', {
      base,
      error: err instanceof Error ? err.name : 'unknown',
    });
    return { valid: false, reason: 'rsa_fail' };
  }

  // 3) POST /login
  const form = buildLoginForm({
    challenge,
    pkPem,
    username,
    ciphertextB64: cipher,
  });

  try {
    const res = await fetchWithTimeout(`${base}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
        ...(landingCookies.length > 0 ? { Cookie: joinCookieHeader(landingCookies) } : {}),
        Referer: `${base}/`,
      },
      body: form,
      signal,
    });

    const loginCookies = extractCookiesFromHeaders(res.headers);
    const mergedCookies = mergeCookies(landingCookies, loginCookies);

    if (res.status === 302 || res.status === 303 || res.status === 301) {
      return { valid: true, cookies: mergedCookies };
    }

    if (res.status === 200) {
      // Canon re-renders the login page with an error hint on bad creds.
      const body = await res.text();
      if (/CHALLENGE/.test(body) && /PK/.test(body)) {
        return { valid: false, reason: 'bad_credentials', status: 200 };
      }
      // Some firmwares send 200 on success too — accept if cookies advanced.
      if (loginCookies.length > 0) {
        return { valid: true, cookies: mergedCookies };
      }
      return { valid: false, reason: 'http_error', status: 200 };
    }

    log.warn('canon /login returned unexpected status', { base, status: res.status });
    return { valid: false, reason: 'http_error', status: res.status };
  } catch (err: unknown) {
    if (isAbortError(err)) return { valid: false, reason: 'timeout' };
    log.warn('canon /login fetch threw', {
      base,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return { valid: false, reason: 'http_error' };
  }
}

// ─── Exposed helpers (for the flow client and unit tests) ──────────────────

export function parseLoginChallenge(
  html: string,
): { challenge: string; pkPem: string } | null {
  const chMatch = CHALLENGE_RE.test(html) ? html.match(CHALLENGE_RE) : null;
  const pkMatch = PK_RE.test(html) ? html.match(PK_RE) : null;
  const challenge = chMatch?.[1];
  const pkPem = pkMatch?.[1];
  if (!challenge || !pkPem) return null;
  return { challenge, pkPem };
}

export function rsaEncryptPassword(
  pkPem: string,
  password: string,
  challenge: string,
): string {
  const key = crypto.createPublicKey({ key: pkPem, format: 'pem' });
  const encrypted = crypto.publicEncrypt(
    { key, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(`${password}${challenge}`, 'utf8'),
  );
  return encrypted.toString('base64');
}

export function buildLoginForm(input: {
  challenge: string;
  pkPem: string;
  username: string;
  ciphertextB64: string;
}): string {
  const params = new URLSearchParams();
  params.set('CHALLENGE', input.challenge);
  params.set('URI', '/');
  params.set('policy', '');
  params.set('DOMAIN', 'localhost');
  params.set('admin', '');
  params.set('GUEST', '');
  params.set('PK', input.pkPem);
  params.set('PASSWORD', input.ciphertextB64);
  params.set('USERNAME', input.username);
  params.set('PASSWORD_T', '');
  params.set('domainname', 'localhost');
  params.set('LoginButton', 'Login');
  return params.toString();
}

export function extractCookiesFromHeaders(headers: Headers): string[] {
  // `Headers.getSetCookie()` is Node 20+; fall back to raw parsing if missing.
  type HeadersWithGetSetCookie = Headers & { getSetCookie?: () => string[] };
  const h = headers as HeadersWithGetSetCookie;
  const raw: string[] =
    typeof h.getSetCookie === 'function'
      ? h.getSetCookie()
      : collectLegacySetCookie(headers);

  const out: string[] = [];
  for (const line of raw) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const sep = line.indexOf(';');
    const kv = sep === -1 ? line.trim() : line.slice(0, sep).trim();
    if (kv.length > 0) out.push(kv);
  }
  return out;
}

function collectLegacySetCookie(headers: Headers): string[] {
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

export function mergeCookies(prev: string[], next: string[]): string[] {
  const map = new Map<string, string>();
  for (const kv of prev) {
    const eq = kv.indexOf('=');
    if (eq > 0) map.set(kv.slice(0, eq), kv);
  }
  for (const kv of next) {
    const eq = kv.indexOf('=');
    if (eq > 0) map.set(kv.slice(0, eq), kv);
  }
  return Array.from(map.values());
}

export function joinCookieHeader(cookies: string[]): string {
  return cookies.join('; ');
}

// ─── fetch helpers ─────────────────────────────────────────────────────────

interface FetchOpts {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  redirect: 'manual' | 'follow';
  signal?: AbortSignal;
}

async function fetchWithTimeout(url: string, opts: FetchOpts): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort('timeout'), DEFAULT_TIMEOUT_MS);
  const linkedSignal = opts.signal
    ? linkSignals(ac.signal, opts.signal)
    : ac.signal;
  try {
    return await fetch(url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      redirect: opts.redirect,
      signal: linkedSignal,
    });
  } finally {
    clearTimeout(t);
  }
}

function linkSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ac = new AbortController();
  const onAbortA = (): void => ac.abort(a.reason);
  const onAbortB = (): void => ac.abort(b.reason);
  a.addEventListener('abort', onAbortA, { once: true });
  b.addEventListener('abort', onAbortB, { once: true });
  return ac.signal;
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
