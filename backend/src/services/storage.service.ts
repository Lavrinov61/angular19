/**
 * storage.service.ts — Unified file storage abstraction (local disk or S3).
 *
 * New photo uploads (chat, print, approvals) go to Yandex Object Storage (S3-compatible).
 * Existing files remain accessible via nginx /uploads/* for backward compatibility.
 * Non-photo uploads (CRM, recordings, general) stay local — use fs directly.
 *
 * Key structure in S3:
 *   chat/{uuid}.ext       — visitor/operator chat files
 *   print/{uuid}.ext      — print order photos
 *   approvals/{uuid}.ext  — retouched photos for approval
 */

import {
  S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
  UploadPartCommand,
  type CompletedPart,
  type S3ClientResolvedConfig,
  type ServiceInputTypes,
  type ServiceOutputTypes,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Command } from '@smithy/types';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { Readable } from 'stream';
import { config } from '../config/index.js';
import { ByteCountTransform } from '../utils/stream-utils.js';

import { createLogger } from '../utils/logger.js';
export interface StorageResult {
  /** Public URL to access the file */
  url: string;
  /** S3 object key or local relative path */
  key: string;
  /** 'local' | 's3' */
  storageType: 'local' | 's3';
  /** File size in bytes */
  size: number;
}

const logger = createLogger('storage.service');
const S3_PUT_TIMEOUT_MS = 2 * 60_000;
const S3_STREAM_UPLOAD_TIMEOUT_MS = 10 * 60_000;
type S3Command<Input extends ServiceInputTypes, Output extends ServiceOutputTypes> =
  Command<ServiceInputTypes, Input, ServiceOutputTypes, Output, S3ClientResolvedConfig>;

class StorageServiceImpl {
  private readonly s3: S3Client | null;
  private readonly s3Enabled: boolean;
  private readonly bucket: string;
  private readonly publicUrl: string;
  private readonly externalDeliveryUrl: string;
  private readonly localBase: string;
  /** True when S3 endpoint is localhost (MinIO) — presigned URLs won't work from browser */
  private readonly isLocalS3: boolean;

  constructor() {
    this.s3Enabled = config.s3.enabled;
    this.bucket = config.s3.bucket;
    this.publicUrl = config.s3.publicUrl.replace(/\/$/, '');
    const defaultExternalDeliveryUrl = this.publicUrl === 'https://svoefoto.ru/media'
      ? 'https://ws.svoefoto.ru/media'
      : this.publicUrl;
    this.externalDeliveryUrl = (config.s3.externalDeliveryUrl || defaultExternalDeliveryUrl).replace(/\/$/, '');
    this.localBase = path.resolve(process.cwd(), 'uploads');
    this.isLocalS3 = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(config.s3.endpoint);

    if (this.s3Enabled) {
      this.s3 = new S3Client({
        endpoint: config.s3.endpoint,
        region: config.s3.region,
        credentials: {
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
        },
        forcePathStyle: true,
        requestHandler: {
          connectionTimeout: 30_000,
          requestTimeout: 30_000,
        },
      });
      logger.info(`[StorageService] S3 mode: bucket=${this.bucket} endpoint=${config.s3.endpoint} local=${this.isLocalS3}`);
    } else {
      this.s3 = null;
      logger.info('[StorageService] Local disk mode');
    }
  }

  /**
   * Send an S3 command with an AbortController-based timeout.
   */
  private async sendWithTimeout<Input extends ServiceInputTypes, Output extends ServiceOutputTypes>(
    command: S3Command<Input, Output>,
    timeoutMs: number,
  ): Promise<Output> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.s3!.send(command, { abortSignal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private withDeliveryCacheBuster(url: string, cacheBuster?: string): string {
    if (!cacheBuster) {
      return url;
    }

    try {
      const parsed = new URL(url);
      parsed.searchParams.set('wa_delivery', cacheBuster);
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private async waitForUploadWithTimeout(upload: Upload, body: Readable, key: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`[StorageService] S3 stream upload timeout after ${S3_STREAM_UPLOAD_TIMEOUT_MS}ms key=${key}`);
        if (!body.destroyed) body.destroy(err);
        upload.abort().catch((abortErr: unknown) => {
          logger.warn('[StorageService] S3 multipart abort failed after timeout', {
            key,
            error: String(abortErr),
          });
        });
        reject(err);
      }, S3_STREAM_UPLOAD_TIMEOUT_MS);
    });

