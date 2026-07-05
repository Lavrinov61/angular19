/**
 * archive-writer.ts — загрузка объектов в MinIO bucket svoefoto-archive-bitrix.
 *
 * - Отдельный S3Client (на MinIO :9000), не общий со storage.service.
 * - Multipart upload через @aws-sdk/lib-storage для больших файлов (>5 МБ).
 * - SHA256 считается в потоке (PassThrough + node:crypto).
 * - WebP-превью генерируется для image/jpeg и image/png через sharp (quality 90).
 * - Presigned read URL с TTL.
 */

import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { config } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('bitrix.archive-writer');

const ARCHIVE_BUCKET = process.env['BITRIX_ARCHIVE_BUCKET'] || 'svoefoto-archive-bitrix';

let s3ClientSingleton: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3ClientSingleton) return s3ClientSingleton;
  s3ClientSingleton = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
    forcePathStyle: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return s3ClientSingleton;
}

export interface UploadResult {
  bucket: string;
  key: string;
  size: number;
  sha256: string;
}

/**
 * Загружает stream в bucket archive. Параллельно считает SHA256 и размер.
 * Запрос PutObject с object-lock retention — bucket уже настроен на default GOVERNANCE 1y,
 * поэтому ничего дополнительно указывать не нужно.
 */
export async function uploadToArchive(
  source: Readable,
  key: string,
  contentType?: string,
): Promise<UploadResult> {
  const hash = createHash('sha256');
  let bytes = 0;

  const hashingPassthrough = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  source.on('error', (err) => hashingPassthrough.destroy(err));

  const piped = source.pipe(hashingPassthrough);

  const upload = new Upload({
    client: getS3Client(),
    params: {
      Bucket: ARCHIVE_BUCKET,
      Key: key,
      Body: piped,
      ContentType: contentType,
    },
    queueSize: 4,
    partSize: 10 * 1024 * 1024,
  });

  await upload.done();

  return {
    bucket: ARCHIVE_BUCKET,
    key,
    size: bytes,
    sha256: hash.digest('hex'),
  };
}

/**
 * Генерит WebP-превью и заливает в bucket. Только для JPEG/PNG.
 * Источник — buffer с оригинальным изображением.
 */
export async function uploadWebpPreview(
  sourceBuffer: Buffer,
  originalKey: string,
): Promise<string | null> {
  try {
    const webpKey = originalKey.replace(/\.[^.]+$/, '') + '.webp';
    const webp = await sharp(sourceBuffer, { failOn: 'none' })
      .rotate()
      .webp({ quality: 90, effort: 4 })
      .toBuffer();

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: ARCHIVE_BUCKET,
        Key: webpKey,
        Body: webp,
        ContentType: 'image/webp',
      }),
    );
    return webpKey;
  } catch (err) {
    logger.warn('WebP preview generation failed', {
      key: originalKey,
      err: (err as Error).message,
    });
    return null;
  }
}

export function isConvertibleImage(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/jpg';
}

/**
 * Presigned GET URL для скачивания из архива. По умолчанию 10 мин TTL.
 */
export async function getPresignedReadUrl(key: string, ttlSeconds = 600): Promise<string> {
  const url = await getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: ARCHIVE_BUCKET, Key: key }),
    { expiresIn: ttlSeconds },
  );
  return url;
}

export function getArchiveBucket(): string {
  return ARCHIVE_BUCKET;
}

/**
 * Полезно для тестов / import resume: есть ли уже объект в бакете.
 * Возвращает без throw — ошибки игнорируются.
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    await getS3Client().send(new HeadObjectCommand({ Bucket: ARCHIVE_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Обёртка: собрать поток в буфер (для WebP generation — нужен буфер). */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

/** Не забыть экспортнуть pipeline если понадобится внешне. */
export { pipeline };
