import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';

export const legacyPhotoGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  
  // Получаем полный URL
  const url = state.url;
  
  // Проверяем, содержит ли URL символ ~
  if (url.includes('~')) {
    // Извлекаем код после символа ~
    const match = url.match(/~([^/?#]+)/);
    if (match && match[1]) {
      const code = match[1];
      // Перенаправляем на новый формат
      router.navigate(['/photo', code]);
      return false;
    }
  }
  
  return true;
};
