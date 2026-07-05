import {
  Component, input, output, signal, computed, effect, inject, untracked,
  ChangeDetectionStrategy, OnInit,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { StaffChatMediaItem, StaffChatMediaService } from '../../services/staff-chat-media.service';

@Component({
  selector: 'app-media-lightbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
  template: `
    <div class="lightbox-overlay" (click)="onOverlayClick($event)" (keydown.escape)="closed.emit()" tabindex="-1" role="dialog">
      <div class="lightbox-header">
        <span class="lightbox-counter">{{ currentIndex() + 1 }} / {{ items().length }}</span>
        <button class="lightbox-download" (click)="downloadCurrent()" aria-label="Скачать">
          <mat-icon>download</mat-icon>
        </button>
        <button class="lightbox-close" (click)="closed.emit()" aria-label="Закрыть">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <button class="lightbox-nav lightbox-prev" (click)="prev()" aria-label="Предыдущее">
        <mat-icon>chevron_left</mat-icon>
      </button>

      <div class="lightbox-content">
        @if (currentItem(); as item) {
          @if (item.message_type === 'video') {
            <video [src]="item.attachment_url" controls autoplay class="lightbox-video"></video>
          } @else {
            <img [src]="media.imagePreviewUrl(item)" [alt]="item.original_filename || ''" class="lightbox-image" />
          }
        }
      </div>

      <button class="lightbox-nav lightbox-next" (click)="next()" aria-label="Следующее">
        <mat-icon>chevron_right</mat-icon>
      </button>

      @if (currentItem()?.original_filename) {
        <div class="lightbox-footer">
          <span class="lightbox-filename">{{ currentItem()!.original_filename }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .lightbox-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0, 0, 0, 0.92);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: lightbox-fade-in 200ms ease;
    }

    @keyframes lightbox-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .lightbox-header {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px 24px;
      z-index: 2;
    }

    .lightbox-counter {
      font-size: 14px;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      color: rgba(255, 255, 255, 0.7);
      letter-spacing: 0.05em;
    }

    .lightbox-download,
    .lightbox-close {
      position: absolute;
      top: 12px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: rgba(255, 255, 255, 0.8);
      transition: all 200ms ease;
      backdrop-filter: blur(8px);

      &:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
      }
    }
    .lightbox-download { right: 64px; }
    .lightbox-close { right: 16px; }

    .lightbox-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      z-index: 2;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 50%;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: rgba(255, 255, 255, 0.7);
      transition: all 200ms ease;
      backdrop-filter: blur(8px);

      mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
      }

      &:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.08);
      }
    }

    .lightbox-prev { left: 16px; }
    .lightbox-next { right: 16px; }

    .lightbox-content {
      display: flex;
      align-items: center;
      justify-content: center;
      max-width: 90vw;
      max-height: 85vh;
    }

    .lightbox-image {
      max-width: 90vw;
      max-height: 85vh;
      object-fit: contain;
      border-radius: 4px;
      user-select: none;
      transition: opacity 150ms ease;
    }

    .lightbox-video {
      max-width: 90vw;
      max-height: 85vh;
      border-radius: 4px;
      outline: none;
    }

    .lightbox-footer {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      padding: 16px 24px;
      z-index: 2;
    }

    .lightbox-filename {
      font-size: 12px;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      color: rgba(255, 255, 255, 0.5);
      max-width: 60vw;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `],
})
export class MediaLightboxComponent implements OnInit {
  protected readonly media = inject(StaffChatMediaService);

  readonly items = input.required<StaffChatMediaItem[]>();
  readonly startIndex = input<number>(0);
  readonly closed = output<void>();

  readonly currentIndex = signal(0);
  readonly currentItem = computed<StaffChatMediaItem | null>(() => this.items()[this.currentIndex()] ?? null);

  private readonly mediaPreviewEffect = effect(() => {
    const items = this.items();
    untracked(() => {
      this.media.ensureImagePreviews(items);
    });
  });

  ngOnInit(): void {
    this.currentIndex.set(this.startIndex());
  }

  prev(): void {
    this.currentIndex.update(i => i > 0 ? i - 1 : this.items().length - 1);
  }

  next(): void {
    this.currentIndex.update(i => i < this.items().length - 1 ? i + 1 : 0);
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target instanceof HTMLElement && event.target.classList.contains('lightbox-overlay')) {
      this.closed.emit();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        this.closed.emit();
        break;
      case 'ArrowLeft':
        this.prev();
        break;
      case 'ArrowRight':
        this.next();
        break;
    }
  }

  downloadCurrent(): void {
    const item = this.currentItem();
    if (item) void this.media.downloadMessageMedia(item);
  }
}
