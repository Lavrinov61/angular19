import { Component, OnInit, inject, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div>Перенаправляем...</div>',

})
export class LegacyRedirectComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private platformId = inject(PLATFORM_ID);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      // На сервере просто перенаправляем на главную
      this.router.navigate(['/']);
      return;
    }

    // Получаем полный URL
    const url = window.location.pathname;
    
    // Проверяем, начинается ли URL с ~
    if (url.startsWith('/~')) {
      const code = url.substring(2); // Убираем /~ в начале
      // Перенаправляем на новый формат
      this.router.navigate(['/photo', code]);
    } else {
      // Если что-то пошло не так, перенаправляем на главную
      this.router.navigate(['/']);
    }
  }
}
