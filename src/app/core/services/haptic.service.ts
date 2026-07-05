import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Паттерны вибрации для разных типов обратной связи.
 * Числа — миллисекунды: [вибрация, пауза, вибрация, ...]
 */
const PATTERNS = {
  tap: [10],
  success: [10, 50, 10],
  error: [50, 30, 50, 30, 50],
  notification: [20, 80, 20],
  celebration: [10, 30, 10, 30, 10, 30, 30, 50, 30],
  shutter: [15],
} as const;

@Injectable({ providedIn: 'root' })
export class HapticService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly supported: boolean;

  constructor() {
    this.supported =
      isPlatformBrowser(this.platformId) &&
      'vibrate' in navigator;
  }

  /** Лёгкий тактильный отклик для нажатий */
  tap(): void {
    this.vibrate(PATTERNS.tap);
  }

  /** Успешное действие (одобрение, сохранение) */
  success(): void {
    this.vibrate(PATTERNS.success);
  }

  /** Ошибка или отклонение */
  error(): void {
    this.vibrate(PATTERNS.error);
  }

  /** Входящее уведомление */
  notification(): void {
    this.vibrate(PATTERNS.notification);
  }

  /** Праздничный момент (level-up, достижение) */
  celebration(): void {
    this.vibrate(PATTERNS.celebration);
  }

  /** Затвор камеры (съёмка фото) */
  shutter(): void {
    this.vibrate(PATTERNS.shutter);
  }

  private vibrate(pattern: readonly number[]): void {
    if (!this.supported) return;
    navigator.vibrate([...pattern]);
  }
}
