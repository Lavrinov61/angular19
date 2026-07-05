import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { catchError, throwError } from 'rxjs';
import { LoggerService } from '../services/logger.service';

/**
 * HTTP Error Logging Interceptor — автоматически логирует все HTTP ошибки (4xx/5xx).
 * Пропускает 401 (обрабатывается auth interceptor) и 0 (network / retry interceptor).
 * Не логирует запросы к /api/app-logs (избегаем рекурсии).
 */
export const httpErrorLogInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);
  if (!isPlatformBrowser(platformId)) return next(req);

  const logger = inject(LoggerService).createChild('HttpClient');

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // Пропускаем: 401 (auth interceptor), 0 (network/retry), 429 (rate-limit — не спамить логами),
      // запросы к app-logs (рекурсия)
      if (error.status === 401 || error.status === 0 || error.status === 429 || req.url.includes('/app-logs')) {
        return throwError(() => error);
      }

      const errorBody = typeof error.error === 'object'
        ? JSON.stringify(error.error)?.slice(0, 500)
        : String(error.error || '').slice(0, 500);

      logger.error(`HTTP ${error.status} ${req.method} ${req.urlWithParams}`, {
        httpStatus: error.status,
        httpMethod: req.method,
        httpUrl: req.urlWithParams,
        errorBody,
      });

      return throwError(() => error);
    }),
  );
};
