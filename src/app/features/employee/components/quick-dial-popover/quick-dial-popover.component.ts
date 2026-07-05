import { isPlatformBrowser } from '@angular/common';
import { Component, inject, signal, output, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
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
  selector: 'app-quick-dial-popover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule],
  template: `
    <div class="popover-card" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">
      <div class="popover-header">
        <mat-icon>phone</mat-icon>
        <span>Быстрый звонок</span>
      </div>
      <div class="popover-row">
        <input class="dial-input" type="tel" placeholder="+7 (___) ___-__-__"
               inputmode="tel"
               autocomplete="tel"
               maxlength="18"
               [ngModel]="phoneNumber()"
               (ngModelChange)="onPhoneInput($event)"
               (focus)="ensurePhonePrefix()"
               (blur)="clearPhonePrefix()"
               (keydown.enter)="call()"
               (keydown.escape)="closed.emit()"
               #dialInput>
        <button mat-mini-fab color="primary"
                [disabled]="!canCall() || telephony.outboundRequesting()"
                (click)="call()">
          <mat-icon>call</mat-icon>
        </button>
      </div>
      @if (recentCalls().length) {
        <div class="recent">
          @for (num of recentCalls(); track num) {
            <button class="recent-btn"
                    [disabled]="telephony.outboundRequesting()"
                    (click)="callRecent(num)">
              <mat-icon>history</mat-icon>
              {{ maskPhone(num) || 'Номер скрыт' }}
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .popover-card {
      width: 280px;
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    }

    .popover-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 10px;
      color: var(--mat-sys-on-surface);

      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-primary); }
    }

    .popover-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .dial-input {
      flex: 1;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 14px;
      font-variant-numeric: tabular-nums;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
      outline: none;

      &:focus { border-color: var(--mat-sys-primary); }
      &::placeholder { color: var(--mat-sys-on-surface-variant); }
    }

    .recent {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 214px;
      overflow-y: auto;
    }

    .recent-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      border: none;
      background: none;
      padding: 6px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      color: var(--mat-sys-on-surface);

      &:hover { background: var(--mat-sys-surface-container-low); }
      &:disabled {
        cursor: default;
        opacity: 0.55;
      }

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
        color: var(--mat-sys-on-surface-variant);
      }
    }
  `],
})
export class QuickDialPopoverComponent {
  private readonly platformId = inject(PLATFORM_ID);
  readonly telephony = inject(TelephonyService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  closed = output<void>();

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
    this.closed.emit();
    this.rememberCall(num);
  }

  protected callRecent(phone: string): void {
    if (this.telephony.outboundRequesting()) return;
    this.phoneNumber.set(formatRussianPhoneInput(phone));
    void this.telephony.makeCall(phone);
    this.closed.emit();
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
