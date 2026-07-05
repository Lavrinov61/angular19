/**
 * Omnichannel v2 — Media Service
 *
 * Download → process → S3 upload → INSERT media_attachments.
 *
 * Two entry points:
 * 1. processAndStoreMedia() — uses adapter.downloadMedia() for channel-specific download
 * 2. downloadAndStoreFromUrl() — direct URL download (Max permanent CDN, etc.)
 *
 * Replaces inline S3 upload logic scattered across individual connectors.
 */

import crypto from 'crypto';
import { Readable } from 'stream';
import db from '../../../database/db.js';
import { storageService } from '../../storage.service.js';
import { processMediaBuffer } from './media-processor.js';
import { createProcessingPipeline } from './streaming-media-processor.js';
import { fetchWithTimeout } from '../../../utils/fetch-timeout.js';
import {
  enforceStreamTimeout,
  peekMime,
  readResponseBufferWithTimeout,
} from '../../../utils/stream-utils.js';
import { detectOfficeFromZipBuffer, mimeToExt } from '../../../utils/mime-utils.js';
import { needsJpegConversion, replaceExtForJpeg } from '../../../utils/image-convert.js';
import type { ChannelType, ChannelAccount, MessageType } from './types.js';
import type { ParsedMediaRef } from './dto.js';
import type { ChannelAdapter } from './adapter.interface.js';
import type { MediaAttachmentIdRow } from '../../../types/views/chat-views.js';
import { enqueueAvScan } from '../../av-scan-worker.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('media-service');
const MEDIA_BODY_IDLE_TIMEOUT_MS = 60_000;
const MEDIA_BODY_TOTAL_TIMEOUT_MS = 10 * 60_000;
const BUFFERED_CONVERSION_MIMES = new Set(['image/heic', 'image/heif', 'image/webp']);
const BUFFERED_CONVERSION_EXTS = new Set(['.heic', '.heif', '.webp']);

/** Default display names when the channel doesn't provide a filename. */
const MIME_DISPLAY_NAMES: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Документ',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Таблица',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Презентация',
  'application/msword': 'Документ',
  'application/vnd.ms-excel': 'Таблица',
  'application/vnd.ms-powerpoint': 'Презентация',
  'application/pdf': 'Документ',
};

/** Generate a fallback filename from MIME when the channel didn't provide one. */
function fallbackFileName(mime: string): string | null {
  const baseName = MIME_DISPLAY_NAMES[mime];
  if (!baseName) return null;
  const ext = mimeToExt(mime);
  return `${baseName}${ext}`;
}

function extensionFromName(fileName: string | undefined): string | null {
  if (!fileName) return null;
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot).toLowerCase() : null;
}

function requiresBufferedConversion(mime: string, fileName?: string): boolean {
  const normalizedMime = mime.toLowerCase().split(';', 1)[0].trim();
  return BUFFERED_CONVERSION_MIMES.has(normalizedMime) || BUFFERED_CONVERSION_EXTS.has(extensionFromName(fileName) ?? '');
}

export function shouldUseStreamingMedia(ref: ParsedMediaRef): boolean {
  return !requiresBufferedConversion(ref.mimeHint, ref.fileName);
}

function processedFileName(
  sourceFileName: string | undefined,
  sourceMime: string,
  outputMime: string,
): string | null {
  const fallback = fallbackFileName(outputMime);
  if (!sourceFileName) return fallback;
  if (outputMime === 'image/jpeg' && needsJpegConversion(sourceMime, sourceFileName)) {
    const convertedName = replaceExtForJpeg(sourceFileName);
    return /\.(jpe?g)$/i.test(convertedName) ? convertedName : `${convertedName}.jpg`;
  }
  return sourceFileName;
}

async function backfillMessageAttachment(
  messageId: string,
  attachmentUrl: string,
  messageType: MessageType,
): Promise<void> {
  await db.query(
    `UPDATE messages
        SET attachment_url = COALESCE(attachment_url, $1),
            message_type = CASE
              WHEN (message_type IS NULL OR message_type = 'file')
               AND $3 = ANY(ARRAY['image', 'video', 'audio']::text[])
              THEN $3
              ELSE message_type
            END
      WHERE id = $2`,
    [attachmentUrl, messageId, messageType],
  );
}

/**
 * Extract filename from Content-Disposition header.
 * Handles both `filename="name"` and `filename*=utf-8''encoded` (RFC 5987).
 */
