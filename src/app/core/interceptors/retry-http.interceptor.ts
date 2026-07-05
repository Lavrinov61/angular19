import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { retry, timer, throwError } from 'rxjs';

/**
 * Retry interceptor: retries failed GET requests with exponential backoff.
 * - Only browser-side, only GET requests
 * - Skips socket.io/polling endpoints
 * - Retries on network errors (status 0) and 5xx only (1s, 2s, 4s — max 3)
 * - Does NOT retry 429 (would amplify rate-limit storm — service handles via _rateLimitUntil)
 * - Does NOT retry 401 (auth refresh handled by auth interceptor)
 * - Does NOT retry other 4xx (client errors)
 */
export const retryHttpInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);

  if (
    !isPlatformBrowser(platformId) ||
    req.method !== 'GET' ||
    req.url.includes('socket.io') ||
    req.url.includes('/polling')
  ) {
    return next(req);
  }

  return next(req).pipe(
    retry({
      count: 3,
      delay: (error: unknown, retryCount: number) => {
        if (
          error instanceof HttpErrorResponse &&
          (error.status === 0 || error.status >= 500)
        ) {
          return timer(1000 * Math.pow(2, retryCount - 1));
        }
        return throwError(() => error);
      }
    })
  );
};
