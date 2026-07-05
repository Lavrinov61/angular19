import { Injectable, signal, computed, inject, DOCUMENT, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type Theme = 'dark';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private document = inject(DOCUMENT);
  private platformId = inject(PLATFORM_ID);

  private _theme = signal<Theme>('dark');

  readonly theme = this._theme.asReadonly();

  readonly isDark = computed(() => true);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.applyTheme();
    }
  }

  setTheme(_theme: Theme): void {
    // Всегда dark — ничего не меняем
  }

  toggleTheme(): void {
    // Переключение отключено — только тёмная тема
  }

  applyCurrentTheme(): void {
    this.applyTheme();
  }

  private applyTheme(): void {
    if (!isPlatformBrowser(this.platformId) || !this.document) return;

    const html = this.document.documentElement;
    html.classList.add('dark-theme');
    html.classList.remove('light-theme');
    html.setAttribute('data-theme', 'dark');
    html.style.colorScheme = 'dark';

    const body = this.document.body;
    if (body) {
      body.classList.add('dark-theme');
      body.classList.remove('light-theme');
      body.setAttribute('data-theme', 'dark');
      body.style.colorScheme = 'dark';
    }
  }
}
