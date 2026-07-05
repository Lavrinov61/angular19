import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { TelephonyService } from '../../services/telephony.service';
import { maskPhone } from '../../utils/phone-mask';

@Component({
  selector: 'app-active-call-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatMenuModule],
  template: `
    @if (telephony.isInCall()) {
      <div class="call-bar" [class.connecting]="telephony.callState() === 'connecting'">
        @if (telephony.recording()) {
          <span class="rec-dot"></span>
        }

        <mat-icon class="bar-icon">
          {{ telephony.activeCall()?.direction === 'inbound' ? 'phone_callback' : 'phone_forwarded' }}
        </mat-icon>

        <span class="caller-info">
          @if (telephony.activeCall()?.clientName) {
            {{ telephony.activeCall()!.clientName }}
          } @else {
            {{ maskedPhone(telephony.activeCall()?.phone) }}
          }
        </span>

        <span class="duration">
          @if (telephony.callState() === 'connecting') {
            Соединение...
          } @else {
            {{ telephony.formatDuration(telephony.callDuration()) }}
          }
        </span>

        <span class="spacer"></span>

        <button mat-icon-button (click)="telephony.toggleMute()"
                [attr.aria-label]="telephony.muted() ? 'Включить микрофон' : 'Выключить микрофон'">
          <mat-icon>{{ telephony.muted() ? 'mic_off' : 'mic' }}</mat-icon>
        </button>

        <button mat-icon-button class="hangup-btn" (click)="telephony.hangup()"
                aria-label="Завершить звонок">
          <mat-icon>call_end</mat-icon>
        </button>
      </div>
    }
  `,
  styles: [`
    .call-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      background: var(--crm-status-success);
      color: white;
      font-size: 13px;
      height: 36px;
      flex-shrink: 0;
    }

    .call-bar.connecting {
      background: var(--mat-sys-tertiary);
    }

    .rec-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--crm-status-error);
      animation: blink 1s infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .bar-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .caller-info {
      font-weight: 500;
    }

    .duration {
      font-variant-numeric: tabular-nums;
      opacity: 0.9;
    }

    .spacer { flex: 1; }

    button {
      color: white !important;
    }

    .hangup-btn {
      background: color-mix(in srgb, var(--crm-status-error) 30%, transparent) !important;
      border-radius: 50%;
    }
  `],
})
export class ActiveCallBarComponent {
  protected readonly telephony = inject(TelephonyService);

  protected maskedPhone(phone: string | null | undefined): string {
    return maskPhone(phone) || 'Клиент';
  }
}
