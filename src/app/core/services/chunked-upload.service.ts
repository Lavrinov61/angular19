/**
 * chunked-upload.service.ts — Resumable S3 multipart upload for large files (>10MB).
 *
 * Flow:
 *   1. POST /api/visitor-chat/sessions/:id/upload/multipart/init → uploadId + presigned part URLs
 *   2. PUT each 5MB chunk to its presigned URL (3 concurrent)
 *   3. POST /api/visitor-chat/sessions/:id/upload/multipart/complete → finalize
 *
 * Resume: uploadId + uploaded ETags stored in sessionStorage.
 * If connection drops, the next attempt reuses the uploadId and skips already-uploaded parts.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LoggerService } from './logger.service';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB — S3 minimum part size
const MAX_CONCURRENT = 3;
const RESUME_STORAGE_PREFIX = 'chunked_upload_';

export interface ChunkedUploadProgress {
  /** Total bytes across all parts */
  totalBytes: number;
  /** Bytes uploaded so far */
  uploadedBytes: number;
  /** Percentage 0-100 */
  percent: number;
  /** Currently uploading part numbers */
  activeParts: number[];
}

export interface ChunkedUploadResult {
  s3Key: string;
  fileSize: number;
}

interface ResumeState {
  uploadId: string;
  s3Key: string;
  /** Part URLs keyed by part number */
  partUrls: Record<number, string>;
  /** Already uploaded parts with ETags */
  completedParts: { partNumber: number; etag: string }[];
  totalParts: number;
  fileSize: number;
  fileName: string;
}

@Injectable({ providedIn: 'root' })
export class ChunkedUploadService {
  private readonly http = inject(HttpClient);
  private readonly log = inject(LoggerService);

  /**
   * Determine if a file should use chunked upload.
   * Files > 10MB benefit from resumable multipart.
   */
  shouldUseChunkedUpload(fileSize: number): boolean {
    return fileSize > 10 * 1024 * 1024;
  }

