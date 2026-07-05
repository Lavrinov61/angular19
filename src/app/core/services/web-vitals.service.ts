import { Injectable, PLATFORM_ID, inject, DOCUMENT } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { GoalTrackingService } from './goal-tracking.service';
import { LoggerService } from './logger.service';

// Типы для Web Vitals
export interface WebVitalMetric {
  name: 'CLS' | 'FID' | 'LCP' | 'FCP' | 'TTFB' | 'INP';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  id: string;
  navigationType?: string;
}

interface WebVitalsLibrary {
  onCLS?: (callback: (metric: WebVitalMetric) => void) => void;
  onFID?: (callback: (metric: WebVitalMetric) => void) => void;
  onLCP?: (callback: (metric: WebVitalMetric) => void) => void;
  onFCP?: (callback: (metric: WebVitalMetric) => void) => void;
  onTTFB?: (callback: (metric: WebVitalMetric) => void) => void;
  onINP?: (callback: (metric: WebVitalMetric) => void) => void;
  [key: string]: unknown;
}

/** Window with optional webVitals property set by the IIFE script */
interface WindowWithWebVitals extends Window {
  webVitals?: WebVitalsLibrary;
}

@Injectable({
  providedIn: 'root'
})
export class WebVitalsService {
  private log = inject(LoggerService);
  private readonly goalTrackingService = inject(GoalTrackingService, { optional: true });
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private isInitialized = false;
  private enabledInProduction = true;
  private enabledInDevelopment = true;

  /**
   * Инициализирует отслеживание Web Vitals метрик
   */
  public initialize(): Promise<void> {
    if (this.isInitialized || !isPlatformBrowser(this.platformId)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      // Динамически загружаем web-vitals библиотеку только в браузере
      this.loadWebVitalsLibrary()
        .then(webVitals => {
          if (webVitals) {
            // Устанавливаем обработчики для каждой метрики
            this.setupWebVitalsReporting(webVitals);
            this.isInitialized = true;
            this.log.debug('Web Vitals tracking initialized');
          }
          resolve();
        })
        .catch(error => {
          this.log.error('Failed to load Web Vitals library', error);
          resolve();
        });
    });
  }

  /**
   * Загружает библиотеку web-vitals динамически
   */
  private loadWebVitalsLibrary(): Promise<WebVitalsLibrary | null> {
    return new Promise((resolve, reject) => {
      if (!isPlatformBrowser(this.platformId)) {
        resolve(null);
        return;
      }

      // Проверяем, нужно ли загружать библиотеку в текущем окружении
      const isDevelopment = window.location.hostname === 'localhost' ||
                           window.location.hostname === '127.0.0.1';

      if ((isDevelopment && !this.enabledInDevelopment) ||
          (!isDevelopment && !this.enabledInProduction)) {
        this.log.debug('Web Vitals tracking is disabled in this environment');
        resolve(null);
        return;
      }

      // Если библиотека уже загружена, используем её
      const win = this.getTypedWindow();
      if (win.webVitals) {
        resolve(win.webVitals);
        return;
      }

      // Динамически загружаем библиотеку
      const script = this.document.createElement('script');
      script.src = 'https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js';
      script.async = true;
      script.onload = () => {
        resolve(this.getTypedWindow().webVitals ?? null);
      };
      script.onerror = (error) => {
        reject(error);
      };

      this.document.head.appendChild(script);
    });
  }

  /** Access window with webVitals type */
  private getTypedWindow(): WindowWithWebVitals {
    return window;
  }

  /**
   * Настраивает отчёты о Web Vitals
   */
  private setupWebVitalsReporting(webVitals: WebVitalsLibrary): void {
    const vitalsToTrack = ['CLS', 'FID', 'LCP', 'FCP', 'TTFB', 'INP'];

    vitalsToTrack.forEach(metric => {
      const handler = webVitals[`on${metric}`];
      if (typeof handler === 'function') {
        (handler as (cb: (result: WebVitalMetric) => void) => void)((result: WebVitalMetric) => {
          this.reportWebVital(result);
        });
      }
    });
  }

  /**
   * Отправляет отчёт о метрике в аналитику
   */
  private reportWebVital(metric: WebVitalMetric): void {
    // Определяем рейтинг для более понятного отображения
    const ratingLabel = metric.rating === 'good'
      ? 'Хорошо'
      : (metric.rating === 'needs-improvement' ? 'Требует улучшения' : 'Плохо');

    // Форматируем значение для удобочитаемости
    let formattedValue = metric.value;
    if (metric.name === 'CLS') {
      formattedValue = Number(metric.value.toFixed(3));
    } else if (['FID', 'LCP', 'FCP', 'TTFB', 'INP'].includes(metric.name)) {
      formattedValue = Math.round(metric.value);
    }
      // Отправляем данные в сервис аналитики только если он доступен
    if (this.goalTrackingService) {
      this.goalTrackingService.trackCustomEvent(`web_vital_${metric.name.toLowerCase()}`, {
        metric_name: metric.name,
        metric_value: formattedValue,
        metric_delta: metric.delta,
        metric_rating: metric.rating,
        metric_rating_label: ratingLabel,
        navigation_type: metric.navigationType || 'unknown'
      });
    }

    // Для отладки
    this.log.debug(`Web Vital: ${metric.name} = ${formattedValue} (${ratingLabel})`);
  }

  /**
   * Включает или отключает отслеживание в production
   */
  public enableForProduction(enable: boolean): void {
    this.enabledInProduction = enable;
  }

  /**
   * Включает или отключает отслеживание в development
   */
  public enableForDevelopment(enable: boolean): void {
    this.enabledInDevelopment = enable;
  }
}
