import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toObservable } from '@angular/core/rxjs-interop';
import { LoggerService } from './logger.service';

/**
 * Сервис для управления Service Worker с поддержкой Firebase Auth
 * Обеспечивает автоматическую передачу ID токенов на сервер
 */
@Injectable({
  providedIn: 'root'
})
export class ServiceWorkerService {
  // Signals для состояния
  private _isSupported = signal<boolean>(false);
  private _isRegistered = signal<boolean>(false);
  private _registration: ServiceWorkerRegistration | null = null;

  // Публичные readonly signals
  readonly isSupported = this._isSupported.asReadonly();
  readonly isRegistered = this._isRegistered.asReadonly();
  
  // Computed signals
  readonly isReady = computed(() => this._isSupported() && this._isRegistered());

  // Legacy Observable API для обратной совместимости
  readonly isSupported$ = toObservable(this.isSupported);
  readonly isRegistered$ = toObservable(this.isRegistered);

  private platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService);
  
  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this._isSupported.set('serviceWorker' in navigator);
    }
  }

  /**
   * Регистрирует Service Worker для Firebase Auth
   * Должен вызываться на странице входа/регистрации
   */
  async registerServiceWorker(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      this.log.debug('Service Worker: Регистрация пропущена - серверная среда');
      return;
    }

    if (!('serviceWorker' in navigator)) {
      this.log.warn('Service Worker: Не поддерживается в этом браузере');
      return;
    }

    try {
      this.log.debug('Service Worker: Начинается регистрация...');
      
      this._registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      this.log.debug('Service Worker: Успешно зарегистрирован', this._registration);
      this._isRegistered.set(true);

      // Обработка обновлений Service Worker
      this._registration.addEventListener('updatefound', () => {
        this.log.debug('Service Worker: Найдено обновление');
        const newWorker = this._registration!.installing;
        
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                this.log.debug('Service Worker: Новая версия доступна');
                // Можно показать уведомление о необходимости обновления
              } else {
                this.log.debug('Service Worker: Готов к работе в оффлайн режиме');
              }
            }
          });
        }
      });

    } catch (error) {
      this.log.error('Service Worker: Ошибка регистрации:', error);
      this._isRegistered.set(false);
    }
  }

  /**
   * Отменяет регистрацию Service Worker
   */
  async unregisterServiceWorker(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !this._registration) {
      return;
    }

    try {
      const unregistered = await this._registration.unregister();
      if (unregistered) {
        this.log.debug('Service Worker: Успешно отменена регистрация');
        this._isRegistered.set(false);
        this._registration = null;
      }
    } catch (error) {
      this.log.error('Service Worker: Ошибка отмены регистрации:', error);
    }
  }
  /**
   * Проверяет статус аутентификации через Service Worker
   */
  async checkAuthStatus(): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId) || !navigator.serviceWorker.controller) {
      return false;
    }

    return new Promise((resolve) => {
      const messageChannel = new MessageChannel();
      
      messageChannel.port1.onmessage = (event) => {
        if (event.data.type === 'AUTH_STATUS_RESPONSE') {
          resolve(event.data.authenticated);
        }
      };

      // Проверяем что controller все еще доступен
      const controller = navigator.serviceWorker.controller;
      if (controller) {
        controller.postMessage(
          { type: 'CHECK_AUTH_STATUS' },
          [messageChannel.port2]
        );
      } else {
        resolve(false);
        return;
      }

      // Timeout через 5 секунд
      setTimeout(() => resolve(false), 5000);
    });
  }

  /**
   * Получает текущую регистрацию Service Worker
   */
  getRegistration(): ServiceWorkerRegistration | null {
    return this._registration;
  }

  /**
   * Принудительно обновляет Service Worker
   */
  async updateServiceWorker(): Promise<void> {
    if (!this._registration) {
      return;
    }

    try {
      await this._registration.update();
      this.log.debug('Service Worker: Обновление запрошено');
    } catch (error) {
      this.log.error('Service Worker: Ошибка обновления:', error);
    }
  }
}
