/**
 * broadcast-flyer-upload.routes.ts — pre-signed S3 upload for broadcast campaign flyers.
 *
 * Two-step presign/complete pattern via createPresignedUploadRoutes (the canonical project
 * upload mechanism). The verified object lands at a PERMANENT public URL
 * (https://svoefoto.ru/media/campaigns/<uuid>.<ext>) — the broadcast send-engine
 * (sendToRecipient → sendMedia) fetches mediaUrl server-side, so a permanent, worker-fetchable
 * URL is required (NOT a transient presigned-GET).
 *
 * Mounted at /api/admin/campaigns/upload (app.ts). Auth chain mirrors the broadcast-campaigns
 * mount: authenticateToken + ipAllowlistAuditOnly + requirePermission('settings:manage').
 *
 * Constraints: images only (jpeg/png/webp), 10 MB, 1 file per request.
 */

import { Request, Response, Router } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { ipAllowlistAuditOnly } from '../middleware/ip-allowlist.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import {
  createPresignedUploadRoutes,
  type VerifiedFile,
} from './shared/presigned-upload.factory.js';

/**
 * POST /api/admin/campaigns/upload/presign
 * POST /api/admin/campaigns/upload/complete
 */
const broadcastFlyerUploadRouter: Router = createPresignedUploadRoutes({
  prefix: 'campaigns',
  allowedMimes: new Set(['image/jpeg', 'image/png', 'image/webp']),
  maxFileSize: 10 * 1024 * 1024,
  maxFiles: 1,
  auth: [authenticateToken, ipAllowlistAuditOnly({ logTag: 'admin' }), requirePermission('settings:manage')],
  rateLimiter: createUploadLimiter('ul-bcast-flyer:', 60, 15 * 60 * 1000),
  onComplete: async (files: VerifiedFile[], _req: Request, res: Response): Promise<void> => {
    // Single file (maxFiles=1). Return the permanent public URL; the caller stores it as
    // broadcast_payload.mediaUrl when creating/dispatching the campaign.
    const file = files[0];
    res.json({ success: true, url: file ? file.s3Url : null });
  },
});

export default broadcastFlyerUploadRouter;
