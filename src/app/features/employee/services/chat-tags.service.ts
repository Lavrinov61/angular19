import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface ChatTag {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
}

@Injectable({ providedIn: 'root' })
export class ChatTagsService {
  private readonly http = inject(HttpClient);

  private readonly _tags = signal<ChatTag[]>([]);
  readonly tags = this._tags.asReadonly();
  private loaded = false;

  load(): void {
    if (this.loaded) return;
    this.http.get<{ success: boolean; data: ChatTag[] }>('/api/crm/tags').subscribe({
      next: (res) => {
        if (res.success) {
          this._tags.set(res.data);
          this.loaded = true;
        }
      },
    });
  }

  getSessionTags(sessionId: string): void {
    // Tags are embedded in inbox metadata, but this fetches fresh per-session
    this.http.get<{ success: boolean; data: ChatTag[] }>(`/api/crm/sessions/${sessionId}/tags`).subscribe({
      next: (res) => {
        if (res.success) this._sessionTags.set(res.data);
      },
    });
  }

  private readonly _sessionTags = signal<ChatTag[]>([]);
  readonly sessionTags = this._sessionTags.asReadonly();

  addTag(sessionId: string, tagId: string): void {
    this.http.post(`/api/crm/sessions/${sessionId}/tags`, { tagId }).subscribe({
      next: () => {
        const tag = this._tags().find(t => t.id === tagId);
        if (tag) {
          this._sessionTags.update(prev => [...prev, tag]);
        }
      },
    });
  }

  removeTag(sessionId: string, tagId: string): void {
    this.http.delete(`/api/crm/sessions/${sessionId}/tags/${tagId}`).subscribe({
      next: () => {
        this._sessionTags.update(prev => prev.filter(t => t.id !== tagId));
      },
    });
  }
}
