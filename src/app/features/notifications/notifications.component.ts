import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { LoggerService } from '../../core/services/logger.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { Router } from '@angular/router';
import { NotificationService, NotificationMessage } from '../../core/services/notification.service';

@Component({
  selector: 'app-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatChipsModule,
    MatMenuModule
  ],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss'
})
export class NotificationsComponent {
  private notificationService = inject(NotificationService);
  private log = inject(LoggerService);
  private router = inject(Router);

  notifications = this.notificationService.notifications;
  unreadCount = this.notificationService.unreadCount;

  selectedFilter = 'all';
  filterOptions = [
    { value: 'all', label: 'Все', icon: 'list' },
    { value: 'unread', label: 'Непрочитанные', icon: 'mark_email_unread' },
    { value: 'booking', label: 'Записи', icon: 'calendar_today' },
    { value: 'payment', label: 'Платежи', icon: 'payment' },
    { value: 'gallery', label: 'Галерея', icon: 'photo_library' },
    { value: 'system', label: 'Система', icon: 'info' },
    { value: 'promotion', label: 'Акции', icon: 'local_offer' }
  ];
  protected filteredNotifications = computed(() => {
    const notifications = this.notifications();
    
    switch (this.selectedFilter) {
      case 'unread':
        return notifications.filter(n => !n.read);
      case 'all':
        return notifications;
      default:
        return notifications.filter(n => n.type === this.selectedFilter);
    }
  });

  trackByNotificationId(_index: number, notification: NotificationMessage): string {
    return notification.id;
  }

  getNotificationIcon(type: string): string {
    const iconMap: Record<string, string> = {
      'booking': 'calendar_today',
      'payment': 'payment',
      'gallery': 'photo_library',
      'system': 'info',
      'promotion': 'local_offer'
    };
    return iconMap[type] || 'notifications';
  }

  getNotificationIconClass(type: string): string {
    return `notification-icon-${type}`;
  }

  formatDate(date: Date): string {
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'только что';
    if (diffInMinutes < 60) return `${diffInMinutes} мин назад`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} ч назад`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return 'вчера';
    if (diffInDays < 7) return `${diffInDays} дня назад`;
    
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  markAsRead(notification: NotificationMessage): void {
    this.notificationService.markAsRead(notification.id);
  }

  markAllAsRead(): void {
    this.notificationService.markAllAsRead();
  }

  deleteNotification(notification: NotificationMessage): void {
    this.notificationService.deleteNotification(notification.id);
  }
  handleNotificationClick(notification: NotificationMessage): void {
    // Отмечаем как прочитанное при клике
    if (!notification.read) {
      this.markAsRead(notification);
    }

    // Навигация по типу уведомления
    if (notification.data?.actionUrl) {
      this.router.navigateByUrl(notification.data.actionUrl);
      return;
    }

    const data = notification.data || {};
    switch (notification.type) {
      case 'task_assigned':
      case 'task_handoff':
      case 'task_urgent':
      case 'task_deadline':
      case 'colleague_note':
        if (data['taskId']) this.router.navigate(['/employee/tasks', data['taskId']]);
        break;
      case 'order_status':
        if (data['orderId']) this.router.navigate(['/order-tracking'], { queryParams: { id: data['orderId'] } });
        break;
      case 'booking_update':
        this.router.navigate(['/profile/bookings']);
        break;
      case 'retouch_approval':
        if (data['sessionId']) this.router.navigate(['/gallery', data['sessionId']]);
        break;
      case 'shift_briefing':
      case 'shift_reminder':
        this.router.navigate(['/employee']);
        break;
    }
  }

  setFilter(filter: string): void {
    this.selectedFilter = filter;
  }

  getFilteredCount(filterValue: string): number {
    if (filterValue === 'all') {
      return this.notifications().length;
    }
    if (filterValue === 'unread') {
      return this.unreadCount();
    }
    return this.notifications().filter(n => n.type === filterValue).length;
  }
}