    try {
      await Promise.race([upload.done(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Upload a buffer to storage.
   * key example: 'chat/550e8400-e29b-41d4-a716-446655440000.jpg'
   */
  async upload(buffer: Buffer, key: string, mimetype: string): Promise<StorageResult> {
    if (this.s3Enabled && this.s3) {
      await this.sendWithTimeout(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
        ContentLength: buffer.length,
      }), S3_PUT_TIMEOUT_MS);
      return {
        url: `${this.publicUrl}/${key}`,
        key,
        storageType: 's3',
        size: buffer.length,
      };
    }

    // Local fallback
    const localPath = path.join(this.localBase, key);
    await fsp.mkdir(path.dirname(localPath), { recursive: true });
    await fsp.writeFile(localPath, buffer);
    return {
      url: `/uploads/${key}`,
      key,
      storageType: 'local',
      size: buffer.length,
    };
  }

  /**
   * Delete a file by its S3 key or local relative key.
   */
  async delete(key: string): Promise<void> {
    if (this.s3Enabled && this.s3) {
      try {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      } catch (err) {
        logger.error(`[StorageService] S3 delete failed for key=${key}:`, { error: String(err) });
      }
      return;
    }
    // Local fallback
    const localPath = path.join(this.localBase, key);
    try {
      await fsp.unlink(localPath);
    } catch (err) {
      logger.debug('[StorageService] Local delete skipped', { key, error: String(err) });
    }
  }

  /**
   * Download an S3 object to a temp file and return the local path.
   * Used by photo-processor worker which needs a local file path.
   * Files are cached in /tmp/s3-cache/ to avoid re-downloading during same session.
   */
  async downloadToTemp(key: string): Promise<string> {
    const cacheDir = path.join(os.tmpdir(), 's3-cache');
    await fsp.mkdir(cacheDir, { recursive: true });

    const safeName = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    const cachePath = path.join(cacheDir, safeName);

    // Return cached file if still fresh (< 1 hour old)
    try {
      const stat = await fsp.stat(cachePath);
      if (Date.now() - stat.mtimeMs < 3600_000) {
        return cachePath;
      }
    } catch { /* not cached */ }

    if (!this.s3) {
      throw new Error(`[StorageService] S3 not configured, cannot download key=${key}`);
    }

    const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = response.Body;
    if (!body) {
      throw new Error(`[StorageService] Empty S3 response for key=${key}`);
    }

    // Stream to temp file
    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(cachePath);
      (body as Readable).pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      (body as Readable).on('error', reject);
    });

    return cachePath;
  }

  /**
   * Download an S3 object and return the file content as a Buffer.
   * Uses downloadToTemp internally, then reads the cached file.
   */
  async downloadToBuffer(key: string): Promise<{ buffer: Buffer }> {
    const tempPath = await this.downloadToTemp(key);
    const buffer = await fsp.readFile(tempPath);
    return { buffer };
  }

