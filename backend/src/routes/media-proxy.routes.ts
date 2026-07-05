/**
 * media-proxy.routes.ts — Public S3 media proxy.
 *
 * GET /media/chat/uuid.jpg → media stream
 * GET /media/print-uploads/yyyy/mm/uuid-file.pdf → local print upload source
 * GET /media/print-layout/job/sheet-001.jpg → media stream for CUPS
 * GET /media/print-conversions/job/task/page_0001.jpg → converted document page for CUPS
 * GET /media/photo-workspace/crops/item/uuid.jpg → internal crop output
 */

import { Router, type Request, type Response } from 'express';
import sharp from 'sharp';
import { storageService } from '../services/storage.service.js';
import { verifyMediaAccess } from '../middleware/media-access.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('media-proxy');
const router = Router();
const PREVIEW_DEFAULT_EDGE_PX = 1400;
const PREVIEW_MIN_EDGE_PX = 320;
const PREVIEW_MAX_EDGE_PX = 2200;
const PREVIEW_JPEG_QUALITY = 78;
const PREVIEW_MAX_SOURCE_BYTES = 80 * 1024 * 1024;

// Override helmet's default CORP: same-origin so cross-origin fetchers
// (Telegram Bot API sendPhoto, social share crawlers) can load public media.
router.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// Access control — checks JWT/token per prefix before serving files
router.use('/{*key}', verifyMediaAccess);

const ALLOWED_PREFIXES = [
  'chat/',
  'print/',
  'approvals/',
  'photo-workspace/crops/',
  'staff-chat/',
  'photos/',
  'gallery/',
  'print-uploads/',
  'print-layout/',
  'print-conversions/',
  'print-materials/',
  'order-attachments/',
];

function isValidKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key.includes('..') || key.includes('\0')) return false;
  if (key.startsWith('/')) return false;
  return ALLOWED_PREFIXES.some(p => key.startsWith(p));
}

type ParsedRange = { start: number; end: number };

function firstQueryValue(value: Request['query'][string]): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

function wantsPreview(req: Request): boolean {
  const value = firstQueryValue(req.query['preview'])?.toLowerCase();
  return value === '1' || value === 'true' || value === 'print' || value === 'image';
}

function previewEdge(req: Request): number {
  const raw = Number(firstQueryValue(req.query['w']) ?? firstQueryValue(req.query['width']));
  if (!Number.isFinite(raw)) return PREVIEW_DEFAULT_EDGE_PX;
  return Math.round(Math.min(Math.max(raw, PREVIEW_MIN_EDGE_PX), PREVIEW_MAX_EDGE_PX));
}

function isPreviewableImage(contentType: string, key: string): boolean {
  const normalized = contentType.toLowerCase();
  if (normalized.startsWith('image/') && normalized !== 'image/svg+xml') return true;
  return /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(key);
}

function chunkToBuffer(chunk: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return Buffer.from(chunk);
}

async function streamToBuffer(stream: AsyncIterable<Buffer | Uint8Array | string>, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = chunkToBuffer(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error(`Preview source exceeds ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

async function serveImagePreview(req: Request, res: Response, key: string): Promise<void> {
  const source = await storageService.getReadStream(key);
  const sourceBuffer = await streamToBuffer(source, PREVIEW_MAX_SOURCE_BYTES);
  const edge = previewEdge(req);
  const { data, info } = await sharp(sourceBuffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: edge,
      height: edge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: PREVIEW_JPEG_QUALITY,
      mozjpeg: true,
    })
    .toBuffer({ resolveWithObject: true });

  res.status(200).set({
    'Content-Type': 'image/jpeg',
    'Content-Length': String(data.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Preview-Width': String(info.width),
    'X-Preview-Height': String(info.height),
  }).send(data);
}

function parseByteRange(rangeHeader: string | undefined, contentLength: number): ParsedRange | null | 'invalid' {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return 'invalid';

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return 'invalid';

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    start = Math.max(contentLength - suffixLength, 0);
    end = contentLength - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : contentLength - 1;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'invalid';
  if (start < 0 || end < start || start >= contentLength) return 'invalid';
  return { start, end: Math.min(end, contentLength - 1) };
}

async function serveMedia(req: Request, res: Response, headOnly: boolean): Promise<void> {
  try {
    const raw = req.params['key'];
    const key = (Array.isArray(raw) ? raw.join('/') : String(raw || '')).replace(/^\/+/, '');

    if (!isValidKey(key)) {
      res.status(400).json({ error: 'Invalid media key' });
      return;
    }

    const head = await storageService.headObject(key);
    if (!head) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (!headOnly && wantsPreview(req) && isPreviewableImage(head.contentType, key)) {
      try {
        await serveImagePreview(req, res, key);
        return;
      } catch (err) {
        log.warn('media preview generation failed, falling back to original stream', {
          key: key.slice(0, 80),
          error: String(err),
        });
      }
    }

    const range = parseByteRange(req.headers.range, head.contentLength);
    res.set({
      'Accept-Ranges': 'bytes',
      'Content-Type': head.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });

    if (range === 'invalid') {
      res.status(416).set('Content-Range', `bytes */${head.contentLength}`).end();
      return;
    }

    if (range) {
      res.status(206).set({
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${head.contentLength}`,
      });
    } else {
      res.set('Content-Length', String(head.contentLength));
    }

    if (headOnly) {
      res.end();
      return;
    }

    const stream = await storageService.getReadStream(key, range || undefined);

    stream.on('error', (err) => {
      log.error('S3 stream error', { key, error: String(err) });
      if (!res.headersSent) {
        res.status(502).end();
      } else {
        res.destroy();
      }
    });

    stream.pipe(res);
  } catch (err) {
    log.error('media proxy request failed', { error: String(err) });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Storage error' });
    }
  }
}

router.head('/{*key}', async (req: Request, res: Response): Promise<void> => {
  await serveMedia(req, res, true);
});

router.get('/{*key}', async (req: Request, res: Response): Promise<void> => {
  await serveMedia(req, res, false);
});

export default router;
