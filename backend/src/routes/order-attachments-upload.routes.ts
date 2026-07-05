/**
 * order-attachments-upload.routes.ts — Presigned S3 upload for order wizard attachments.
 * Mount under /api/orders/photo-print/attachments
 */
import { Request, Response } from 'express';
import { createPresignedUploadRoutes, type VerifiedFile } from './shared/presigned-upload.factory.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import { authenticateToken, requirePermission, type AuthRequest } from '../middleware/auth.js';
import db from '../database/db.js';

const IMAGE_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/tiff',
  'image/heic', 'image/heif',
  'application/pdf',
]);

const orderAttachmentsRouter = createPresignedUploadRoutes({
  prefix: 'order-attachments',
  allowedMimes: IMAGE_MIMES,
  maxFileSize: 30 * 1024 * 1024,
  maxFiles: 20,
  auth: [authenticateToken, requirePermission('pos:use')],
  rateLimiter: createUploadLimiter('ul-order-attach:', 30, 15 * 60 * 1000),
  onComplete: async (files: VerifiedFile[], req: Request, res: Response) => {
    const orderId = req.body['orderId'] as string | undefined;
    if (!orderId) {
      res.json({ success: true, files: files.map(f => ({ s3Url: f.s3Url, s3Key: f.s3Key, fileName: f.fileName })) });
      return;
    }
    const allowedTypes = new Set(['client_photo', 'form_sample', 'reference']);
    const rawType = typeof req.body['attachment_type'] === 'string' ? req.body['attachment_type'] : '';
    const attachmentType = allowedTypes.has(rawType) ? rawType : 'client_photo';
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id ?? null;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      await db.query(
        `INSERT INTO order_attachments (order_id, s3_key, s3_url, file_name, mime_type, file_size_bytes, uploaded_by, attachment_type, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [orderId, f.s3Key, f.s3Url, f.fileName, f.contentType, f.fileSize, userId, attachmentType, i],
      );
    }
    res.json({ success: true, count: files.length });
  },
});

export default orderAttachmentsRouter;
