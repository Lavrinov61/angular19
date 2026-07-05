import { HttpInterceptorFn, HttpErrorResponse, HttpResponse, HttpContextToken } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { OfflineQueueService } from '../services/offline-queue.service';
import { LoggerService, ContextLogger } from '../services/logger.service';
import { from, switchMap, catchError, throwError, of, BehaviorSubject, filter, take } from 'rxjs';

const AUTH_RETRY_COUNT = new HttpContextToken<number>(() => 0);

let isRefreshing = false;
let refreshTokenSubject = new BehaviorSubject<string | null>(null);

/**
 * HTTP Interceptor для автоматической подстановки JWT токена в Authorization header.
 * При получении 401 автоматически обновляет токен через refresh token и повторяет запрос.
 */
const MUTABLE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];

export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const offlineQueue = inject(OfflineQueueService);
  const platformId = inject(PLATFORM_ID);
  const log = inject(LoggerService).createChild('AuthInterceptor');

  const isApiRequest = req.url.startsWith('/api') || req.url.includes('/api/');
  const skipsAuthorizationHeader = req.url.includes('/auth/refresh');

  // Не добавляем токен к не-API запросам, запросам с уже установленным Authorization,
  // и к запросу обновления токена (чтобы избежать бесконечного цикла)
  if (!isApiRequest || req.headers.has('Authorization') || skipsAuthorizationHeader) {
    // Still send credentials (cookies) for API requests
    if (isApiRequest && !req.withCredentials) {
      return next(req.clone({ withCredentials: true }));
    }
    return next(req);
  }

  return from(authService.getAuthToken()).pipe(
    switchMap(token => {
      // Always set withCredentials for cookie-based auth; add Authorization header for legacy/transition
      const authReq = token
        ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` }, withCredentials: true })
        : req.clone({ withCredentials: true });

      return next(authReq).pipe(
        catchError(error => {
          if (
            error instanceof HttpErrorResponse
            && error.status === 401
            && !req.url.includes('/auth/login')
            && !req.url.includes('/auth/refresh')
            && !req.url.includes('/auth/pin/')
            && !req.url.includes('/auth/logout')
          ) {
            return handle401Error(req, next, authService, log);
          }

          // Offline queue: save mutable requests when offline
          if (
            error instanceof HttpErrorResponse &&
            error.status === 0 &&
            isPlatformBrowser(platformId) && !navigator.onLine &&
            MUTABLE_METHODS.includes(req.method)
          ) {
            const headers: Record<string, string> = {};
            authReq.headers.keys().forEach(k => { headers[k] = authReq.headers.get(k)!; });
            const body = typeof authReq.body === 'string' ? authReq.body : JSON.stringify(authReq.body);
            offlineQueue.enqueue('generic', authReq.method, authReq.urlWithParams, body, headers, authReq.urlWithParams);
            log.warn('Request queued (offline)', { method: req.method, url: req.urlWithParams });
            return of(new HttpResponse({ status: 202, body: { queued: true } }));
          }

          return throwError(() => error);
        })
      );
    })
  );
};

function handle401Error(
  req: Parameters<HttpInterceptorFn>[0],
  next: Parameters<HttpInterceptorFn>[1],
  authService: AuthService,
  log: ContextLogger,
) {
  const retryCount = req.context.get(AUTH_RETRY_COUNT);
  if (retryCount >= 1) {
    log.warn('Auth retry limit exceeded', { url: req.urlWithParams, retryCount });
    return throwError(() => new Error('Auth retry exceeded'));
  }

  if (!isRefreshing) {
    isRefreshing = true;
    refreshTokenSubject.next(null);
    log.warn('Token expired, refreshing', { url: req.urlWithParams });

    return authService.refreshAccessToken().pipe(
      switchMap(tokens => {
        isRefreshing = false;
        refreshTokenSubject.next(tokens.accessToken);
        log.debug('Token refreshed successfully');

        const retryReq = req.clone({
          setHeaders: { Authorization: `Bearer ${tokens.accessToken}` },
          withCredentials: true,
          context: req.context.set(AUTH_RETRY_COUNT, retryCount + 1),
        });
        return next(retryReq);
      }),
      catchError(err => {
        log.error('Token refresh failed', { httpStatus: err?.status });
        refreshTokenSubject.error(err);
        refreshTokenSubject = new BehaviorSubject<string | null>(null);
        isRefreshing = false;
        return throwError(() => err);
      })
    );
  }

  // Если refresh уже идёт — ждём результат и повторяем запрос с новым токеном
  return refreshTokenSubject.pipe(
    filter(token => token !== null),
    take(1),
    switchMap(token => {
      const retryReq = req.clone({
        setHeaders: { Authorization: `Bearer ${token}` },
        withCredentials: true,
        context: req.context.set(AUTH_RETRY_COUNT, retryCount + 1),
      });
      return next(retryReq);
    })
  );
}
