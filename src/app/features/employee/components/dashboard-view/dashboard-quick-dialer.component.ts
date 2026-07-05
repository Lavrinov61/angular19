import { isPlatformBrowser } from '@angular/common';
import { Component, inject, signal, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TelephonyService } from '../../services/telephony.service';
import {
  formatRussianPhoneInput,
  isCompleteRussianPhone,
  maskPhone,
  normalizeRussianPhoneDigits,
  normalizeRussianPhoneForDial,
} from '../../utils/phone-mask';
import {
  parseRecentDialerCalls,
  RECENT_DIALER_STORAGE_KEY,
  rememberRecentDialerCall,
} from '../../utils/recent-dialer-calls';

@Component({
  selector: 'app-dashboard-quick-dialer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <div class="dialer-card">
      <header class="dialer-head">
        <div class="dialer-title">
          <mat-icon>phone_in_talk</mat-icon>
          <span>Звонок клиенту</span>
        </div>
        @if (phoneNumber()) {
          <button mat-icon-button
                  type="button"
                  class="clear-btn"
                  matTooltip="Очистить"
                  aria-label="Очистить номер"
                  (click)="clearPhone()">
            <mat-icon>close</mat-icon>
          </button>
        }
      </header>

      <div class="dialer-row">
        <label class="phone-shell" [class.ready]="canCall()">
          <mat-icon>phone</mat-icon>
          <input class="phone-input"
                 type="tel"
                 inputmode="tel"
                 autocomplete="tel"
                 maxlength="18"
                 placeholder="+7 (___) ___-__-__"
                 [ngModel]="phoneNumber()"
                 (ngModelChange)="onPhoneInput($event)"
                 (focus)="ensurePhonePrefix()"
                 (blur)="clearPhonePrefix()"
                 (keydown.enter)="call()">
        </label>
        <button mat-flat-button
                type="button"
                class="call-button"
                [disabled]="!canCall() || telephony.outboundRequesting()"
                (click)="call()">
          <mat-icon>call</mat-icon>
          {{ telephony.outboundRequesting() ? 'Звоним' : 'Позвонить' }}
        </button>
      </div>

      @if (recentCalls().length) {
        <div class="recent">
          <div class="recent-label">
            <mat-icon>history</mat-icon>
            <span>Недавние</span>
          </div>
          <div class="recent-list">
            @for (num of recentCalls(); track num) {
              <button class="recent-num"
                      type="button"
                      [disabled]="telephony.outboundRequesting()"
                      (click)="callRecent(num)">
                {{ maskPhone(num) || 'Номер скрыт' }}
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .dialer-card {
      background: var(--crm-surface);
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-border);
      padding: 12px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
    }

    .dialer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 26px;
      margin-bottom: 10px;
    }

    .dialer-title {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      font-weight: 700;
      color: var(--crm-text-primary);

      mat-icon {
        width: 17px;
        height: 17px;
        font-size: 17px;
        color: var(--crm-accent);
      }
    }

    .clear-btn {
      width: 26px;
      height: 26px;
      color: var(--crm-text-muted) !important;

      mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
      }
    }

    .dialer-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
    }

    .phone-shell {
      min-width: 0;
      height: 56px;
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      border: 1px solid color-mix(in srgb, var(--crm-border) 78%, var(--crm-accent));
      border-radius: var(--crm-radius-md);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.04), transparent),
        var(--crm-surface-base);
      padding: 0 12px;
      transition:
        border-color var(--crm-transition-fast),
        box-shadow var(--crm-transition-fast),
        background var(--crm-transition-fast);

      &:focus-within {
        border-color: var(--crm-accent);
        box-shadow: 0 0 0 3px rgba(245,158,11,0.14);
      }

      &.ready {
        border-color: color-mix(in srgb, var(--crm-status-success) 55%, var(--crm-border));
      }

      mat-icon {
        width: 20px;
        height: 20px;
        font-size: 20px;
        color: var(--crm-accent);
      }
    }

    .phone-input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--crm-text-primary);
      font: inherit;
      font-size: 18px;
      line-height: 1;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;

      &::placeholder {
        color: var(--crm-text-muted);
        font-weight: 500;
      }
    }

    .call-button {
      height: 56px;
      min-width: 134px;
      border-radius: var(--crm-radius-md);
      background: var(--crm-accent) !important;
      color: var(--crm-on-accent, #111) !important;
      font-weight: 700;

      mat-icon {
        width: 19px;
        height: 19px;
        font-size: 19px;
      }

      &:disabled {
        opacity: 0.5;
      }
    }

    .recent {
      display: grid;
      gap: 7px;
      margin-top: 10px;
    }

    .recent-label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--crm-text-muted);

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
    }

    .recent-list {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .recent-num {
      border: 1px solid var(--crm-border);
      background: var(--crm-surface-raised);
      border-radius: var(--crm-radius-sm);
      min-height: 28px;
      padding: 3px 10px;
      font-size: 12px;
      cursor: pointer;
      color: var(--crm-accent);
      font-variant-numeric: tabular-nums;

      &:hover { background: var(--crm-accent-muted); }
      &:disabled {
        cursor: default;
        opacity: 0.55;
      }
    }

    @media (max-width: 420px) {
      .dialer-row { grid-template-columns: 1fr; }
      .call-button { width: 100%; }
    }
  `],
})
export class DashboardQuickDialerComponent {
  private readonly platformId = inject(PLATFORM_ID);
  readonly telephony = inject(TelephonyService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly phoneNumber = signal('');
  readonly recentCalls = signal<string[]>([]);

  constructor() {
    if (!this.isBrowser) return;
    this.recentCalls.set(parseRecentDialerCalls(localStorage.getItem(RECENT_DIALER_STORAGE_KEY)));
  }

  call(): void {
    const num = normalizeRussianPhoneForDial(this.phoneNumber());
    if (!isCompleteRussianPhone(num) || this.telephony.outboundRequesting()) return;

    void this.telephony.makeCall(num);
    this.phoneNumber.set(formatRussianPhoneInput(num));
    this.rememberCall(num);
  }

  protected callRecent(phone: string): void {
    if (this.telephony.outboundRequesting()) return;
    this.phoneNumber.set(formatRussianPhoneInput(phone));
    void this.telephony.makeCall(phone);
    this.rememberCall(phone);
  }

  protected onPhoneInput(value: string): void {
    this.phoneNumber.set(formatRussianPhoneInput(value));
  }

  protected ensurePhonePrefix(): void {
    if (!this.phoneNumber()) {
      this.phoneNumber.set('+7 (');
    }
  }

  protected clearPhone(): void {
    this.phoneNumber.set('');
  }

  protected clearPhonePrefix(): void {
    if (normalizeRussianPhoneDigits(this.phoneNumber()) === '7') {
      this.phoneNumber.set('');
    }
  }

  protected canCall(): boolean {
    return isCompleteRussianPhone(this.phoneNumber());
  }

  private rememberCall(phone: string): void {
    const limited = rememberRecentDialerCall(this.recentCalls(), phone);
    this.recentCalls.set(limited);
    if (!this.isBrowser) return;
    try { localStorage.setItem(RECENT_DIALER_STORAGE_KEY, JSON.stringify(limited)); } catch { void 0; }
  }

  protected maskPhone(value: string): string | null {
    return maskPhone(value);
  }
}
