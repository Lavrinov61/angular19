import { Component, input, inject, computed, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatRippleModule } from '@angular/material/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, Router } from '@angular/router';
import { NotificationService, NotificationMessage } from '../../services/notification.service';

@Component({
  selector: 'app-notification-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
    MatRippleModule,
    MatBadgeModule,
    MatTooltipModule,
    RouterLink
],  template: `
    <div class="notification-menu-container" [class.clickable]="showLabel()">
      <div 
        #menuTrigger="matMenuTrigger"
        [matMenuTriggerFor]="notificationMenu"
        class="notification-menu-wrapper"
        [matTooltip]="!showLabel() ? 'Уведомления' : ''"
        matTooltipPosition="above"
        [attr.aria-label]="'Уведомления' + (unreadCount() > 0 ? ' (' + unreadCount() + ' новых)' : '')"
        aria-haspopup="menu">
        <button 
          mat-icon-button
          class="notification-menu-button"
          [matBadge]="unreadCount()"
          [matBadgeHidden]="unreadCount() === 0"
          matBadgeColor="accent"
          matBadgeSize="small">
          <mat-icon>notifications</mat-icon>
        </button>
        
        @if (showLabel()) {
          <span class="notification-menu-label">
            Уведомления
            @if (unreadCount() > 0) {
              <span class="unread-count">({{ unreadCount() }})</span>
            }
          </span>
        }
      </div>
    </div>

    <mat-menu #notificationMenu="matMenu" class="notification-menu" [hasBackdrop]="true" xPosition="before">
      <div class="notification-header">
        <h3>Уведомления</h3>
        @if (unreadCount() > 0) {
          <button 
            mat-icon-button
            (click)="markAllAsRead(); $event.stopPropagation()"
            [attr.aria-label]="'Отметить все как прочитанные'"
            [matTooltip]="'Отметить все как прочитанные'"
            class="mark-all-read-btn">
            <mat-icon>done_all</mat-icon>
          </button>
        }
      </div>
      
      <mat-divider />
      
      <div class="notification-list" role="menu">
        @if (recentNotifications().length > 0) {
          @for (notification of recentNotifications(); track trackByNotificationId($index, notification)) {
            <div
              mat-menu-item
              class="notification-item"
              [class.unread]="!notification.read"
              (click)="handleNotificationClick(notification)"
              (keydown.enter)="handleNotificationClick(notification)"
              tabindex="0"
              role="menuitem"
              [attr.aria-label]="notification.title + (notification.read ? '' : ' (непрочитано)')"
              [attr.aria-pressed]="false">
              <div class="notification-icon">
                <mat-icon [class]="getNotificationIconClass(notification.type)">
                  {{ getNotificationIcon(notification.type) }}
                </mat-icon>
              </div>
              <div class="notification-content">
                <div class="notification-title">{{ notification.title }}</div>
                <div class="notification-message">{{ notification.body }}</div>
                <div class="notification-time">{{ getRelativeTime(notification.timestamp) }}</div>
              </div>
              @if (!notification.read) {
                <div class="notification-actions">
                  <button 
                    mat-icon-button
                    (click)="markAsReadAndStopPropagation(notification, $event)"
                    [attr.aria-label]="'Отметить уведомление ' + notification.title + ' как прочитанное'"
                    [matTooltip]="'Отметить как прочитанное'"
                    class="mark-read-btn">
                    <mat-icon>check</mat-icon>
                  </button>
                </div>
              }
            </div>
          }
        } @else {
          <div class="no-notifications" role="status" aria-live="polite">
            <mat-icon>notifications_none</mat-icon>
            <span>Нет новых уведомлений</span>
          </div>
        }
      </div>
      
      @if (recentNotifications().length > 0) {
        <mat-divider />
      }
      
      <button mat-menu-item routerLink="/notifications" class="view-all-btn" [attr.aria-label]="'Посмотреть все уведомления'">
        <mat-icon>list</mat-icon>
        <span>Посмотреть все уведомления</span>
      </button>
    </mat-menu>
  `,
  styleUrl: './notification-menu.component.scss'
})
export class NotificationMenuComponent {
  showLabel = input<boolean>(false);

  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  notifications = this.notificationService.notifications;
  unreadCount = this.notificationService.unreadCount;

  // Показываем только последние 5 уведомлений в меню
  protected recentNotifications = computed(() => 
    this.notifications().slice(0, 5)
  );

  trackByNotificationId(index: number, notification: NotificationMessage): string {
    return notification.id || `notification-${index}`;
  }

  getNotificationIcon(type: string): string {
    const iconMap: Record<string, string> = {
      'booking': 'calendar_today',
      'payment': 'payment',
      'gallery': 'photo_library',
      'info': 'info',
      'warning': 'warning',
      'error': 'error',
      'success': 'check_circle',
      'promotion': 'local_offer'
    };
    return iconMap[type] || 'notifications';
  }

  getNotificationIconClass(type: string): string {
    return `notification-icon-${type}`;
  }
  
  getRelativeTime(timestamp: string | Date | { toDate(): Date }): string {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp instanceof Date ? timestamp : timestamp.toDate();
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'только что';
    if (diffInMinutes < 60) return `${diffInMinutes} мин назад`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} ч назад`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays} д назад`;
    
    return date.toLocaleDateString('ru-RU');
  }

  markAsRead(notificationId: string): void {
    this.notificationService.markAsRead(notificationId);
  }
  
  markAsReadAndStopPropagation(notification: NotificationMessage, event: Event): void {
    event.stopPropagation();
    if (notification.id) {
      this.markAsRead(notification.id);
    }
  }
  markAllAsRead(): void {
    this.notificationService.markAllAsRead();
  }

  handleNotificationClick(notification: NotificationMessage): void {
    // Отмечаем как прочитанное при клике
    if (!notification.read && notification.id) {
      this.markAsRead(notification.id);
    }    // Переходим по ссылке, если есть в data
    if (notification.data?.actionUrl) {
      if (notification.data.actionUrl.startsWith('http')) {
        // Внешняя ссылка - открываем в новой вкладке
        if (isPlatformBrowser(this.platformId)) {
          window.open(notification.data.actionUrl, '_blank', 'noopener,noreferrer');
        }
      } else {
        // Внутренняя ссылка - используем Angular Router
        this.router.navigateByUrl(notification.data.actionUrl);
      }
    }
  }
}
