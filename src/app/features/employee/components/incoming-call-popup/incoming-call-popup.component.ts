import { Component, inject, effect, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TelephonyService } from '../../services/telephony.service';
import { maskPhone } from '../../utils/phone-mask';

@Component({
  selector: 'app-incoming-call-popup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule],
  template: `
    @if (telephony.hasIncomingCall()) {
      <div class="call-popup">
        <div class="call-header">
          <mat-icon class="call-icon pulse">phone_in_talk</mat-icon>
          <span class="call-label">Входящий звонок</span>
          <button mat-icon-button class="dismiss-btn" (click)="telephony.dismissIncomingNotification()" aria-label="Скрыть уведомление">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <div class="call-info">
          <span class="caller-number">{{ maskedPhone(telephony.incomingCall()!.callerNumber) }}</span>
          <span class="call-route">Звонит рабочий телефон</span>
          @if (telephony.incomingCall()!.clientName) {
            <span class="caller-name">{{ telephony.incomingCall()!.clientName }}</span>
          }
          @if (telephony.incomingCall()!.ordersCount > 0) {
            <span class="orders-count">{{ telephony.incomingCall()!.ordersCount }} заказов</span>
          }
        </div>

      </div>
    }
  `,
  styles: [`
    .call-popup {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 10000;
      background: var(--mat-sys-surface-container-high);
      border-radius: 16px;
      padding: 16px;
      min-width: 280px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
      animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
      from { transform: translateX(120%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .call-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    .call-icon {
      color: var(--crm-status-success);
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    .call-icon.pulse {
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .call-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--mat-sys-on-surface);
    }

    .dismiss-btn {
      margin-left: auto;
      width: 32px;
      height: 32px;
      color: var(--mat-sys-on-surface-variant) !important;
    }

    .dismiss-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .call-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .caller-number {
      font-size: 20px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
      letter-spacing: 0.5px;
    }

    .call-route {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    .caller-name {
      font-size: 14px;
      color: var(--mat-sys-on-surface-variant);
    }

    .orders-count {
      font-size: 12px;
      color: var(--mat-sys-primary);
    }
  `],
})
export class IncomingCallPopupComponent {
  protected readonly telephony = inject(TelephonyService);
  private readonly platformId = inject(PLATFORM_ID);
  private audioCtx: AudioContext | null = null;
  private ringInterval: ReturnType<typeof setInterval> | null = null;

  protected maskedPhone(phone: string | null | undefined): string {
    return maskPhone(phone) || 'Клиент';
  }

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    effect(() => {
      if (this.telephony.hasIncomingCall()) {
        this.startRingtone();
      } else {
        this.stopRingtone();
      }
    });
  }

  private startRingtone(): void {
    if (this.ringInterval) return;

    this.audioCtx = new AudioContext();
    this.ringInterval = setInterval(() => {
      this.playRingTone();
    }, 2000);
    this.playRingTone();
  }

  private playRingTone(): void {
    if (!this.audioCtx) return;

    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.frequency.value = 440;
    gain.gain.value = 0.15;
    osc.start();

    setTimeout(() => {
      osc.frequency.value = 480;
    }, 200);

    setTimeout(() => {
      osc.stop();
    }, 400);
  }

  private stopRingtone(): void {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
