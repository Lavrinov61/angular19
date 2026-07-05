import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import {
  PosApiService,
  PosFiscalSettings,
  PosFiscalSettingsUpdate,
  PosShiftFiscalStatus,
} from '../../../services/pos-api.service';

export interface PosFiscalSettingsDialogData {
  studioId: string;
  studioName: string;
  fiscalStatus: PosShiftFiscalStatus | null;
}

@Component({
  selector: 'app-pos-fiscal-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatTabsModule,
  ],
  host: { class: 'pos-fiscal-settings-dialog' },
  template: `
    <header class="dialog-header">
      <div>
        <h2 mat-dialog-title>Настройки АТОЛ27Ф</h2>
        <p>{{ data.studioName }}</p>
      </div>
      <span class="status" [class.status--open]="data.fiscalStatus?.ready === true">
        <mat-icon>{{ data.fiscalStatus?.ready ? 'receipt_long' : 'receipt' }}</mat-icon>
        {{ data.fiscalStatus?.ready ? 'ФР открыт' : 'ФР закрыт' }}
      </span>
    </header>

    <mat-dialog-content>
      @if (loading()) {
        <div class="loading">
          <mat-spinner diameter="32" />
        </div>
      } @else if (settings(); as form) {
        <div class="enabled-row">
          <mat-slide-toggle [(ngModel)]="form.enabled" name="fiscal-enabled">
            Управление АТОЛ27Ф включено для точки
          </mat-slide-toggle>
        </div>

        <mat-tab-group animationDuration="120ms">
          <mat-tab label="Чек">
            <div class="tab-grid">
              <mat-slide-toggle [(ngModel)]="form.receipt_settings.print_receipt" name="receipt-print">
                Печатать фискальный чек
              </mat-slide-toggle>
              <mat-form-field appearance="outline">
                <mat-label>Копий чека</mat-label>
                <input matInput type="number" min="1" max="3" [(ngModel)]="form.receipt_settings.receipt_copies" name="receipt-copies">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>ИНН кассира</mat-label>
                <input matInput maxlength="12" inputmode="numeric" [(ngModel)]="form.receipt_settings.cashier_inn" name="cashier-inn">
              </mat-form-field>
              <div class="toggle-grid">
                <mat-slide-toggle [(ngModel)]="form.receipt_settings.show_cashier" name="show-cashier">Кассир</mat-slide-toggle>
                <mat-slide-toggle [(ngModel)]="form.receipt_settings.show_receipt_number" name="show-receipt-number">Номер чека</mat-slide-toggle>
                <mat-slide-toggle [(ngModel)]="form.receipt_settings.show_order_number" name="show-order-number">Номер заказа</mat-slide-toggle>
                <mat-slide-toggle [(ngModel)]="form.receipt_settings.show_customer" name="show-customer">Клиент</mat-slide-toggle>
              </div>
            </div>

            <mat-divider />

            <section class="line-section">
              <h3>Верх чека</h3>
              @for (line of form.receipt_settings.header_lines; track $index) {
                <mat-form-field appearance="outline">
                  <mat-label>Строка {{ $index + 1 }}</mat-label>
                  <input matInput maxlength="64" [(ngModel)]="form.receipt_settings.header_lines[$index]" [name]="'receipt-header-' + $index">
                </mat-form-field>
              }
            </section>

            <section class="line-section">
              <h3>Низ чека</h3>
              @for (line of form.receipt_settings.footer_lines; track $index) {
                <mat-form-field appearance="outline">
                  <mat-label>Строка {{ $index + 1 }}</mat-label>
                  <input matInput maxlength="64" [(ngModel)]="form.receipt_settings.footer_lines[$index]" [name]="'receipt-footer-' + $index">
                </mat-form-field>
              }
            </section>
          </mat-tab>

          <mat-tab label="Слип">
            <div class="tab-grid">
              <mat-slide-toggle [(ngModel)]="form.slip_settings.print_bank_slip_on_atol" name="slip-print">
                Печатать банковский слип на АТОЛ27Ф
              </mat-slide-toggle>
              <mat-form-field appearance="outline">
                <mat-label>Копий слипа</mat-label>
                <input matInput type="number" min="1" max="3" [(ngModel)]="form.slip_settings.bank_slip_copies" name="slip-copies">
              </mat-form-field>
              <div class="toggle-grid">
                <mat-slide-toggle [(ngModel)]="form.slip_settings.print_merchant_copy" name="slip-merchant">Копия продавца</mat-slide-toggle>
                <mat-slide-toggle [(ngModel)]="form.slip_settings.print_customer_copy" name="slip-customer">Копия клиента</mat-slide-toggle>
                <mat-slide-toggle [(ngModel)]="form.slip_settings.include_rrn" name="slip-rrn">RRN</mat-slide-toggle>
                <mat-slide-toggle [(ngModel)]="form.slip_settings.include_approval_code" name="slip-approval">Код авторизации</mat-slide-toggle>
                <mat-slide-toggle [(ngModel)]="form.slip_settings.include_card_mask" name="slip-mask">Маска карты</mat-slide-toggle>
                <mat-slide-toggle [(ngModel)]="form.slip_settings.include_sbp_id" name="slip-sbp">ID СБП</mat-slide-toggle>
              </div>
            </div>

            <mat-divider />

            <section class="line-section">
              <h3>Низ слипа</h3>
              @for (line of form.slip_settings.footer_lines; track $index) {
                <mat-form-field appearance="outline">
                  <mat-label>Строка {{ $index + 1 }}</mat-label>
                  <input matInput maxlength="64" [(ngModel)]="form.slip_settings.footer_lines[$index]" [name]="'slip-footer-' + $index">
                </mat-form-field>
              }
            </section>
          </mat-tab>

          <mat-tab label="Смена">
            <div class="tab-grid">
              <mat-slide-toggle [(ngModel)]="form.shift_settings.auto_open_before_card_sbp" name="auto-open">
                Предлагать открыть ФР перед картой/СБП
              </mat-slide-toggle>
              <mat-slide-toggle [(ngModel)]="form.shift_settings.auto_close_on_last_pos_shift_close" name="auto-close">
                Закрывать ФР при закрытии POS-смены
              </mat-slide-toggle>
              <mat-slide-toggle [(ngModel)]="form.shift_settings.print_open_report" name="print-open-report">
                Печатать отчёт открытия смены
              </mat-slide-toggle>
              <mat-slide-toggle [(ngModel)]="form.shift_settings.print_close_report" name="print-close-report">
                Печатать Z-отчёт при закрытии ФР
              </mat-slide-toggle>
            </div>
          </mat-tab>
        </mat-tab-group>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close [disabled]="saving()">Отмена</button>
      <button mat-flat-button type="button" (click)="save()" [disabled]="loading() || saving()">
        @if (saving()) {
          <mat-spinner diameter="18" />
        } @else {
          <mat-icon>save</mat-icon>
        }
        Сохранить
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: block;
      width: min(760px, calc(100vw - 24px));
    }
    .dialog-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 24px 0;
      h2 {
        margin: 0;
        padding: 0;
        font-size: 20px;
      }
      p {
        margin: 4px 0 0;
        color: var(--mat-sys-on-surface-variant);
        font-size: 13px;
      }
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-error);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }
    .status--open {
      color: var(--crm-status-success);
    }
    mat-dialog-content {
      min-height: 420px;
    }
    .loading {
      min-height: 240px;
      display: grid;
      place-items: center;
    }
    .enabled-row {
      padding: 8px 0 12px;
    }
    .tab-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px 16px;
      padding: 18px 0;
      align-items: center;
    }
    .toggle-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      grid-column: 1 / -1;
    }
    .line-section {
      padding: 16px 0 4px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      h3 {
        grid-column: 1 / -1;
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }
    }
    mat-dialog-actions mat-spinner {
      margin-right: 6px;
    }
    @media (max-width: 640px) {
      .dialog-header {
        flex-direction: column;
      }
      .tab-grid,
      .toggle-grid,
      .line-section {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class PosFiscalSettingsDialogComponent {
  private readonly posApi = inject(PosApiService);
  private readonly dialogRef = inject(MatDialogRef<PosFiscalSettingsDialogComponent>);
  private readonly snackBar = inject(MatSnackBar);
  readonly data = inject<PosFiscalSettingsDialogData>(MAT_DIALOG_DATA);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly settings = signal<PosFiscalSettings | null>(null);

  constructor() {
    this.posApi.getFiscalSettings(this.data.studioId).subscribe({
      next: (settings) => {
        this.settings.set(this.prepareSettings(settings));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Не удалось загрузить настройки АТОЛ27Ф', 'OK', { duration: 5000 });
      },
    });
  }

  save(): void {
    const settings = this.settings();
    if (!settings || this.saving()) return;

    this.saving.set(true);
    this.posApi.updateFiscalSettings(this.toPayload(settings)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.dialogRef.close(saved);
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Не удалось сохранить настройки АТОЛ27Ф', 'OK', { duration: 5000 });
      },
    });
  }

  private prepareSettings(settings: PosFiscalSettings): PosFiscalSettings {
    return {
      ...settings,
      receipt_settings: {
        ...settings.receipt_settings,
        header_lines: this.padLines(settings.receipt_settings.header_lines),
        footer_lines: this.padLines(settings.receipt_settings.footer_lines),
      },
      slip_settings: {
        ...settings.slip_settings,
        footer_lines: this.padLines(settings.slip_settings.footer_lines),
      },
    };
  }

  private toPayload(settings: PosFiscalSettings): PosFiscalSettingsUpdate {
    return {
      studio_id: settings.studio_id,
      agent_id: settings.agent_id,
      enabled: settings.enabled,
      receipt_settings: {
        ...settings.receipt_settings,
        receipt_copies: this.copyCount(settings.receipt_settings.receipt_copies),
        header_lines: this.cleanLines(settings.receipt_settings.header_lines),
        footer_lines: this.cleanLines(settings.receipt_settings.footer_lines),
        cashier_inn: this.cleanInn(settings.receipt_settings.cashier_inn),
      },
      slip_settings: {
        ...settings.slip_settings,
        bank_slip_copies: this.copyCount(settings.slip_settings.bank_slip_copies),
        footer_lines: this.cleanLines(settings.slip_settings.footer_lines),
      },
      shift_settings: { ...settings.shift_settings },
    };
  }

  private padLines(lines: string[]): string[] {
    const result = [...lines].slice(0, 4);
    while (result.length < 4) result.push('');
    return result;
  }

  private cleanLines(lines: string[]): string[] {
    return lines
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .slice(0, 4)
      .map(line => line.slice(0, 64));
  }

  private copyCount(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.min(3, Math.max(1, Math.trunc(value)));
  }

  private cleanInn(value: string | null): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, '').slice(0, 12);
    return digits.length === 10 || digits.length === 12 ? digits : null;
  }
}
