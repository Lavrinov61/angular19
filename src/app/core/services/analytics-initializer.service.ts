import { Injectable, inject, PLATFORM_ID, Injector, NgZone } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService } from './logger.service';

/**
 * Безопасный инициализатор для аналитики без циклических зависимостей
 * Используется для предотвращения NG0200 ошибок при SSR
 */
@Injectable({
  providedIn: 'root'
})
export class AnalyticsInitializerService {
  private isInitialized = false;
  private platformId = inject(PLATFORM_ID);
  private injector = inject(Injector);
  private ngZone = inject(NgZone);
  private log = inject(LoggerService);

  /**
   * Безопасная инициализация аналитики только в браузере
   */
  async initialize(): Promise<void> {
    if (this.isInitialized || !isPlatformBrowser(this.platformId)) {
      return;
    }

    try {      // Динамически импортируем сервисы только в браузере
      if (isPlatformBrowser(this.platformId) && typeof window !== 'undefined') {
        // Ждем немного, чтобы все основные сервисы загрузились
        // Выносим setTimeout из Angular zone для предотвращения ошибок SSR
        await new Promise(resolve => 
          this.ngZone.runOutsideAngular(() => setTimeout(resolve, 100))
        );
        
        // Динамически импортируем типы сервисов
        const { GoalTrackingService } = await import('./goal-tracking.service');
        const { WebVitalsService } = await import('./web-vitals.service');
        
        // Получаем инстансы через injector
        const goalTracking = this.injector.get(GoalTrackingService);
        const webVitals = this.injector.get(WebVitalsService);
          // Конфигурируем аналитику
        goalTracking.configure({
          gtag: true,
          facebookPixel: false,
          debug: isPlatformBrowser(this.platformId) &&
                 typeof window !== 'undefined' && 
                 window.location.hostname === 'localhost'
        });
        
        // Инициализируем Web Vitals
        await webVitals.initialize();
        
        this.isInitialized = true;
        this.log.debug('Analytics safely initialized in browser');
      }
    } catch (error) {
      this.log.warn('Analytics initialization failed:', error);
      // Fail silently - analytics is not critical for app functionality
    }
  }

  /**
   * Проверка, инициализирован ли сервис
   */
  get initialized(): boolean {
    return this.isInitialized;
  }
}
