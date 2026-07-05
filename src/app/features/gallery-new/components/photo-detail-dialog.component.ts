import { Component, inject, ChangeDetectionStrategy } from '@angular/core';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { GalleryPhoto } from '../interfaces/gallery.interfaces';
import { LoggerService } from '../../../core/services/logger.service';

export interface PhotoDetailData {
  photo: GalleryPhoto;
  fullSizeUrl: string;
}

@Component({
  selector: 'app-photo-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule
],
  template: `
    <div class="photo-detail-container">
      <div class="photo-detail-header">
        <h2 mat-dialog-title>{{ data.photo.title }}</h2>
        <button mat-icon-button (click)="close()" aria-label="Закрыть">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      
      <div mat-dialog-content class="photo-detail-content">
        <div class="photo-wrapper">
          <img 
            [src]="data.fullSizeUrl" 
            [alt]="data.photo.alt || data.photo.title"
            class="full-size-photo"
            (load)="onImageLoad()"
            (error)="onImageError($event)">
        </div>
        
        @if (data.photo.description || data.photo.tags?.length) {
          <div class="photo-info">
            @if (data.photo.description) {
              <p class="photo-description">
                {{ data.photo.description }}
              </p>
            }
            
            @if (data.photo.tags?.length) {
              <div class="photo-tags">
                @for (tag of data.photo.tags; track tag || $index) {
                  <span class="tag">{{ tag }}</span>
                }
              </div>
            }
          </div>
        }
      </div>
      
      <div mat-dialog-actions class="photo-detail-actions">
        <button mat-button (click)="downloadPhoto()" color="primary">
          <mat-icon>download</mat-icon>
          Скачать
        </button>
        <button mat-button (click)="sharePhoto()" color="primary">
          <mat-icon>share</mat-icon>
          Поделиться
        </button>
        <button mat-button (click)="close()">
          Закрыть
        </button>
      </div>
    </div>
  `,
  styles: [`
    .photo-detail-container {
      max-width: 95vw;
      max-height: 95vh;
      display: flex;
      flex-direction: column;
      background: var(--ed-surface, #0a0a0a);
    }

    .photo-detail-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);

      h2 {
        font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
        font-weight: 600;
        color: var(--ed-on-surface, #f5f5f5);
      }

      button {
        color: var(--ed-on-surface-muted, #666);
      }
    }

    .photo-detail-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 16px;
      background: var(--ed-surface, #0a0a0a);
    }

    .photo-wrapper {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
      margin-bottom: 16px;
    }

    .full-size-photo {
      max-width: 100%;
      max-height: 60vh;
      object-fit: contain;
      border-radius: var(--ed-border-radius-sm, 4px);
    }

    .photo-info {
      margin-top: 16px;
    }

    .photo-description {
      margin: 0 0 12px 0;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .photo-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .tag {
      background: var(--ed-accent-container, #451a03);
      color: var(--ed-on-accent-container, #fef3c7);
      padding: 4px 10px;
      border-radius: 2px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .photo-detail-actions {
      padding: 16px;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      display: flex;
      flex-direction: column;
      gap: 8px;
      justify-content: flex-end;
    }

    @media (min-width: 840px) {
      .photo-detail-container {
        max-width: 90vw;
        max-height: 90vh;
      }

      .full-size-photo {
        max-height: 70vh;
      }

      .photo-detail-actions {
        flex-direction: row;
      }
    }
  `]
})
export class PhotoDetailDialogComponent {
  dialogRef = inject<MatDialogRef<PhotoDetailDialogComponent>>(MatDialogRef);
  data = inject<PhotoDetailData>(MAT_DIALOG_DATA);

  private log = inject(LoggerService);

  close(): void {
    this.dialogRef.close();
  }

  onImageLoad(): void {
    this.log.debug('Full-size image loaded successfully');
  }

  onImageError(event: Event): void {
    this.log.error('Error loading full-size image');
    const img = event.target as HTMLImageElement;
    // Fallback to thumbnail if full-size fails
    img.src = this.data.photo.thumbnailSrc || this.data.photo.src || '';
  }

  downloadPhoto(): void {
    const link = document.createElement('a');
    link.href = this.data.fullSizeUrl;
    link.download = `${this.data.photo.title || 'photo'}.jpg`;
    link.click();
  }  sharePhoto(): void {
    const nav = globalThis.navigator;
    if (!nav) return;
    if ('share' in nav && typeof nav.share === 'function') {
      nav.share({
        title: this.data.photo.title,
        text: this.data.photo.description || this.data.photo.alt,
        url: this.data.fullSizeUrl
      });
    } else if (nav.clipboard) {
      // Fallback - copy to clipboard
      nav.clipboard.writeText(this.data.fullSizeUrl);
      this.log.debug('Photo URL copied to clipboard');
    }
  }
}
