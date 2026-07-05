/**
 * Shared utilities for converting browser-problematic images to JPEG.
 *
 * Used in:
 * - Download pipeline (ZIP + single file) — convert existing S3 files on-the-fly
 * - Upload pipeline (media-processor) — prevent future WebP/HEIC storage
 */

import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { createLogger } from './logger.js';

const log = createLogger('image-convert');
const execFileAsync = promisify(execFile);

const CONVERT_TO_JPEG_MIMES = new Set(['image/webp', 'image/heic', 'image/heif']);
const HEIC_MIMES = new Set(['image/heic', 'image/heif']);
const CONVERT_TO_JPEG_EXTS = new Set(['webp', 'heic', 'heif']);
const HEIC_EXTS = new Set(['heic', 'heif']);
const SHARP_HEIF_INPUT_SUFFIXES = new Set(
  (sharp.format.heif?.input.fileSuffix ?? []).map(suffix => suffix.toLowerCase()),
);
const HEIC_TO_JPEG_SUPPORTED = SHARP_HEIF_INPUT_SUFFIXES.has('.heic') || SHARP_HEIF_INPUT_SUFFIXES.has('.heif');
const HEIF_CONVERT_BIN = process.env['HEIF_CONVERT_BIN'] || 'heif-convert';
const JPEG_QUALITY = 92;

function normalizedMime(mime?: string | null): string {
  return mime?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function extFromUrlOrFilename(urlOrFilename?: string): string | null {
  if (!urlOrFilename) return null;
  const basename = urlOrFilename.split('?')[0]?.split('/').pop() ?? '';
  const dot = basename.lastIndexOf('.');
  return dot > -1 ? basename.slice(dot + 1).toLowerCase() : null;
}

function isHeicLike(mime?: string | null, urlOrFilename?: string): boolean {
  const normalized = normalizedMime(mime);
  return HEIC_MIMES.has(normalized) || HEIC_EXTS.has(extFromUrlOrFilename(urlOrFilename) ?? '');
}

/** Check if MIME type requires conversion to JPEG */
export function shouldConvertToJpeg(mime?: string | null): boolean {
  return CONVERT_TO_JPEG_MIMES.has(normalizedMime(mime));
}

/**
 * Check if sharp stream conversion can be used for this input.
 * HEIC/HEIF often need the CLI fallback, so those formats use the buffer path
 * unless the installed sharp/libvips build explicitly supports them.
 */
export function canConvertToJpeg(mime?: string | null, urlOrFilename?: string): boolean {
  if (!needsJpegConversion(mime, urlOrFilename)) return false;
  return !isHeicLike(mime, urlOrFilename) || HEIC_TO_JPEG_SUPPORTED;
}

/**
 * Check if file needs JPEG conversion by MIME or filename/URL extension.
 * Useful when MIME is unavailable (e.g. webchat direct uploads lack media_attachments).
 */
export function needsJpegConversion(mime?: string | null, urlOrFilename?: string): boolean {
  if (shouldConvertToJpeg(mime)) return true;
  const ext = extFromUrlOrFilename(urlOrFilename);
  if (!ext) return false;
  return CONVERT_TO_JPEG_EXTS.has(ext);
}

/** Replace .webp/.heic/.heif extension with .jpg */
export function replaceExtForJpeg(name: string): string {
  return name.replace(/\.(webp|heic|heif)$/i, '.jpg');
}

/** Create a sharp transform stream that converts input to JPEG (quality 92) */
export function jpegTransform(): sharp.Sharp {
  const pipeline = sharp().jpeg({ quality: 92 });
  pipeline.on('error', (err: Error) => {
    log.error('jpegTransform stream error', { error: err.message });
    pipeline.destroy();
  });
  return pipeline;
}

async function convertHeicWithCli(buffer: Buffer, urlOrFilename?: string): Promise<Buffer> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'svf-heic-'));
  const ext = extFromUrlOrFilename(urlOrFilename);
  const inputExt = ext && HEIC_EXTS.has(ext) ? `.${ext}` : '.heic';
  const inputPath = path.join(tmpRoot, `input-${randomUUID()}${inputExt}`);
  const outputPath = path.join(tmpRoot, `output-${randomUUID()}.jpg`);

  try {
    await fs.writeFile(inputPath, buffer);
    await execFileAsync(HEIF_CONVERT_BIN, ['--quiet', '-q', String(JPEG_QUALITY), inputPath, outputPath], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    return await fs.readFile(outputPath);
  } finally {
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch (cleanupErr) {
      log.warn('failed to clean HEIC conversion temp dir', { dir: tmpRoot, error: String(cleanupErr) });
    }
  }
}

async function convertHeicWithLibheifJs(buffer: Buffer): Promise<Buffer> {
  try {
    const converted = await heicConvert({
      buffer,
      format: 'JPEG',
      quality: JPEG_QUALITY / 100,
    });
    return Buffer.isBuffer(converted) ? converted : Buffer.from(converted);
  } catch (err) {
    log.error('HEIC libheif-js conversion failed', { error: String(err) });
    throw err;
  }
}

/** Convert WebP/HEIC/HEIF buffer to JPEG, throwing when conversion is impossible. */
export async function convertImageBufferToJpeg(
  buffer: Buffer,
  mime?: string | null,
  urlOrFilename?: string,
): Promise<Buffer> {
  const heic = isHeicLike(mime, urlOrFilename);
  if (!heic || HEIC_TO_JPEG_SUPPORTED) {
    try {
      return await sharp(buffer).jpeg({ quality: JPEG_QUALITY }).toBuffer();
    } catch (err) {
      if (!heic) throw err;
      log.warn('Sharp HEIC conversion failed, trying heif-convert fallback', { error: String(err) });
    }
  }

  try {
    return await convertHeicWithCli(buffer, urlOrFilename);
  } catch (err) {
    log.warn('trying libheif-js HEIC fallback after heif-convert failure', { error: String(err) });
    return convertHeicWithLibheifJs(buffer);
  }
}