function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;

  // Prefer filename* (RFC 5987, UTF-8 encoded) over plain filename
  const starMatch = header.match(/filename\*\s*=\s*utf-8''(.+?)(?:;|$)/i);
  if (starMatch) {
    try { return decodeURIComponent(starMatch[1].trim()); } catch { /* fall through */ }
  }

  // Plain filename (may be percent-encoded or quoted)
  const plainMatch = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (plainMatch) {
    const raw = plainMatch[1].trim();
    try { return decodeURIComponent(raw); } catch { return raw; }
  }

  return null;
}

export interface MediaResult {
  id: string;
  s3Key: string;
  s3Url: string;
  mediaType: MessageType;
  mime: string;
  sizeBytes: number;
  fileName: string | null;
}

/**
 * Full pipeline: adapter.downloadMedia → process → S3 → media_attachments.
 *
 * Used for channels with channel-specific download mechanisms
 * (Telegram file_id, WhatsApp media_id, etc.)
 */
export async function processAndStoreMedia(
  ref: ParsedMediaRef,
  messageId: string,
  adapter: ChannelAdapter,
  account: ChannelAccount,
): Promise<MediaResult> {
  // 1. Download from source via adapter
  const rawBuffer = await adapter.downloadMedia(ref, account);

  // 2. Process (HEIC→JPEG, type reclassification)
  const processed = await processMediaBuffer(
    rawBuffer,
    ref.mimeHint,
    ref.mediaTypeHint,
    ref.fileName,
  );

  // 3. Upload to S3
  const uuid = crypto.randomUUID();
  const s3Key = `chat/${account.channel}-${uuid}${processed.ext}`;
  const uploadResult = await storageService.upload(processed.buffer, s3Key, processed.mime);
  const resolvedFileName = processedFileName(ref.fileName, ref.mimeHint, processed.mime);

  // 4. INSERT media_attachments
  const row = await db.queryOne<MediaAttachmentIdRow>(
    `INSERT INTO media_attachments
      (message_id, s3_key, s3_url, media_type, mime_type, file_size_bytes, file_name,
       original_url, processing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded')
     RETURNING id`,
    [
      messageId, s3Key, uploadResult.url, processed.messageType, processed.mime,
      processed.buffer.length, resolvedFileName, ref.sourceRef,
    ],
  );

  // 5. Enqueue async AV scan
  enqueueAvScan({
    s3Key,
    mediaAttachmentId: row!.id,
    entityType: 'media_attachment',
    entityId: row!.id,
  }).catch((err: unknown) => log.warn('failed to enqueue av-scan', { s3Key, error: String(err) }));

  // 6. Backfill messages.attachment_url so API queries pick it up immediately
  await backfillMessageAttachment(messageId, uploadResult.url, processed.messageType);

  log.debug('media stored via adapter', {
    messageId,
    channel: account.channel,
    mediaType: processed.messageType,
    s3Key,
    sizeBytes: processed.buffer.length,
  });

  return {
    id: row!.id,
    s3Key,
    s3Url: uploadResult.url,
    mediaType: processed.messageType,
    mime: processed.mime,
    sizeBytes: processed.buffer.length,
    fileName: resolvedFileName,
  };
}

/**
 * Direct URL download → process → S3 → media_attachments.
 *
 * Used for channels that provide permanent CDN URLs (Max, some VK photos)
 * where adapter.downloadMedia() is not needed.
 */
