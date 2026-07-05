// Сервис для определения производительности устройства и адаптации анимаций
import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { LoggerService } from './logger.service';

export enum PerformanceLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}

@Injectable({
  providedIn: 'root'
})
export class DevicePerformanceService {
  // Signal для уровня производительности
  private _performanceLevel = signal<PerformanceLevel>(PerformanceLevel.HIGH);
  
  // Публичный readonly signal
  readonly performanceLevel = this._performanceLevel.asReadonly();
  
  // Computed signals
  readonly isLowPerformance = computed(() => this._performanceLevel() === PerformanceLevel.LOW);
  readonly isMediumPerformance = computed(() => this._performanceLevel() === PerformanceLevel.MEDIUM);
  readonly isHighPerformance = computed(() => this._performanceLevel() === PerformanceLevel.HIGH);
  
  // Legacy Observable API для обратной совместимости
  public readonly performanceLevel$: Observable<PerformanceLevel> = toObservable(this.performanceLevel);
  
  // Признак предпочтения уменьшенной анимации
  private prefersReducedMotion = false;

  private platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService);
  
  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.detectPerformanceLevel();
      this.detectReducedMotionPreference();
      
      // Обновляем уровень производительности при изменении системных настроек
      this.listenForReducedMotionChanges();
    }
  }
  /**
   * Определяет уровень производительности устройства на основе доступных API
   */
  private detectPerformanceLevel(): void {
    if (!isPlatformBrowser(this.platformId)) {
      // На сервере устанавливаем средний уровень производительности
      this._performanceLevel.set(PerformanceLevel.MEDIUM);
      return;
    }

    // Определяем количество логических процессоров
    const cpuCores = navigator.hardwareConcurrency || 4;
    
    // Определяем доступную память (если API доступен)
    const memory = 'deviceMemory' in navigator ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4 : 4;
    
    // Определяем поддержку мобильной связи как индикатор мобильного устройства
    const isMobileConnection = 'connection' in navigator &&
      (navigator as Navigator & { connection?: { type?: string } }).connection?.type === 'cellular';
    
    // Логика определения уровня производительности
    if (cpuCores <= 2 || memory <= 2 || (isMobileConnection && memory <= 4)) {
      this._performanceLevel.set(PerformanceLevel.LOW);
    } else if (cpuCores <= 4 || memory <= 4) {
      this._performanceLevel.set(PerformanceLevel.MEDIUM);
    } else {
      this._performanceLevel.set(PerformanceLevel.HIGH);
    }
    
    this.log.debug(`Detected device performance level: ${this._performanceLevel()}`);
    this.log.debug(`Device info: CPU cores: ${cpuCores}, Memory: ${memory}GB`);
  }
    /**
   * Определяет предпочтение пользователя по уменьшению анимаций 
   */
  private detectReducedMotionPreference(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (window.matchMedia) {
      // Проверяем сохраненное предпочтение пользователя
      const savedPreference = localStorage.getItem('prefersReducedMotion');
      
      if (savedPreference === 'true') {
        this.prefersReducedMotion = true;
        this._performanceLevel.set(PerformanceLevel.LOW);
        this.log.debug('User manually disabled animations. Setting performance level to LOW.');
        return;
      }
      
      this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      
      if (this.prefersReducedMotion) {
        // Если пользователь предпочитает уменьшение анимации, устанавливаем низкий уровень
        // производительности независимо от возможностей устройства
        this._performanceLevel.set(PerformanceLevel.LOW);
        this.log.debug('User prefers reduced motion. Setting performance level to LOW.');
      }
    }
  }
    /**
   * Отслеживает изменения в предпочтении пользователя по уменьшению анимаций
   */
  private listenForReducedMotionChanges(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (window.matchMedia) {
      const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      
      // Современный способ подписки на изменения (для новых браузеров)
      if ('addEventListener' in motionQuery) {
        motionQuery.addEventListener('change', (e) => {
          this.prefersReducedMotion = e.matches;
          if (this.prefersReducedMotion) {
            this._performanceLevel.set(PerformanceLevel.LOW);
          } else {
            // Переопределяем уровень производительности
            this.detectPerformanceLevel(); 
          }
        });
      } 
      // Поддержка старых браузеров
      else if ('addListener' in motionQuery) {
        (motionQuery as MediaQueryList & { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener((e: MediaQueryListEvent) => {
          this.prefersReducedMotion = e.matches;
          if (this.prefersReducedMotion) {
            this._performanceLevel.set(PerformanceLevel.LOW);
          } else {
            this.detectPerformanceLevel();
          }
        });
      }
    }
  }
  
  /**
   * Получает текущий уровень производительности
   */
  public getCurrentPerformanceLevel(): PerformanceLevel {
    return this._performanceLevel();
  }
  
  /**
   * Проверяет, предпочитает ли пользователь уменьшение анимации
   */
  public isPrefersReducedMotion(): boolean {
    return this.prefersReducedMotion;
  }
  
  /**
   * Проверяет, является ли устройство низкопроизводительным
   */
  public isLowPerformanceDevice(): boolean {
    return this._performanceLevel() === PerformanceLevel.LOW;
  }
    /**
   * Сохраняет предпочтение пользователя по уменьшению анимаций
   * @param reduceMotion Должны ли анимации быть уменьшены
   */
  public setUserPreference(reduceMotion: boolean): void {
    this.prefersReducedMotion = reduceMotion;
    
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('prefersReducedMotion', reduceMotion.toString());
    }
    
    if (reduceMotion) {
      this._performanceLevel.set(PerformanceLevel.LOW);
    } else {
      this.detectPerformanceLevel();
    }
  }
}
