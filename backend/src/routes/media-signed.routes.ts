/**
 * media-signed.routes.ts — Signed URL endpoints for secure S3 media access.
 *
 * Replaces direct public S3 URLs with short-lived pre-signed GET URLs.
 * All endpoints require authentication (JWT or session token).
 *
 * GET  /api/media/signed?key=chat/xxx.jpg         — single signed URL (auth: JWT)
 * POST /api/media/signed/batch                     — batch signed URLs (auth: JWT)
 * GET  /api/media/signed/session/:token?key=...    — single signed URL (auth: session HMAC)
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { storageService } from '../services/storage.service.js';
import { createLogger } from '../utils/logger.js';
import rateLimit from 'express-rate-limit';

const log = createLogger('media-signed');

const router = Router();

const SIGNED_URL_TTL = 3600; // 1 hour

/** Validate that a key is a safe S3 object key (no path traversal) */
function isValidS3Key(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key.includes('..') || key.startsWith('/')) return false;
  // Only allow known prefixes
  const allowedPrefixes = ['chat/', 'print/', 'approvals/', 'staff-chat/'];
  return allowedPrefixes.some(p => key.startsWith(p));
}

/** Rate limiter for signed URL generation */
const signedUrlLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many signed URL requests' },
});

router.use(signedUrlLimiter);

/**
 * GET /api/media/signed?key=chat/xxx.jpg
 * Returns a single signed URL. Requires JWT auth.
 */
router.get('/signed', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const key = req.query['key'];
  if (typeof key !== 'string' || !isValidS3Key(key)) {
    throw new AppError(400, 'Invalid or missing key parameter');
  }

  const signedUrl = await storageService.generatePresignedGetUrl(key, SIGNED_URL_TTL);
  res.json({ success: true, data: { url: signedUrl, expiresIn: SIGNED_URL_TTL } });
});

/**
 * POST /api/media/signed/batch
 * Body: { keys: string[] } or { urls: string[] }
 * Returns signed URLs for multiple files. Requires JWT auth.
 * Max 100 keys per request.
 */
router.post('/signed/batch', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { keys, urls } = req.body;

  let resolvedKeys: string[];

  if (Array.isArray(keys)) {
    resolvedKeys = keys;
  } else if (Array.isArray(urls)) {
    // Convert public URLs to keys
    resolvedKeys = urls
      .map((url: unknown) => typeof url === 'string' ? storageService.keyFromUrl(url) : null)
      .filter((k): k is string => k !== null);
  } else {
    throw new AppError(400, 'keys or urls array required');
  }

  if (resolvedKeys.length === 0) {
    throw new AppError(400, 'No valid keys provided');
  }
  if (resolvedKeys.length > 100) {
    throw new AppError(400, 'Max 100 keys per batch request');
  }

  // Validate all keys
  for (const key of resolvedKeys) {
    if (!isValidS3Key(key)) {
      throw new AppError(400, `Invalid key: ${key}`);
    }
  }

  const signedUrls = await Promise.all(
    resolvedKeys.map(async key => ({
      key,
      url: await storageService.generatePresignedGetUrl(key, SIGNED_URL_TTL),
    })),
  );

  res.json({
    success: true,
    data: { urls: signedUrls, expiresIn: SIGNED_URL_TTL },
  });
});

/**
 * POST /api/media/signed/resolve
 * Body: { urls: string[] }
 * Resolves public S3 URLs to signed URLs. Non-S3 URLs are returned as-is.
 * Used by frontend to batch-resolve attachment_url values.
 */
router.post('/signed/resolve', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { urls } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    throw new AppError(400, 'urls array required');
  }
  if (urls.length > 200) {
    throw new AppError(400, 'Max 200 URLs per resolve request');
  }

  const resolved: Record<string, string> = {};

  await Promise.all(
    urls.map(async (url: unknown) => {
      if (typeof url !== 'string') return;
      const signed = await storageService.resolveSignedUrl(url, SIGNED_URL_TTL);
      resolved[url] = signed;
    }),
  );

  res.json({
    success: true,
    data: { resolved, expiresIn: SIGNED_URL_TTL },
  });
});

export default router;