  /**
   * Generate a pre-signed PUT URL for direct client-to-S3 upload.
   * Client sends PUT request with the file body to the returned URL.
   *
   * When S3 is local MinIO (127.0.0.1), presigned URLs are rewritten to go
   * through nginx /s3-proxy/ so the browser can actually reach them.
   * Nginx sets Host: 127.0.0.1:9000 so the signature still validates.
   */
  async generatePresignedPutUrl(key: string, contentType: string): Promise<{ url: string; key: string }> {
    if (!this.s3Enabled || !this.s3) {
      throw new Error('[StorageService] S3 not configured — presigned URLs require S3');
    }
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ACL: 'public-read',
    });
    const url = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    return { url: this.rewriteLocalUrl(url), key };
  }

  /**
   * Check if an S3 object exists and return its metadata.
   * Returns null if the object does not exist.
   */
  async headObject(key: string): Promise<{ contentLength: number; contentType: string } | null> {
    if (!this.s3Enabled || !this.s3) {
      throw new Error('[StorageService] S3 not configured');
    }
    try {
      const response = await this.sendWithTimeout(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }), 5_000,
      );
      return {
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  /**
   * List objects under a key prefix (paginated). Returns key + last-modified.
   * Used by short-lived tmp-file sweeps (e.g. edu print-estimate cleanup).
   */
  async listObjectsByPrefix(prefix: string, maxKeys = 1000): Promise<Array<{ key: string; lastModified: Date | null }>> {
    if (!this.s3Enabled || !this.s3) {
      throw new Error('[StorageService] S3 not configured');
    }
    const out: Array<{ key: string; lastModified: Date | null }> = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
      }));
      for (const obj of response.Contents ?? []) {
        if (obj.Key) out.push({ key: obj.Key, lastModified: obj.LastModified ?? null });
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
  }

  /**
   * Streaming upload to S3 via multipart.
   * Optionally enforces a max byte limit via ByteCountTransform.
   */
  async uploadStream(
    stream: Readable,
    key: string,
    mimetype: string,
    maxBytes?: number,
  ): Promise<StorageResult> {
    if (!this.s3Enabled || !this.s3) {
      throw new Error('[StorageService] S3 not configured — streaming upload requires S3');
    }

    const body = maxBytes ? stream.pipe(new ByteCountTransform(maxBytes)) : stream;

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimetype,
      },
    });

    await this.waitForUploadWithTimeout(upload, body, key);
    // S3 multipart doesn't return content-length in the response;
    // use HeadObject to get the authoritative size.
    const head = await this.headObject(key);

    return {
      url: `${this.publicUrl}/${key}`,
      key,
      storageType: 's3',
      size: head?.contentLength ?? 0,
    };
  }

  /**
   * Get a readable stream for an S3 object.
   * Caller is responsible for consuming / destroying the stream.
   */
  async getReadStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    if (!this.s3Enabled || !this.s3) {
      throw new Error('[StorageService] S3 not configured — getReadStream requires S3');
    }

    const params: { Bucket: string; Key: string; Range?: string } = { Bucket: this.bucket, Key: key };
    if (range) {
      params.Range = `bytes=${range.start}-${range.end}`;
    }

    const response = await this.s3.send(
      new GetObjectCommand(params),
    );

    if (!response.Body) {
      throw new Error(`[StorageService] Empty S3 response for key=${key}`);
    }

    return response.Body as Readable;
  }

  /**
   * Generate a pre-signed GET URL for secure, time-limited access to an S3 object.
   * Used instead of public URLs to prevent unauthorized access.
   */
  async generatePresignedGetUrl(key: string, expiresIn = 3600): Promise<string> {
    if (!this.s3Enabled || !this.s3) {
      throw new Error('[StorageService] S3 not configured — presigned GET URLs require S3');
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return this.rewriteLocalUrl(await getSignedUrl(this.s3, command, { expiresIn }));
  }

  /**
   * Generate a pre-signed GET URL with Content-Disposition: attachment header.
   * Forces the browser to download the file instead of displaying it inline.
   */
  async generatePresignedDownloadUrl(key: string, filename?: string, expiresIn = 3600): Promise<string> {
    if (!this.s3Enabled || !this.s3) {
      throw new Error('[StorageService] S3 not configured — presigned download URLs require S3');
    }
    const params: { Bucket: string; Key: string; ResponseContentDisposition?: string } = {
      Bucket: this.bucket,
      Key: key,
    };
    if (filename) {
      params.ResponseContentDisposition = `attachment; filename="${encodeURIComponent(filename)}"`;
    } else {
      params.ResponseContentDisposition = 'attachment';
    }
    const command = new GetObjectCommand(params);
    return this.rewriteLocalUrl(await getSignedUrl(this.s3, command, { expiresIn }));
  }

  /**
   * Resolve a stored URL (public S3 or local) to a signed URL for secure access.
   * - S3 URLs → signed GET URL
   * - Local /uploads/ URLs → returned as-is (served by nginx)
   * - Non-S3 external URLs → returned as-is
   */
  async resolveSignedUrl(url: string, expiresIn = 3600): Promise<string> {
    // Local S3 (MinIO): presigned URLs point to localhost, unreachable from browser.
    // Files are served via nginx /media/ proxy — return proxy URL as-is.
    if (this.isLocalS3) return url;

    const key = this.keyFromUrl(url);
    if (key) {
      return this.generatePresignedGetUrl(key, expiresIn);
    }
    return url;
  }

  /**
   * Resolve a stored URL for external channel providers.
   * Local MinIO files must stay on the public /media/ URL: providers such as
   * WhatsApp/Gupshup may preflight media with HEAD, while presigned GET URLs
   * behind /s3-proxy/ reject HEAD and can fail media upload.
   */
  async resolveExternalDeliveryUrl(url: string, expiresIn = 24 * 3600, cacheBuster?: string): Promise<string> {
    const key = this.keyFromUrl(url);
    if (this.isLocalS3) {
      if (key && this.externalDeliveryUrl) {
        return this.withDeliveryCacheBuster(`${this.externalDeliveryUrl}/${key}`, cacheBuster);
      }
      return this.withDeliveryCacheBuster(url, cacheBuster);
    }

    if (key) {
      return this.generatePresignedGetUrl(key, expiresIn);
    }
    return this.withDeliveryCacheBuster(url, cacheBuster);
  }

  /**
   * Resolve an array of URLs to signed URLs in parallel.
   */
  async resolveSignedUrls(urls: string[], expiresIn = 3600): Promise<string[]> {
    return Promise.all(urls.map(url => this.resolveSignedUrl(url, expiresIn)));
  }

  // ─── Client-driven multipart upload (resumable) ──────────────────────────

  /**
   * Initiate an S3 multipart upload. Returns the uploadId needed by the client
   * to upload individual parts.
   */
  async initMultipartUpload(key: string, contentType: string): Promise<string> {
    if (!this.s3Enabled || !this.s3) {
      throw new Error('[StorageService] S3 not configured — multipart upload requires S3');
    }
    const result = await this.sendWithTimeout(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }), 10_000,
    );
    if (!result.UploadId) {
      throw new Error('[StorageService] CreateMultipartUpload returned no UploadId');
    }
    return result.UploadId;
  }

  /**
   * Generate pre-signed PUT URLs for each part of a multipart upload.
   * Client uploads each 5MB chunk directly to S3 via these URLs.
   */
  async getPartPresignedUrls(
    key: string,
    uploadId: string,
    totalParts: number,
  ): Promise<Array<{ partNumber: number; url: string }>> {
    if (!this.s3Enabled || !this.s3) {
      throw new Error('[StorageService] S3 not configured');
    }
    const urls: Array<{ partNumber: number; url: string }> = [];
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const command = new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });
      const url = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
      urls.push({ partNumber, url: this.rewriteLocalUrl(url) });
    }
    return urls;
  }

  /**
   * Complete a multipart upload after all parts have been uploaded by the client.
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<void> {
    if (!this.s3Enabled || !this.s3) {
      throw new Error('[StorageService] S3 not configured');
    }
    const completedParts: CompletedPart[] = parts
      .sort((a, b) => a.partNumber - b.partNumber)
      .map(p => ({ PartNumber: p.partNumber, ETag: p.etag }));

    await this.sendWithTimeout(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: completedParts },
      }), 15_000,
    );
  }

  /**
   * Abort a multipart upload (e.g. on user cancel or timeout).
   * S3 will clean up any already-uploaded parts.
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    if (!this.s3Enabled || !this.s3) {
      throw new Error('[StorageService] S3 not configured');
    }
    await this.s3.send(new AbortMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
    }));
  }

  /**
   * Rewrite local MinIO URLs to go through nginx /s3-proxy/ so the browser can reach them.
   * Nginx sets Host: 127.0.0.1:9000 so the S3 signature still validates.
   */
  private rewriteLocalUrl(url: string): string {
    if (!this.isLocalS3) return url;
    return url.replace(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/, `${this.publicUrl.replace(/\/media\/?$/, '')}/s3-proxy`);
  }

  /** Build a public CDN URL from an S3 key */
  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${key}`;
  }

  /**
   * Returns true if the URL points to our S3 bucket.
   */
  isS3Url(url: string): boolean {
    if (!url || !this.publicUrl) return false;
    return url.startsWith(this.publicUrl + '/');
  }

  /**
   * Extracts the S3 object key from a public S3 URL.
   * Example: 'https://storage.yandexcloud.net/svoefoto-client-photos/chat/abc.jpg' → 'chat/abc.jpg'
   */
  keyFromUrl(url: string): string | null {
    if (!this.isS3Url(url)) return null;
    return stripUrlSuffix(url.slice(this.publicUrl.length + 1));
  }
}

function stripUrlSuffix(value: string): string {
  const queryIndex = value.indexOf('?');
  const hashIndex = value.indexOf('#');
  const cutIndex = [queryIndex, hashIndex]
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0];
  return cutIndex === undefined ? value : value.slice(0, cutIndex);
}

export const storageService = new StorageServiceImpl();