  /**
   * Upload a large file using S3 multipart upload.
   * Supports resume if a previous attempt was interrupted.
   */
  async upload(
    file: File,
    s3Key: string,
    sessionId: string,
    onProgress?: (progress: ChunkedUploadProgress) => void,
    abortSignal?: AbortSignal,
  ): Promise<ChunkedUploadResult> {
    const baseUrl = `${environment.apiUrl}/visitor-chat/sessions/${sessionId}/upload`;
    const totalParts = Math.ceil(file.size / CHUNK_SIZE);

    // Try to resume a previous upload
    const resumeState = this.getResumeState(s3Key);
    let uploadId: string;
    let partUrls: Map<number, string>;
    let completedParts: Map<number, string>; // partNumber → etag

    if (resumeState && resumeState.totalParts === totalParts && resumeState.fileSize === file.size) {
      this.log.debug('[ChunkedUpload] Resuming upload', { s3Key, uploadId: resumeState.uploadId });
      uploadId = resumeState.uploadId;
      partUrls = new Map(Object.entries(resumeState.partUrls).map(([k, v]) => [Number(k), v]));
      completedParts = new Map(resumeState.completedParts.map(p => [p.partNumber, p.etag]));
    } else {
      // Init new multipart upload
      const initResponse = await firstValueFrom(this.http.post<{
        success: boolean;
        data: {
          uploadId: string;
          partUrls: { partNumber: number; url: string }[];
        };
      }>(`${baseUrl}/multipart/init`, {
        key: s3Key,
        contentType: file.type || 'application/octet-stream',
        totalParts,
        fileSize: file.size,
      }));

      if (!initResponse?.success) {
        throw new Error('Multipart init failed');
      }

      uploadId = initResponse.data.uploadId;
      partUrls = new Map(initResponse.data.partUrls.map(p => [p.partNumber, p.url]));
      completedParts = new Map();

      // Save resume state
      this.saveResumeState(s3Key, {
        uploadId,
        s3Key,
        partUrls: Object.fromEntries(partUrls),
        completedParts: [],
        totalParts,
        fileSize: file.size,
        fileName: file.name,
      });
    }

    // Build list of parts still needing upload
    const pendingParts: number[] = [];
    for (let i = 1; i <= totalParts; i++) {
      if (!completedParts.has(i)) {
        pendingParts.push(i);
      }
    }

    // Upload parts with concurrency limit
    let uploadedBytes = 0;
    for (const [pn, _etag] of completedParts) {
      const partSize = pn === totalParts
        ? file.size - (pn - 1) * CHUNK_SIZE
        : CHUNK_SIZE;
      uploadedBytes += partSize;
    }

    const activeParts = new Set<number>();

    const uploadPart = async (partNumber: number): Promise<void> => {
      if (abortSignal?.aborted) {
        throw new DOMException('Upload aborted', 'AbortError');
      }

      const start = (partNumber - 1) * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      const url = partUrls.get(partNumber);
      if (!url) throw new Error(`No presigned URL for part ${partNumber}`);

      activeParts.add(partNumber);
      onProgress?.({
        totalBytes: file.size,
        uploadedBytes,
        percent: Math.round((uploadedBytes / file.size) * 100),
        activeParts: [...activeParts],
      });

      const etag = await this.putPart(url, chunk, abortSignal);

      completedParts.set(partNumber, etag);
      activeParts.delete(partNumber);
      uploadedBytes += chunk.size;

      // Update resume state after each successful part
      this.saveResumeState(s3Key, {
        uploadId,
        s3Key,
        partUrls: Object.fromEntries(partUrls),
        completedParts: [...completedParts.entries()].map(([pn, et]) => ({ partNumber: pn, etag: et })),
        totalParts,
        fileSize: file.size,
        fileName: file.name,
      });

      onProgress?.({
        totalBytes: file.size,
        uploadedBytes,
        percent: Math.round((uploadedBytes / file.size) * 100),
        activeParts: [...activeParts],
      });
    };

    // Process pending parts with concurrency pool
    await this.runWithConcurrency(pendingParts, uploadPart, MAX_CONCURRENT);

    // Complete the multipart upload
    const partsArray = [...completedParts.entries()]
      .map(([partNumber, etag]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber);

    await firstValueFrom(this.http.post<{ success: boolean }>(`${baseUrl}/multipart/complete`, {
      key: s3Key,
      uploadId,
      parts: partsArray,
    }));

    // Clean up resume state on success
    this.clearResumeState(s3Key);

    return { s3Key, fileSize: file.size };
  }

  /**
   * Abort an in-progress multipart upload.
   */
  async abort(
    s3Key: string,
    sessionId: string,
  ): Promise<void> {
    const resumeState = this.getResumeState(s3Key);
    if (!resumeState) return;

    const baseUrl = `${environment.apiUrl}/visitor-chat/sessions/${sessionId}/upload`;

    try {
      await firstValueFrom(this.http.post(`${baseUrl}/multipart/abort`, {
        key: s3Key,
        uploadId: resumeState.uploadId,
      }));
    } catch (err) {
      this.log.warn('[ChunkedUpload] Abort request failed (may already be cleaned up)', err);
    }

    this.clearResumeState(s3Key);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private putPart(url: string, chunk: Blob, abortSignal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => xhr.abort(), { once: true });
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader('ETag');
          if (!etag) {
            reject(new Error('S3 did not return ETag header'));
            return;
          }
          resolve(etag);
        } else {
          reject(new Error(`S3 part upload failed: ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('S3 part upload network error'));
      xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
      xhr.send(chunk);
    });
  }

  private async runWithConcurrency<T>(
    items: T[],
    fn: (item: T) => Promise<void>,
    limit: number,
  ): Promise<void> {
    const queue = [...items];
    const executing: Promise<void>[] = [];

    while (queue.length > 0) {
      const item = queue.shift()!;
      const p = fn(item).then(() => {
        executing.splice(executing.indexOf(p), 1);
      });
      executing.push(p);

      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
  }

  // ─── Session storage for resume ──────────────────────────────────────────

  private getResumeState(s3Key: string): ResumeState | null {
    try {
      const raw = sessionStorage.getItem(RESUME_STORAGE_PREFIX + s3Key);
      if (!raw) return null;
      return JSON.parse(raw) as ResumeState;
    } catch {
      return null;
    }
  }

  private saveResumeState(s3Key: string, state: ResumeState): void {
    try {
      sessionStorage.setItem(RESUME_STORAGE_PREFIX + s3Key, JSON.stringify(state));
    } catch {
      // sessionStorage full or unavailable — non-critical
    }
  }

  private clearResumeState(s3Key: string): void {
    try {
      sessionStorage.removeItem(RESUME_STORAGE_PREFIX + s3Key);
    } catch {
      // ignore
    }
  }
}
