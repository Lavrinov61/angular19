import { InjectionToken } from '@angular/core';

/**
 * Токен для инъекции базового URL сервера во время SSR
 */
export const SERVER_BASE_URL = new InjectionToken<string>('SERVER_BASE_URL', {
  providedIn: 'root',
  factory: () => {
    // Значение по умолчанию для разработки
    if (typeof process !== 'undefined' && process.env) {
      return process.env['SERVER_URL'] || 'http://localhost:4000';
    }
    return 'http://localhost:4000';
  }
});
