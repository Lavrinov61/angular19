import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { PhotoApprovalService } from '../../../../core/services/photo-approval.service';
import { PhotoApproval, ApprovalStatus } from '../../../../core/models/photo-approval.model';
import { OrderHistoryService } from '../../../../core/services/order-history.service';
import { OrderHistory } from '../../../../core/models/order-history.model';

@Component({
  selector: 'app-photo-approval-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatBadgeModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatDividerModule,
    MatTooltipModule,
    MatSnackBarModule,
    DatePipe
  ],
  template: `
    <div class="approval-list-container">
      <h2 class="page-title">Мои фотографии</h2>

      @if (isLoading()) {
        <div class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
          <p>Загрузка заказов...</p>
        </div>
      }

      @if (error()) {
        <div class="error-message">
          <mat-icon color="warn">error</mat-icon>
          <p>{{ error() }}</p>
          <button mat-button color="primary" (click)="loadApprovals()">Повторить</button>
        </div>
      }

      @if (!isLoading() && !error() && approvals().length > 0) {
        <div class="approvals-list">
          @for (approval of approvals(); track approval.id || approval.orderId || $index) {
            <mat-card class="approval-card">
              <mat-card-header>
                <div mat-card-avatar class="approval-icon">
                  <mat-icon>assignment</mat-icon>
                </div>
                <mat-card-title>{{ getOrderTitle(approval) }}</mat-card-title>
                <mat-card-subtitle>
                  Создан {{ approval.createdAt | date:'dd.MM.yyyy' }}
                  @if (approval.requestDeadline) {
                    <span class="deadline-text"
                      [class.deadline-warning]="isDeadlineApproaching(approval)">
                      • Срок: {{ approval.requestDeadline | date:'dd.MM.yyyy' }}
                    </span>
                  }
                </mat-card-subtitle>

                <div class="status-badge">
                  <mat-chip [class]="getStatusClass(approval.status)">
                    {{ getStatusText(approval.status) }}
                  </mat-chip>
                </div>
              </mat-card-header>

              <mat-card-content>
                <div class="approval-content">
                  <div class="photo-count">
                    <mat-icon>photo_library</mat-icon>
                    <span>{{ approval.photos.length }} фото</span>
                  </div>

                  <div class="progress-container">
                    <span class="progress-label">Проверено:</span>
                    <div class="progress-bar">
                      <div class="progress-fill"
                        [style.width.%]="getApprovalProgress(approval)">
                      </div>
                    </div>
                    <span class="progress-text">{{ getApprovalProgress(approval) }}%</span>
                  </div>
                </div>

                @if (approval.photos.length > 0) {
                  <div class="photo-previews">
                    @for (photo of getPreviewPhotos(approval); track photo.id || photo.retouchedPhotoUrl || $index) {
                      <div class="photo-preview"
                        [class.approved]="photo.approved"
                        [class.has-annotations]="photo.annotations.length > 0"
                        matTooltip="{{ photo.approved ? 'Одобрено' : photo.annotations.length > 0 ? 'Есть комментарии' : 'Ожидает проверки' }}">
                        <img [src]="photo.retouchedPhotoUrl" alt="Фото для проверки">
                        <div class="photo-status-icon">
                          @if (photo.approved) {
                            <mat-icon>check_circle</mat-icon>
                          }
                          @if (!photo.approved && photo.annotations.length > 0) {
                            <mat-icon>comment</mat-icon>
                          }
                        </div>
                      </div>
                    }
                  </div>
                }
              </mat-card-content>

              <mat-divider></mat-divider>

              <mat-card-actions align="end">
                <button
                  mat-button
                  color="primary"
                  (click)="viewApproval(approval)"
                >
                  <mat-icon>visibility</mat-icon>
                  Проверить фотографии
                </button>

                @if (isDownloadableStatus(approval.status)) {
                  <button
                    mat-raised-button
                    color="primary"
                    (click)="downloadSession(approval)"
                  >
                    <mat-icon>download</mat-icon>
                    Скачать
                  </button>
                }

                <button
                  mat-raised-button
                  color="accent"
                  [disabled]="!canApproveAll(approval)"
                  (click)="approveAll(approval)"
                  matTooltip="{{ canApproveAll(approval) ? 'Одобрить все фотографии' : 'Необходимо просмотреть все фотографии' }}"
                >
                  <mat-icon>check_circle</mat-icon>
                  Одобрить все
                </button>
              </mat-card-actions>
            </mat-card>
          }
        </div>
      } @else {
        @if (!isLoading() && !error()) {
          <div class="no-approvals">
            <mat-icon class="empty-icon">check_circle</mat-icon>
            <p>У вас пока нет согласований фотографий</p>
            <button mat-raised-button color="primary" routerLink="/user-profile/orders">
              История заказов
            </button>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .approval-list-container {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .page-title {
      font-size: 24px;
      font-weight: 500;
      margin-bottom: 20px;
      color: #333;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      gap: 16px;
    }

    .error-message {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background-color: #7f1d1d;
      border-radius: 4px;
      margin-bottom: 20px;
      gap: 8px;
    }

    .no-approvals {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      text-align: center;
      gap: 16px;
    }

    .empty-icon {
      font-size: 48px;
      height: 48px;
      width: 48px;
      color: #9e9e9e;
    }

    .approvals-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .approval-card {
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      transition: box-shadow 0.3s ease;
    }

    .approval-card:hover {
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    }

    .approval-icon {
      background-color: #673ab7;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .status-badge {
      margin-left: auto;
    }

    .approval-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-top: 16px;
    }

    .photo-count {
      display: flex;
      align-items: center;
      gap: 8px;
      color: rgba(0, 0, 0, 0.6);
    }

    .progress-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .progress-label {
      color: rgba(0, 0, 0, 0.6);
      white-space: nowrap;
    }

    .progress-bar {
      flex: 1;
      height: 8px;
      background-color: var(--ed-surface-container-high, #222);
      border-radius: 4px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background-color: #4caf50;
      border-radius: 4px;
    }

    .progress-text {
      min-width: 40px;
      text-align: right;
      color: rgba(0, 0, 0, 0.6);
    }

    .deadline-text {
      margin-left: 8px;
    }

    .deadline-warning {
      color: #f44336;
      font-weight: 500;
    }

    .photo-previews {
      display: flex;
      gap: 8px;
      margin-top: 16px;
      overflow-x: auto;
      padding-bottom: 8px;
    }

    .photo-preview {
      position: relative;
      width: 80px;
      height: 80px;
      border-radius: 4px;
      overflow: hidden;
      flex-shrink: 0;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      transition: transform 0.2s ease;
    }

    .photo-preview:hover {
      transform: scale(1.05);
    }

    .photo-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .photo-status-icon {
      position: absolute;
      bottom: 0;
      right: 0;
      background-color: rgba(0, 0, 0, 0.6);
      border-top-left-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
    }

    .photo-preview.approved .photo-status-icon {
      color: #4caf50;
    }

    .photo-preview.has-annotations .photo-status-icon {
      color: #ff9800;
    }

    /* Стили для статусов */
    .status-pending {
      background-color: #ff9800;
      color: white;
    }

    .status-partial {
      background-color: #2196f3;
      color: white;
    }

    .status-approved {
      background-color: #4caf50;
      color: white;
    }

    .status-rejected {
      background-color: #f44336;
      color: white;
    }

    .status-revision {
      background-color: #9c27b0;
      color: white;
    }

    mat-card-actions {
      padding: 16px;
    }

    @media (max-width: 600px) {
      .approval-list-container {
        padding: 12px;
      }

      .approval-content {
        flex-direction: column;
      }
    }
  `
})
export class PhotoApprovalListComponent implements OnInit {
  private photoApprovalService = inject(PhotoApprovalService);
  private orderHistoryService = inject(OrderHistoryService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  // Сигналы
  approvals = this.photoApprovalService.pendingApprovals;
  isLoading = this.photoApprovalService.isLoading;
  error = this.photoApprovalService.error;

  // Кеш для информации о заказах
  private orderCache = new Map<string, OrderHistory>();

  ngOnInit() {
    this.loadApprovals();
  }

  /**
   * Загрузить список заказов на одобрение
   */
  loadApprovals() {
    this.photoApprovalService.getClientApprovals().subscribe({
      next: () => {
        // Данные загружены через сигнал
      },
      error: () => {
        this.snackBar.open('Не удалось загрузить заказы на одобрение', 'Закрыть', {
          duration: 5000,
          panelClass: 'error-snackbar'
        });
      }
    });
  }

  /**
   * Получить заголовок для карточки заказа
   */
  getOrderTitle(approval: PhotoApproval): string {
    const order = this.orderCache.get(approval.orderId);
    if (order) {
      switch (order.orderType) {
        case 'photo_session':
          return order.photoSession?.title || 'Фотосессия';
        case 'photo_editing':
          return 'Ретушь и обработка фотографий';
        case 'photo_restoration':
          return 'Реставрация фотографий';
        default:
          return 'Заказ на обработку фотографий';
      }
    }
    return 'Заказ на обработку фотографий';
  }

  /**
   * Получить класс для статуса
   */
  getStatusClass(status: ApprovalStatus): string {
    switch (status) {
      case ApprovalStatus.PENDING:
        return 'status-pending';
      case ApprovalStatus.PARTIALLY_APPROVED:
        return 'status-partial';
      case ApprovalStatus.APPROVED:
        return 'status-approved';
      case ApprovalStatus.REJECTED:
        return 'status-rejected';
      case ApprovalStatus.NEEDS_REVISION:
        return 'status-revision';
      default:
        return '';
    }
  }

  /**
   * Получить текст статуса
   */
  getStatusText(status: ApprovalStatus): string {
    switch (status) {
      case ApprovalStatus.PENDING:
        return 'Ожидает подтверждения';
      case ApprovalStatus.PARTIALLY_APPROVED:
        return 'Частично одобрено';
      case ApprovalStatus.APPROVED:
        return 'Одобрено';
      case ApprovalStatus.REJECTED:
        return 'Отклонено';
      case ApprovalStatus.NEEDS_REVISION:
        return 'Требуется доработка';
      default:
        return 'Неизвестный статус';
    }
  }

  /**
   * Получить прогресс одобрения в процентах
   */
  getApprovalProgress(approval: PhotoApproval): number {
    if (approval.photos.length === 0) return 0;

    const reviewed = approval.photos.filter(p => p.approved || p.annotations.length > 0).length;
    return Math.round((reviewed / approval.photos.length) * 100);
  }

  /**
   * Проверить, скоро ли истекает срок одобрения
   */
  isDeadlineApproaching(approval: PhotoApproval): boolean {
    if (!approval.requestDeadline) return false;

    const now = new Date();
    const deadline = new Date(approval.requestDeadline);
    const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return diffDays <= 2;
  }

  /**
   * Получить фотографии для предпросмотра (максимум 5)
   */
  getPreviewPhotos(approval: PhotoApproval) {
    return approval.photos.slice(0, 5);
  }

  /**
   * Можно ли одобрить все фотографии сразу
   */
  canApproveAll(approval: PhotoApproval): boolean {
    // Можно одобрить все, если прогресс просмотра 100%
    return this.getApprovalProgress(approval) === 100;
  }

  /**
   * Перейти на страницу проверки фотографий
   */
  viewApproval(approval: PhotoApproval) {
    this.router.navigate(['/user-profile/photo-approval', approval.id]);
  }

  /**
   * Проверить, доступен ли статус для скачивания
   */
  isDownloadableStatus(status: ApprovalStatus): boolean {
    return status === ApprovalStatus.APPROVED || status === ApprovalStatus.PARTIALLY_APPROVED;
  }

  /**
   * Скачать фото сессии
   */
  downloadSession(approval: PhotoApproval) {
    this.photoApprovalService.getSessionDownloadLinks(approval.id).subscribe({
      next: (res) => {
        if (res.photos.length === 0) {
          this.snackBar.open('Нет доступных фотографий для скачивания', 'Закрыть', { duration: 3000 });
          return;
        }
        for (const photo of res.photos) {
          const a = document.createElement('a');
          a.href = photo.url;
          a.download = '';
          a.click();
        }
      },
      error: () => {
        this.snackBar.open('Не удалось получить ссылки для скачивания', 'Закрыть', {
          duration: 5000,
          panelClass: 'error-snackbar'
        });
      }
    });
  }

  /**
   * Одобрить все фотографии
   */
  approveAll(approval: PhotoApproval) {
    if (!this.canApproveAll(approval)) {
      this.snackBar.open('Необходимо просмотреть все фотографии перед одобрением', 'Закрыть', {
        duration: 3000
      });
      return;
    }

    this.photoApprovalService.approveAll(approval.id).subscribe({
      next: () => {
        this.snackBar.open('Все фотографии успешно одобрены', 'Закрыть', {
          duration: 3000
        });
      },
      error: () => {
        this.snackBar.open('Не удалось одобрить фотографии', 'Закрыть', {
          duration: 5000,
          panelClass: 'error-snackbar'
        });
      }
    });
  }
}
