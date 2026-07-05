import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { NotificationApiService, NotificationMessage } from '../../../core/services/notification-api.service';
import { LoggerService } from '../../../core/services/logger.service';

type Notification = NotificationMessage;

@Component({
  selector: 'app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, 
    MatBadgeModule, 
    MatButtonModule, 
    MatIconModule, 
    MatMenuModule, 
    MatDividerModule,
    MatTooltipModule,
    RouterLink
  ],
  template: `
    <button mat-icon-button
            [matMenuTriggerFor]="notificationMenu"
            [matBadge]="unreadCount()"
            [matBadgeHidden]="unreadCount() === 0"
            matBadgeColor="warn"
            matTooltip="Уведомления"
            (click)="preventClose($event)">
      <mat-icon>notifications</mat-icon>
    </button>

    <mat-menu #notificationMenu="matMenu" class="notification-menu" xPosition="before">
      <div class="notification-header" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">
        <h3>Уведомления</h3>
        <div class="notification-header-actions">
          @if (unreadCount() > 0) {
            <button mat-button
                    (click)="markAllAsRead()">
              Отметить все как прочитанные
            </button>
          }
          @if (notifications().length > 0) {
            <button mat-icon-button
                    matTooltip="Очистить все уведомления"
                    (click)="clearAllNotifications()">
              <mat-icon>delete_sweep</mat-icon>
            </button>
          }
        </div>
      </div>
      
      <mat-divider></mat-divider>
      
      <div class="notification-container" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">
        @if (notifications().length > 0) {
          @for (notification of notifications(); track notification.id || $index) {
            <div class="notification-item" [class.unread]="!notification.read">
              <div class="notification-icon">
                <mat-icon [class]="getNotificationIconClass(notification)">{{ getNotificationIcon(notification) }}</mat-icon>
              </div>
              <div class="notification-content" (click)="markAsRead(notification)" (keydown.enter)="markAsRead(notification)" tabindex="0">
                <h4>{{ notification.title }}</h4>
                <p>{{ notification.body }}</p>
                <span class="notification-time">{{ formatTime(notification.createdAt) }}</span>
              </div>
              <button mat-icon-button class="notification-delete" (click)="deleteNotification(notification.id)">
                <mat-icon>close</mat-icon>
              </button>
            </div>
          }
        } @else {
          <div class="no-notifications">
            <mat-icon>notifications_off</mat-icon>
            <p>У вас нет новых уведомлений</p>
          </div>
        }
      </div>
      
      <mat-divider></mat-divider>
      
      <div class="notification-footer" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">
        <button mat-button routerLink="/user-profile/account">
          Все уведомления
        </button>
        <button mat-icon-button matTooltip="Настройки" routerLink="/user-profile/account">
          <mat-icon>settings</mat-icon>
        </button>
      </div>
    </mat-menu>
  `,
  styles: [`
    .notification-menu {
      max-width: 350px;
      max-height: 500px;
    }
      .notification-header,
    .notification-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 16px;
      background-color: #f5f5f5;

      h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
      }
      
      .notification-header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
    }
    
    .notification-container {
      max-height: 300px;
      overflow-y: auto;
      padding: 0;
    }
    
    .notification-item {
      display: flex;
      padding: 12px 16px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      transition: background-color 0.2s;

      &:hover {
        background-color: var(--ed-surface-container-high, #222);
      }

      &.unread {
        background-color: rgba(245, 158, 11, 0.05);
      }
    }
    
    .notification-icon {
      margin-right: 12px;
      
      mat-icon {
        color: #757575;
        
        &.photo-icon {
          color: #4caf50;
        }
        
        &.booking-icon {
          color: #2196f3;
        }
        
        &.system-icon {
          color: #ff9800;
        }
        
        &.feedback-icon {
          color: #9c27b0;
        }
      }
    }
    
    .notification-content {
      flex: 1;
      cursor: pointer;
      
      h4 {
        margin: 0 0 4px;
        font-size: 14px;
        font-weight: 500;
      }
      
      p {
        margin: 0 0 4px;
        font-size: 14px;
        color: #666;
      }
      
      .notification-time {
        font-size: 12px;
        color: #999;
      }
    }
    
    .notification-delete {
      opacity: 0.5;
      transition: opacity 0.2s;
      
      &:hover {
        opacity: 1;
      }
    }
    
    .no-notifications {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 32px 16px;
      color: #999;
      
      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
      }
      
      p {
        text-align: center;
        margin: 0;
      }
    }
  `]
})
export class NotificationBellComponent {
  private notificationService = inject(NotificationApiService);
  private log = inject(LoggerService);
  
  notifications = this.notificationService.notifications;
  unreadCount = this.notificationService.unreadCount;
  
  // Предотвращение закрытия меню при клике на кнопку
  preventClose(event: MouseEvent): void {
    event.stopPropagation();
  }
  
  // Получение иконки в зависимости от типа уведомления
  getNotificationIcon(notification: Notification): string {
    // Маппинг расширенных типов к базовым для иконок
    const typeMap: Record<string, string> = {
      'photo_ready': 'photo_library',
      'session_uploaded': 'cloud_upload',
      'feedback_request': 'rate_review',
      'booking_confirmation': 'event_available',
      'booking_reminder': 'alarm',
      'special_offer': 'local_offer',
      'system': 'notifications',
      'info': 'info',
      'warning': 'warning',
      'error': 'error',
      'success': 'check_circle'
    };
    
    return typeMap[notification.type] || 'notifications';
  }
  
  // Получение класса для стилизации иконки
  getNotificationIconClass(notification: Notification): string {
    // Маппинг расширенных типов к классам
    const classMap: Record<string, string> = {
      'photo_ready': 'photo-icon',
      'session_uploaded': 'photo-icon',
      'booking_confirmation': 'booking-icon',
      'booking_reminder': 'booking-icon',
      'feedback_request': 'feedback-icon',
      'system': 'system-icon',
      'special_offer': 'system-icon',
      'info': 'info-icon',
      'warning': 'warning-icon',
      'error': 'error-icon',
      'success': 'success-icon'
    };
    
    return classMap[notification.type] || 'system-icon';
  }
  
  // Форматирование времени уведомления
  formatTime(createdAt: string | Date): string {
    return this.notificationService.formatNotificationTime(createdAt);
  }
  
  // Отметить уведомление как прочитанное
  async markAsRead(notification: Notification): Promise<void> {
    if (!notification.read) {
      await this.notificationService.markAsRead(notification.id);
    }
    
    // Навигация по ссылке уведомления, если она есть
    if (notification.data?.url) {
      // В реальном приложении здесь будет навигация по URL
      this.log.debug('Navigating to:', notification.data.url);
    }
  }
  
  // Отметить все уведомления как прочитанные
  async markAllAsRead(): Promise<void> {
    await this.notificationService.markAllAsRead();
  }
  
  // Удалить уведомление
  async deleteNotification(id: string): Promise<void> {
    await this.notificationService.deleteNotification(id);
  }
  
  // Очистить все уведомления
  async clearAllNotifications(): Promise<void> {
    const confirmed = confirm('Вы уверены, что хотите удалить все уведомления?');
    if (confirmed) {
      await this.notificationService.clearAllNotifications();
    }
  }
}
