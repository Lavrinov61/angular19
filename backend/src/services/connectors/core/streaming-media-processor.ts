/**
 * Omnichannel v2 — Streaming Media Processor
 *
 * Stream-based counterpart to media-processor.ts (buffer-based).
 * Returns a sharp Transform pipeline for HEIC→JPEG conversion,
 * or null for passthrough (caller pipes directly to S3).
 *
 * Type reclassification logic is identical to the buffer-based processor.
 */

import type { Duplex } from 'stream';
import sharp from 'sharp';
import { mimeToExt, extFromFilename, mimeFromFilename } from '../../../utils/mime-utils.js';
import { canConvertToJpeg } from '../../../utils/image-convert.js';
import { createLogger } from '../../../utils/logger.js';
import type { MessageType } from './types.js';

const log = createLogger('streaming-media-processor');

const OFFICE_EXT_MIME: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
};

function officeMimeFromFilename(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot < 1) return null;
  return OFFICE_EXT_MIME[name.slice(dot).toLowerCase()] ?? null;
}

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

export interface StreamingProcessResult {
  /** sharp pipeline for HEIC→JPEG, or null (passthrough — no transform needed) */
  transform: Duplex | null;
  /** Output MIME after conversion (image/jpeg for HEIC, otherwise same as input) */
  outputMime: string;
  /** File extension with leading dot */
  ext: string;
  /** Reclassified message type (file → image/video/audio based on MIME) */
  messageType: MessageType;
}

/**
 * Create a streaming processing pipeline for media.
 *
 * - WebP and runtime-supported HEIC/HEIF → sharp().jpeg() transform pipeline
 * - Everything else → null transform (passthrough)
 * - Type reclassification: file + browser-previewable image/* → image, etc. (same as buffer-based)
 */
export function createProcessingPipeline(
  inputMime: string,
  sourceType: MessageType,
  fileName?: string,
): StreamingProcessResult {
  let transform: Duplex | null = null;
  let outputMime = inputMime;

  // --- Office ZIP→MIME resolution (parity with buffer-based media-processor) ---
  if (inputMime === 'application/zip' && fileName) {
    const extMime = officeMimeFromFilename(fileName);
    if (extMime) outputMime = extMime;
  }

  // --- General MIME from fileName when detection failed ---
  if (outputMime === 'application/octet-stream' && fileName) {
    const fileMime = mimeFromFilename(fileName);
    if (fileMime) outputMime = fileMime;
  }

  // --- Format conversion (WebP/runtime-supported HEIC → JPEG for photo studio workflow) ---
  const convertToJpeg = canConvertToJpeg(outputMime, fileName);
  if (convertToJpeg) {
    try {
      const pipeline = sharp({ limitInputPixels: 100_000_000 }).jpeg({ quality: 92 });
      pipeline.on('error', (err: Error) => {
        log.error('Sharp stream transform failed, destroying pipe', { error: err.message, inputMime: outputMime });
        pipeline.destroy();
      });
      transform = pipeline;
      outputMime = 'image/jpeg';
    } catch (err) {
      log.error('Sharp pipeline creation failed, using passthrough', { error: (err as Error).message });
    }
  }

  // --- Extension from filename or output MIME ---
  const ext = convertToJpeg ? '.jpg' : (fileName ? extFromFilename(fileName, outputMime) : mimeToExt(outputMime));

  // --- Type reclassification (only PROMOTES, never downgrades) ---
  let messageType = sourceType;
  if (sourceType === 'file') {
    if (isBrowserPreviewableImageMime(outputMime)) {
      messageType = 'image';
    } else if (outputMime.startsWith('video/')) {
      messageType = 'video';
    } else if (outputMime.startsWith('audio/')) {
      messageType = 'audio';
    }
  }

  return { transform, outputMime, ext, messageType };
}
