/**
 * multipart-upload.routes.ts — Resumable multipart upload endpoints.
 *
 * For files >10MB, the client uses S3 multipart upload:
 *   POST /multipart/init     — create multipart upload, get presigned part URLs
 *   POST /multipart/complete — finalize after all parts uploaded
 *   POST /multipart/abort    — cancel an in-progress upload
 *
 * This is a shared Router mounted alongside presigned-upload routes.
 */

import { Router, Request, Response } from 'express';
import { AppError } from '../../middleware/errorHandler.js';
import { storageService } from '../../services/storage.service.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('multipart-upload');

const router = Router();

// S3 minimum part size is 5MB (except last part)
const MIN_PART_SIZE = 5 * 1024 * 1024;
const MAX_PART_SIZE = 100 * 1024 * 1024;
const MAX_TOTAL_PARTS = 100; // 100 * 5MB = 500MB theoretical max

// ─── Validation helpers ─────────────────────────────────────────────────────

interface InitBody {
  key: string;
  contentType: string;
  totalParts: number;
  fileSize: number;
}

function validateInitBody(body: unknown): InitBody {
  if (!body || typeof body !== 'object') {
    throw new AppError(400, 'Request body required');
  }
  const b = body as Record<string, unknown>;

  const key = typeof b['key'] === 'string' ? b['key'] : '';
  if (!key || !key.includes('/')) {
    throw new AppError(400, 'key must include a prefix (e.g. chat/uuid.jpg)');
  }

  const contentType = typeof b['contentType'] === 'string' ? b['contentType'] : '';
  if (!contentType) {
    throw new AppError(400, 'contentType required');
  }

  const totalParts = typeof b['totalParts'] === 'number' ? b['totalParts'] : 0;
  if (totalParts < 1 || totalParts > MAX_TOTAL_PARTS) {
    throw new AppError(400, `totalParts must be 1..${MAX_TOTAL_PARTS}`);
  }

  const fileSize = typeof b['fileSize'] === 'number' ? b['fileSize'] : 0;
  if (fileSize <= 0) {
    throw new AppError(400, 'fileSize must be positive');
  }

  return { key, contentType, totalParts, fileSize };
}

interface CompleteBody {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}

function validateCompleteBody(body: unknown): CompleteBody {
  if (!body || typeof body !== 'object') {
    throw new AppError(400, 'Request body required');
  }
  const b = body as Record<string, unknown>;

  const key = typeof b['key'] === 'string' ? b['key'] : '';
  if (!key) throw new AppError(400, 'key required');

  const uploadId = typeof b['uploadId'] === 'string' ? b['uploadId'] : '';
  if (!uploadId) throw new AppError(400, 'uploadId required');

  const parts = b['parts'];
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new AppError(400, 'parts array required');
  }

  const validated: Array<{ partNumber: number; etag: string }> = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as Record<string, unknown>;
    const partNumber = typeof p['partNumber'] === 'number' ? p['partNumber'] : 0;
    const etag = typeof p['etag'] === 'string' ? p['etag'] : '';
    if (partNumber < 1) throw new AppError(400, `parts[${i}]: invalid partNumber`);
    if (!etag) throw new AppError(400, `parts[${i}]: etag required`);
    validated.push({ partNumber, etag });
  }

  return { key, uploadId, parts: validated };
}

interface AbortBody {
  key: string;
  uploadId: string;
}

function validateAbortBody(body: unknown): AbortBody {
  if (!body || typeof body !== 'object') {
    throw new AppError(400, 'Request body required');
  }
  const b = body as Record<string, unknown>;

  const key = typeof b['key'] === 'string' ? b['key'] : '';
  if (!key) throw new AppError(400, 'key required');

  const uploadId = typeof b['uploadId'] === 'string' ? b['uploadId'] : '';
  if (!uploadId) throw new AppError(400, 'uploadId required');

  return { key, uploadId };
}

// ─── POST /multipart/init ───────────────────────────────────────────────────

router.post('/multipart/init', async (req: Request, res: Response): Promise<void> => {
  const { key, contentType, totalParts, fileSize } = validateInitBody(req.body);

  log.info('multipart init', { key, contentType, totalParts, fileSize });

  const uploadId = await storageService.initMultipartUpload(key, contentType);
  const partUrls = await storageService.getPartPresignedUrls(key, uploadId, totalParts);

  res.json({
    success: true,
    data: { uploadId, partUrls },
  });
});

// ─── POST /multipart/complete ───────────────────────────────────────────────

router.post('/multipart/complete', async (req: Request, res: Response): Promise<void> => {
  const { key, uploadId, parts } = validateCompleteBody(req.body);

  log.info('multipart complete', { key, uploadId, partsCount: parts.length });

  await storageService.completeMultipartUpload(key, uploadId, parts);

  // Verify the assembled object
  const head = await storageService.headObject(key);
  if (!head) {
    throw new AppError(500, 'Multipart upload completed but object not found');
  }

  res.json({
    success: true,
    data: {
      key,
      url: storageService.getPublicUrl(key),
      fileSize: head.contentLength,
    },
  });
});

// ─── POST /multipart/abort ──────────────────────────────────────────────────

router.post('/multipart/abort', async (req: Request, res: Response): Promise<void> => {
  const { key, uploadId } = validateAbortBody(req.body);

  log.info('multipart abort', { key, uploadId });

  await storageService.abortMultipartUpload(key, uploadId);

  res.json({ success: true });
});

export default router;
