import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Handles virtual keyboard visibility on iOS PWA standalone mode.
 *
 * On Chrome Android, `interactive-widget=resizes-content` in the viewport meta
 * tag handles this natively. iOS Safari ignores that directive, so we fall back
 * to the VisualViewport API — but only inside standalone PWA mode where Safari's
 * own scroll-into-view behaviour doesn't apply.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardLayoutService {
  private readonly platformId = inject(PLATFORM_ID);

  /** Keyboard height offset in px (non-zero only on iOS standalone PWA) */
  readonly keyboardOffset = signal(0);

  /** Whether virtual keyboard is currently visible */
  readonly isKeyboardVisible = computed(() => this.keyboardOffset() > 0);

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    const isStandalone =
      ('standalone' in navigator && (navigator as Record<string, unknown>)['standalone'] === true) ||
      matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (isStandalone && isIOS && window.visualViewport) {
      this.listenVisualViewport();
    }
  }

  private listenVisualViewport(): void {
    const vv = window.visualViewport!;
    vv.addEventListener(
      'resize',
      () => {
        const offset = window.innerHeight - vv.height;
        this.keyboardOffset.set(offset > 50 ? offset : 0);
      },
      { passive: true },
    );
  }
}
