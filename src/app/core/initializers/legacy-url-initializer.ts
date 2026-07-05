import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService } from '../services/logger.service';

export function initializeLegacyUrlHandler() {
  return () => {
    const platformId = inject(PLATFORM_ID);
    const log = inject(LoggerService);

    if (isPlatformBrowser(platformId)) {
      // Проверяем URL сразу при инициализации
      const currentUrl = window.location.pathname;
      log.debug('APP_INITIALIZER - Current URL:', currentUrl);

      if (currentUrl.includes('~')) {
        const match = currentUrl.match(/~([^/?#]+)/);
        if (match && match[1]) {
          const code = match[1];
          log.debug(`APP_INITIALIZER - Legacy URL detected: ${currentUrl}, redirecting to /photo/${code}`);

          // Используем window.location.replace для гарантированного перенаправления
          window.location.replace(`/photo/${code}`);
          return Promise.resolve();
        }
      }
    }

    return Promise.resolve();
  };
}
