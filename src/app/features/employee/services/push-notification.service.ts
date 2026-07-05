import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SwPush, SwUpdate } from '@angular/service-worker';
import { firstValueFrom, filter } from 'rxjs';
import { LoggerService } from '../../../core/services/logger.service';

/**
 * Web Push Notification Service — подписка на серверные push-уведомления.
 * Использует Angular SwPush для подписки через ngsw-worker.js.
 * При обновлении SW (VERSION_READY) автоматически переподписывается.
 */
@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private readonly http = inject(HttpClient);
  private readonly swPush = inject(SwPush);
  private readonly swUpdate = inject(SwUpdate);
  private readonly log = inject(LoggerService);
  private subscribed = false;

  constructor() {
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.pipe(
        filter(event => event.type === 'VERSION_READY')
      ).subscribe(() => {
        if (this.subscribed) {
          this.log.debug('[Push] SW updated, re-subscribing...');
          this.subscribed = false;
          this.subscribe().catch(() => undefined);
        }
      });
    }
  }

  /**
   * Запрашивает разрешение и подписывается на push-уведомления.
   * Вызывать при входе сотрудника.
   */
  async subscribe(): Promise<boolean> {
    if (this.subscribed) return true;
    if (!this.swPush.isEnabled) {
      this.log.warn('[Push] SwPush not enabled');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this.log.debug('[Push] Permission denied');
        return false;
      }

      const { publicKey } = await firstValueFrom(
        this.http.get<{ publicKey: string }>('/api/notifications/push/vapid-key')
      );
      if (!publicKey) {
        this.log.warn('[Push] No VAPID public key');
        return false;
      }

      const subscription = await this.swPush.requestSubscription({ serverPublicKey: publicKey });

      await firstValueFrom(
        this.http.post('/api/notifications/push/subscribe', { subscription: subscription.toJSON() })
      );

      this.subscribed = true;
      this.log.debug('[Push] Subscribed successfully');
      return true;
    } catch (err) {
      this.log.error('[Push] Subscribe error:', err);
      return false;
    }
  }

  /**
   * Отписаться от push-уведомлений.
   */
  async unsubscribe(): Promise<void> {
    try {
      const subscription = await firstValueFrom(this.swPush.subscription);
      if (subscription) {
        await firstValueFrom(
          this.http.delete('/api/notifications/push/unsubscribe', { body: { endpoint: subscription.endpoint } })
        );
        await this.swPush.unsubscribe();
      }
      this.subscribed = false;
    } catch (err) {
      this.log.error('[Push] Unsubscribe error:', err);
    }
  }
}
