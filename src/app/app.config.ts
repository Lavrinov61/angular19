import { ApplicationConfig, provideZonelessChangeDetection, LOCALE_ID, APP_INITIALIZER, ENVIRONMENT_INITIALIZER, ErrorHandler, isDevMode, inject } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeRu from '@angular/common/locales/ru';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes'; // ВОССТАНОВЛЕНО! Используем настоящие маршруты
import { provideClientHydration, withIncrementalHydration } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withFetch, withInterceptors, withInterceptorsFromDi } from '@angular/common/http';

// Angular Material Date Adapter
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
import { NativeDateAdapter } from '@angular/material/core';

// Import interceptors
import { authTokenInterceptor } from './core/interceptors/auth-token.interceptor';
import { httpErrorLogInterceptor } from './core/interceptors/http-error-log.interceptor';
import { retryHttpInterceptor } from './core/interceptors/retry-http.interceptor';

import { provideServiceWorker, SwUpdate } from '@angular/service-worker';

import { AuthService } from './core/services/auth.service';
import { FingerprintSecretService } from './core/services/fingerprint-secret.service';
import { MessageOutboxService } from './core/services/message-outbox.service';
import { ChunkErrorHandler } from './core/providers/chunk-error-handler';

// Русский формат даты для Material DatePicker
export const RU_DATE_FORMATS = {
  parse: {
    dateInput: 'DD.MM.YYYY',
  },
  display: {
    dateInput: 'DD.MM.YYYY',
    monthYearLabel: 'MMM YYYY',
    dateA11yLabel: 'DD.MM.YYYY',
    monthYearA11yLabel: 'MMMM YYYY',
  },
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    provideClientHydration(withIncrementalHydration()),
    provideAnimations(),
    provideHttpClient(
      withFetch(),
      withInterceptors([authTokenInterceptor, httpErrorLogInterceptor, retryHttpInterceptor]),
      withInterceptorsFromDi() // Для поддержки DI-based interceptors (ServerHttpInterceptor)
    ),
    // Auth: дождаться загрузки профиля ПЕРЕД bootstrap
    {
      provide: APP_INITIALIZER,
      useFactory: (authService: AuthService) => () => authService.initializeAuth(),
      deps: [AuthService],
      multi: true,
    },
    // Fingerprint secret: загружать HMAC-ключ при bootstrap
    {
      provide: APP_INITIALIZER,
      useFactory: (fpSecret: FingerprintSecretService) => () => fpSecret.load(),
      deps: [FingerprintSecretService],
      multi: true,
    },
    // Локализация для Material DatePicker
    { provide: LOCALE_ID, useValue: 'ru-RU' },
    { provide: MAT_DATE_LOCALE, useValue: 'ru-RU' },
    { provide: DateAdapter, useClass: NativeDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: RU_DATE_FORMATS },
    // Angular Service Worker (ngsw) — версионирование и кеширование чанков
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // SW auto-update: при VERSION_READY активируем новый SW и перезагружаем
    // Guard: не reload пока outbox имеет pending сообщения
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        const swUpdate = inject(SwUpdate);
        const outbox = inject(MessageOutboxService);
        if (!swUpdate.isEnabled) return;
        swUpdate.versionUpdates.subscribe(evt => {
          if (evt.type === 'VERSION_READY') {
            swUpdate.activateUpdate().then(() => {
              const tryReload = () => {
                if (outbox.hasPending()) {
                  setTimeout(tryReload, 2000);
                } else {
                  document.location.reload();
                }
              };
              setTimeout(tryReload, 300);
            });
          }
        });
      },
    },
    // ChunkLoadError recovery — автоматический reload при 404 на lazy chunks
    { provide: ErrorHandler, useClass: ChunkErrorHandler },
  ]
};

registerLocaleData(localeRu);