export async function downloadAndStoreFromUrl(
  url: string,
  messageId: string,
  channel: ChannelType,
  mimeHint: string,
  mediaTypeHint: MessageType,
  fileName?: string,
): Promise<MediaResult> {
  const response = await fetchWithTimeout(url, { timeout: 60_000 });
  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status} ${response.statusText} for ${url}`);
  }

  // Extract filename from Content-Disposition when channel didn't provide one
  const effectiveFileName = fileName
    || filenameFromContentDisposition(response.headers.get('content-disposition'))
    || undefined;

  const rawBuffer = await readResponseBufferWithTimeout(response, {
    idleTimeoutMs: MEDIA_BODY_IDLE_TIMEOUT_MS,
    totalTimeoutMs: MEDIA_BODY_TOTAL_TIMEOUT_MS,
    label: 'media URL download',
  });
  const contentType = response.headers.get('content-type') || mimeHint;

  const processed = await processMediaBuffer(rawBuffer, contentType, mediaTypeHint, effectiveFileName);

  const uuid = crypto.randomUUID();
  const s3Key = `chat/${channel}-${uuid}${processed.ext}`;
  const uploadResult = await storageService.upload(processed.buffer, s3Key, processed.mime);
  const resolvedFileName = processedFileName(effectiveFileName, contentType, processed.mime);

  const row = await db.queryOne<MediaAttachmentIdRow>(
    `INSERT INTO media_attachments
      (message_id, s3_key, s3_url, media_type, mime_type, file_size_bytes, file_name,
       original_url, processing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded')
     RETURNING id`,
    [
      messageId, s3Key, uploadResult.url, processed.messageType, processed.mime,
      processed.buffer.length, resolvedFileName, url,
    ],
  );

  // Enqueue async AV scan
  enqueueAvScan({
    s3Key,
    mediaAttachmentId: row!.id,
    entityType: 'media_attachment',
    entityId: row!.id,
  }).catch((err: unknown) => log.warn('failed to enqueue av-scan', { s3Key, error: String(err) }));

  // Backfill messages.attachment_url so API queries pick it up immediately
  await backfillMessageAttachment(messageId, uploadResult.url, processed.messageType);

  log.debug('media stored from URL', {
    messageId,
    channel,
    mediaType: processed.messageType,
    s3Key,
    sizeBytes: processed.buffer.length,
  });

  return {
    id: row!.id,
    s3Key,
    s3Url: uploadResult.url,
    mediaType: processed.messageType,
    mime: processed.mime,
    sizeBytes: processed.buffer.length,
    fileName: resolvedFileName,
  };
}

// ─── Streaming variants ──────────────────────────────────────────────────────

/**
 * Streaming pipeline: adapter.downloadMediaStream → peekMime → process → S3 stream upload → INSERT.
 * Falls back to buffer-based processAndStoreMedia if adapter lacks downloadMediaStream.
 */
export async function processAndStoreMediaStream(
  ref: ParsedMediaRef,
  messageId: string,
  adapter: ChannelAdapter,
  account: ChannelAccount,
): Promise<MediaResult> {
  // 1. Get source stream
  const sourceStream = enforceStreamTimeout(
    await adapter.downloadMediaStream!(ref, account),
    {
      idleTimeoutMs: MEDIA_BODY_IDLE_TIMEOUT_MS,
      totalTimeoutMs: MEDIA_BODY_TOTAL_TIMEOUT_MS,
      label: `${account.channel} media stream`,
    },
  );

  // 2. Detect MIME from magic bytes (non-destructive peek)
  const { detectedMime, header, stream: peekedStream } = await peekMime(sourceStream);

  // 3. Determine final MIME
  let finalMime = detectedMime
    ?? (ref.mimeHint !== 'application/octet-stream' ? ref.mimeHint : 'application/octet-stream');

  // 3a. ZIP → Office refinement: peek inside ZIP header for [Content_Types].xml
  if (finalMime === 'application/zip' && !ref.fileName) {
    const officeMime = detectOfficeFromZipBuffer(header);
    if (officeMime) finalMime = officeMime;
  }

  if (requiresBufferedConversion(finalMime, ref.fileName)) {
    sourceStream.destroy();
    throw new Error(`buffered conversion required for ${finalMime}`);
  }

  // 4. Create processing pipeline (sharp transform for HEIC, null for passthrough)
  const pipeline = createProcessingPipeline(finalMime, ref.mediaTypeHint, ref.fileName);

  // 5. Assemble pipe chain: peekedStream → [transform] → S3
  const uploadSource = pipeline.transform
    ? peekedStream.pipe(pipeline.transform)
    : peekedStream;

  // 6. Upload stream to S3
  const uuid = crypto.randomUUID();
  const s3Key = `chat/${account.channel}-${uuid}${pipeline.ext}`;
  const maxBytes = account.capabilities.maxMediaSizeBytes || undefined;
  const uploadResult = await storageService.uploadStream(uploadSource, s3Key, pipeline.outputMime, maxBytes);
  const resolvedFileName = processedFileName(ref.fileName, finalMime, pipeline.outputMime);

  // 7. INSERT media_attachments
  const row = await db.queryOne<MediaAttachmentIdRow>(
    `INSERT INTO media_attachments
      (message_id, s3_key, s3_url, media_type, mime_type, file_size_bytes, file_name,
       original_url, processing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded')
     RETURNING id`,
    [
      messageId, s3Key, uploadResult.url, pipeline.messageType, pipeline.outputMime,
      uploadResult.size, resolvedFileName, ref.sourceRef,
    ],
  );

  // 8. Enqueue async AV scan
  enqueueAvScan({
    s3Key,
    mediaAttachmentId: row!.id,
    entityType: 'media_attachment',
    entityId: row!.id,
  }).catch((err: unknown) => log.warn('failed to enqueue av-scan', { s3Key, error: String(err) }));

  // 9. Backfill messages.attachment_url
  await backfillMessageAttachment(messageId, uploadResult.url, pipeline.messageType);

  log.debug('media stored via streaming adapter', {
    messageId,
    channel: account.channel,
    mediaType: pipeline.messageType,
    s3Key,
    sizeBytes: uploadResult.size,
  });

  return {
    id: row!.id,
    s3Key,
    s3Url: uploadResult.url,
    mediaType: pipeline.messageType,
    mime: pipeline.outputMime,
    sizeBytes: uploadResult.size,
    fileName: resolvedFileName,
  };
}

/**
 * Streaming URL download → peekMime → process → S3 stream upload → INSERT.
 */
export async function downloadAndStoreFromUrlStream(
  url: string,
  messageId: string,
  channel: ChannelType,
  mimeHint: string,
  mediaTypeHint: MessageType,
  fileName?: string,
): Promise<MediaResult> {
  // 1. Stream download
  const response = await fetchWithTimeout(url, { timeout: 60_000 });
  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status} ${response.statusText} for ${url}`);
  }
  if (!response.body) {
    throw new Error('Response body is null');
  }

  // Extract filename from Content-Disposition when channel didn't provide one
  const effectiveFileName = fileName
    || filenameFromContentDisposition(response.headers.get('content-disposition'))
    || undefined;

  const sourceStream = enforceStreamTimeout(
    Readable.fromWeb(response.body as import('stream/web').ReadableStream),
    {
      idleTimeoutMs: MEDIA_BODY_IDLE_TIMEOUT_MS,
      totalTimeoutMs: MEDIA_BODY_TOTAL_TIMEOUT_MS,
      label: 'media URL stream',
    },
  );
  const contentType = response.headers.get('content-type') || mimeHint;

  // 2. Detect MIME from magic bytes
  const { detectedMime, header, stream: peekedStream } = await peekMime(sourceStream);

  // 3. Determine final MIME
  let finalMime = detectedMime
    ?? (contentType !== 'application/octet-stream' ? contentType : 'application/octet-stream');

  // 3a. ZIP → Office refinement: peek inside ZIP header for [Content_Types].xml
  if (finalMime === 'application/zip' && !effectiveFileName) {
    const officeMime = detectOfficeFromZipBuffer(header);
    if (officeMime) finalMime = officeMime;
  }

  if (requiresBufferedConversion(finalMime, effectiveFileName)) {
    sourceStream.destroy();
    throw new Error(`buffered conversion required for ${finalMime}`);
  }

  // 4. Create processing pipeline
  const pipeline = createProcessingPipeline(finalMime, mediaTypeHint, effectiveFileName);

  // 5. Assemble pipe chain
  const uploadSource = pipeline.transform
    ? peekedStream.pipe(pipeline.transform)
    : peekedStream;

  // 6. Upload stream to S3
  const uuid = crypto.randomUUID();
  const s3Key = `chat/${channel}-${uuid}${pipeline.ext}`;
  const uploadResult = await storageService.uploadStream(uploadSource, s3Key, pipeline.outputMime);
  const resolvedFileName = processedFileName(effectiveFileName, finalMime, pipeline.outputMime);

  // 7. INSERT media_attachments
  const row = await db.queryOne<MediaAttachmentIdRow>(
    `INSERT INTO media_attachments
      (message_id, s3_key, s3_url, media_type, mime_type, file_size_bytes, file_name,
       original_url, processing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded')
     RETURNING id`,
    [
      messageId, s3Key, uploadResult.url, pipeline.messageType, pipeline.outputMime,
      uploadResult.size, resolvedFileName, url,
    ],
  );

  // 8. Enqueue async AV scan
  enqueueAvScan({
    s3Key,
    mediaAttachmentId: row!.id,
    entityType: 'media_attachment',
    entityId: row!.id,
  }).catch((err: unknown) => log.warn('failed to enqueue av-scan', { s3Key, error: String(err) }));

  // 9. Backfill messages.attachment_url
  await backfillMessageAttachment(messageId, uploadResult.url, pipeline.messageType);

  log.debug('media stored from URL via streaming', {
    messageId,
    channel,
    mediaType: pipeline.messageType,
    s3Key,
    sizeBytes: uploadResult.size,
  });

  return {
    id: row!.id,
    s3Key,
    s3Url: uploadResult.url,
    mediaType: pipeline.messageType,
    mime: pipeline.outputMime,
    sizeBytes: uploadResult.size,
    fileName: resolvedFileName,
  };
}
