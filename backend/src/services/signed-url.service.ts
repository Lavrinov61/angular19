/**
 * signed-url.service.ts — Enterprise-grade HMAC signing utilities.
 *
 * Provides:
 * 1. Signed URLs with expiry (for file downloads, media access)
 * 2. Session tokens (stateless HMAC for guest chat sessions)
 *
 * All signatures use HMAC-SHA256 with timing-safe comparison.
 */

import crypto from 'crypto';

// ─── Signed URLs ────────────────────────────────────────────────────────────

/**
 * Generate a signed URL by appending ?exp=TIMESTAMP&sig=HMAC to the path.
 * The signature covers the path + expiry, preventing tampering.
 */
export function generateSignedUrl(
  path: string,
  secret: string,
  opts: { expiresInMs?: number } = {},
): string {
  const expiresInMs = opts.expiresInMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days default
  const exp = Math.floor((Date.now() + expiresInMs) / 1000);
  const payload = `${path}?exp=${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}exp=${exp}&sig=${sig}`;
}

/**
 * Verify a signed URL. Extracts exp & sig from query params, recomputes HMAC.
 * Returns true only if signature matches AND not expired.
 */
export function verifySignedUrl(fullUrl: string, secret: string): boolean {
  try {
    // Parse out sig and exp from the URL
    const url = new URL(fullUrl, 'http://localhost');
    const sig = url.searchParams.get('sig');
    const expStr = url.searchParams.get('exp');
    if (!sig || !expStr) return false;

    const exp = parseInt(expStr, 10);
    if (isNaN(exp)) return false;

    // Check expiry
    if (Math.floor(Date.now() / 1000) > exp) return false;

    // Reconstruct the payload that was signed: path + ?exp=TIMESTAMP
    // Strip sig param to get the base path
    url.searchParams.delete('sig');
    const basePath = url.pathname;
    const payload = `${basePath}?exp=${exp}`;

    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

    if (sig.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Session Tokens ─────────────────────────────────────────────────────────

/**
 * Generate a stateless session token: HMAC-SHA256(sessionId:visitorId, secret).
 * No DB storage needed — verified by recomputation.
 */
export function generateSessionToken(
  sessionId: string,
  visitorId: string,
  secret: string,
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${sessionId}:${visitorId}`)
    .digest('base64url');
}

/**
 * Verify a session token using timing-safe comparison.
 */
export function verifySessionToken(
  sessionId: string,
  visitorId: string,
  token: string,
  secret: string,
): boolean {
  const expected = generateSessionToken(sessionId, visitorId, secret);
  if (token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}
