/**
 * Stream utilities for media pipeline.
 *
 * - peekMime: non-destructive MIME detection from stream header bytes
 * - ByteCountTransform: size-limiting transform stream
 */

import { Readable, Transform, type TransformCallback } from 'stream';
import { detectMimeFromBuffer } from './mime-utils.js';

const PEEK_BYTES = 4096;

export interface StreamTimeoutOptions {
  /** Fails if no bytes pass through the stream within this window. */
  idleTimeoutMs: number;
  /** Fails after this absolute duration from wrapper creation. */
  totalTimeoutMs: number;
  /** Human-readable operation label included in the error message. */
  label: string;
}

/**
 * Read first 4096 bytes from a stream to detect MIME via magic bytes,
 * then return a new Readable that replays those bytes followed by the rest.
 *
 * The larger peek window (vs. the original 16 bytes) allows ZIP-based
 * Office document detection — the first ZIP entry `[Content_Types].xml`
 * plus the next entry's directory name (`word/`, `xl/`, `ppt/`) fit
 * comfortably within 4 KB.
 */
export async function peekMime(stream: Readable): Promise<{
  detectedMime: string | null;
  header: Buffer;
  stream: Readable;
}> {
  const chunks: Buffer[] = [];
  let totalRead = 0;

  const header = await new Promise<Buffer>((resolve, reject) => {
    const onReadable = (): void => {
      let chunk: Buffer | null;
      while (totalRead < PEEK_BYTES && (chunk = stream.read(PEEK_BYTES - totalRead) as Buffer | null) !== null) {
        chunks.push(chunk);
        totalRead += chunk.length;
      }
      if (totalRead >= PEEK_BYTES) {
        cleanup();
        resolve(Buffer.concat(chunks));
      }
    };

    const onEnd = (): void => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };

    const cleanup = (): void => {
      stream.removeListener('readable', onReadable);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
    };

    stream.on('readable', onReadable);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });

  const detectedMime = header.length >= 12 ? detectMimeFromBuffer(header) : null;

  // Prepend the peeked bytes back and return a combined stream
  stream.unshift(header);

  return { detectedMime, header, stream };
}

/**
 * Transform stream that counts bytes passing through.
 * Emits an error if the total exceeds maxBytes.
 */
export class ByteCountTransform extends Transform {
  private bytesProcessed = 0;
  private readonly maxBytes: number;

  constructor(maxBytes: number) {
    super();
    this.maxBytes = maxBytes;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytesProcessed += chunk.length;
    if (this.bytesProcessed > this.maxBytes) {
      callback(new Error(`File exceeds max size: ${this.maxBytes} bytes`));
      return;
    }
    callback(null, chunk);
  }
}

class StreamTimeoutTransform extends Transform {
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private totalTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: StreamTimeoutOptions;

  constructor(options: StreamTimeoutOptions) {
    super();
    this.options = options;
    this.armIdleTimer();
    this.totalTimer = setTimeout(() => {
      this.destroy(new Error(`${this.options.label} total timeout after ${this.options.totalTimeoutMs}ms`));
    }, this.options.totalTimeoutMs);
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.armIdleTimer();
    callback(null, chunk);
  }

  override _flush(callback: TransformCallback): void {
    this.clearTimers();
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.clearTimers();
    callback(error);
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.destroy(new Error(`${this.options.label} idle timeout after ${this.options.idleTimeoutMs}ms`));
    }, this.options.idleTimeoutMs);
  }

  private clearTimers(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.totalTimer) {
      clearTimeout(this.totalTimer);
      this.totalTimer = null;
    }
  }
}

/**
 * Pipe a readable through timeout guards. This protects media workers from
 * half-open HTTP/proxy/S3 streams that keep a BullMQ slot active forever.
 */
export function enforceStreamTimeout(stream: Readable, options: StreamTimeoutOptions): Readable {
  const timeoutGuard = new StreamTimeoutTransform(options);

  timeoutGuard.on('error', (err: Error) => {
    if (!stream.destroyed) stream.destroy(err);
  });
  stream.on('error', (err: Error) => {
    if (!timeoutGuard.destroyed) timeoutGuard.destroy(err);
  });

  return stream.pipe(timeoutGuard);
}

/**
 * Read a fetch Response body into memory with stream timeouts. fetch() timeout
 * only covers the request/headers phase in our wrapper; this covers the body.
 */
export async function readResponseBufferWithTimeout(
  response: Response,
  options: StreamTimeoutOptions,
): Promise<Buffer> {
  if (!response.body) {
    throw new Error(`${options.label} response body is null`);
  }

  const source = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
  const guarded = enforceStreamTimeout(source, options);
  const chunks: Buffer[] = [];

  for await (const chunk of guarded) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
