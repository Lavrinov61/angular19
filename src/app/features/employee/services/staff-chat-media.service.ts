import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { DestroyRef, Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { StaffMessage } from '../models/staff-chat.model';

export type StaffChatMediaItem = Pick<
  StaffMessage,
  'id' | 'conversation_id' | 'message_type' | 'attachment_url' | 'original_filename'
>;

const EMPTY_IMAGE_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

@Injectable({ providedIn: 'root' })
export class StaffChatMediaService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(this.platformId);

  private readonly imagePreviewUrls = signal<ReadonlyMap<string, string>>(new Map());
  private readonly imagePreviewFallbacks = signal<ReadonlySet<string>>(new Set());
  private readonly imagePreviewRequests = new Set<string>();
  private destroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      for (const previewUrl of this.imagePreviewUrls().values()) {
        URL.revokeObjectURL(previewUrl);
      }
      this.imagePreviewRequests.clear();
    });
  }

  imagePreviewUrl(item: StaffChatMediaItem): string {
    if (!item.attachment_url) return EMPTY_IMAGE_SRC;
    if (this.usesInlineAttachmentUrl(item)) return item.attachment_url;

    const key = this.imagePreviewCacheKey(item);
    const cached = this.imagePreviewUrls().get(key);
    if (cached) return cached;

    if (this.imagePreviewFallbacks().has(key)) return item.attachment_url;
    return this.isApiMediaUrl(item.attachment_url) ? EMPTY_IMAGE_SRC : item.attachment_url;
  }

  ensureImagePreviews(items: readonly StaffChatMediaItem[]): void {
    if (!this.browser) return;

    for (const item of items) {
      if (item.message_type === 'image' && item.attachment_url && !this.usesInlineAttachmentUrl(item)) {
        void this.ensureImagePreview(item);
      }
    }
  }

  async downloadMessageMedia(item: StaffChatMediaItem): Promise<void> {
    if (!this.browser || !item.attachment_url) return;

    const fallbackFilename = this.attachmentFilename(item);
    if (this.usesInlineAttachmentUrl(item)) {
      this.triggerDownload(item.attachment_url, fallbackFilename);
      return;
    }

    try {
      const response = await this.fetchMedia(item, 'download');
      const blob = response.body;
      if (!blob) throw new Error('Empty media response');

      const blobUrl = URL.createObjectURL(blob);
      this.triggerDownload(
        blobUrl,
        this.filenameFromContentDisposition(response.headers.get('content-disposition'), fallbackFilename),
      );
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(item.attachment_url, '_blank', 'noopener');
    }
  }

  async openMessageMedia(item: StaffChatMediaItem): Promise<void> {
    if (!this.browser || !item.attachment_url) return;

    if (this.usesInlineAttachmentUrl(item)) {
      window.open(item.attachment_url, '_blank', 'noopener');
      return;
    }

    const popup = window.open('', '_blank');

    try {
      const response = await this.fetchMedia(item, 'download');
      const blob = response.body;
      if (!blob) throw new Error('Empty media response');

      const blobUrl = URL.createObjectURL(blob);
      if (popup) {
        popup.location.href = blobUrl;
      } else {
        window.open(blobUrl, '_blank', 'noopener');
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 300_000);
    } catch {
      const fallbackUrl = item.attachment_url || this.staffMessageMediaEndpoint(item, 'download');
      if (popup) {
        popup.location.href = fallbackUrl;
      } else {
        window.open(fallbackUrl, '_blank', 'noopener');
      }
    }
  }

  private async ensureImagePreview(item: StaffChatMediaItem): Promise<void> {
    const key = this.imagePreviewCacheKey(item);
    if (this.imagePreviewUrls().has(key) || this.imagePreviewFallbacks().has(key) || this.imagePreviewRequests.has(key)) {
      return;
    }

    this.imagePreviewRequests.add(key);

    try {
      let blobUrl: string;
      try {
        blobUrl = await this.createMediaBlobUrl(item, 'thumbnail');
      } catch {
        blobUrl = await this.createMediaBlobUrl(item, 'download');
      }

      if (this.destroyed) {
        URL.revokeObjectURL(blobUrl);
        return;
      }

      this.imagePreviewUrls.update(prev => {
        const next = new Map(prev);
        const oldUrl = next.get(key);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        next.set(key, blobUrl);
        return next;
      });
    } catch {
      this.imagePreviewFallbacks.update(prev => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    } finally {
      this.imagePreviewRequests.delete(key);
    }
  }

  private async createMediaBlobUrl(item: StaffChatMediaItem, action: 'thumbnail' | 'download'): Promise<string> {
    const response = await this.fetchMedia(item, action);
    const blob = response.body;
    if (!blob) throw new Error('Empty media response');
    return URL.createObjectURL(blob);
  }

  private fetchMedia(item: StaffChatMediaItem, action: 'thumbnail' | 'download'): Promise<HttpResponse<Blob>> {
    return firstValueFrom(
      this.http.get(this.staffMessageMediaEndpoint(item, action), {
        observe: 'response',
        responseType: 'blob',
      }),
    );
  }

  private usesInlineAttachmentUrl(item: StaffChatMediaItem): boolean {
    return item.id.startsWith('temp-')
      || item.attachment_url?.startsWith('blob:') === true
      || item.attachment_url?.startsWith('data:') === true;
  }

  private staffMessageMediaEndpoint(item: StaffChatMediaItem, action: 'thumbnail' | 'download'): string {
    return `/api/staff-chat/conversations/${encodeURIComponent(item.conversation_id)}/messages/${encodeURIComponent(item.id)}/${action}`;
  }

  private imagePreviewCacheKey(item: StaffChatMediaItem): string {
    return `${item.conversation_id}:${item.id}:${item.attachment_url ?? ''}`;
  }

  private isApiMediaUrl(url: string): boolean {
    return url.startsWith('/api/') || url.includes('/api/');
  }

  private attachmentFilename(item: StaffChatMediaItem): string {
    return item.original_filename || (item.message_type === 'image' ? 'photo.jpg' : 'file');
  }

  private triggerDownload(url: string, filename: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  private filenameFromContentDisposition(disposition: string | null, fallback: string): string {
    if (!disposition) return fallback;

    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) {
      try {
        return decodeURIComponent(encoded.replace(/^"|"$/g, ''));
      } catch {
        return fallback;
      }
    }

    const raw = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? '';
    const cleaned = raw.trim().replace(/^"|"$/g, '');
    if (!cleaned) return fallback;

    try {
      return decodeURIComponent(cleaned);
    } catch {
      return cleaned;
    }
  }
}
