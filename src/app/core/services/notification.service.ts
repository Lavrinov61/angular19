import { Injectable, inject } from '@angular/core';
import { NotificationApiService, NotificationMessage, NotificationSettings, CreateNotificationRequest, NotificationFilters } from './notification-api.service';
import { Observable } from 'rxjs';
import { ApiResponse, PaginatedResponse, PaginationParams } from './api.service';

// Re-export для компонентов
export type { NotificationMessage, NotificationSettings, CreateNotificationRequest, NotificationFilters } from './notification-api.service';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private notificationApiService = inject(NotificationApiService);

  // Делегируем все сигналы к API сервису
  readonly notifications = this.notificationApiService.notifications;
  readonly settings = this.notificationApiService.settings;
  readonly pushPermission = this.notificationApiService.pushPermission;
  readonly isLoading = this.notificationApiService.isLoading;
  readonly error = this.notificationApiService.error;
  readonly unreadCount = this.notificationApiService.unreadCount;
  readonly hasUnreadNotifications = this.notificationApiService.hasUnreadNotifications;
  readonly recentNotifications = this.notificationApiService.recentNotifications;
  readonly isPushEnabled = this.notificationApiService.isPushEnabled;

  /**
   * Получить уведомления пользователя
   */
  getNotifications(params?: PaginationParams & NotificationFilters): Observable<PaginatedResponse<NotificationMessage>> {
    return this.notificationApiService.getNotifications(params);
  }

  /**
   * Получить настройки уведомлений
   */
  getNotificationSettings(): Observable<ApiResponse<NotificationSettings>> {
    return this.notificationApiService.getNotificationSettings();
  }

  /**
   * Обновить настройки уведомлений
   */
  updateNotificationSettings(settings: Partial<NotificationSettings>): Observable<ApiResponse<NotificationSettings>> {
    return this.notificationApiService.updateNotificationSettings(settings);
  }

  /**
   * Отметить уведомление как прочитанное
   */
  markAsRead(notificationId: string): Observable<ApiResponse<NotificationMessage>> {
    return this.notificationApiService.markAsRead(notificationId);
  }

  /**
   * Отметить все уведомления как прочитанные
   */
  markAllAsRead(): Observable<ApiResponse<void>> {
    return this.notificationApiService.markAllAsRead();
  }

  /**
   * Удалить уведомление
   */
  deleteNotification(notificationId: string): Observable<ApiResponse<void>> {
    return this.notificationApiService.deleteNotification(notificationId);
  }

  /**
   * Создать уведомление (только для администраторов)
   */
  createNotification(notification: CreateNotificationRequest): Observable<ApiResponse<NotificationMessage>> {
    return this.notificationApiService.createNotification(notification);
  }

  /**
   * Запросить разрешение на push-уведомления
   */
  async requestPushPermission(): Promise<NotificationPermission> {
    return this.notificationApiService.requestPushPermission();
  }

  /**
   * Подписка на push-уведомления
   */
  subscribeToPush(): Observable<ApiResponse<void>> {
    return this.notificationApiService.subscribeToPush();
  }

  /**
   * Отписка от push-уведомлений
   */
  unsubscribeFromPush(): Observable<ApiResponse<void>> {
    return this.notificationApiService.unsubscribeFromPush();
  }

  /**
   * Получить статистику уведомлений
   */
  getNotificationStats(): Observable<ApiResponse<{
    total: number;
    unread: number;
    byType: Record<string, number>;
    recent: number;
  }>> {
    return this.notificationApiService.getNotificationStats();
  }

  /**
   * Показать браузерное уведомление
   */
  showBrowserNotification(title: string, options?: NotificationOptions): void {
    this.notificationApiService.showBrowserNotification(title, options);
  }

  /**
   * Очистить состояние
   */
  clearState(): void {
    this.notificationApiService.clearState();
  }

  /**
   * Добавить новое уведомление в список (для real-time обновлений)
   */
  addNotification(notification: NotificationMessage): void {
    this.notificationApiService.addNotification(notification);
  }
}
