import {
  Component,
  inject,
  input,
  signal,
  computed,
  ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ChatMessage, AuthChatService } from '../../../../core/services/auth-chat.service';
import { PhotoViewerComponent } from '../photo-viewer/photo-viewer.component';
import { ComparisonSliderComponent } from '../comparison-slider/comparison-slider.component';
import { PhotoFeedbackComponent, FeedbackSubmission } from '../photo-feedback/photo-feedback.component';
import { MediaDownloadService } from '../../services/media-download.service';

interface MediaItem {
  id: string;
  url: string;
  type: 'sent' | 'received';
  caption?: string;
  timestamp: Date;
}

@Component({
  selector: 'app-media-gallery',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatMenuModule,
    PhotoViewerComponent,
    ComparisonSliderComponent,
    PhotoFeedbackComponent,
    MatSnackBarModule
],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="media-gallery">
      <!-- Header -->
      <div class="gallery-header">
        <h3>Медиа</h3>
        <div class="header-actions">
          @if (mediaItems().length > 0) {
            <button mat-icon-button [matMenuTriggerFor]="downloadMenu">
              <mat-icon>download</mat-icon>
            </button>
            <mat-menu #downloadMenu="matMenu">
              <button mat-menu-item (click)="downloadAll()">
                <mat-icon>folder_zip</mat-icon>
                <span>Скачать все ({{ mediaItems().length }})</span>
              </button>
              <button mat-menu-item (click)="downloadSent()">
                <mat-icon>upload</mat-icon>
                <span>Только отправленные ({{ sentItems().length }})</span>
              </button>
              <button mat-menu-item (click)="downloadReceived()">
                <mat-icon>download</mat-icon>
                <span>Только полученные ({{ receivedItems().length }})</span>
              </button>
            </mat-menu>
          }
        </div>
      </div>

      <!-- Tabs -->
      <mat-tab-group class="gallery-tabs">
        <mat-tab label="Все ({{ mediaItems().length }})">
          @if (mediaItems().length === 0) {
            <div class="empty-gallery">
              <mat-icon>photo_library</mat-icon>
              <p>Нет фотографий</p>
              <span>Отправьте фото, чтобы начать</span>
            </div>
          } @else {
            <div class="photo-grid">
              @for (item of mediaItems(); track item.id) {
                <div
                  class="photo-item"
                  [class.sent]="item.type === 'sent'"
                  [class.received]="item.type === 'received'"
                  (click)="openViewer(item)"
                  (keydown.enter)="openViewer(item)"
                  tabindex="0"
                >
                  <img [src]="item.url" [alt]="item.caption || 'Фото'" loading="lazy" />
                  <div class="photo-overlay">
                    <span class="photo-badge">
                      @if (item.type === 'sent') {
                        <mat-icon>upload</mat-icon> Исходное
                      } @else {
                        <mat-icon>download</mat-icon> Готовое
                      }
                    </span>
                    <mat-icon class="zoom-icon">zoom_in</mat-icon>
                  </div>
                </div>
              }
            </div>
          }
        </mat-tab>

        <mat-tab label="Исходные ({{ sentItems().length }})">
          @if (sentItems().length === 0) {
            <div class="empty-gallery">
              <mat-icon>upload_file</mat-icon>
              <p>Нет исходных фото</p>
            </div>
          } @else {
            <div class="photo-grid">
              @for (item of sentItems(); track item.id) {
                <div class="photo-item sent" (click)="openViewer(item)" (keydown.enter)="openViewer(item)" tabindex="0">
                  <img [src]="item.url" [alt]="item.caption || 'Исходное фото'" loading="lazy" />
                  <div class="photo-overlay">
                    <mat-icon class="zoom-icon">zoom_in</mat-icon>
                  </div>
                </div>
              }
            </div>
          }
        </mat-tab>

        <mat-tab label="Готовые ({{ receivedItems().length }})">
          @if (receivedItems().length === 0) {
            <div class="empty-gallery">
              <mat-icon>photo_camera</mat-icon>
              <p>Нет готовых фото</p>
              <span>Оператор скоро пришлёт результат</span>
            </div>
          } @else {
            <div class="photo-grid">
              @for (item of receivedItems(); track item.id) {
                <div class="photo-item received" (click)="openViewer(item)" (keydown.enter)="openViewer(item)" tabindex="0">
                  <img [src]="item.url" [alt]="item.caption || 'Готовое фото'" loading="lazy" />
                  <div class="photo-overlay">
                    <mat-icon class="zoom-icon">zoom_in</mat-icon>
                  </div>
                </div>
              }
            </div>
          }
        </mat-tab>
      </mat-tab-group>

      <!-- Comparison section -->
      @if (canCompare()) {
        <div class="comparison-section">
          <div class="section-header">
            <mat-icon>compare</mat-icon>
            <span>Сравнение До/После</span>
          </div>
          <app-comparison-slider 
            [beforeImage]="sentItems()[0].url"
            [afterImage]="receivedItems()[0].url"
          />
        </div>
      }

      <!-- Selection section - показываем когда есть несколько готовых фото -->
      @if (showFeedbackSection()) {
        <div class="feedback-section">
          <app-photo-feedback
            [photoUrls]="receivedPhotoUrls()"
            (feedbackSubmitted)="onFeedbackSubmitted($event)"
          />
        </div>
      }

      <!-- Photo Viewer Modal -->
      @if (selectedItem()) {
        <app-photo-viewer
          [imageUrl]="selectedItem()!.url"
          [caption]="selectedItem()!.caption"
          [allImages]="mediaItems()"
          [currentIndex]="currentIndex()"
          (closed)="closeViewer()"
          (navigate)="navigateViewer($event)"
          (download)="downloadSingle(selectedItem()!)"
        />
      }
    </div>
  `,
  styles: [`
    .media-gallery {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--ed-surface, #0a0a0a);
    }

    /* ============ Header ============ */
    .gallery-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);

      h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: var(--ed-on-surface, #f5f5f5);
      }
    }

    /* ============ Tabs ============ */
    .gallery-tabs {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Material tab body styling - using :host with direct child selectors */
    :host .gallery-tabs .mat-mdc-tab-body-wrapper {
      flex: 1;
      overflow: hidden;
    }

    :host .gallery-tabs .mat-mdc-tab-body-content {
      height: 100%;
      overflow-y: auto;
    }

    /* ============ Empty State ============ */
    .empty-gallery {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 200px;
      text-align: center;
      color: var(--ed-on-surface-variant, #a0a0a0);

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        opacity: 0.5;
        margin-bottom: 12px;
      }

      p {
        margin: 0;
        font-weight: 500;
      }

      span {
        font-size: 0.85rem;
        margin-top: 4px;
      }
    }

    /* ============ Photo Grid ============ */
    .photo-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      padding: 12px;
    }

    .photo-item {
      position: relative;
      aspect-ratio: 1;
      border-radius: 12px;
      overflow: hidden;
      cursor: pointer;
      background: var(--ed-surface-container, #1a1a1a);

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.3s;
      }

      .photo-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 8px;
        opacity: 0;
        transition: opacity 0.3s;
      }

      &:hover {
        img {
          transform: scale(1.05);
        }

        .photo-overlay {
          opacity: 1;
        }
      }

      &.sent .photo-overlay {
        background: linear-gradient(to top, rgba(102, 126, 234, 0.8) 0%, transparent 50%);
      }

      &.received .photo-overlay {
        background: linear-gradient(to top, rgba(17, 153, 142, 0.8) 0%, transparent 50%);
      }
    }

    .photo-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      align-self: flex-start;
      padding: 4px 8px;
      background: rgba(255, 255, 255, 0.9);
      border-radius: 100px;
      font-size: 0.7rem;
      font-weight: 500;
      color: #333;

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
    }

    .zoom-icon {
      align-self: center;
      color: white;
      font-size: 32px;
      width: 32px;
      height: 32px;
    }

    /* ============ Comparison Section ============ */
    .comparison-section {
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      padding: 16px;

      .section-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        font-weight: 600;
        color: var(--ed-on-surface, #f5f5f5);

        mat-icon {
          color: #667eea;
        }
      }
    }

    /* ============ Feedback Section ============ */
    .feedback-section {
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      padding: 12px;
    }

    /* ============ Responsive ============ */
    @media (min-width: 480px) {
      .photo-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }
  `],
})
export class MediaGalleryComponent {
  messages = input<ChatMessage[]>([]);

  private platformId = inject(PLATFORM_ID);
  private downloadService = inject(MediaDownloadService);
  private chatService = inject(AuthChatService);
  private snackBar = inject(MatSnackBar);

  selectedItem = signal<MediaItem | null>(null);
  currentIndex = signal(0);

  mediaItems = computed(() => {
    return this.messages()
      .filter(m => m.message_type === 'image' && m.attachment_url)
      .map(m => ({
        id: m.id,
        url: m.attachment_url!,
        type: m.sender_type === 'visitor' ? 'sent' : 'received' as 'sent' | 'received',
        caption: m.content !== '📷 Фото' ? m.content : undefined,
        timestamp: new Date(m.created_at),
      }))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  });

  sentItems = computed(() => this.mediaItems().filter(i => i.type === 'sent'));
  receivedItems = computed(() => this.mediaItems().filter(i => i.type === 'received'));
  canCompare = computed(() => this.sentItems().length > 0 && this.receivedItems().length > 0);
  
  // Показывать секцию выбора когда есть 2+ готовых фото
  showFeedbackSection = computed(() => this.receivedItems().length >= 2);
  receivedPhotoUrls = computed(() => this.receivedItems().map(i => i.url));

  openViewer(item: MediaItem): void {
    const index = this.mediaItems().findIndex(i => i.id === item.id);
    this.currentIndex.set(index);
    this.selectedItem.set(item);
  }

  closeViewer(): void {
    this.selectedItem.set(null);
  }

  navigateViewer(direction: 'prev' | 'next'): void {
    const items = this.mediaItems();
    let newIndex = this.currentIndex();
    
    if (direction === 'prev') {
      newIndex = newIndex > 0 ? newIndex - 1 : items.length - 1;
    } else {
      newIndex = newIndex < items.length - 1 ? newIndex + 1 : 0;
    }
    
    this.currentIndex.set(newIndex);
    this.selectedItem.set(items[newIndex]);
  }

  downloadSingle(item: MediaItem): void {
    this.downloadService.downloadSingle(item.url, `photo-${item.id}.jpg`);
  }

  async downloadAll(): Promise<void> {
    const sessionId = this.chatService.getSessionId();
    if (!sessionId) return;
    
    try {
      await this.downloadService.downloadAll(sessionId);
    } catch {
      this.snackBar.open('Не удалось скачать архив. Попробуйте позже.', 'Закрыть', { duration: 5000 });
    }
  }

  async downloadSent(): Promise<void> {
    const sessionId = this.chatService.getSessionId();
    if (!sessionId) return;
    
    try {
      await this.downloadService.downloadSent(sessionId);
    } catch {
      this.snackBar.open('Не удалось скачать архив. Попробуйте позже.', 'Закрыть', { duration: 5000 });
    }
  }

  async downloadReceived(): Promise<void> {
    const sessionId = this.chatService.getSessionId();
    if (!sessionId) return;
    
    try {
      await this.downloadService.downloadReceived(sessionId);
    } catch {
      this.snackBar.open('Не удалось скачать архив. Попробуйте позже.', 'Закрыть', { duration: 5000 });
    }
  }

  onFeedbackSubmitted(feedback: FeedbackSubmission): void {
    // Формируем сообщение с выбором и комментариями
    const selectedPhoto = feedback.allFeedback.find(f => f.isSelected);
    if (!selectedPhoto) return;

    const photoIndex = feedback.allFeedback.findIndex(f => f.isSelected) + 1;
    
    let message = `✅ Выбран вариант ${photoIndex}`;
    
    // Добавляем комментарии
    const comments = feedback.allFeedback
      .filter(f => f.comment.trim())
      .map((f, i) => `Вариант ${i + 1}: ${f.comment.trim()}`);
    
    if (comments.length > 0) {
      message += `\n\n📝 Пожелания:\n${comments.join('\n')}`;
    }

    // Добавляем лайки/дизлайки
    const likes = feedback.allFeedback.filter(f => f.rating === 'like').length;
    const dislikes = feedback.allFeedback.filter(f => f.rating === 'dislike').length;
    
    if (likes > 0 || dislikes > 0) {
      message += `\n\n👍 ${likes} | 👎 ${dislikes}`;
    }

    // Отправляем сообщение в чат
    this.chatService.sendMessage(message);
  }
}
