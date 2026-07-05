import { Component, inject, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { PhotoApiService } from '../../../../core/services/photo-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { 
  PhotoPermission, 
  PermissionStatus, 
  PermissionPurpose, 
  PermissionType 
} from '../../../../core/models/photo-permission.model';
import { SignatureDialogComponent } from '../signature-dialog/signature-dialog.component';

@Component({
  selector: 'app-photo-permissions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatDividerModule,
    MatExpansionModule,
    MatBadgeModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSnackBarModule
  ],
  templateUrl: './photo-permissions.component.html',
  styleUrls: ['./photo-permissions.component.scss']
})
export class PhotoPermissionsComponent implements OnInit {
  private photoApiService = inject(PhotoApiService);
  private authService = inject(AuthService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
    // Signals
  permissions = this.photoApiService.permissions;
  isLoading = this.photoApiService.isLoading;
  error = this.photoApiService.error;
  
  ngOnInit() {
    this.loadPermissions();
  }
    /**
   * Загрузить разрешения пользователя
   */
  loadPermissions() {
    const user = this.authService.user();
    if (!user) {
      return;
    }

    const userId = user.id || user.uid;
    if (!userId) {
      return;
    }

    this.photoApiService.getUserPermissions(userId).subscribe({
      next: () => { /* permissions loaded */ },
      error: () => { /* silently ignore */ }
    });
  }
    /**
   * Одобрить разрешение с подписью
   */
  approvePermission(permission: PhotoPermission) {
    const dialogRef = this.dialog.open(SignatureDialogComponent, {
      width: '600px',
      data: { permission }
    });
    
    dialogRef.afterClosed().subscribe(result => {
      if (result && result.signatureImage) {
        this.photoApiService.signPermission(permission.id, result.signatureImage).subscribe({
          next: (response) => {
            if (response.success) {
              this.snackBar.open('Разрешение успешно подписано', 'Закрыть', { duration: 3000 });
              this.loadPermissions();
            }
          },
          error: () => {
            this.snackBar.open('Ошибка при подписании разрешения', 'Закрыть', { duration: 3000 });
          }
        });
      }
    });
  }
  
  /**
   * Отклонить разрешение
   */
  declinePermission(permission: PhotoPermission) {
    const comments = 'Отклонено пользователем';
    
    this.photoApiService.updatePermissionStatus(
      permission.id, 
      PermissionStatus.DECLINED, 
      comments
    ).subscribe({
      next: (response) => {
        if (response.success) {
          this.snackBar.open('Разрешение отклонено', 'Закрыть', { duration: 3000 });
          this.loadPermissions();
        }
      },
      error: () => {
        this.snackBar.open('Ошибка при отклонении разрешения', 'Закрыть', { duration: 3000 });
      }
    });
  }
  
  /**
   * Отозвать разрешение
   */
  revokePermission(permission: PhotoPermission) {
    const reason = 'Отозвано пользователем';
    
    this.photoApiService.revokePermission(permission.id, reason).subscribe({
      next: (response) => {
        if (response.success) {
          this.snackBar.open('Разрешение отозвано', 'Закрыть', { duration: 3000 });
          this.loadPermissions();
        }
      },
      error: () => {
        this.snackBar.open('Ошибка при отзыве разрешения', 'Закрыть', { duration: 3000 });
      }
    });
  }
  
  /**
   * Получить заголовок разрешения
   */
  getPermissionTitle(permission: PhotoPermission): string {
    switch (permission.type) {
      case PermissionType.ALL_PHOTOS:
        return 'Все ваши фотографии';
      case PermissionType.SESSION:
        return 'Фотографии фотосессии';
      case PermissionType.SPECIFIC_PHOTOS:
        return `Выбранные фотографии (${permission.photoIds?.length || 0})`;
      default:
        return 'Разрешение на использование фотографий';
    }
  }
  
  /**
   * Получить CSS класс для статуса
   */
  getStatusClass(status: PermissionStatus): string {
    return `status-${status}`;
  }
  
  /**
   * Получить текст статуса
   */
  getStatusText(status: PermissionStatus): string {
    switch (status) {
      case PermissionStatus.PENDING:
        return 'Ожидает подтверждения';
      case PermissionStatus.APPROVED:
        return 'Одобрено';
      case PermissionStatus.DECLINED:
        return 'Отклонено';
      case PermissionStatus.EXPIRED:
        return 'Срок истек';
      case PermissionStatus.REVOKED:
        return 'Отозвано';
      default:
        return 'Неизвестный статус';
    }
  }
  
  /**
   * Получить текст цели использования
   */
  getPurposeText(purpose: PermissionPurpose): string {
    switch (purpose) {
      case PermissionPurpose.ADVERTISING:
        return 'Реклама';
      case PermissionPurpose.PORTFOLIO:
        return 'Портфолио';
      case PermissionPurpose.SOCIAL_MEDIA:
        return 'Соцсети';
      case PermissionPurpose.PRINT_MEDIA:
        return 'Печатные издания';
      case PermissionPurpose.WEBSITE:
        return 'Веб-сайт';
      case PermissionPurpose.COMPETITIONS:
        return 'Конкурсы';
      case PermissionPurpose.EDUCATIONAL:
        return 'Обучение';
      default:
        return purpose;
    }
  }
  
  /**
   * Форматировать дату
   */
  formatDate(date?: Date): string {
    if (!date) return '';
    return new DatePipe('ru-RU').transform(date, 'dd.MM.yyyy') || '';
  }
}
