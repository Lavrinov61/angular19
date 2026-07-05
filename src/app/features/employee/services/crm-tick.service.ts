import { Injectable, inject, signal, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class CrmTickService {
  private readonly platformId = inject(PLATFORM_ID);
  readonly tick = signal(0);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const id = setInterval(() => this.tick.update(v => v + 1), 30_000);
      inject(DestroyRef).onDestroy(() => clearInterval(id));
    }
  }
}
