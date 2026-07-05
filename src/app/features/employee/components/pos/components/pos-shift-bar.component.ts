import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { PosShift, PosShiftFiscalStatus } from '../../../services/pos-api.service';

@Component({
  selector: 'app-pos-shift-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule],
  host: { class: 'pos-shift-bar' },
  template: `
    <div class="shift-info">
      <mat-icon>point_of_sale</mat-icon>
      <span class="shift-number">Смена #{{ shift().shift_number }}</span>
      <span class="shift-divider">&middot;</span>
      <span class="shift-studio">{{ studioName() }}</span>
      @if (commission() !== null && commission()! > 0) {
        <span class="shift-divider">&middot;</span>
        <span class="shift-commission">
          <mat-icon>payments</mat-icon>
          {{ commission() }}\u20BD
        </span>
      }
      @if (onlineEarnings() > 0) {
        <span class="shift-divider">&middot;</span>
        <span class="online-badge" [matTooltip]="'Онлайн-платежи: ' + onlineCount() + ' шт.'">
          <mat-icon>language</mat-icon>
          {{ onlineEarnings() }}\u20BD
        </span>
      }
      @if (shift().fiscal_status; as fiscalStatus) {
        <span class="shift-divider">&middot;</span>
        <span
          class="fiscal-badge"
          [class.fiscal-badge--open]="fiscalStatus.ready"
          [class.fiscal-badge--closed]="!fiscalStatus.ready"
          [matTooltip]="fiscalStatusTooltip(fiscalStatus)"
        >
          <mat-icon>{{ fiscalStatus.ready ? 'receipt_long' : 'receipt' }}</mat-icon>
          {{ fiscalStatusLabel(fiscalStatus) }}
        </span>
      }
    </div>
    <div class="shift-actions">
      @if (canOpenFiscalShift()) {
        <button
          mat-stroked-button
          type="button"
          class="fiscal-action-btn"
          [disabled]="fiscalOpening()"
          (click)="fiscalOpenRequested.emit()"
          matTooltip="Открыть фискальную смену на АТОЛ"
        >
          <mat-icon [class.spin]="fiscalOpening()">{{ fiscalOpening() ? 'sync' : 'point_of_sale' }}</mat-icon>
          <span>{{ fiscalOpening() ? 'Открываю...' : 'Открыть ФР' }}</span>
        </button>
      }
      @if (canCloseFiscalShift()) {
        <button
          mat-stroked-button
          type="button"
          class="fiscal-action-btn fiscal-action-btn--close"
          [disabled]="fiscalClosing()"
          (click)="fiscalCloseRequested.emit()"
          matTooltip="Закрыть фискальную смену на АТОЛ"
        >
          <mat-icon [class.spin]="fiscalClosing()">
            {{ fiscalClosing() ? 'sync' : 'receipt_long' }}
          </mat-icon>
          <span>{{ fiscalClosing() ? 'Закрываю...' : 'Закрыть ФР' }}</span>
        </button>
      }
      <button mat-icon-button [matMenuTriggerFor]="shiftMenu" matTooltip="Действия смены">
        <mat-icon>more_vert</mat-icon>
      </button>
    </div>
    <mat-menu #shiftMenu="matMenu">
      <button mat-menu-item (click)="journalRequested.emit()">
        <mat-icon>receipt_long</mat-icon> Журнал чеков
      </button>
      <button mat-menu-item (click)="reportRequested.emit()">
        <mat-icon>summarize</mat-icon> X-отчёт
      </button>
      <button mat-menu-item (click)="cashWithdrawalRequested.emit()">
        <mat-icon>payments</mat-icon> Изъять наличные
      </button>
      <button mat-menu-item (click)="fiscalSettingsRequested.emit()">
        <mat-icon>settings</mat-icon> Настройки АТОЛ27Ф
      </button>
      <button mat-menu-item (click)="closeRequested.emit()">
        <mat-icon>logout</mat-icon> Закрыть смену
      </button>
    </mat-menu>
  `,
  styles: [`
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      background: var(--mat-sys-surface-container);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      min-height: 48px;
    }
    .shift-info {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }
    .shift-number { font-weight: 600; color: var(--mat-sys-on-surface); }
    .shift-studio {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .shift-divider { opacity: 0.4; }
    .shift-commission {
      display: flex;
      align-items: center;
      gap: 3px;
      color: var(--crm-status-success);
      font-weight: 600;
      font-size: 12px;
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }
    .online-badge {
      display: flex;
      align-items: center;
      gap: 3px;
      color: var(--mat-sys-tertiary, #6D63FF);
      font-weight: 600;
      font-size: 12px;
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }
    .fiscal-badge {
      display: flex;
      align-items: center;
      gap: 3px;
      max-width: 230px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
      font-size: 12px;
      color: var(--mat-sys-error);
      mat-icon { font-size: 14px; width: 14px; height: 14px; flex: 0 0 auto; }
    }
    .fiscal-badge--open { color: var(--crm-status-success); }
    .fiscal-badge--closed { color: var(--mat-sys-error); }
    .shift-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
    }
    .fiscal-action-btn {
      height: 32px;
      padding: 0 10px;
      font-size: 12px;
      white-space: nowrap;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }
    .fiscal-action-btn--close {
      border-color: color-mix(in srgb, var(--mat-sys-error) 55%, transparent);
      color: var(--mat-sys-error);
    }
    .spin { animation: shift-spin 1s linear infinite; }
    @keyframes shift-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @media (max-width: 640px) {
      .fiscal-action-btn {
        min-width: 36px;
        padding: 0 8px;
        span { display: none; }
      }
    }
  `],
})
export class PosShiftBarComponent {
  readonly shift = input.required<PosShift>();
  readonly studioName = input.required<string>();
  readonly commission = input<number | null>(null);
  readonly onlineEarnings = input<number>(0);
  readonly onlineCount = input<number>(0);
  readonly fiscalOpening = input(false);
  readonly fiscalClosing = input(false);
  readonly journalRequested = output();
  readonly reportRequested = output();
  readonly cashWithdrawalRequested = output();
  readonly fiscalOpenRequested = output();
  readonly fiscalCloseRequested = output();
  readonly fiscalSettingsRequested = output();
  readonly closeRequested = output();

