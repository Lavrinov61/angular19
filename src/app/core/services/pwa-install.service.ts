import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private platformId = inject(PLATFORM_ID);
  private deferredPrompt: Event | null = null;

  /** true, когда можно показать кнопку «Установить» */
  canInstall = signal(false);

  /** true после того как пользователь установил или закрыл промпт */
  dismissed = signal(false);

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    // Показываем баннер только со 2-го визита
    const visits = Number(localStorage.getItem('sf_visits') || '0') + 1;
    localStorage.setItem('sf_visits', String(visits));
    if (visits < 2) return;

    // Уже установлено
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Уже отклонено в этой сессии
    if (sessionStorage.getItem('sf_pwa_dismissed')) return;

    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.canInstall.set(true);
    });
  }

  async promptInstall(): Promise<boolean> {
    if (!this.deferredPrompt) return false;
    const prompt = this.deferredPrompt as BeforeInstallPromptEvent;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    this.deferredPrompt = null;
    this.canInstall.set(false);
    this.dismissed.set(true);
    return outcome === 'accepted';
  }

  dismiss(): void {
    this.canInstall.set(false);
    this.dismissed.set(true);
    if (isPlatformBrowser(this.platformId)) {
      sessionStorage.setItem('sf_pwa_dismissed', '1');
    }
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
