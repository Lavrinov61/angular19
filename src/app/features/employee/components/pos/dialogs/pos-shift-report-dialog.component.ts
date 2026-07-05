import {
  Component, ChangeDetectionStrategy, inject, signal, OnInit,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DecimalPipe } from '@angular/common';
import { PosApiService, ShiftReport } from '../../../services/pos-api.service';
import { PosSalesApiService, SalesDashboard } from '../../../services/pos-sales-api.service';
import { ShiftsApiService } from '../../../services/shifts-api.service';

export interface ShiftReportDialogData {
  shiftId: string;
  shiftNumber: number;
  isCloseShiftSummary?: boolean;
  zReportSent?: boolean;
}

@Component({
  selector: 'app-pos-shift-report-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, DecimalPipe],
  template: `
    <h2 mat-dialog-title>
      @if (data.isCloseShiftSummary) {
        Итоги смены #{{ data.shiftNumber }}
      } @else {
        X-отчёт · Смена #{{ data.shiftNumber }}
      }
    </h2>

    <mat-dialog-content>
      @if (loading()) {
        <div class="report-loading">
          <mat-spinner diameter="32" />
        </div>
      } @else if (report()) {
        <!-- Main stats grid -->
        <div class="report-grid">
          <div class="report-item highlight">
            <span class="report-label">Нетто</span>
            <span class="report-value">{{ formatAmount(report()!.net_sales) }}\u20BD</span>
          </div>
          <div class="report-item accent">
            <span class="report-label">Средний чек</span>
            <span class="report-value">{{ formatAmount(report()!.avg_receipt) }}\u20BD</span>
          </div>
          <div class="report-item">
            <span class="report-label">Чеков</span>
            <span class="report-value">{{ report()!.receipts_count }}</span>
          </div>
          <div class="report-item">
            <span class="report-label">Продажи</span>
            <span class="report-value">{{ formatAmount(report()!.total_sales) }}\u20BD</span>
          </div>
          <div class="report-item">
            <span class="report-label">Возвратов</span>
            <span class="report-value">{{ report()!.refunds_count }}</span>
          </div>
          <div class="report-item">
            <span class="report-label">Сумма возвратов</span>
            <span class="report-value">{{ formatAmount(report()!.total_refunds) }}\u20BD</span>
          </div>
          @if (report()!.voided_count > 0) {
            <div class="report-item warn">
              <span class="report-label">Аннулировано</span>
              <span class="report-value">{{ report()!.voided_count }}</span>
            </div>
          }
        </div>

        <!-- Payment breakdown -->
        <div class="section-title">Оплата по типам</div>
        <div class="payment-grid">
          <div class="payment-row">
            <mat-icon>payments</mat-icon>
            <span class="payment-label">Наличные</span>
            <span class="payment-value">{{ formatAmount(report()!.cash_payments) }}\u20BD</span>
          </div>
          <div class="payment-row">
            <mat-icon>credit_card</mat-icon>
            <span class="payment-label">Карты</span>
            <span class="payment-value">{{ formatAmount(report()!.card_payments) }}\u20BD</span>
          </div>
          <div class="payment-row">
            <mat-icon>qr_code_2</mat-icon>
            <span class="payment-label">СБП</span>
            <span class="payment-value">{{ formatAmount(report()!.sbp_payments) }}\u20BD</span>
          </div>
        </div>

        <!-- Cash desk -->
        <div class="section-title">Касса</div>
        <div class="payment-grid">
          <div class="payment-row">
            <mat-icon>account_balance_wallet</mat-icon>
            <span class="payment-label">На начало</span>
            <span class="payment-value">{{ formatAmount(report()!.shift.cash_at_open) }}\u20BD</span>
          </div>
          <div class="payment-row">
            <mat-icon>remove_circle_outline</mat-icon>
            <span class="payment-label">Изъято</span>
            <span class="payment-value">{{ formatAmount(report()!.cash_withdrawals) }}\u20BD</span>
          </div>
          <div class="payment-row">
            <mat-icon>calculate</mat-icon>
            <span class="payment-label">Ожидалось</span>
            <span class="payment-value">{{ formatAmount(expectedCash(report()!)) }}\u20BD</span>
          </div>
          @if (report()!.shift.cash_at_close !== null) {
            <div class="payment-row">
              <mat-icon>fact_check</mat-icon>
              <span class="payment-label">Пересчитано</span>
              <span class="payment-value">{{ formatAmount(report()!.shift.cash_at_close ?? 0) }}\u20BD</span>
            </div>
            <div class="payment-row">
              <mat-icon>compare_arrows</mat-icon>
              <span class="payment-label">Расхождение</span>
              <span class="payment-value" [class.good]="cashDifference(report()!) >= 0" [class.bad]="cashDifference(report()!) < 0">
                {{ formatSignedAmount(cashDifference(report()!)) }}\u20BD
              </span>
            </div>
          }
        </div>

        @if (report()!.cash_movements.length > 0) {
          <div class="cash-movements">
            @for (movement of report()!.cash_movements; track movement.id) {
              <div class="cash-movement-row">
                <span class="movement-reason">{{ movement.reason }}</span>
                <span class="movement-amount">−{{ formatAmount(movement.amount) }}\u20BD</span>
              </div>
            }
          </div>
        }

        <!-- Online sales -->
        @if (onlineSales(); as online) {
          @if (online.count > 0) {
            <div class="report-section">
              <div class="section-title">Онлайн-платежи из чата</div>
              <div class="online-stats-grid">
                <div class="online-stat">
                  <span class="stat-label">Платежей</span>
                  <span class="stat-value">{{ online.count }}</span>
                </div>
                <div class="online-stat">
                  <span class="stat-label">Сумма</span>
                  <span class="stat-value">{{ online.amount | number:'1.0-0' }} \u20BD</span>
                </div>
                <div class="online-stat">
                  <span class="stat-label">Комиссия</span>
                  <span class="stat-value accent">{{ online.commission | number:'1.0-0' }} \u20BD</span>
                </div>
              </div>
            </div>
          }
        }

        <!-- Top services -->
        @if (report()!.top_services.length > 0) {
          <div class="section-title">Топ услуг по выручке</div>
          <div class="top-services">
            @for (svc of report()!.top_services; track svc.product_name; let i = $index) {
              <div class="service-row">
                <span class="service-rank">#{{ i + 1 }}</span>
                <span class="service-name">{{ svc.product_name }}</span>
                <span class="service-qty">{{ svc.quantity }}x</span>
                <span class="service-revenue">{{ formatAmount(svc.revenue) }}\u20BD</span>
              </div>
            }
          </div>
        }

        <!-- Commission -->
        @if (commission()) {
          <div class="commission-block">
            <mat-icon class="commission-icon">paid</mat-icon>
            <span class="commission-label">Ваша комиссия:</span>
            <span class="commission-value">{{ commission()!.total_commission }}\u20BD</span>
          </div>
        }

        <!-- F54: Z-report status -->
        @if (data.isCloseShiftSummary && data.zReportSent) {
          <div class="z-report-block">
            <mat-icon class="z-report-icon">receipt_long</mat-icon>
            <span class="z-report-label">Z-отчёт отправлен на ККТ</span>
          </div>
        }
      }

      @if (error()) {
        <div class="report-error">
          <mat-icon>error</mat-icon>
          <p>{{ error() }}</p>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close>Закрыть</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .report-loading {
      display: flex;
      justify-content: center;
      padding: 32px;
    }

    .report-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .report-item {
      display: flex;
      flex-direction: column;
      padding: 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
    }

    .report-label {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 4px;
    }

    .report-value {
      font-size: 20px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
    }

    .highlight {
      background: color-mix(in srgb, var(--mat-sys-primary) 15%, var(--mat-sys-surface));
      .report-value { color: var(--mat-sys-primary); }
    }

    .accent {
      background: color-mix(in srgb, var(--crm-accent, var(--mat-sys-tertiary)) 12%, var(--mat-sys-surface));
      .report-value { color: var(--crm-accent, var(--mat-sys-tertiary)); }
    }

    .warn {
      background: color-mix(in srgb, var(--mat-sys-error) 10%, var(--mat-sys-surface));
      .report-value { color: var(--mat-sys-error); }
    }

    /* ── Section title ── */
    .section-title {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--mat-sys-on-surface-variant);
      margin: 16px 0 8px;
    }

    /* ── Payment grid ── */
    .payment-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .payment-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .payment-label {
      flex: 1;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }

    .payment-value {
      font-size: 14px;
      font-weight: 600;
      font-family: var(--crm-font-mono, monospace);
      color: var(--mat-sys-on-surface);

      &.good { color: var(--crm-status-success, #16a34a); }
      &.bad { color: var(--mat-sys-error); }
    }

    .cash-movements {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
    }

    .cash-movement-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--mat-sys-error) 6%, var(--mat-sys-surface));
    }

    .movement-reason {
      flex: 1;
      min-width: 0;
      color: var(--mat-sys-on-surface);
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .movement-amount {
      color: var(--mat-sys-error);
      font-family: var(--crm-font-mono, monospace);
      font-weight: 700;
      font-size: 13px;
    }

    /* ── Top services ── */
    .top-services {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .service-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
    }

    .service-rank {
      font-size: 11px;
      font-weight: 700;
      color: var(--mat-sys-on-surface-variant);
      min-width: 20px;
    }

    .service-name {
      flex: 1;
      font-size: 13px;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .service-qty {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      font-family: var(--crm-font-mono, monospace);
    }

    .service-revenue {
      font-size: 14px;
      font-weight: 600;
      font-family: var(--crm-font-mono, monospace);
      color: var(--mat-sys-on-surface);
      min-width: 60px;
      text-align: right;
    }

    /* ── Commission ── */
    .commission-block {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-status-success) 10%, var(--mat-sys-surface));
      margin-top: 16px;
    }
    .commission-icon {
      color: var(--crm-status-success);
    }
    .commission-label {
      font-size: 14px;
      color: var(--mat-sys-on-surface-variant);
    }
    .commission-value {
      font-size: 20px;
      font-weight: 700;
      color: var(--crm-status-success);
      margin-left: auto;
    }

    /* ── Z-report indicator ── */
    .z-report-block {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, var(--mat-sys-surface));
      margin-top: 12px;
    }
    .z-report-icon {
      color: var(--mat-sys-primary);
    }
    .z-report-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--mat-sys-on-surface);
    }

    /* ── Online sales ── */
    .online-stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 8px;
    }
    .online-stat {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px;
      background: color-mix(in srgb, var(--mat-sys-tertiary, #6D63FF) 8%, var(--mat-sys-surface));
      border-radius: 8px;
    }
    .online-stat .stat-label {
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .online-stat .stat-value {
      font-size: 18px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
    }
    .online-stat .stat-value.accent {
      color: var(--mat-sys-primary);
    }

    .report-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 24px;
      text-align: center;
      mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--mat-sys-error); }
    }
  `],
})
export class PosShiftReportDialogComponent implements OnInit {
  readonly data = inject<ShiftReportDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PosShiftReportDialogComponent>);
  private readonly posApi = inject(PosApiService);
  private readonly salesApi = inject(PosSalesApiService);
  private readonly shiftsApi = inject(ShiftsApiService);

  readonly report = signal<ShiftReport | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly commission = signal<SalesDashboard | null>(null);
  readonly onlineSales = signal<{ count: number; amount: number; commission: number } | null>(null);

  ngOnInit(): void {
    this.posApi.getShiftReport(this.data.shiftId).subscribe({
      next: (r) => {
        this.report.set(r);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error || 'Не удалось загрузить отчёт');
        this.loading.set(false);
      },
    });

    this.salesApi.getDashboard().subscribe({
      next: (d) => this.commission.set(d),
      error: () => this.commission.set(null),
    });

    this.shiftsApi.getOnlineEarnings(this.data.shiftId).subscribe({
      next: (res) => {
        if (res.success && res.data) this.onlineSales.set(res.data);
      },
      error: () => this.onlineSales.set(null),
    });
  }

  formatAmount(value: number): string {
    return Math.round(value).toLocaleString('ru-RU');
  }

  expectedCash(report: ShiftReport): number {
    return report.shift.expected_cash
      ?? report.shift.cash_at_open + report.cash_payments - report.cash_withdrawals;
  }

  cashDifference(report: ShiftReport): number {
    return (report.shift.cash_at_close ?? 0) - this.expectedCash(report);
  }

  formatSignedAmount(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${this.formatAmount(value)}`;
  }
}
