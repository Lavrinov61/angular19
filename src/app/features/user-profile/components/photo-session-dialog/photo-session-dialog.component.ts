import { Component, inject, signal, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PhotoApiService } from '../../../../core/services/photo-api.service';
import { Photo } from '../../../../core/models/photo.model';

export interface PhotoSessionDialogData {
  sessionId: string;
  sessionTitle: string;
}

@Component({
  selector: 'app-photo-session-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTooltipModule
  ],
  template: `
    <div class="psd">
      <div class="psd__header">
        <div class="psd__header-info">
          <h2 class="psd__title">{{ data.sessionTitle }}</h2>
          @if (photos().length > 0) {
            <span class="psd__count">{{ photos().length }} фото</span>
          }
        </div>
        <div class="psd__header-actions">
          @if (photos().length > 0) {
            <button mat-flat-button class="psd__download-all-btn"
                    [disabled]="downloadingAll()"
                    (click)="downloadAllPhotos()">
              <mat-icon>download</mat-icon>
              {{ downloadingAll() ? 'Загрузка...' : 'Скачать все' }}
            </button>
          }
          <button mat-icon-button (click)="close()" matTooltip="Закрыть">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      </div>

      <div class="psd__content">
        @if (isLoading()) {
          <div class="psd__loading">
            <mat-progress-bar mode="indeterminate" color="accent"></mat-progress-bar>
            <p>Загрузка фотографий...</p>
          </div>
        }

        @if (photos().length > 0) {
          <div class="psd__grid">
            @for (photo of photos(); track photo.id) {
              <div class="psd__photo-card">
                <img [src]="photo.thumbnailUrl || photo.processedUrl || photo.originalUrl"
                     alt="Фото" loading="lazy">
                <div class="psd__photo-actions">
                  <button mat-mini-fab class="psd__photo-download"
                          matTooltip="Скачать"
                          (click)="downloadSinglePhoto(photo)">
                    <mat-icon>download</mat-icon>
                  </button>
                </div>
              </div>
            }
          </div>
        }

        @if (photos().length === 0 && !isLoading()) {
          <div class="psd__empty">
            <mat-icon>photo_library</mat-icon>
            <p>Фотографии ещё не добавлены</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .psd {
      display: flex;
      flex-direction: column;
      max-height: 85vh;
      background: var(--ed-surface, #121212);
    }

    .psd__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      flex-shrink: 0;
    }

    .psd__header-info {
      display: flex;
      align-items: baseline;
      gap: 12px;
      min-width: 0;
    }

    .psd__title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .psd__count {
      font-size: 13px;
      color: var(--ed-outline, #888);
      white-space: nowrap;
    }

    .psd__header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .psd__download-all-btn {
      background: var(--ed-accent, #f59e0b) !important;
      color: #000 !important;
      font-weight: 500;
      font-size: 13px;
      border-radius: 8px;
    }

    .psd__download-all-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 4px;
    }

    .psd__content {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
    }

    .psd__loading {
      text-align: center;
      padding: 40px 0;
    }

    .psd__loading p {
      margin-top: 12px;
      color: var(--ed-outline, #888);
      font-size: 14px;
    }

    .psd__grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
    }

    .psd__photo-card {
      position: relative;
      aspect-ratio: 1;
      border-radius: 12px;
      overflow: hidden;
      background: var(--ed-surface-container-low, #111);
    }

    .psd__photo-card img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .psd__photo-actions {
      position: absolute;
      bottom: 10px;
      right: 10px;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .psd__photo-card:hover .psd__photo-actions {
      opacity: 1;
    }

    .psd__photo-download {
      background: var(--ed-accent, #f59e0b) !important;
      color: #000 !important;
    }

    .psd__photo-download mat-icon {
      font-size: 20px;
    }

    .psd__empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      color: var(--ed-outline, #888);
    }

    .psd__empty mat-icon {
      font-size: 56px;
      width: 56px;
      height: 56px;
      margin-bottom: 12px;
      color: var(--ed-outline-variant, #333);
    }

    @media (max-width: 640px) {
      .psd__grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }

      .psd__photo-actions {
        opacity: 1;
      }
    }
  `]
})
export class PhotoSessionDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<PhotoSessionDialogComponent>);
  private readonly photoApiService = inject(PhotoApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  readonly data = inject<PhotoSessionDialogData>(MAT_DIALOG_DATA);

  readonly isLoading = signal(false);
  readonly photos = signal<Photo[]>([]);
  readonly downloadingAll = signal(false);

  constructor() {
    this.loadSessionPhotos();
  }

  loadSessionPhotos(): void {
    this.isLoading.set(true);

    this.photoApiService.getSessionPhotos(this.data.sessionId).subscribe({
      next: (response) => {
        if (response.data) {
          this.photos.set(response.data);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.snackBar.open('Не удалось загрузить фотографии', 'Закрыть', { duration: 5000 });
        this.isLoading.set(false);
      }
    });
  }

  downloadSinglePhoto(photo: Photo): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const url = photo.processedUrl || photo.originalUrl;
    const link = this.document.createElement('a');
    link.href = url;
    link.download = photo.metadata?.fileName || `photo-${photo.id}.jpg`;
    link.target = '_blank';
    link.rel = 'noopener';
    this.document.body.appendChild(link);
    link.click();
    this.document.body.removeChild(link);
  }

  downloadAllPhotos(): void {
    if (!isPlatformBrowser(this.platformId) || this.photos().length === 0) return;

    this.downloadingAll.set(true);

    this.photoApiService.getDownloadUrls(this.data.sessionId).subscribe({
      next: (response) => {
        this.downloadingAll.set(false);
        if (response.success && response.data?.photos?.length) {
          for (const photo of response.data.photos) {
            const link = this.document.createElement('a');
            link.href = photo.url;
            link.download = photo.file_name || `photo-${photo.id}.jpg`;
            link.target = '_blank';
            link.rel = 'noopener';
            this.document.body.appendChild(link);
            link.click();
            this.document.body.removeChild(link);
          }
          this.snackBar.open('Загрузка началась', 'OK', { duration: 3000 });
        } else {
          this.snackBar.open('Фотографии не найдены', 'Закрыть', { duration: 5000 });
        }
      },
      error: () => {
        this.downloadingAll.set(false);
        this.snackBar.open('Не удалось скачать фотографии', 'Закрыть', { duration: 5000 });
      }
    });
  }

  close(): void {
    this.dialogRef.close();
  }
}
