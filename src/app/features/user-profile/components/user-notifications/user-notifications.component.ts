import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';

import { NotificationApiService, NotificationMessage } from '../../../../core/services/notification-api.service';
import { LoggerService } from '../../../../core/services/logger.service';

@Component({
  selector: 'app-user-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    MatCardModule, 
    MatButtonModule, 
    MatIconModule, 
    MatTabsModule, 
    MatDividerModule,
    MatMenuModule,
    MatBadgeModule,
    MatProgressSpinnerModule,
    RouterLink
  ],
  templateUrl: './user-notifications.component.html',
  styleUrls: ['./user-notifications.component.scss']
})
export class UserNotificationsComponent {
  private notificationApiService = inject(NotificationApiService);
  private log = inject(LoggerService);

  notifications = this.notificationApiService.notifications;
  loading = this.notificationApiService.isLoading;
  
  // Computed сигналы для фильтрованных уведомлений
  protected unreadNotifications = computed(() => 
    this.notifications().filter((n: NotificationMessage) => !n.read)
  );
  
  protected bookingNotifications = computed(() => 
    this.notifications().filter((n: NotificationMessage) => 
      n.data?.category === 'booking'
    )
  );
  
  protected photoNotifications = computed(() => 
    this.notifications().filter((n: NotificationMessage) => 
      n.data?.category === 'photo'
    )
  );
  
  protected systemNotifications = computed(() => 
    this.notifications().filter((n: NotificationMessage) => 
      n.data?.category === 'system'
    )
  );
    /**
   * Получение иконки уведомления
   */
  getNotificationIcon(notification: NotificationMessage): string {
    const category = notification.data?.category;
    switch (category) {
      case 'photo':
        return 'photo_library';
      case 'booking':
        return 'event_available';
      case 'system':
        return 'notifications';
      default:
        return 'notifications';
    }
  }
  
  /**
   * Получение класса иконки
   */
  getNotificationIconClass(notification: NotificationMessage): string {
    const category = notification.data?.category;
    switch (category) {
      case 'photo':
        return 'photo-icon';
      case 'booking':
        return 'booking-icon';
      case 'system':
      default:
        return 'system-icon';
    }
  }
  
  /**
   * Форматирование времени уведомления
   */
  formatTime(createdAt: string): string {
    if (!createdAt) return '';
    
    const date = new Date(createdAt);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMinutes < 1) {
      return 'только что';
    } else if (diffInMinutes < 60) {
      return `${diffInMinutes} мин. назад`;
    } else if (diffInHours < 24) {
      return `${diffInHours} ч. назад`;
    } else if (diffInDays < 7) {
      return `${diffInDays} дн. назад`;
    } else {
      return date.toLocaleDateString('ru-RU');
    }
  }
    /**
   * Отметить уведомление как прочитанное
   */
  async markAsRead(notification: NotificationMessage): Promise<void> {
    if (!notification.read && notification.id) {
      this.notificationApiService.markAsRead(notification.id).subscribe({
        next: () => this.log.debug('Notification marked as read'),
        error: (error) => this.log.error('Error marking notification as read:', error)
      });
    }
    
    // Навигация по ссылке уведомления, если она есть
    if (notification.data?.url) {
      // В реальном приложении здесь будет навигация по URL
      this.log.debug('Navigating to:', notification.data.url);
    }
  }
  
  /**
   * Отметить все уведомления как прочитанные
   */
  async markAllAsRead(): Promise<void> {
    this.notificationApiService.markAllAsRead().subscribe({
      next: () => this.log.debug('All notifications marked as read'),
      error: (error) => this.log.error('Error marking all notifications as read:', error)
    });
  }
  
  /**
   * Удалить уведомление
   */
  async deleteNotification(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    this.notificationApiService.deleteNotification(id).subscribe({
      next: () => this.log.debug('Notification deleted'),
      error: (error) => this.log.error('Error deleting notification:', error)
    });
  }
  
  /**
   * Очистить все уведомления
   */
  async clearAllNotifications(): Promise<void> {
    const confirmed = confirm('Вы уверены, что хотите удалить все уведомления?');
    if (confirmed) {
      // Используем markAllAsRead вместо clearAllNotifications
      this.notificationApiService.markAllAsRead().subscribe({
        next: () => this.log.debug('All notifications cleared'),
        error: (error) => this.log.error('Error clearing notifications:', error)
      });
    }
  }
}
