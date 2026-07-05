import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class BadgeService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly supported: boolean;

  constructor() {
    this.supported =
      isPlatformBrowser(this.platformId) &&
      'setAppBadge' in navigator;
  }

  /** Устанавливает бейдж на иконке PWA (непрочитанные сообщения и т.д.) */
  setBadge(count: number): void {
    if (!this.supported) return;
    if (count > 0) {
      navigator.setAppBadge(count).catch(() => {/* permission denied — ignore */});
    } else {
      this.clearBadge();
    }
  }

  /** Убирает бейдж с иконки PWA */
  clearBadge(): void {
    if (!this.supported) return;
    navigator.clearAppBadge().catch(() => {/* ignore */});
  }
}
