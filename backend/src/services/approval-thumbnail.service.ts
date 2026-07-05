/**
 * F14: Approval Thumbnail Service
 *
 * Generates thumbnails for approval photos/variants using sharp.
 * Uploads to S3 with approvals/thumb/ prefix.
 */

import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { storageService } from './storage.service.js';
import { validateImageBuffer } from '../utils/image-validate.js';
import { safeSharp } from '../utils/safe-sharp.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('approval-thumbnail');

const THUMB_WIDTH = 400;
const THUMB_QUALITY = 80;

export async function generateThumbnail(
  buffer: Buffer,
  width: number = THUMB_WIDTH,
): Promise<{ thumbnailBuffer: Buffer; thumbnailUrl: string }> {
  const validation = validateImageBuffer(buffer);
  if (!validation.valid) {
    throw new Error(`Invalid image for thumbnail: ${validation.error}`);
  }

  let thumbnailBuffer: Buffer;
  try {
    thumbnailBuffer = await safeSharp(
      () => sharp(buffer)
        .resize(width, undefined, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: THUMB_QUALITY, progressive: true })
        .toBuffer(),
      'approval-thumbnail:generate',
    );
  } catch (err) {
    log.error('Thumbnail generation failed', { error: (err as Error).message, bufferSize: buffer.length });
    throw err;
  }

  const key = `approvals/thumb/${uuidv4()}.jpg`;
  const { url: thumbnailUrl } = await storageService.upload(thumbnailBuffer, key, 'image/jpeg');

  return { thumbnailBuffer, thumbnailUrl };
}
