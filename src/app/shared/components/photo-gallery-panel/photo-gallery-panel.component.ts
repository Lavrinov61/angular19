import {
  Component,
  ChangeDetectionStrategy,
  inject,
  output,
  computed,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AuthChatService } from '../../../core/services/auth-chat.service';

@Component({
  selector: 'app-photo-gallery-panel',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gallery-panel">
      <!-- Header -->
      <div class="gallery-header">
        <div class="gallery-title">
          <mat-icon>photo_library</mat-icon>
          <span>Фотографии</span>
          @if (chatService.uploadedPhotos().length > 0) {
            <span class="photo-count">{{ chatService.uploadedPhotos().length }}</span>
          }
        </div>
        <div class="gallery-actions">
          <button class="gallery-btn upload-btn" (click)="uploadMore.emit()">
            <mat-icon>add_photo_alternate</mat-icon>
            <span class="btn-label">Добавить</span>
          </button>
          @if (unlockedPhotoCount() > 0) {
            <button class="gallery-btn clear-btn" (click)="onClearAll()">
              <mat-icon>delete_sweep</mat-icon>
              <span class="btn-label">Очистить</span>
            </button>
          }
        </div>
      </div>

      <!-- Order status bar -->
      @if (chatService.hasActiveOrder()) {
        <div class="order-status-bar" [style.background]="statusInfo().color + '18'" [style.border-color]="statusInfo().color + '40'">
          <mat-icon [style.color]="statusInfo().color" [class.spin]="statusInfo().status === 'processing'">{{ statusInfo().icon }}</mat-icon>
          <div class="status-text">
            <span class="status-label" [style.color]="statusInfo().color">{{ statusInfo().label }}</span>
            @if (statusInfo().orderNumber) {
              <span class="status-detail">Заказ №{{ statusInfo().orderNumber }}@if (statusInfo().price) {, {{ statusInfo().price }}₽}</span>
            }
          </div>
        </div>
      }

      <!-- Photo grid -->
      @if (chatService.uploadedPhotos().length > 0) {
        <div class="photo-grid">
          @for (photo of chatService.uploadedPhotos(); track photo.id) {
            <div class="photo-card" [class.order-locked]="chatService.isPhotoLocked(photo.id)">
              <div class="photo-thumb">
                <img [src]="photo.attachment_url" [alt]="photo.content" loading="lazy" />
                @if (!chatService.isPhotoLocked(photo.id)) {
                  <button class="delete-btn" (click)="onDelete(photo.id)" title="Удалить фото">
                    <mat-icon>close</mat-icon>
                  </button>
                }
                @if (chatService.isPhotoLocked(photo.id)) {
                  <div class="photo-status-badge" [style.background]="statusInfo().color">
                    <mat-icon>{{ statusInfo().icon }}</mat-icon>
                  </div>
                }
              </div>
              @if (!chatService.isPhotoLocked(photo.id)) {
                <div class="copy-stepper">
                  <button
                    class="stepper-btn"
                    [disabled]="chatService.getPhotoCopies(photo.id) <= 1"
                    (click)="onDecrease(photo.id)"
                  >
                    <mat-icon>remove</mat-icon>
                  </button>
                  <span class="copy-count">{{ chatService.getPhotoCopies(photo.id) }}</span>
                  <button class="stepper-btn" (click)="onIncrease(photo.id)">
                    <mat-icon>add</mat-icon>
                  </button>
                </div>
              }
            </div>
          }
        </div>
      } @else {
        <div class="empty-state">
          <mat-icon class="empty-icon">add_a_photo</mat-icon>
          <p>Нет загруженных фотографий</p>
          <button class="gallery-btn upload-btn" (click)="uploadMore.emit()">
            <mat-icon>upload</mat-icon>
            Загрузить фото
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }

    .gallery-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--ed-surface, #0a0a0a);
      border-radius: 16px;
      overflow: hidden;
    }

    .gallery-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--ed-surface-container-high, #222);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--ed-on-surface, #f5f5f5);
      flex-shrink: 0;
    }

    .gallery-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 15px;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .photo-count {
      background: rgba(245, 158, 11, 0.2);
      border-radius: 12px;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 700;
    }

    .gallery-actions {
      display: flex;
      gap: 6px;
    }

    .gallery-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 10px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.2s;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    .upload-btn {
      background: rgba(245, 158, 11, 0.15);
      color: #f59e0b;

      &:hover {
        background: rgba(245, 158, 11, 0.25);
      }
    }

    .clear-btn {
      background: rgba(255, 80, 80, 0.15);
      color: #ef4444;

      &:hover {
        background: rgba(255, 80, 80, 0.3);
      }
    }

    .order-status-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      border-bottom: 1px solid;
      flex-shrink: 0;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      mat-icon.spin {
        animation: spin 1.5s linear infinite;
      }
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .status-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .status-label {
      font-weight: 700;
      font-size: 13px;
    }

    .status-detail {
      font-size: 11px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .photo-status-badge {
      position: absolute;
      bottom: 4px;
      left: 4px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);

      mat-icon {
        font-size: 13px;
        width: 13px;
        height: 13px;
      }
    }

    .photo-card.order-locked .photo-thumb {
      opacity: 0.85;
    }

    .photo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
      padding: 12px;
      overflow-y: auto;
      flex: 1;
    }

    .photo-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .photo-thumb {
      position: relative;
      border-radius: 10px;
      overflow: hidden;
      aspect-ratio: 1;
      background: var(--ed-surface-container, #1a1a1a);

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      &:hover .delete-btn {
        background: rgba(220, 40, 40, 0.85);
      }
    }

    .delete-btn {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: none;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 1;
      transition: background 0.2s;
      padding: 0;

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }

      &:hover {
        background: rgba(220, 40, 40, 0.85);
      }
    }

    .copy-stepper {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
      background: var(--ed-surface-container-high, #222);
      border-radius: 8px;
      padding: 2px;
    }

    .stepper-btn {
      width: 26px;
      height: 26px;
      border-radius: 6px;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ed-on-surface-variant, #a0a0a0);
      transition: all 0.15s;
      padding: 0;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      &:hover:not(:disabled) {
        background: var(--ed-surface-container-highest, #333);
        color: var(--ed-on-surface, #f5f5f5);
      }

      &:disabled {
        opacity: 0.3;
        cursor: default;
      }
    }

    .copy-count {
      min-width: 22px;
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 32px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      text-align: center;

      .empty-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        opacity: 0.4;
      }

      p {
        margin: 0;
        font-size: 14px;
      }

      .upload-btn {
        background: #f59e0b;
        color: #0a0a0a;
        padding: 8px 16px;
        font-size: 14px;
        border-radius: 10px;

        &:hover {
          background: #fbbf24;
        }
      }
    }

    @media (max-width: 480px) {
      .photo-grid {
        grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
        gap: 8px;
        padding: 8px;
      }

      .btn-label {
        display: none;
      }

      .gallery-btn {
        padding: 6px;
      }
    }
  `,
})
export class PhotoGalleryPanelComponent {
  readonly chatService = inject(AuthChatService);
  readonly uploadMore = output<void>();

  readonly statusInfo = this.chatService.orderStatusInfo;

  /** Количество незалоченных фото (для кнопки «Очистить») */
  readonly unlockedPhotoCount = computed(() =>
    this.chatService.uploadedPhotos().filter(p => !this.chatService.isPhotoLocked(p.id)).length
  );

  onDelete(messageId: string): void {
    this.chatService.deletePhoto(messageId);
  }

  onIncrease(messageId: string): void {
    const current = this.chatService.getPhotoCopies(messageId);
    this.chatService.setPhotoCopies(messageId, current + 1);
  }

  onDecrease(messageId: string): void {
    const current = this.chatService.getPhotoCopies(messageId);
    this.chatService.setPhotoCopies(messageId, current - 1);
  }

  onClearAll(): void {
    // Удаляем только незалоченные фото (заказанные остаются)
    const unlocked = this.chatService.uploadedPhotos()
      .filter(p => !this.chatService.isPhotoLocked(p.id));
    for (const photo of unlocked) {
      this.chatService.deletePhoto(photo.id);
    }
  }
}
