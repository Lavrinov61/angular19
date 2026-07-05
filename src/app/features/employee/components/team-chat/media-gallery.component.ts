import { Component, input, signal, computed, effect, inject, untracked, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MediaLightboxComponent } from './media-lightbox.component';
import { StaffChatMediaItem, StaffChatMediaService } from '../../services/staff-chat-media.service';

type GalleryMediaItem = StaffChatMediaItem & {
  sender_name: string;
  created_at: string;
};

@Component({
  selector: 'app-media-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MediaLightboxComponent],
  template: `
    <div class="media-gallery">
      <div class="gallery-tabs">
        <button [class.active]="activeTab() === 'media'" (click)="activeTab.set('media')">
          Медиа <span class="tab-count">{{ mediaCount() }}</span>
        </button>
        <button [class.active]="activeTab() === 'files'" (click)="activeTab.set('files')">
          Файлы <span class="tab-count">{{ filesCount() }}</span>
        </button>
        <button [class.active]="activeTab() === 'audio'" (click)="activeTab.set('audio')">
          Аудио <span class="tab-count">{{ audioCount() }}</span>
        </button>
      </div>

      @if (loading()) {
        <div class="gallery-loading">Загрузка...</div>
      } @else {
        @switch (activeTab()) {
          @case ('media') {
            @for (group of mediaByDay(); track group.date) {
              <div class="day-group">
                <span class="day-label">{{ group.label }}</span>
                <div class="media-grid">
                  @for (item of group.items; track item.id) {
                    @if (item.message_type === 'image') {
                      <img [src]="media.imagePreviewUrl(item)" [alt]="item.original_filename"
                           class="media-thumb" loading="lazy" tabindex="0" role="button"
                           (click)="openLightbox(item)" (keydown.enter)="openLightbox(item)" />
                    } @else if (item.message_type === 'video') {
                      <div class="video-thumb" tabindex="0" role="button"
                           (click)="openLightbox(item)" (keydown.enter)="openLightbox(item)">
                        <mat-icon>play_circle_filled</mat-icon>
                      </div>
                    }
                  }
                </div>
              </div>
            } @empty {
              <div class="gallery-empty">
                <mat-icon>perm_media</mat-icon>
                <span>Нет медиа</span>
              </div>
            }
          }
          @case ('files') {
            @for (item of docFiles(); track item.id) {
              <button type="button" class="file-item" (click)="downloadMedia(item)">
                <mat-icon>description</mat-icon>
                <div class="file-info">
                  <span class="file-name">{{ item.original_filename || 'Файл' }}</span>
                  <span class="file-meta">{{ item.sender_name }} · {{ dateLabel(item.created_at) }}</span>
                </div>
                <mat-icon class="file-download">download</mat-icon>
              </button>
            } @empty {
              <div class="gallery-empty">
                <mat-icon>folder_open</mat-icon>
                <span>Нет файлов</span>
              </div>
            }
          }
          @case ('audio') {
            @for (item of audioFiles(); track item.id) {
              <div class="audio-item">
                <audio [src]="item.attachment_url" controls preload="metadata"></audio>
                <span class="audio-meta">{{ item.sender_name }} · {{ dateLabel(item.created_at) }}</span>
              </div>
            } @empty {
              <div class="gallery-empty">
                <mat-icon>headphones</mat-icon>
                <span>Нет аудио</span>
              </div>
            }
          }
        }
      }
    </div>

    @if (showLightbox()) {
      <app-media-lightbox
        [items]="mediaOnly()"
        [startIndex]="lightboxIndex()"
        (closed)="showLightbox.set(false)" />
    }
  `,
  styles: [`
    .media-gallery {
      display: flex;
      flex-direction: column;
    }

    .gallery-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--crm-glass-border);
      padding: 0 4px;
    }
    .gallery-tabs button {
      flex: 1;
      padding: 10px 8px;
      font-size: 11px;
      font-family: var(--crm-font-display, Oswald, sans-serif);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--crm-text-muted);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      transition: all 150ms ease;
      &:hover { color: var(--crm-text-secondary); }
      &.active {
        color: var(--crm-accent);
        border-bottom-color: var(--crm-accent);
        background: rgba(245, 158, 11, 0.04);
      }
    }
    .tab-count {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 10px;
      opacity: 0.6;
      margin-left: 2px;
    }

    .gallery-loading {
      padding: 24px;
      text-align: center;
      font-size: 12px;
      color: var(--crm-text-muted);
    }

    .day-group {
      padding: 0 8px;
    }
    .day-label {
      display: block;
      font-size: 11px;
      color: var(--crm-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 12px 0 4px;
      font-family: var(--crm-font-display, Oswald, sans-serif);
    }
    .media-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }
    .media-thumb {
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 8px;
      cursor: pointer;
      width: 100%;
      transition: all 200ms ease;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
      &:hover {
        transform: scale(1.03);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        opacity: 0.9;
      }
    }
    .video-thumb {
      aspect-ratio: 1;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.06);
      transition: opacity 150ms;
      mat-icon {
        font-size: 36px;
        width: 36px;
        height: 36px;
        color: var(--crm-text-secondary);
      }
      &:hover { opacity: 0.85; }
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 12px 12px;
      border-bottom: 1px solid var(--crm-glass-border);
      color: inherit;
      background: none;
      border-top: 0;
      border-left: 0;
      border-right: 0;
      cursor: pointer;
      text-align: left;
      transition: background 150ms;
      &:hover { background: rgba(245, 158, 11, 0.04); }
    }
    .file-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .file-name {
      font-size: 13px;
      color: var(--crm-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file-meta {
      font-size: 11px;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      color: var(--crm-text-muted);
    }
    .file-download {
      color: var(--crm-text-muted);
      opacity: 0;
      transition: opacity 150ms;
    }
    .file-item:hover .file-download { opacity: 1; }

    .audio-item {
      padding: 10px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      border-bottom: 1px solid var(--crm-glass-border);
      audio { width: 100%; height: 32px; }
    }
    .audio-meta {
      font-size: 11px;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      color: var(--crm-text-muted);
    }

    .gallery-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 40px 16px;
      color: var(--crm-text-muted);
      mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.4; }
      span { font-size: 12px; }
    }
  `],
})
export class MediaGalleryComponent {
  protected readonly media = inject(StaffChatMediaService);

