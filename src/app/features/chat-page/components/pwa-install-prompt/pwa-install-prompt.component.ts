import {
  Component,
  signal,
  ChangeDetectionStrategy,
  OnInit,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { LoggerService } from '../../../../core/services/logger.service';

/** Browser BeforeInstallPromptEvent (not in lib.dom.d.ts) */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Safari-specific navigator.standalone property */
interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

@Component({
  selector: 'app-pwa-install-prompt',
  imports: [CommonModule, MatButtonModule, MatIconModule, MatSnackBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showPrompt() && !dismissed()) {
      <div class="pwa-prompt">
        <div class="prompt-content">
          <div class="prompt-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 15.2c1.77 0 3.2-1.43 3.2-3.2S13.77 8.8 12 8.8 8.8 10.23 8.8 12s1.43 3.2 3.2 3.2z"/>
              <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
            </svg>
          </div>
          <div class="prompt-text">
            <strong>Добавить на главный экран</strong>
            <span>Быстрый доступ к чату и фото</span>
          </div>
        </div>
        <div class="prompt-actions">
          <button mat-button (click)="dismiss()">Позже</button>
          <button mat-flat-button color="primary" (click)="install()">
            <mat-icon>add_to_home_screen</mat-icon>
            Добавить
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .pwa-prompt {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 16px;
      background: linear-gradient(90deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      border-bottom: 1px solid rgba(102, 126, 234, 0.2);
      animation: slideDown 0.3s ease;
    }

    @keyframes slideDown {
      from { 
        transform: translateY(-100%);
        opacity: 0;
      }
      to { 
        transform: translateY(0);
        opacity: 1;
      }
    }

    .prompt-content {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .prompt-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      svg {
        width: 22px;
        height: 22px;
        color: white;
      }
    }

    .prompt-text {
      display: flex;
      flex-direction: column;

      strong {
        font-size: 0.85rem;
        color: var(--ed-on-surface, #f5f5f5);
      }

      span {
        font-size: 0.75rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    .prompt-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;

      button {
        font-size: 0.8rem;
      }

      .mat-mdc-unelevated-button {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          margin-right: 4px;
        }
      }
    }

    @media (max-width: 480px) {
      .pwa-prompt {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }

      .prompt-actions {
        justify-content: flex-end;
      }
    }
  `],
})
export class PwaInstallPromptComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService);
  private snackBar = inject(MatSnackBar);

  showPrompt = signal(false);
  dismissed = signal(false);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Check if already dismissed
    const dismissedAt = localStorage.getItem('pwa-install-dismissed');
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10);
      // Show again after 7 days
      if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) {
        return;
      }
    }

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return;
    }

    // Listen for beforeinstallprompt
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.showPrompt.set(true);
    });

    // For iOS Safari
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const nav = navigator as NavigatorStandalone;
    if (isIOS && isSafari && !('standalone' in navigator && nav.standalone)) {
      this.showPrompt.set(true);
    }
  }

  async install(): Promise<void> {
    if (this.deferredPrompt) {
      this.deferredPrompt.prompt();
      const result = await this.deferredPrompt.userChoice;
      
      if (result.outcome === 'accepted') {
        this.log.debug('PWA installed');
      }
      
      this.deferredPrompt = null;
      this.showPrompt.set(false);
    } else {
      // iOS Safari instructions
      this.snackBar.open('iOS: Нажмите "Поделиться" → "На экран Домой"', 'Закрыть', { duration: 8000 });
    }
  }

  dismiss(): void {
    this.dismissed.set(true);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('pwa-install-dismissed', Date.now().toString());
    }
  }
}
