import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { filter } from 'rxjs/operators';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root'
})
export class LegacyUrlService {
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService);

  init(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Проверяем URL при загрузке страницы
    this.checkInitialUrl();
    
    // Подписываемся на изменения маршрута
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.handleLegacyUrl(event.url);
      });
  }
  private checkInitialUrl(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    
    const currentUrl = window.location.pathname;
    this.handleLegacyUrl(currentUrl);
  }

  private handleLegacyUrl(url: string): void {
    // Проверяем, содержит ли URL символ ~
    if (url.includes('~')) {
      const match = url.match(/~([^/?#]+)/);
      if (match && match[1]) {
        const code = match[1];
        this.log.debug(`Legacy URL detected: ${url}, redirecting to /photo/${code}`);
        // Перенаправляем на новый формат
        this.router.navigate(['/photo', code], { 
          replaceUrl: true // Заменяем текущую запись в истории
        });
      }
    }
  }
}
