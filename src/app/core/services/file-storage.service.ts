import { Injectable, inject, signal } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ApiService, ApiResponse } from './api.service';
import { HttpClient, HttpEventType, HttpEvent } from '@angular/common/http';

export interface FileUploadResponse {
  id: string;
  fileName: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  url: string;
}

export interface UploadProgress {
  progress: number;
  loaded: number;
  total: number;
  state: 'pending' | 'uploading' | 'completed' | 'error';
}

export interface FileMetadata {
  id: string;
  fileName: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  userId: string;
  url: string;
  uploadedAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class FileStorageService {
  private readonly apiService = inject(ApiService);
  private readonly http = inject(HttpClient);

  // Signal for tracking upload progress
  private uploadProgressSignal = signal<Map<string, UploadProgress>>(new Map());
  public readonly uploadProgress = this.uploadProgressSignal.asReadonly();

  /**
   * Uploads a file to the REST API.
   * @param path The full path in the storage (e.g., 'avatars/userId/filename.jpg').
   *   Note: This parameter is kept for API compatibility but may be used for organization.
   * @param file The file object to upload.
   * @returns An observable that emits the download URL of the uploaded file.
   */
  uploadFile(_path: string, file: File): Observable<string> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<ApiResponse<FileUploadResponse>>(
      `/api/files/upload`,
      formData
    ).pipe(
      map(response => {
        if (response.success && response.data) {
          // Return full URL for the file
          return response.data.url;
        }
        throw new Error(response.error || 'File upload failed');
      }),
      catchError(error => {
        return throwError(() => new Error(error.message || 'File upload failed'));
      })
    );
  }

  /**
   * Uploads a file with progress tracking.
   * @param path The full path in the storage.
   * @param file The file object to upload.
   * @returns An observable that emits upload progress and final URL.
   */
  uploadFileWithProgress(_path: string, file: File): Observable<UploadProgress | string> {
    const formData = new FormData();
    formData.append('file', file);
    const fileId = `${Date.now()}-${file.name}`;

    // Initialize progress
    this.updateProgress(fileId, {
      progress: 0,
      loaded: 0,
      total: file.size,
      state: 'pending'
    });

    return this.http.post<ApiResponse<FileUploadResponse>>(
      `/api/files/upload`,
      formData,
      {
        reportProgress: true,
        observe: 'events'
      }
    ).pipe(
      map((event: HttpEvent<ApiResponse<FileUploadResponse>>) => {
        switch (event.type) {
          case HttpEventType.UploadProgress:
            if (event.total) {
              const progress = Math.round((100 * event.loaded) / event.total);
              const uploadProgress: UploadProgress = {
                progress,
                loaded: event.loaded,
                total: event.total,
                state: 'uploading'
              };
              this.updateProgress(fileId, uploadProgress);
              return uploadProgress;
            }
            return { progress: 0, loaded: 0, total: 0, state: 'uploading' as const };

          case HttpEventType.Response: {
            const response = event.body as ApiResponse<FileUploadResponse>;
            if (response.success && response.data) {
              this.updateProgress(fileId, {
                progress: 100,
                loaded: file.size,
                total: file.size,
                state: 'completed'
              });
              return response.data.url;
            }
            throw new Error(response.error || 'File upload failed');
          }

          default:
            return { progress: 0, loaded: 0, total: 0, state: 'pending' as const };
        }
      }),
      catchError(error => {
        this.updateProgress(fileId, {
          progress: 0,
          loaded: 0,
          total: file.size,
          state: 'error'
        });
        return throwError(() => new Error(error.message || 'File upload failed'));
      })
    );
  }

  /**
   * Download a file by ID.
   * @param fileId The ID of the file to download.
   * @returns An observable that emits the Blob of the file.
   */
  downloadFile(fileId: string): Observable<Blob> {
    return this.http.get(
      `/api/files/${fileId}/download`,
      { responseType: 'blob' }
    ).pipe(
      catchError(error => {
        return throwError(() => new Error(error.message || 'File download failed'));
      })
    );
  }

  /**
   * Download a file by URL.
   * @param url The URL of the file.
   * @returns An observable that emits the Blob of the file.
   */
  downloadFileByUrl(url: string): Observable<Blob> {
    return this.http.get(url, { responseType: 'blob' }).pipe(
      catchError(error => {
        return throwError(() => new Error(error.message || 'File download failed'));
      })
    );
  }

  /**
   * Get file metadata.
   * @param fileId The ID of the file.
   * @returns An observable that emits the file metadata.
   */
  getFileMetadata(fileId: string): Observable<FileMetadata> {
    return this.http.get<ApiResponse<FileMetadata>>(
      `/api/files/${fileId}`
    ).pipe(
      map(response => {
        if (response.success && response.data) {
          return response.data;
        }
        throw new Error(response.error || 'Failed to load file metadata');
      }),
      catchError(error => {
        return throwError(() => new Error(error.message || 'Failed to load file metadata'));
      })
    );
  }

  /**
   * Deletes a file from the REST API by file ID.
   * @param fileId The ID of the file to delete.
   * @returns An observable that completes when the file is deleted.
   */
  deleteFile(fileId: string): Observable<void> {
    return this.apiService.delete<void>(`/files/${fileId}`).pipe(
      map(() => void 0)
    );
  }

  /**
   * Deletes a file from the REST API using its download URL.
   * This extracts the file ID from the URL and calls deleteFile.
   * @param url The full download URL of the file (e.g., '/api/files/:id/download').
   * @returns An observable that completes when the file is deleted.
   */
  deleteFileByUrl(url: string): Observable<void> {
    // Extract file ID from URL pattern: /api/files/:id/download
    const match = url.match(/\/files\/([^/]+)\/download/);
    if (!match || !match[1]) {
      // Try alternative pattern: /api/files/:id
      const altMatch = url.match(/\/files\/([^/]+)/);
      if (altMatch && altMatch[1]) {
        return this.deleteFile(altMatch[1]);
      }
      throw new Error('Invalid file URL format');
    }
    return this.deleteFile(match[1]);
  }

  /**
   * Extract file ID from URL.
   * @param url The file URL.
   * @returns The file ID or null if not found.
   */
  extractFileId(url: string): string | null {
    const match = url.match(/\/files\/([^/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Clear upload progress for a file.
   * @param fileId The file ID.
   */
  clearProgress(fileId: string): void {
    this.uploadProgressSignal.update(map => {
      const newMap = new Map(map);
      newMap.delete(fileId);
      return newMap;
    });
  }

  /**
   * Clear all upload progress.
   */
  clearAllProgress(): void {
    this.uploadProgressSignal.set(new Map());
  }

  /**
   * Update upload progress for a file.
   */
  private updateProgress(fileId: string, progress: UploadProgress): void {
    this.uploadProgressSignal.update(map => {
      const newMap = new Map(map);
      newMap.set(fileId, progress);
      return newMap;
    });
  }
}
