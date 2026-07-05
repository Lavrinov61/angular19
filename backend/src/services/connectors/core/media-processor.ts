/**
 * Omnichannel v2 — Media Processor
 *
 * Centralized media processing for all channel adapters:
 * - HEIC/HEIF → JPEG conversion (browsers can't render HEIC)
 * - Message type re-classification based on actual MIME (file + image/* → image)
 *
 * Ported from connectors/media-processor.ts with enhanced typing for v2 MessageType.
 */

import { mimeToExt, extFromFilename, detectMimeFromBuffer, detectOfficeFromZipBuffer } from '../../../utils/mime-utils.js';
import { validateImageBuffer } from '../../../utils/image-validate.js';
import { convertImageBufferToJpeg, needsJpegConversion } from '../../../utils/image-convert.js';
import { createLogger } from '../../../utils/logger.js';
import type { MessageType } from './types.js';

const log = createLogger('media-processor');

const BROWSER_PREVIEW_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

function normalizedMime(mime: string): string {
  return mime.split(';', 1)[0]?.trim().toLowerCase() ?? mime;
}

function isBrowserPreviewableImageMime(mime: string): boolean {
  return BROWSER_PREVIEW_IMAGE_MIMES.has(normalizedMime(mime));
}

function isHeicLikeMedia(mime: string, fileName?: string): boolean {
  return normalizedMime(mime) === 'image/heic'
    || normalizedMime(mime) === 'image/heif'
    || /\.(heic|heif)$/i.test(fileName ?? '');
}

/** ZIP-based Office extensions → correct MIME type. */
const OFFICE_EXT_MIME: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
};

function officeMimeFromFilename(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot < 1) return null;
  return OFFICE_EXT_MIME[name.slice(dot).toLowerCase()] ?? null;
}

export interface ProcessedMedia {
  buffer: Buffer;
  mime: string;
  ext: string;
  messageType: MessageType;
}

/**
 * Process downloaded media buffer before S3 upload.
 *
 * MIME detection priority (defense in depth):
 *   1. Magic bytes from buffer content — source of truth
 *   2. Channel-provided MIME hint — fallback
 *
 * Format conversion:
 *   WebP/HEIC/HEIF → JPEG (quality 92)
 *
 * Type re-classification (only PROMOTES, never downgrades):
 *   file + browser-previewable image/* → image
 *   file + video/* → video
 *   file + audio/* → audio
 */
export async function processMediaBuffer(
  buffer: Buffer,
  mime: string,
  sourceType: MessageType,
  fileName?: string,
): Promise<ProcessedMedia> {
  let finalBuffer = buffer;
  let convertedToJpeg = false;

  // --- Content-based MIME detection (source of truth) ---
  const detected = detectMimeFromBuffer(buffer);
  let finalMime = detected
    ?? (mime !== 'application/octet-stream' ? mime : 'application/octet-stream');

  // Office documents (.docx, .xlsx, .pptx) are ZIP containers — magic bytes
  // detect them as application/zip. When the channel-provided hint is more
  // specific than generic ZIP, trust it (e.g. application/vnd.openxmlformats-*).
  if (detected === 'application/zip'
    && mime !== 'application/octet-stream'
    && mime !== 'application/zip') {
    finalMime = mime;
  }

  // Last resort: when both magic bytes AND hint say "zip" but filename has
  // an Office extension → resolve MIME from filename (Telegram/VK send
  // application/zip for .docx/.xlsx/.pptx).
  if (finalMime === 'application/zip' && fileName) {
    const extMime = officeMimeFromFilename(fileName);
    if (extMime) finalMime = extMime;
  }

  // Final fallback: no filename available (e.g. Max forwarded messages) —
  // peek inside the ZIP to detect Office Open XML via [Content_Types].xml.
  if (finalMime === 'application/zip') {
    const officeMime = detectOfficeFromZipBuffer(buffer);
    if (officeMime) finalMime = officeMime;
  }

  // --- Format conversion (WebP/HEIC → JPEG for photo studio workflow) ---
  if (needsJpegConversion(finalMime, fileName)) {
    const sourceMime = finalMime;
    const validation = validateImageBuffer(buffer);
    if (!validation.valid) {
      throw new Error(`Invalid image buffer for JPEG conversion: ${validation.error ?? 'unknown error'}`);
    } else {
      try {
        finalBuffer = await convertImageBufferToJpeg(buffer, finalMime, fileName);
        finalMime = 'image/jpeg';
        convertedToJpeg = true;
        log.debug('media converted to JPEG', { sourceMime, fileName });
      } catch (err) {
        if (!isHeicLikeMedia(sourceMime, fileName)) throw err;
        log.warn('HEIC conversion failed, storing original media file', {
          sourceMime,
          fileName,
          error: String(err),
        });
      }
    }
  }

  // --- Extension from filename or MIME ---
  const ext = convertedToJpeg ? '.jpg' : (fileName ? extFromFilename(fileName, finalMime) : mimeToExt(finalMime));

  // --- Type re-classification ---
  let messageType = sourceType;
  if (sourceType === 'file') {
    if (isBrowserPreviewableImageMime(finalMime)) {
      messageType = 'image';
    } else if (finalMime.startsWith('video/')) {
      messageType = 'video';
    } else if (finalMime.startsWith('audio/')) {
      messageType = 'audio';
    }
  }

  return { buffer: finalBuffer, mime: finalMime, ext, messageType };
}
