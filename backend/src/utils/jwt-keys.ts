/**
 * JWT Key Rotation — dual-key verification with kid header.
 *
 * Supports two keys: current (JWT_SECRET) and previous (JWT_SECRET_PREVIOUS).
 * - Signing always uses the current key with kid='current' in the JWT header.
 * - Verification tries the current key first; if it fails with a signature
 *   error AND a previous key is configured, retries with the previous key.
 *
 * Rotation procedure:
 * 1. Generate a new secret
 * 2. Set JWT_SECRET_PREVIOUS = old JWT_SECRET
 * 3. Set JWT_SECRET = new secret
 * 4. Restart the server — new tokens signed with the new key,
 *    old tokens still verified via JWT_SECRET_PREVIOUS
 * 5. After the longest token TTL (30d for refresh tokens) expires,
 *    remove JWT_SECRET_PREVIOUS
 */
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { config } from '../config/index.js';
import { createLogger } from './logger.js';

const log = createLogger('jwt-keys');

/** Key identifier embedded in the JWT header */
export type KeyId = 'current' | 'previous';

/**
 * Sign a JWT payload with the current key and embed kid='current' in the header.
 */
export function signJwt(
  payload: object,
  options: SignOptions = {},
): string {
  return jwt.sign(payload, config.jwt.secret, {
    ...options,
    header: {
      ...((options as Record<string, unknown>)['header'] as object | undefined),
      alg: 'HS256',
      typ: 'JWT',
      kid: 'current' satisfies KeyId,
    },
  } as SignOptions);
}

/**
 * Verify a JWT token using dual-key rotation.
 *
 * 1. If the token has kid='previous' and a previous key is configured,
 *    verify directly with the previous key.
 * 2. Otherwise verify with the current key.
 * 3. If the current key fails with JsonWebTokenError (signature mismatch)
 *    and a previous key exists, retry with the previous key.
 *
 * Throws on expired tokens, malformed tokens, or when no key matches.
 */
export function verifyJwt(token: string): jwt.JwtPayload | string {
  const previousSecret = config.jwt.secretPrevious;
  const decodedHeader = jwt.decode(token, { complete: true });
  const kid = decodedHeader?.header?.kid as KeyId | undefined;

  // Fast path: kid explicitly says 'previous'
  if (kid === 'previous' && previousSecret) {
    return jwt.verify(token, previousSecret);
  }

  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error: unknown) {
    // Only retry with previous key on signature mismatch, NOT on expiry
    if (
      previousSecret &&
      error instanceof jwt.JsonWebTokenError &&
      !(error instanceof jwt.TokenExpiredError) &&
      !(error instanceof jwt.NotBeforeError)
    ) {
      log.info('Token verification failed with current key, trying previous key', {
        kid: kid ?? 'none',
      });
      return jwt.verify(token, previousSecret);
    }
    throw error;
  }
}

/**
 * Verify a JWT signed with a derived secret (e.g. config.jwt.secret + '_2fa').
 * Supports dual-key rotation for derived secrets.
 */
export function verifyJwtDerived(token: string, suffix: string): jwt.JwtPayload | string {
  const previousSecret = config.jwt.secretPrevious;

  try {
    return jwt.verify(token, config.jwt.secret + suffix);
  } catch (error: unknown) {
    if (
      previousSecret &&
      error instanceof jwt.JsonWebTokenError &&
      !(error instanceof jwt.TokenExpiredError) &&
      !(error instanceof jwt.NotBeforeError)
    ) {
      return jwt.verify(token, previousSecret + suffix);
    }
    throw error;
  }
}
