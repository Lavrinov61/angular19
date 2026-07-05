import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatRippleModule } from '@angular/material/core';

import { AuthService } from '../../../../core/services/auth.service';
import {
  ClientPhotoSession,
  PhotoApiService,
} from '../../../../core/services/photo-api.service';
import { PhotoSessionDialogComponent } from '../photo-session-dialog/photo-session-dialog.component';

@Component({
  selector: 'app-user-photos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatDialogModule,
    MatRippleModule,
  ],
  template: `
    <section class="my-photos">
      <header class="my-photos__hero">
        <div>
          <span class="my-photos__eyebrow">Личный кабинет</span>
          <h1>Мои фотографии</h1>
          <p>
            Готовые съёмки, фото на документы и архивы заказов. Откройте
            фотосессию, чтобы посмотреть все кадры или скачать файлы.
          </p>
        </div>

        <div class="my-photos__counter" aria-label="Количество фотосессий">
          <strong>{{ photoSessions().length }}</strong>
          <span>{{ getSessionWord(photoSessions().length) }}</span>
        </div>
      </header>

      @if (isLoading()) {
        <div class="my-photos__loading">
          <mat-progress-bar mode="indeterminate" />
          <span>Загружаем ваши фотографии</span>
        </div>
      }

      @if (photoSessions().length > 0) {
        <div class="my-photos__grid">
          @for (session of photoSessions(); track session.id) {
            <article
              class="session-card"
              matRipple
              tabindex="0"
              (click)="openSessionDialog(session)"
              (keydown.enter)="openSessionDialog(session)"
            >
              <div class="session-card__visual">
                @if (session.thumbnailUrl) {
                  <img
                    class="session-card__thumb"
                    [src]="session.thumbnailUrl"
                    alt="Превью фотосессии"
                    loading="lazy"
                  />
                } @else {
                  <div class="session-card__placeholder" aria-hidden="true">
                    <mat-icon>camera_alt</mat-icon>
                    <span>Своё фото</span>
                  </div>
                }

                <span
                  class="session-card__badge"
                  [class.session-card__badge--delivered]="
                    session.status === 'delivered'
                  "
                  [class.session-card__badge--ready]="session.status === 'ready'"
                  [class.session-card__badge--processing]="
                    session.status === 'processing'
                  "
                >
                  {{ getStatusLabel(session.status) }}
                </span>

                <div class="session-card__quick-view">
                  <mat-icon>visibility</mat-icon>
                </div>
              </div>

              <div class="session-card__body">
                <h2>{{ session.title }}</h2>

                <div class="session-card__meta">
                  <span>
                    <mat-icon>calendar_today</mat-icon>
                    {{ formatDate(session.date) }}
                  </span>
                  <span>
                    <mat-icon>photo_library</mat-icon>
                    {{ session.photoCount }} фото
                  </span>
                </div>

                @if (session.status === 'ready' || session.status === 'delivered') {
                  <button
                    mat-flat-button
                    class="session-card__download"
                    type="button"
                    [disabled]="downloading() === session.id"
                    (click)="downloadSessionPhotos(session, $event)"
                  >
                    <mat-icon>download</mat-icon>
                    <span>{{
                      downloading() === session.id ? 'Скачиваем' : 'Скачать'
                    }}</span>
                  </button>
                } @else {
                  <span class="session-card__state">Фотографии готовятся</span>
                }
              </div>
            </article>
          }
        </div>
      } @else if (!isLoading()) {
        <div class="my-photos__empty">
          <div class="my-photos__empty-icon" aria-hidden="true">
            <mat-icon>add_a_photo</mat-icon>
          </div>
          <h2>Фотосессий пока нет</h2>
          <p>
            После съёмки готовые фотографии появятся здесь. Их можно будет
            просмотреть, скачать и открыть повторно в любое время.
          </p>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100%;
        background: #f3f4f6;
        color: #202124;
      }

      .my-photos {
        width: min(1220px, calc(100% - 32px));
        margin: 0 auto;
        padding: 32px 0 64px;
      }

      .my-photos__hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 24px;
        align-items: end;
        margin-bottom: 28px;
      }

      .my-photos__eyebrow {
        display: inline-flex;
        margin-bottom: 8px;
        color: #f59e0b;
        font-size: 13px;
        font-weight: 800;
      }

      .my-photos__hero h1 {
        margin: 0;
        max-width: 760px;
        font-size: clamp(32px, 4vw, 52px);
        line-height: 1.02;
        font-weight: 900;
        letter-spacing: 0;
      }

      .my-photos__hero p {
        max-width: 660px;
        margin: 12px 0 0;
        color: #6b7280;
        font-size: 16px;
        line-height: 1.55;
      }

      .my-photos__counter {
        min-width: 150px;
        padding: 18px 20px;
        border-radius: 24px;
        background: #ffffff;
        box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
        text-align: right;
      }

      .my-photos__counter strong {
        display: block;
        color: #202124;
        font-size: 36px;
        line-height: 1;
        font-weight: 900;
      }

      .my-photos__counter span {
        color: #6b7280;
        font-size: 14px;
      }

      .my-photos__loading {
        display: grid;
        gap: 12px;
        padding: 22px;
        margin-bottom: 20px;
        border-radius: 22px;
        background: #ffffff;
        color: #6b7280;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06);
      }

      .my-photos__grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 18px;
      }

      .session-card {
        display: grid;
        overflow: hidden;
        min-width: 0;
        border: 1px solid #e5e7eb;
        border-radius: 24px;
        background: #ffffff;
        box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
        cursor: pointer;
        outline: none;
        transition:
          transform 180ms ease,
          box-shadow 180ms ease,
          border-color 180ms ease;
      }

      .session-card:hover {
        transform: translateY(-3px);
        border-color: #d1d5db;
        box-shadow: 0 24px 52px rgba(15, 23, 42, 0.12);
      }

      .session-card:focus-visible {
        box-shadow:
          0 0 0 3px rgba(245, 158, 11, 0.28),
          0 24px 52px rgba(15, 23, 42, 0.12);
      }

      .session-card__visual {
        position: relative;
        aspect-ratio: 16 / 10;
        overflow: hidden;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0) 36%, rgba(0, 0, 0, 0.12)),
          linear-gradient(135deg, #f7f8fb, #d7dce4);
      }

      .session-card__thumb {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 220ms ease;
      }

      .session-card:hover .session-card__thumb {
        transform: scale(1.035);
      }

      .session-card__placeholder {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 8px;
        color: #9ca3af;
      }

      .session-card__placeholder mat-icon {
        width: 52px;
        height: 52px;
        font-size: 52px;
      }

      .session-card__placeholder span {
        font-size: 14px;
        font-weight: 800;
      }

      .session-card__badge {
        position: absolute;
        top: 12px;
        right: 12px;
        z-index: 1;
        display: inline-flex;
        min-height: 30px;
        align-items: center;
        padding: 0 12px;
        border-radius: 999px;
        background: #eef2ff;
        color: #4338ca;
        font-size: 12px;
        font-weight: 800;
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.12);
      }

      .session-card__badge--delivered {
        background: #dcfce7;
        color: #15803d;
      }

      .session-card__badge--ready {
        background: #fff7ed;
        color: #c2410c;
      }

      .session-card__badge--processing {
        background: #eff6ff;
        color: #1d4ed8;
      }

      .session-card__quick-view {
        position: absolute;
        right: 12px;
        bottom: 12px;
        display: grid;
        place-items: center;
        width: 42px;
        height: 42px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.94);
        color: #202124;
        opacity: 0;
        transform: translateY(8px);
        transition:
          opacity 180ms ease,
          transform 180ms ease;
      }

      .session-card:hover .session-card__quick-view,
      .session-card:focus-visible .session-card__quick-view {
        opacity: 1;
        transform: translateY(0);
      }

      .session-card__body {
        display: grid;
        gap: 14px;
        padding: 18px;
      }

      .session-card__body h2 {
        min-height: 42px;
        margin: 0;
        color: #202124;
        font-size: 18px;
        font-weight: 900;
        line-height: 1.18;
      }

      .session-card__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 14px;
        color: #6b7280;
        font-size: 13px;
      }

      .session-card__meta span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }

      .session-card__meta mat-icon {
        width: 17px;
        height: 17px;
        color: #9ca3af;
        font-size: 17px;
      }

      .session-card__download {
        justify-self: start;
        min-height: 42px;
        padding: 0 18px !important;
        border-radius: 999px !important;
        background: #202124 !important;
        color: #ffffff !important;
        box-shadow: none !important;
        font-weight: 800;
      }

      .session-card__download mat-icon {
        width: 18px;
        height: 18px;
        margin-right: 6px;
        color: #f59e0b;
        font-size: 18px;
      }

      .session-card__state {
        display: inline-flex;
        justify-self: start;
        min-height: 36px;
        align-items: center;
        padding: 0 14px;
        border-radius: 999px;
        background: #f3f4f6;
        color: #6b7280;
        font-size: 13px;
        font-weight: 800;
      }

      .my-photos__empty {
        display: grid;
        place-items: center;
        gap: 12px;
        min-height: 420px;
        padding: 48px 24px;
        border-radius: 32px;
        background: #ffffff;
        text-align: center;
        box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
      }

      .my-photos__empty-icon {
        display: grid;
        place-items: center;
        width: 86px;
        height: 86px;
        border-radius: 26px;
        background: #f3f4f6;
        color: #202124;
      }

      .my-photos__empty-icon mat-icon {
        width: 38px;
        height: 38px;
        font-size: 38px;
      }

      .my-photos__empty h2 {
        margin: 0;
        color: #202124;
        font-size: 26px;
        font-weight: 900;
      }

      .my-photos__empty p {
        max-width: 420px;
        margin: 0;
        color: #6b7280;
        line-height: 1.55;
      }

      @media (max-width: 1100px) {
        .my-photos__grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @media (max-width: 760px) {
        .my-photos {
          width: min(100% - 24px, 1220px);
          padding: 22px 0 40px;
        }

        .my-photos__hero {
          grid-template-columns: 1fr;
        }

        .my-photos__counter {
          width: 100%;
          text-align: left;
        }

        .my-photos__grid {
          grid-template-columns: 1fr;
        }

        .session-card__body h2 {
          min-height: auto;
        }
      }
    `,
  ],
})
export class UserPhotosComponent implements OnInit {
  private readonly photoApiService = inject(PhotoApiService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  readonly photoSessions = this.photoApiService.photoSessions;
  readonly isLoading = this.photoApiService.isLoading;
  readonly user = this.authService.user;
  readonly downloading = signal<string | null>(null);

  ngOnInit(): void {
    this.loadUserPhotoSessions();
  }

  loadUserPhotoSessions(): void {
    const userId = this.user()?.uid;
    if (!userId) {
      this.snackBar.open(
        'Для просмотра фотографий необходимо авторизоваться',
        'Закрыть',
        { duration: 5000 },
      );
      return;
    }

    this.photoApiService.getClientPhotoSessions(userId).subscribe({
      error: () => {
        this.snackBar.open('Не удалось загрузить фотосессии', 'Закрыть', {
          duration: 5000,
        });
      },
    });
  }

  openSessionDialog(session: ClientPhotoSession): void {
    this.dialog.open(PhotoSessionDialogComponent, {
      data: {
        sessionId: session.id,
        sessionTitle: session.title,
      },
      width: '90vw',
      maxWidth: '1000px',
      maxHeight: '90vh',
      panelClass: 'photo-session-dialog-container',
    });
  }

  downloadSessionPhotos(session: ClientPhotoSession, event: Event): void {
    event.stopPropagation();
    if (!isPlatformBrowser(this.platformId)) return;

    this.downloading.set(session.id);

    this.photoApiService.getDownloadUrls(session.id).subscribe({
      next: (response) => {
        this.downloading.set(null);
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
          this.snackBar.open('Загрузка фотографий началась', 'OK', {
            duration: 3000,
          });
        } else {
          this.snackBar.open('Фотографии не найдены', 'Закрыть', {
            duration: 5000,
          });
        }
      },
      error: () => {
        this.downloading.set(null);
        this.snackBar.open('Не удалось скачать фотографии', 'Закрыть', {
          duration: 5000,
        });
      },
    });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'processing':
        return 'В обработке';
      case 'ready':
        return 'Готово';
      case 'delivered':
        return 'Доставлено';
      default:
        return status;
    }
  }

  getSessionWord(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 14) return 'фотосессий';
    if (mod10 === 1) return 'фотосессия';
    if (mod10 >= 2 && mod10 <= 4) return 'фотосессии';
    return 'фотосессий';
  }
}
