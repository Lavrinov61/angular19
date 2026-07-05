import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';

import { isTelephonyApiPath } from './telephony-api-routing';

/**
 * HTTP интерцептор для правильной работы HTTP запросов во время SSR.
 * Преобразует /api/* запросы в абсолютные URL для внутренних backend-процессов.
 * Без этого Angular SSR отправлял бы /api/* запросы на :4000 (SSR-сервер),
 * где API роутов больше нет.
 */
@Injectable()
export class ServerHttpInterceptor implements HttpInterceptor {
  private platformId = inject(PLATFORM_ID);

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Применяем интерцептор только на сервере
    if (!isPlatformServer(this.platformId)) {
      return next.handle(req);
    }

    // Если URL уже абсолютный, не меняем его
    if (req.url.startsWith('http://') || req.url.startsWith('https://')) {
      return next.handle(req);
    }

    // /api/* → http://localhost:<port>/api/*
    // Telephony split owns both /api/telephony/* and the phone-auth slice.
    if (req.url.startsWith('/api/') || req.url === '/api') {
      const targetPort = isTelephonyApiPath(req.url)
        ? (process.env['TELEPHONY_PORT'] || process.env['API_PORT'] || '3001')
        : (process.env['API_PORT'] || '3001');
      const serverReq = req.clone({ url: `http://localhost:${targetPort}${req.url}` });
      return next.handle(serverReq);
    }

    // Остальные относительные URL оставляем как есть
    return next.handle(req);
  }
}