  mediaItems = input.required<GalleryMediaItem[]>();
  loading = input<boolean>(false);

  readonly activeTab = signal<'media' | 'files' | 'audio'>('media');
  readonly showLightbox = signal(false);
  readonly lightboxIndex = signal(0);

  readonly mediaOnly = computed(() =>
    this.mediaItems().filter(m => m.message_type === 'image' || m.message_type === 'video')
  );
  readonly docFiles = computed(() =>
    this.mediaItems().filter(m => m.message_type === 'file')
  );
  readonly audioFiles = computed(() =>
    this.mediaItems().filter(m => m.message_type === 'audio')
  );

  readonly mediaCount = computed(() => this.mediaOnly().length);
  readonly filesCount = computed(() => this.docFiles().length);
  readonly audioCount = computed(() => this.audioFiles().length);

  private readonly mediaPreviewEffect = effect(() => {
    const items = this.mediaOnly();
    untracked(() => {
      this.media.ensureImagePreviews(items);
    });
  });

  readonly mediaByDay = computed(() => {
    const items = this.mediaOnly();
    const groups: { date: string; label: string; items: typeof items }[] = [];
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    for (const item of items) {
      const d = new Date(item.created_at).toDateString();
      let label = new Date(item.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      if (d === today) label = 'Сегодня';
      else if (d === yesterday) label = 'Вчера';

      const existing = groups.find(g => g.date === d);
      if (existing) { existing.items.push(item); }
      else { groups.push({ date: d, label, items: [item] }); }
    }
    return groups;
  });

  dateLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const ds = d.toDateString();
    if (ds === today) return 'сегодня';
    if (ds === yesterday) return 'вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  openLightbox(item: { id: string; attachment_url: string | null }): void {
    const items = this.mediaOnly();
    const idx = items.findIndex(m => m.id === item.id);
    this.lightboxIndex.set(idx >= 0 ? idx : 0);
    this.showLightbox.set(true);
  }

  downloadMedia(item: GalleryMediaItem): void {
    void this.media.downloadMessageMedia(item);
  }
}
