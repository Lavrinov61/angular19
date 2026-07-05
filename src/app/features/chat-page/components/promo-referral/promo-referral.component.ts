import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';

import { AuthService } from '../../../../core/services/auth.service';
import { CartService } from '../../services/cart.service';
import { ReferralTrackingService } from '../../../../core/services/referral-tracking.service';

type PromoStatus = 'idle' | 'loading' | 'success' | 'error';

interface LoyaltyProfileResponse {
  success: boolean;
  data: {
    profile: {
      referralCode: string;
      [key: string]: unknown;
    };
  };
}

@Component({
  selector: 'app-promo-referral',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
  ],
  template: `
    <div class="promo-referral">

      <!-- ─── ПРОМОКОД ─── -->
      <div class="promo-section">
        <div class="section-title">
          <mat-icon>local_offer</mat-icon>
          <span>Промокод</span>
        </div>

        <div class="promo-input-row">
          <input
            class="promo-input"
            type="text"
            placeholder="Введите промокод"
            [ngModel]="promoCode()"
            (ngModelChange)="promoCode.set($event)"
            (keydown.enter)="applyPromo()"
            [disabled]="promoStatus() === 'loading' || promoStatus() === 'success'"
            autocomplete="off"
            autocapitalize="characters"
          />
          <button
            class="promo-apply-btn"
            (click)="applyPromo()"
            [disabled]="!promoCode().trim() || promoStatus() === 'loading' || promoStatus() === 'success'"
          >
            @if (promoStatus() === 'loading') {
              <mat-icon class="spin">refresh</mat-icon>
            } @else if (promoStatus() === 'success') {
              <mat-icon>check</mat-icon>
            } @else {
              <span>Применить</span>
            }
          </button>
        </div>

        @if (promoStatus() === 'success') {
          <div class="promo-feedback success">
            <mat-icon>check_circle</mat-icon>
            <span>{{ promoMessage() }}</span>
          </div>
        } @else if (promoStatus() === 'error') {
          <div class="promo-feedback error">
            <mat-icon>error_outline</mat-icon>
            <span>{{ promoMessage() }}</span>
          </div>
        }
      </div>

      <!-- ─── РЕФЕРАЛ (только для авторизованных) ─── -->
      @if (isAuthenticated()) {
        <div class="referral-section">
          <div class="section-title">
            <mat-icon>group_add</mat-icon>
            <span>Пригласите друга</span>
          </div>

          <div class="referral-promo-text">
            <mat-icon>workspace_premium</mat-icon>
            <span>Вы получите <strong>до 5 000 бонусов</strong>, когда друг активирует подписку</span>
          </div>

          @if (referralLoading()) {
            <div class="referral-loading">
              <mat-icon class="spin">refresh</mat-icon>
              <span>Загрузка...</span>
            </div>
          } @else if (referralCode()) {
            <div class="referral-link-block">
              <div class="referral-link-label">Ваша реферальная ссылка</div>
              <div class="referral-link-row">
                <code class="referral-link-text">{{ referralLink() }}</code>
                <button
                  class="icon-btn"
                  (click)="copyReferralLink()"
                  [class.copied]="copied()"
                  title="Скопировать"
                >
                  <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
                </button>
                @if (canShare()) {
                  <button
                    class="icon-btn"
                    (click)="shareReferralLink()"
                    title="Поделиться"
                  >
                    <mat-icon>share</mat-icon>
                  </button>
                }
              </div>

              <div class="referral-code-row">
                <span class="referral-code-label">Код:</span>
                <span class="referral-code-value">{{ referralCode() }}</span>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .promo-referral {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-size: 14px;
      font-weight: 600;
      color: var(--ed-on-surface);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--ed-accent);
      }
    }

    /* ─── Промокод ─── */
    .promo-section {
      display: flex;
      flex-direction: column;
    }

    .promo-input-row {
      display: flex;
      gap: 8px;
    }

    .promo-input {
      flex: 1;
      padding: 10px 12px;
      background: var(--ed-surface-container);
      border: 1px solid var(--ed-outline-variant);
      border-radius: 8px;
      color: var(--ed-on-surface);
      font-size: 14px;
      font-weight: 500;
      letter-spacing: 0.06em;
      outline: none;
      transition: border-color 0.15s;
      min-width: 0;

      &::placeholder {
        color: var(--ed-on-surface-variant);
        font-weight: 400;
        letter-spacing: 0;
      }

      &:focus {
        border-color: var(--ed-accent);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .promo-apply-btn {
      padding: 0 16px;
      background: var(--ed-accent);
      color: #000;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 90px;
      transition: opacity 0.15s;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      &:not(:disabled):hover {
        opacity: 0.88;
      }
    }

    .promo-feedback {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      font-size: 13px;
      border-radius: 8px;
      padding: 8px 10px;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      &.success {
        background: rgba(34, 197, 94, 0.1);
        color: #22c55e;
      }

      &.error {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
      }
    }

    /* ─── Реферал ─── */
    .referral-section {
      display: flex;
      flex-direction: column;
    }

    .referral-promo-text {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 12px;
      background: var(--ed-accent-container);
      border-radius: 10px;
      font-size: 13px;
      color: var(--ed-on-accent);
      margin-bottom: 12px;
      line-height: 1.4;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        margin-top: 1px;
      }

      strong {
        font-weight: 700;
        color: var(--ed-accent);
      }
    }

    .referral-link-block {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      background: var(--ed-surface-container);
      border: 1px solid var(--ed-outline-variant);
      border-radius: 10px;
    }

    .referral-link-label {
      font-size: 11px;
      color: var(--ed-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .referral-link-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .referral-link-text {
      flex: 1;
      font-size: 12px;
      color: var(--ed-on-surface);
      word-break: break-all;
      background: var(--ed-surface-container-high);
      padding: 4px 8px;
      border-radius: 6px;
      font-family: monospace;
      line-height: 1.4;
    }

    .referral-code-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;

      .referral-code-label {
        color: var(--ed-on-surface-variant);
      }

      .referral-code-value {
        font-family: monospace;
        font-weight: 700;
        color: var(--ed-accent);
        font-size: 13px;
        letter-spacing: 0.08em;
      }
    }

    .icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: 1px solid var(--ed-outline-variant);
      background: var(--ed-surface-container-high);
      color: var(--ed-on-surface-variant);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      flex-shrink: 0;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      &:hover {
        background: var(--ed-accent-container);
        color: var(--ed-accent);
      }

      &.copied {
        color: #22c55e;
        border-color: #22c55e;
      }
    }

    .referral-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--ed-on-surface-variant);

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    /* Spin animation */
    .spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class PromoReferralComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly authService = inject(AuthService);
  private readonly cartService = inject(CartService);
  private readonly referralTracking = inject(ReferralTrackingService);

  readonly isAuthenticated = this.authService.isAuthenticated;

  readonly promoCode = signal('');
  readonly promoStatus = signal<PromoStatus>('idle');
  readonly promoMessage = signal('');
  readonly referralCode = signal<string | null>(null);
  readonly referralLoading = signal(false);
  readonly copied = signal(false);

  readonly referralLink = computed<string>(() => {
    const code = this.referralCode();
    if (!code) return '';
    const path = `/priglasi-druga?loyaltyRef=${encodeURIComponent(code)}`;
    if (!isPlatformBrowser(this.platformId)) return `https://svoefoto.ru${path}`;
    return `${window.location.origin}${path}`;
  });

  readonly canShare = computed<boolean>(() => {
    if (!isPlatformBrowser(this.platformId)) return false;
    return typeof navigator !== 'undefined' && 'share' in navigator;
  });

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Auto-fill promo input from stored partner code
    const storedCode = this.referralTracking.getPartnerCode();
    if (storedCode && !this.promoCode()) {
      this.promoCode.set(storedCode);
    }

    if (this.isAuthenticated()) {
      this.loadReferralCode();
    }
  }

  private loadReferralCode(): void {
    this.referralLoading.set(true);
    this.http.get<LoyaltyProfileResponse>('/api/loyalty/profile').subscribe({
      next: (res) => {
        if (res.success && res.data?.profile?.referralCode) {
          this.referralCode.set(res.data.profile.referralCode);
        }
        this.referralLoading.set(false);
      },
      error: () => {
        this.referralLoading.set(false);
      },
    });
  }

  async applyPromo(): Promise<void> {
    const code = this.promoCode().trim();
    if (!code || this.promoStatus() === 'loading' || this.promoStatus() === 'success') return;

    this.promoStatus.set('loading');
    this.promoMessage.set('');

    try {
      const valid = await this.cartService.validatePromo(code);
      if (valid) {
        this.promoStatus.set('success');
        const data = this.cartService.promoData();
        if (data?.is_partner_code) {
          this.promoMessage.set(`Код партнёра применён${data.partner_name ? ': ' + data.partner_name : ''}`);
        } else {
          const discountText = data?.discount_percent
            ? `-${data.discount_percent}%`
            : data?.discount_amount
            ? `-${data.discount_amount}₽`
            : '';
          this.promoMessage.set(
            `Промокод применён${discountText ? ': ' + discountText : ''}`,
          );
        }
      } else {
        this.promoStatus.set('error');
        this.promoMessage.set('Промокод не найден или недействителен');
      }
    } catch {
      this.promoStatus.set('error');
      this.promoMessage.set('Ошибка при проверке промокода');
    }
  }

  async copyReferralLink(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    const link = this.referralLink();
    if (!link) return;

    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
      this.snackBar.open('Ссылка скопирована!', '', { duration: 2000 });
    } catch {
      this.snackBar.open('Не удалось скопировать ссылку', '', { duration: 2000 });
    }
  }

  async shareReferralLink(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    const link = this.referralLink();
    if (!link) return;

    try {
      await navigator.share({
        title: 'Своё Фото, фотостудия',
        text: 'Рекомендую "Своё Фото": активируйте подписку по моей ссылке.',
        url: link,
      });
    } catch {
      // User cancelled or share not supported, silently ignore
    }
  }
}