  canOpenFiscalShift(): boolean {
    const fiscalStatus = this.shift().fiscal_status;
    return fiscalStatus?.available === true && fiscalStatus.ready !== true;
  }

  canCloseFiscalShift(): boolean {
    const fiscalStatus = this.shift().fiscal_status;
    return fiscalStatus?.available === true && fiscalStatus.ready === true;
  }

  fiscalStatusLabel(status: PosShiftFiscalStatus): string {
    if (status.ready) {
      const openedAt = this.formatTime(status.opened_at);
      const openedBy = status.opened_by ? ` ${status.opened_by}` : '';
      return openedAt ? `ФР открыт ${openedAt}${openedBy}` : 'ФР открыт на АТОЛ';
    }

    if (status.available === false) {
      return 'ФР не настроен';
    }

    return status.shift_status === 'expired' ? 'ФР истёк' : 'ФР закрыт';
  }

  fiscalStatusTooltip(status: PosShiftFiscalStatus): string {
    const source = status.source === 'telemetry' ? 'АТОЛ' : status.source === 'transaction' ? 'команда пульта' : 'нет подтверждения';
    const checkedAt = this.formatDateTime(status.checked_at);
    const openedAt = this.formatDateTime(status.opened_at);
    const openedBy = status.opened_by ?? 'кассир не определён';
    const command = status.command_status ? `, команда: ${status.command_status}` : '';

    if (status.ready) {
      return openedAt
        ? `Фискальная смена открыта. Кассир: ${openedBy}, время: ${openedAt}. Источник: ${source}${command}`
        : `Фискальная смена открыта по данным ${source}. Время и кассир не получены${checkedAt ? `, проверено: ${checkedAt}` : ''}`;
    }

    if (status.available === false) {
      return 'Для этой точки активный POS-agent с ФР не настроен';
    }

    return `Фискальная смена не открыта. Источник: ${source}${checkedAt ? `, проверено: ${checkedAt}` : ''}`;
  }

  private formatTime(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  private formatDateTime(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }
}
