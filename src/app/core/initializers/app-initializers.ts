/**
 * Файл с логикой для инициализации сервисов на уровне приложения
 * Используется в app.config.ts
 */

import { inject } from '@angular/core';
import { GoalTrackingService } from '../services/goal-tracking.service';
import { GeolocationService } from '../services/geolocation.service';
import { WebVitalsService } from '../services/web-vitals.service';
import { AnalyticsInitializerService } from '../services/analytics-initializer.service';
import { LoggerService } from '../services/logger.service';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';

/**
 * Безопасная инициализация сервиса аналитики без циклических зависимостей
 * @returns Функция для APP_INITIALIZER
 */
export function initializeAnalyticsSafe() {
  const analyticsInitializer = inject(AnalyticsInitializerService);
  const log = inject(LoggerService);

  return () => {
    // Инициализируем асинхронно в браузере
    analyticsInitializer.initialize().catch(error => {
      log.warn('Failed to initialize analytics:', error);
    });

    // Возвращаем промис, который сразу резолвится
    // чтобы не блокировать загрузку приложения
    log.debug('Analytics initializer scheduled');
    return Promise.resolve();
  };
}

/**
 * Безопасная инициализация сервиса геолокации  
 * @returns Функция для APP_INITIALIZER
 */
export function initializeGeolocationSafe() {
  const platformId = inject(PLATFORM_ID);
  const log = inject(LoggerService);

  return () => {
    // Только проверяем поддержку геолокации, без создания сервиса
    if (isPlatformBrowser(platformId) && typeof navigator !== 'undefined') {
      const isSupported = !!navigator.geolocation;
      log.debug('Geolocation support check:', isSupported);
    }

    log.debug('Geolocation service check completed');
    return Promise.resolve();
  };
}

/**
 * Инициализация сервиса аналитики (СТАРАЯ ВЕРСИЯ - ОТКЛЮЧЕНА)
 * @returns Функция для APP_INITIALIZER
 */
export function initializeAnalytics() {
  const analyticsService = inject(GoalTrackingService);
  const webVitalsService = inject(WebVitalsService);
  const platformId = inject(PLATFORM_ID);
  const log = inject(LoggerService);

  return () => {
    // Глобальная конфигурация аналитики для всего приложения
    analyticsService.configure({
      gtag: true,
      facebookPixel: false,
      debug: isPlatformBrowser(platformId) &&
             typeof window !== 'undefined' &&
             window.location.hostname === 'localhost'
    });

    // Инициализируем отслеживание Web Vitals если мы в браузере
    if (isPlatformBrowser(platformId)) {
      webVitalsService.initialize()
        .then(() => log.debug('Web Vitals tracking initialized'))
        .catch(err => log.error('Failed to initialize Web Vitals tracking', err));
    }

    log.debug('Analytics service initialized at application level');
    return Promise.resolve();
  };
}

/**
 * Инициализация сервиса геолокации (СТАРАЯ ВЕРСИЯ - ОТКЛЮЧЕНА) 
 * @returns Функция для APP_INITIALIZER
 */
export function initializeGeolocation() {
  const geolocationService = inject(GeolocationService);
  const log = inject(LoggerService);

  return () => {
    // Проверяем поддержку геолокации при инициализации приложения
    // Реальный запрос позиции пользователя будет происходить только
    // при явном вызове getCurrentPosition()
    geolocationService.checkGeolocationSupport();

    log.debug('Geolocation service initialized at application level');
    return Promise.resolve();
  };
}
