import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PosShift } from '../../../services/pos-api.service';

@Component({
  selector: 'app-pos-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: { class: 'pos-status-bar' },
  template: `
    <div class="status-left">
      <div class="online-indicator" [class.online]="isOnline()" [class.offline]="!isOnline()">
        <mat-icon>{{ isOnline() ? 'wifi' : 'wifi_off' }}</mat-icon>
        <span>{{ isOnline() ? 'Online' : 'Offline' }}</span>
      </div>
      @if (shift(); as s) {
        <span class="status-divider">&middot;</span>
        <span class="shift-stats">Чеков: {{ s.receipt_count }} &middot; {{ s.total_sales }}\u20BD</span>
      }
    </div>
    <div class="status-right">
      @if (commission() !== null && commission()! > 0) {
        <span class="commission-hint">Комиссия: {{ commission() }}\u20BD</span>
      }
      <span class="shortcut-hint">Esc — закрыть</span>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 12px;
      background: var(--mat-sys-surface-container);
      border-top: 1px solid var(--mat-sys-outline-variant);
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      min-height: 28px;
    }
    .status-left {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .online-indicator {
      display: flex;
      align-items: center;
      gap: 3px;
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }
    .online { color: var(--crm-status-success); }
    .offline { color: var(--crm-status-error); }
    .status-divider { opacity: 0.4; }
    .commission-hint {
      color: var(--crm-status-success);
      font-weight: 600;
      font-size: 12px;
    }
    .shortcut-hint { opacity: 0.6; }
  `],
})
export class PosStatusBarComponent {
  readonly shift = input<PosShift | null>(null);
  readonly isOnline = input(true);
  readonly commission = input<number | null>(null);
}
