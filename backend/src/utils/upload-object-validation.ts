import path from 'path';
import { Readable } from 'stream';
import { AppError } from '../middleware/errorHandler.js';

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_EOCD_MIN_LENGTH = 22;
const ZIP_MAX_COMMENT_LENGTH = 65_535;
const ZIP_TAIL_SCAN_LENGTH = ZIP_EOCD_MIN_LENGTH + ZIP_MAX_COMMENT_LENGTH;

export interface StoredObjectHead {
  contentLength: number;
  contentType: string;
}

export interface StorageObjectReader {
  getReadStream(key: string, range?: { start: number; end: number }): Promise<Readable>;
}

export interface CompletedUploadObject {
  s3Key: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}

export interface CompletedUploadObjectValidation {
  file: CompletedUploadObject;
  head: StoredObjectHead;
  storage: StorageObjectReader;
  index: number;
}

export async function validateCompletedUploadObject(input: CompletedUploadObjectValidation): Promise<void> {
  const { file, head, storage, index } = input;
  const prefix = `files[${index}]`;

  if (!Number.isSafeInteger(file.fileSize) || file.fileSize <= 0) {
    throw new AppError(400, `${prefix}: fileSize must be positive`);
  }

  if (head.contentLength !== file.fileSize) {
    throw new AppError(400, `${prefix}: uploaded object size mismatch`);
  }

  if (!isZipUpload(file.fileName, file.contentType)) return;

  const tail = await readObjectTail(storage, file.s3Key, head.contentLength);
  if (!hasZipEndOfCentralDirectory(tail)) {
    throw new AppError(400, `${prefix}: invalid zip archive`);
  }
}

export function isZipUpload(fileName: string, contentType: string): boolean {
  const normalizedContentType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (normalizedContentType === 'application/zip' || normalizedContentType === 'application/x-zip-compressed') {
    return true;
  }
  return path.extname(fileName).toLowerCase() === '.zip';
}

export function hasZipEndOfCentralDirectory(buffer: Buffer): boolean {
  if (buffer.length < ZIP_EOCD_MIN_LENGTH) return false;

  for (let offset = buffer.length - ZIP_EOCD_MIN_LENGTH; offset >= 0; offset--) {
    if (buffer.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue;

    const commentLength = buffer.readUInt16LE(offset + 20);
    const recordEnd = offset + ZIP_EOCD_MIN_LENGTH + commentLength;
    if (recordEnd <= buffer.length) return true;
  }

  return false;
}

async function readObjectTail(storage: StorageObjectReader, s3Key: string, contentLength: number): Promise<Buffer> {
  const start = Math.max(0, contentLength - ZIP_TAIL_SCAN_LENGTH);
  const end = contentLength - 1;
  const stream = await storage.getReadStream(s3Key, { start, end });
  return readStreamToBuffer(stream, ZIP_TAIL_SCAN_LENGTH);
}

async function readStreamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    const buffer = chunkToBuffer(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      stream.destroy();
      throw new AppError(500, 'Object range read exceeded validation limit');
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes);
}

function chunkToBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  throw new AppError(500, 'Unsupported object stream chunk');
}
