/**
 * presigned-upload.factory.ts — Reusable pre-signed S3 upload pattern.
 *
 * Creates a Router with two endpoints:
 *   POST /presign   — validate file metadata, generate pre-signed PUT URLs
 *   POST /complete  — verify S3 objects via headObject, call onComplete hook
 *
 * Reference implementation: chat-direct-upload.routes.ts
 */

import { Router, Request, Response, RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { AppError } from '../../middleware/errorHandler.js';
import { storageService } from '../../services/storage.service.js';
import { enqueueAvScan } from '../../services/av-scan-worker.js';
import { createLogger } from '../../utils/logger.js';
import { BLOCKED_EXTENSIONS } from '../chat/chat-shared.js';

const log = createLogger('presigned-upload');

// ─── Public types ───────────────────────────────────────────────────────────

export interface PresignedUploadConfig {
  /** S3 key prefix (e.g. 'print', 'approvals', 'staff-chat') */
  prefix: string;
  /** Set of allowed MIME types */
  allowedMimes: Set<string>;
  /** Set of blocked extensions — defaults to chat-shared BLOCKED_EXTENSIONS */
  blockedExtensions?: Set<string>;
  /** Max file size in bytes per file */
  maxFileSize: number;
  /** Max files per request */
  maxFiles: number;
  /** Auth middleware chain (e.g. [authenticateToken]) */
  auth: RequestHandler[];
  /** Rate limiter middleware */
  rateLimiter: RequestHandler;
  /**
   * Hook called after all files are verified in S3.
   * Responsible for DB logic (create order, insert messages, etc.).
   * Must send the response via res.json().
   */
  onComplete: (
    files: VerifiedFile[],
    req: Request,
    res: Response,
  ) => Promise<void>;
}

export interface VerifiedFile {
  s3Key: string;
  s3Url: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}

// ─── Internal validation ────────────────────────────────────────────────────

interface PresignFileEntry {
  fileName: string;
  contentType: string;
  fileSize: number;
}

interface CompleteFileEntry {
  s3Key: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}

interface RawPresignFileEntry {
  fileName?: unknown;
  contentType?: unknown;
  fileSize?: unknown;
}

interface RawCompleteFileEntry extends RawPresignFileEntry {
  s3Key?: unknown;
}

function validatePresignEntry(
  entry: unknown,
  index: number,
  config: PresignedUploadConfig,
): PresignFileEntry {
  if (!entry || typeof entry !== 'object') {
    throw new AppError(400, `files[${index}]: invalid entry`);
  }
  const e = entry as RawPresignFileEntry;

  const fileName = typeof e['fileName'] === 'string' ? e['fileName'] : '';
  const contentType = typeof e['contentType'] === 'string' ? e['contentType'] : '';
  const fileSize = typeof e['fileSize'] === 'number' ? e['fileSize'] : 0;

  if (!fileName) throw new AppError(400, `files[${index}]: fileName required`);

  // Block dangerous extensions
  const ext = path.extname(fileName).toLowerCase();
  const blocked = config.blockedExtensions ?? BLOCKED_EXTENSIONS;
  if (blocked.has(ext)) {
    throw new AppError(400, `files[${index}]: blocked extension ${ext}`);
  }

  if (!config.allowedMimes.has(contentType)) {
    throw new AppError(400, `files[${index}]: unsupported type ${contentType}`);
  }
  if (fileSize <= 0) {
    throw new AppError(400, `files[${index}]: fileSize must be positive`);
  }
  if (fileSize > config.maxFileSize) {
    throw new AppError(400, `files[${index}]: exceeds ${Math.round(config.maxFileSize / 1024 / 1024)}MB limit`);
  }

  return { fileName, contentType, fileSize };
}

function validateCompleteEntry(
  entry: unknown,
  index: number,
  prefix: string,
): CompleteFileEntry {
  if (!entry || typeof entry !== 'object') {
    throw new AppError(400, `files[${index}]: invalid entry`);
  }
  const e = entry as RawCompleteFileEntry;

  const s3Key = typeof e['s3Key'] === 'string' ? e['s3Key'] : '';
  if (!s3Key.startsWith(`${prefix}/`)) {
    throw new AppError(400, `files[${index}]: invalid s3Key prefix`);
  }

  const fileName = typeof e['fileName'] === 'string' ? e['fileName'] : '';
  const contentType = typeof e['contentType'] === 'string' ? e['contentType'] : '';
  const fileSize = typeof e['fileSize'] === 'number' ? e['fileSize'] : 0;

  return { s3Key, fileName, contentType, fileSize };
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createPresignedUploadRoutes(config: PresignedUploadConfig): Router {
  const router = Router({ mergeParams: true });

  // Apply auth + rate limiter to all routes
  if (config.auth.length > 0) {
    router.use(...config.auth, config.rateLimiter);
  } else {
    router.use(config.rateLimiter);
  }

  // ─── POST /presign ──────────────────────────────────────────────────────

  router.post('/presign', async (req: Request, res: Response): Promise<void> => {
    const { files } = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      throw new AppError(400, 'files array required');
    }
    if (files.length > config.maxFiles) {
      throw new AppError(400, `max ${config.maxFiles} files per request`);
    }

    const uploads = await Promise.all(
      files.map(async (raw: unknown, i: number) => {
        const entry = validatePresignEntry(raw, i, config);
        const ext = path.extname(entry.fileName).toLowerCase() || '.bin';
        const s3Key = `${config.prefix}/${uuidv4()}${ext}`;
        const { url } = await storageService.generatePresignedPutUrl(s3Key, entry.contentType);
        return { s3Key, uploadUrl: url, contentType: entry.contentType };
      }),
    );

    res.json({ success: true, data: { uploads } });
  });

  // ─── POST /complete ─────────────────────────────────────────────────────

  router.post('/complete', async (req: Request, res: Response): Promise<void> => {
    const { files } = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      throw new AppError(400, 'files array required');
    }
    if (files.length > config.maxFiles) {
      throw new AppError(400, `max ${config.maxFiles} files per request`);
    }

    // Validate and verify S3 objects
    const verified: VerifiedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const entry = validateCompleteEntry(files[i], i, config.prefix);
      const head = await storageService.headObject(entry.s3Key);
      if (!head) {
        throw new AppError(400, `files[${i}]: not found in storage`);
      }
      verified.push({
        s3Key: entry.s3Key,
        s3Url: storageService.getPublicUrl(entry.s3Key),
        fileName: entry.fileName,
        contentType: entry.contentType,
        fileSize: head.contentLength,
      });
    }

    // Enqueue async AV scan for each verified file
    for (const file of verified) {
      enqueueAvScan({
        s3Key: file.s3Key,
        entityType: config.prefix,
        entityId: file.s3Key,
      }).catch((err: unknown) => log.warn('failed to enqueue av-scan', { s3Key: file.s3Key, error: String(err) }));
    }

    // Delegate DB logic to caller
    await config.onComplete(verified, req, res);
  });

  return router;
}
