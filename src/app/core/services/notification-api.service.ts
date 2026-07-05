import { Injectable, inject, signal, computed, effect, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of, firstValueFrom, from } from 'rxjs';
import { tap, catchError, switchMap } from 'rxjs/operators';
import { SwPush } from '@angular/service-worker';
import { ApiResponse, PaginatedResponse, PaginationParams } from './api.service';
import { WebSocketService, NotificationPayload } from './websocket.service';
import { ToastService } from './toast.service';

export type NotificationType = 'info' | 'warning' | 'error' | 'success' | 'photo_ready' | 'session_uploaded' | 'feedback_request' | 'booking_confirmation' | 'booking_reminder' | 'special_offer' | 'system' | 'task_assigned' | 'task_handoff' | 'task_urgent' | 'task_deadline' | 'colleague_note' | 'order_status' | 'booking_update' | 'retouch_approval' | 'shift_briefing' | 'shift_reminder';

export interface NotificationData {
  actionUrl?: string;
  category?: string;
  url?: string;
  [key: string]: unknown;
}

export interface NotificationMessage {
  id: string;
  title: string;
  body: string;
  data?: NotificationData;
  timestamp: string;
  read: boolean;
  userId: string;
  type: NotificationType;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationSettings {
  id?: string;
  userId: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  bookingReminders: boolean;
  bookingConfirmation: boolean;
  specialOffers: boolean;
  systemUpdates: boolean;
  orderStatus: boolean;
  printReady: boolean;
  promotionalMessages: boolean;
  preferredDeliveryTime: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateNotificationRequest {
  title: string;
  body: string;
  type: NotificationType;
  userId?: string;
  userIds?: string[];
  data?: NotificationData;
  scheduleAt?: string;
}

export interface NotificationFilters {
  type?: string;
  read?: boolean;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface PushSubscription {
  userId: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  createdAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationApiService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly swPush = inject(SwPush);
  private readonly wsService = inject(WebSocketService);
  private readonly toastService = inject(ToastService);
  private readonly apiUrl = `/api/notifications`;

  private readonly _seenNotificationIds = new Set<string>();

  // Сигналы состояния
  private notificationsSignal = signal<NotificationMessage[]>([]);
  private settingsSignal = signal<NotificationSettings | null>(null);
  private pushPermissionSignal = signal<NotificationPermission>('default');
  private isLoadingSignal = signal<boolean>(false);
  private errorSignal = signal<string | null>(null);

  // Readonly signals
  public readonly notifications = this.notificationsSignal.asReadonly();
  public readonly settings = this.settingsSignal.asReadonly();
  public readonly pushPermission = this.pushPermissionSignal.asReadonly();
  public readonly isLoading = this.isLoadingSignal.asReadonly();
  public readonly error = this.errorSignal.asReadonly();

  // Computed свойства
  public readonly unreadCount = computed(() =>
    this.notifications().filter(n => !n.read).length
  );

  public readonly hasUnreadNotifications = computed(() =>
    this.unreadCount() > 0
  );

  public readonly recentNotifications = computed(() =>
    this.notifications()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10)
  );

  public readonly isPushEnabled = computed(() =>
    this.pushPermission() === 'granted' && this.settings()?.pushNotifications
  );
  constructor() {
    // Проверяем поддержку push-уведомлений только в браузере
    if (isPlatformBrowser(this.platformId) && 'Notification' in window) {
      this.pushPermissionSignal.set(Notification.permission);
    }

    // Real-time: new notification push via WS
    effect(() => {
      const notif = this.wsService.newNotification();
      if (!notif || !isPlatformBrowser(this.platformId)) return;
      if (this._seenNotificationIds.has(notif.id)) return;
      this._seenNotificationIds.add(notif.id);

      const mapped: NotificationMessage = this.mapPayloadToMessage(notif);
      this.notificationsSignal.update(list => {
        if (list.some(n => n.id === mapped.id)) return list;
        return [mapped, ...list];
      });

      this.toastService.info(notif.title);

      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        try {
          new Notification(notif.title, {
            body: notif.body,
            icon: '/web-app-manifest-192x192.png',
            badge: '/favicon-96x96.png',
          });
        } catch { /* ignore */ }
      }
    });

    // Real-time: notification count hint — fetch list if local is empty
    effect(() => {
      const count = this.wsService.notificationCount();
      if (count === null || !isPlatformBrowser(this.platformId)) return;
      if (this.notificationsSignal().length === 0 && count > 0) {
        this.getNotifications({ page: 1, limit: 50 }).subscribe({
          error: () => { /* swallow — error already captured in signal */ },
        });
      }
    });
  }

  private mapPayloadToMessage(payload: NotificationPayload): NotificationMessage {
    return {
      id: payload.id,
      title: payload.title,
      body: payload.body,
      type: payload.type as NotificationType,
      data: payload.data as NotificationData | undefined,
      userId: payload.userId ?? '',
      read: payload.read ?? false,
      timestamp: payload.createdAt,
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
    };
  }

  /**
   * Получить уведомления пользователя
   */
  getNotifications(params?: PaginationParams & NotificationFilters): Observable<PaginatedResponse<NotificationMessage>> {
    this.isLoadingSignal.set(true);
    let httpParams = new HttpParams();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }

    return this.http.get<PaginatedResponse<NotificationMessage>>(this.apiUrl, { params: httpParams }).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.notificationsSignal.set(response.data);
        }
        this.isLoadingSignal.set(false);
      }),
      catchError(error => {
        this.isLoadingSignal.set(false);
        this.errorSignal.set(error.message || 'Failed to load notifications');
        return of({ success: false, data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 }, error: error.message });
      })
    );
  }

  /**
   * Получить настройки уведомлений
   */
  getNotificationSettings(): Observable<ApiResponse<NotificationSettings>> {
    return this.http.get<ApiResponse<NotificationSettings>>(`${this.apiUrl}/settings`).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.settingsSignal.set(response.data);
        }
      }),
      catchError(error => {
        this.errorSignal.set(error.message || 'Failed to load settings');
        return of({ success: false, error: error.message });
      })
    );
  }

  /**
   * Обновить настройки уведомлений
   */
  updateNotificationSettings(settings: Partial<NotificationSettings>): Observable<ApiResponse<NotificationSettings>> {
    return this.http.put<ApiResponse<NotificationSettings>>(`${this.apiUrl}/settings`, settings).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.settingsSignal.set(response.data);
        }
      }),
      catchError(error => {
        this.errorSignal.set(error.message || 'Failed to update settings');
        return of({ success: false, error: error.message });
      })
    );
  }

  /**
   * Отметить уведомление как прочитанное
   */
  markAsRead(notificationId: string): Observable<ApiResponse<NotificationMessage>> {
    return this.http.put<ApiResponse<NotificationMessage>>(`${this.apiUrl}/${notificationId}/read`, {}).pipe(
      tap(response => {
        if (response.success) {
          this.notificationsSignal.update(notifications =>
            notifications.map(n => n.id === notificationId ? { ...n, read: true } : n)
          );
        }
      }),
      catchError(error => {
        this.errorSignal.set(error.message || 'Failed to mark as read');
        return of({ success: false, error: error.message });
      })
    );
  }

  /**
   * Отметить все уведомления как прочитанные
   */
  markAllAsRead(): Observable<ApiResponse<void>> {
    return this.http.put<ApiResponse<void>>(`${this.apiUrl}/read-all`, {}).pipe(
      tap(response => {
        if (response.success) {
          this.notificationsSignal.update(notifications =>
            notifications.map(n => ({ ...n, read: true }))
          );
        }
      }),
      catchError(error => {
        this.errorSignal.set(error.message || 'Failed to mark all as read');
        return of({ success: false, error: error.message });
      })
    );
  }

  /**
   * Удалить уведомление
   */
  deleteNotification(notificationId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.apiUrl}/${notificationId}`).pipe(
      tap(response => {
        if (response.success) {
          this.notificationsSignal.update(notifications =>
            notifications.filter(n => n.id !== notificationId)
          );
        }
      }),
      catchError(error => {
        this.errorSignal.set(error.message || 'Failed to delete notification');
        return of({ success: false, error: error.message });
      })
    );
  }

  /**
   * Создать уведомление (только для администраторов)
   */
  createNotification(notification: CreateNotificationRequest): Observable<ApiResponse<NotificationMessage>> {
    return this.http.post<ApiResponse<NotificationMessage>>(this.apiUrl, notification).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.addNotification(response.data);
        }
      }),
      catchError(error => {
        this.errorSignal.set(error.message || 'Failed to create notification');
        return of({ success: false, error: error.message });
      })
    );
  }
  /**
   * Запросить разрешение на push-уведомления
   */
  async requestPushPermission(): Promise<NotificationPermission> {
    if (!isPlatformBrowser(this.platformId) || !('Notification' in window)) {
      throw new Error('Push-уведомления не поддерживаются браузером');
    }

    const permission = await Notification.requestPermission();
    this.pushPermissionSignal.set(permission);

    if (permission === 'granted') {
      await firstValueFrom(this.subscribeToPush());
    }

    return permission;
  }

  /**
   * Подписка на push-уведомления через SwPush (ngsw)
   */
  subscribeToPush(): Observable<ApiResponse<void>> {
    if (!isPlatformBrowser(this.platformId) || !this.swPush.isEnabled) {
      return of({ success: false, error: 'Push not available' });
    }

    return from(
      firstValueFrom(this.http.get<{ publicKey: string }>(`${this.apiUrl}/push/vapid-key`))
    ).pipe(
      switchMap(({ publicKey }) =>
        from(this.swPush.requestSubscription({ serverPublicKey: publicKey }))
      ),
      switchMap(subscription =>
        this.http.post<ApiResponse<void>>(`${this.apiUrl}/push/subscribe`, {
          subscription: subscription.toJSON(),
        })
      ),
      catchError(error => of({ success: false, error: error.message }))
    );
  }

  /**
   * Отписка от push-уведомлений
   */
  unsubscribeFromPush(): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.apiUrl}/push/unsubscribe`).pipe(
      catchError(error => {
        this.errorSignal.set(error.message || 'Failed to unsubscribe');
        return of({ success: false, error: error.message });
      })
    );
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
    return this.http.get<ApiResponse<{
      total: number;
      unread: number;
      byType: Record<string, number>;
      recent: number;
    }>>(`${this.apiUrl}/stats`).pipe(
      catchError(error => {
        this.errorSignal.set(error.message || 'Failed to load stats');
        return of({
          success: false,
          error: error.message,
          data: { total: 0, unread: 0, byType: {}, recent: 0 }
        });
      })
    );
  }

  // Утилиты
  private updateNotificationInList(updatedNotification: NotificationMessage): void {
    this.notificationsSignal.update(notifications =>
      notifications.map(n =>
        n.id === updatedNotification.id ? updatedNotification : n
      )
    );
  }

  /**
   * Очистить состояние
   */
  clearState(): void {
    this.notificationsSignal.set([]);
    this.settingsSignal.set(null);
  }

  /**
   * Добавить новое уведомление в список (для real-time обновлений)
   */
  addNotification(notification: NotificationMessage): void {
    this.notificationsSignal.update(notifications => [notification, ...notifications]);
  }

  /**
   * Показать браузерное уведомление
   */
  showBrowserNotification(title: string, options?: NotificationOptions): void {
    if (this.pushPermission() === 'granted') {
      new Notification(title, {
        icon: '/web-app-manifest-192x192.png',
        badge: '/favicon-96x96.png',
        ...options
      });
    }
  }

  /**
   * Форматировать время уведомления
   */
  formatNotificationTime(timestamp: string | Date): string {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) {
      return 'только что';
    } else if (minutes < 60) {
      return `${minutes} ${this.pluralize(minutes, 'минуту', 'минуты', 'минут')} назад`;
    } else if (hours < 24) {
      return `${hours} ${this.pluralize(hours, 'час', 'часа', 'часов')} назад`;
    } else if (days < 7) {
      return `${days} ${this.pluralize(days, 'день', 'дня', 'дней')} назад`;
    } else {
      return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    }
  }

  /**
   * Очистить все уведомления
   */
  clearAllNotifications(): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.apiUrl}/all`).pipe(
      tap(response => {
        if (response.success) {
          this.notificationsSignal.set([]);
        }
      }),
      catchError(error => {
        this.errorSignal.set(error.message || 'Failed to clear all notifications');
        return of({ success: false, error: error.message });
      })
    );
  }

  /**
   * Вспомогательный метод для склонения слов
   */
  private pluralize(count: number, one: string, few: string, many: string): string {
    const mod10 = count % 10;
    const mod100 = count % 100;

    if (mod10 === 1 && mod100 !== 11) {
      return one;
    } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
      return few;
    } else {
      return many;
    }
  }
}
