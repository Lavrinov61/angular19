import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, CanActivateFn } from '@angular/router';

// Секретный ключ для доступа к аналитике
// Генерируется случайно, можно изменить
const ANALYTICS_SECRET_KEY = 'MgNs2024AnLtcs#Xk9pQ';

/**
 * Analytics Guard - защита дашборда аналитики
 * 
 * Проверяет наличие ключа в localStorage или query параметре
 * Если ключ неверный - редирект на страницу входа
 */
export const analyticsGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  // На сервере (SSR) разрешаем для рендеринга
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  // Проверяем ключ в query параметрах
  const keyFromUrl = route.queryParams['key'];
  if (keyFromUrl === ANALYTICS_SECRET_KEY) {
    // Сохраняем в localStorage для последующих визитов
    localStorage.setItem('analytics_key', keyFromUrl);
    return true;
  }

  // Проверяем ключ в localStorage
  const storedKey = localStorage.getItem('analytics_key');
  if (storedKey === ANALYTICS_SECRET_KEY) {
    return true;
  }

  // Ключ неверный или отсутствует - редирект на страницу входа
  router.navigate(['/analytics/login'], {
    queryParams: { returnUrl: state.url }
  });
  return false;
};

/**
 * Проверить ключ доступа
 */
export function checkAnalyticsKey(key: string): boolean {
  return key === ANALYTICS_SECRET_KEY;
}

/**
 * Сохранить ключ в localStorage
 */
export function saveAnalyticsKey(key: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('analytics_key', key);
  }
}

/**
 * Удалить ключ из localStorage (выход)
 */
export function clearAnalyticsKey(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('analytics_key');
  }
}

