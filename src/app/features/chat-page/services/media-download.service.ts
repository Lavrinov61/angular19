import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { decodeFileName } from '../../../shared/utils/file-helpers';

@Injectable({
  providedIn: 'root'
})
export class MediaDownloadService {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);

  private get baseApiUrl(): string {
    const apiUrl = environment.apiUrl;
    if (!apiUrl) return '/api';
    if (apiUrl.endsWith('/api')) return apiUrl;
    return `${apiUrl}/api`;
  }

  async downloadAll(sessionId: string): Promise<void> {
    await this.downloadZipAdmin(sessionId);
  }

  async downloadSent(sessionId: string): Promise<void> {
    await this.downloadZipAdmin(sessionId, 'sent');
  }

  async downloadReceived(sessionId: string): Promise<void> {
    await this.downloadZipAdmin(sessionId, 'received');
  }

  /**
   * Download a single file via fetch → blob to bypass cross-origin download restrictions.
   * S3 presigned URLs ignore the <a download> attribute because of cross-origin policy.
   */
  async downloadSingle(url: string, filename?: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const resolvedFilename = filename || this.extractFilename(url);

    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = resolvedFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Fallback: open in new tab (better than nothing)
      window.open(url, '_blank');
    }
  }

  /**
   * Download a file by message ID through the backend proxy.
   * Backend streams the file with correct Content-Disposition and MIME type headers.
   */
  async downloadByMessageId(messageId: string, filename?: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      const response = await firstValueFrom(this.http.get(
        `${this.baseApiUrl}/visitor-chat/admin/files/${messageId}/download`,
        { responseType: 'blob', observe: 'response' },
      ));

      if (response?.body) {
        this.triggerDownload(
          response.body,
          response.headers.get('Content-Disposition'),
          filename || 'file',
        );
      }
    } catch {
      // Fallback to fetch → blob if proxy fails
      // (caller should provide direct URL as fallback)
    }
  }

  private extractFilename(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      return decodeFileName(pathname.split('/').pop() || 'download');
    } catch {
      return 'download';
    }
  }

  async downloadSelectedZip(sessionId: string, messageIds: string[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const response = await firstValueFrom(this.http.post(
      `${this.baseApiUrl}/visitor-chat/admin/sessions/${sessionId}/download-selected`,
      { messageIds },
      { responseType: 'blob', observe: 'response' },
    ));

    if (response?.body) {
      this.triggerDownload(response.body, response.headers.get('Content-Disposition'), `selected-${sessionId.substring(0, 8)}.zip`);
    }
  }

  private async downloadZipAdmin(sessionId: string, type?: 'sent' | 'received'): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    let url = `${this.baseApiUrl}/visitor-chat/admin/sessions/${sessionId}/download`;
    if (type) {
      url += `?type=${type}`;
    }

    const response = await firstValueFrom(this.http.get(url, {
      responseType: 'blob',
      observe: 'response',
    }));

    if (response?.body) {
      this.triggerDownload(response.body, response.headers.get('Content-Disposition'), `photos-${sessionId.substring(0, 8)}.zip`);
    }
  }

  private triggerDownload(blob: Blob, contentDisposition: string | null, defaultName: string): void {
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;

    const filename = this.filenameFromContentDisposition(contentDisposition, defaultName);

    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  }

  private filenameFromContentDisposition(contentDisposition: string | null, defaultName: string): string {
    if (!contentDisposition) return defaultName;

    const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) {
      return decodeFileName(encoded.replace(/^"|"$/g, ''));
    }

    const plain = contentDisposition.match(/filename="([^"]+)"/i)?.[1]
      || contentDisposition.match(/filename=([^;]+)/i)?.[1];
    return plain ? decodeFileName(plain.trim()) : defaultName;
  }
}
