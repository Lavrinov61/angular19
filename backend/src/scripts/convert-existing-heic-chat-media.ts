import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import db from '../database/db.js';
import { storageService } from '../services/storage.service.js';
import { enqueueAvScan, getAvScanQueue } from '../services/av-scan-worker.js';
import { convertImageBufferToJpeg, replaceExtForJpeg } from '../utils/image-convert.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('convert-existing-heic-chat-media');

interface HeicAttachmentRow {
  id: string;
  message_id: string;
  s3_key: string | null;
  s3_url: string;
  file_name: string | null;
  mime_type: string;
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function jpegName(row: HeicAttachmentRow): string {
  const source = row.file_name?.trim() || `chat-media-${row.id}.heic`;
  const withoutUnsafeChars = source.replace(/[/\\:*?"<>|]/g, '_');
  const jpg = replaceExtForJpeg(withoutUnsafeChars);
  return /\.(jpe?g)$/i.test(jpg) ? jpg : `${jpg}.jpg`;
}

async function readSourceBuffer(row: HeicAttachmentRow): Promise<Buffer> {
  const s3Key = row.s3_key && row.s3_key !== 'pending'
    ? row.s3_key
    : storageService.keyFromUrl(row.s3_url);
  if (s3Key) {
    return (await storageService.downloadToBuffer(s3Key)).buffer;
  }

  if (row.s3_url.startsWith('/uploads/')) {
    const localPath = path.resolve(process.cwd(), row.s3_url.replace(/^\//, ''));
    if (!localPath.startsWith(process.cwd() + path.sep)) {
      throw new Error('local upload path escapes backend directory');
    }
    return fs.readFile(localPath);
  }

  throw new Error('attachment does not have a readable storage key');
}

async function main(): Promise<void> {
  const limit = positiveInt(argValue('--limit'), 500);
  const dryRun = process.argv.includes('--dry-run');

  const rows = await db.query<HeicAttachmentRow>(
    `SELECT id, message_id, s3_key, s3_url, file_name, mime_type
       FROM media_attachments
      WHERE processing_status = 'uploaded'
        AND s3_url <> ''
        AND (
          lower(split_part(mime_type, ';', 1)) IN ('image/heic', 'image/heif')
          OR lower(coalesce(file_name, '')) ~ '\\.(heic|heif)$'
          OR lower(coalesce(s3_key, '')) ~ '\\.(heic|heif)$'
        )
      ORDER BY created_at ASC
      LIMIT $1`,
    [limit],
  );

  if (!rows.length) {
    log.info('no HEIC chat media rows found');
    return;
  }

  log.info('found HEIC chat media rows', { count: rows.length, dryRun });

  let converted = 0;
  for (const row of rows) {
    const fileName = jpegName(row);
    let uploadedKey: string | null = null;
    try {
      if (dryRun) {
        log.info('dry-run would convert HEIC attachment', { mediaAttachmentId: row.id, messageId: row.message_id });
        continue;
      }

      const source = await readSourceBuffer(row);
      const jpeg = await convertImageBufferToJpeg(source, row.mime_type, row.file_name ?? row.s3_key ?? undefined);
      const newKey = `chat/reprocessed-${row.message_id}-${crypto.randomUUID()}.jpg`;
      const upload = await storageService.upload(jpeg, newKey, 'image/jpeg');
      uploadedKey = newKey;

      await db.transaction(async client => {
        await client.query(
          `UPDATE media_attachments
              SET s3_key = $1,
                  s3_url = $2,
                  media_type = 'image',
                  mime_type = 'image/jpeg',
                  file_size_bytes = $3,
                  file_name = $4,
                  processing_status = 'uploaded',
                  av_status = 'pending',
                  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                    'heic_reprocessed_at', NOW(),
                    'heic_original_s3_key', $5::text,
                    'heic_original_mime_type', $6::text
                  )
            WHERE id = $7`,
          [newKey, upload.url, jpeg.length, fileName, row.s3_key, row.mime_type, row.id],
        );
        await client.query(
          `UPDATE messages
              SET attachment_url = $1,
                  message_type = 'image'
            WHERE id = $2`,
          [upload.url, row.message_id],
        );
      });
      uploadedKey = null;

      await enqueueAvScan({
        s3Key: newKey,
        mediaAttachmentId: row.id,
        entityType: 'media_attachment',
        entityId: row.id,
      });

      converted++;
      log.info('converted HEIC attachment to JPEG', { mediaAttachmentId: row.id, messageId: row.message_id });
    } catch (err) {
      log.error('failed to convert HEIC attachment', {
        mediaAttachmentId: row.id,
        messageId: row.message_id,
        error: String(err),
      });
      if (uploadedKey) {
        await storageService.delete(uploadedKey);
      }
    }
  }

  log.info('HEIC conversion finished', { scanned: rows.length, converted, dryRun });
}

main()
  .catch(err => {
    log.error('HEIC conversion script failed', { error: String(err) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await getAvScanQueue().close().catch(err => log.warn('failed to close av-scan queue', { error: String(err) }));
    await db.close();
  });
