/**
 * upload-limiter.ts — Unified rate limiter factory for file upload endpoints.
 *
 * All upload endpoints should use this factory to enforce consistent
 * rate limiting with Redis-backed store (works across ALB instances).
 */

import rateLimit from 'express-rate-limit';
import { createRateLimitStore } from './rate-limit-store.js';

/**
 * Create a rate limiter for upload endpoints.
 * @param prefix - Redis key prefix for this limiter (e.g. 'ul-print:')
 * @param maxPerWindow - max requests per window (default 100)
 * @param windowMs - window size in ms (default 15 min)
 */
export function createUploadLimiter(
  prefix: string,
  maxPerWindow = 100,
  windowMs = 15 * 60 * 1000,
) {
  return rateLimit({
    windowMs,
    max: maxPerWindow,
    message: { error: 'Too many upload requests, try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    store: createRateLimitStore(prefix),
  });
}
