import {
  Component, ChangeDetectionStrategy, computed, inject, signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  PosApiService, PosInDoubtPayment, PosReceiptItem,
} from '../../../services/pos-api.service';
import { employeeApiErrorMessage } from '../../../utils/api-error-message';

export interface InDoubtResolveDialogData {
  payment: PosInDoubtPayment;
  studioId: string;
}

/** Результат: разрешена ли оплата (для обновления списка зависших в журнале). */
export interface InDoubtResolveDialogResult {
  resolved: boolean;
  receiptId?: string;
}

@Component({
  selector: 'app-pos-indoubt-resolve-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatDialogModule,
    MatDividerModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title class="resolve-title">
      <mat-icon class="title-icon">help_outline</mat-icon>
      Разбор зависшей оплаты
    </h2>

    <mat-dialog-content class="resolve-content">
      <section class="payment-card">
        <div class="payment-row">
          <span>Сумма</span>
          <strong>{{ payment.amount | number:'1.0-2' }} ₽</strong>
        </div>
        @if (payment.initiatedAt) {
          <div class="payment-row">
            <span>Время</span>
            <strong>{{ payment.initiatedAt | date:'dd.MM.yyyy HH:mm' }}</strong>
          </div>
        }
        @if (payment.orderId) {
          <div class="payment-row">
            <span>Заказ</span>
            <strong>{{ payment.orderId }}</strong>
          </div>
        }
        @if (payment.errorMessage) {
          <div class="payment-note">{{ payment.errorMessage }}</div>
        }
      </section>

      <p class="resolve-hint">
        Деньги могли списаться. Сверьте терминал, чтобы убедиться, и не запускайте оплату повторно.
      </p>

      @if (snapshotItems().length > 0) {
        <section class="items-section">
          <h4>Позиции продажи</h4>
          <div class="item-list">
            @for (item of snapshotItems(); track $index) {
              <div class="item-row">
                <span class="item-name">{{ item.product_name }}</span>
                <span class="item-qty">{{ item.quantity | number:'1.0-3' }} × {{ item.unit_price | number:'1.0-2' }} ₽</span>
                <strong>{{ item.total | number:'1.0-2' }} ₽</strong>
              </div>
            }
          </div>
        </section>
      } @else {
        <div class="no-items">
          <mat-icon>inventory_2</mat-icon>
          <p>Позиции этой продажи не сохранились. Завершить можно вручную в кассе: пробейте чек на сумму, выбрав оплату картой.</p>
        </div>
      }

      @if (settlementReport(); as report) {
        <section class="settlement-section">
          <h4>Сверка терминала</h4>
          <pre class="settlement-report">{{ report }}</pre>
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions class="resolve-actions">
      <button
        mat-stroked-button
        type="button"
        (click)="runSettlement()"
        [disabled]="busy()"
      >
        @if (settling()) {
          <mat-spinner diameter="18" />
        } @else {
          <mat-icon>account_balance</mat-icon>
        }
        Сверить терминал
      </button>

      <span class="actions-spacer"></span>

      <button mat-button mat-dialog-close [disabled]="busy()">Закрыть</button>

      <button
        mat-stroked-button
        type="button"
        class="unpaid-btn"
        (click)="resolveUnpaid()"
        [disabled]="busy()"
      >
        @if (resolvingUnpaid()) {
          <mat-spinner diameter="18" />
        } @else {
          <mat-icon>money_off</mat-icon>
        }
        Не оплачено
      </button>

      <button
        mat-flat-button
        type="button"
        (click)="resolvePaid()"
        [disabled]="busy() || snapshotItems().length === 0"
        [matTooltip]="snapshotItems().length === 0 ? 'Нет сохранённых позиций для чека' : ''"
      >
        @if (resolvingPaid()) {
          <mat-spinner diameter="18" />
        } @else {
          <mat-icon>check</mat-icon>
        }
        Подтвердить оплату
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .resolve-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .title-icon {
      color: var(--mat-sys-tertiary, #b58900);
    }

    .resolve-content {
      width: min(540px, calc(100vw - 48px));
    }

    .payment-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px 14px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
    }
    .payment-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }
    .payment-row span {
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }
    .payment-row strong {
      font-size: 15px;
      color: var(--mat-sys-on-surface);
    }
    .payment-note {
      margin-top: 4px;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      overflow-wrap: anywhere;
    }

    .resolve-hint {
      margin: 12px 0;
      font-size: 13px;
      line-height: 1.4;
      color: var(--mat-sys-on-surface-variant);
    }

    .items-section, .settlement-section {
      margin-top: 12px;
    }
    .items-section h4, .settlement-section h4 {
      margin: 0 0 6px;
      font-size: 12px;
      font-weight: 700;
      color: var(--mat-sys-on-surface-variant);
    }
    .item-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      overflow: hidden;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-outline-variant);
    }
    .item-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 8px;
      align-items: center;
      padding: 8px 10px;
      background: var(--mat-sys-surface-container-lowest);
      min-width: 0;
    }
    .item-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item-qty {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .item-row strong {
      white-space: nowrap;
    }

    .no-items {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-status-warning) 12%, transparent);
      color: var(--crm-status-warning);
      mat-icon { flex: 0 0 auto; }
      p { margin: 0; font-size: 13px; line-height: 1.35; }
    }

    .settlement-report {
      margin: 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
      font-size: 12px;
      line-height: 1.4;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 220px;
      overflow: auto;
    }

    .resolve-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .actions-spacer {
      flex: 1 1 auto;
    }
    .unpaid-btn {
      color: var(--crm-status-error);
    }
    .resolve-actions mat-icon {
      margin-right: 4px;
    }
  `],
})
export class PosInDoubtResolveDialogComponent {
  readonly data = inject<InDoubtResolveDialogData>(MAT_DIALOG_DATA);
  private readonly posApi = inject(PosApiService);
  private readonly dialogRef =
    inject(MatDialogRef<PosInDoubtResolveDialogComponent, InDoubtResolveDialogResult>);
  private readonly snackBar = inject(MatSnackBar);

  readonly payment = this.data.payment;

  readonly resolvingPaid = signal(false);
  readonly resolvingUnpaid = signal(false);
  readonly settling = signal(false);
  readonly settlementReport = signal<string | null>(null);

  readonly busy = computed(() =>
    this.resolvingPaid() || this.resolvingUnpaid() || this.settling(),
  );

  readonly snapshotItems = computed<PosReceiptItem[]>(() =>
    this.payment.snapshot?.items ?? [],
  );

  runSettlement(): void {
    this.settling.set(true);
    this.posApi.runBankSettlement(this.data.studioId).subscribe({
      next: () => {
        this.settling.set(false);
        this.settlementReport.set(
          'Сверка запущена. Через несколько секунд проверьте итоги эквайринга в журнале и сравните с суммой оплаты.',
        );
        this.snackBar.open('Сверка терминала запущена', 'OK', { duration: 2600 });
      },
      error: (err: unknown) => {
        this.settling.set(false);
        this.snackBar.open(
          employeeApiErrorMessage(err, 'Не удалось запустить сверку терминала'),
          'OK',
          { duration: 3600 },
        );
      },
    });
  }

  resolvePaid(): void {
    const items = this.snapshotItems();
    if (items.length === 0) return;
    this.resolvingPaid.set(true);
    this.posApi.resolvePayment(this.payment.id, { outcome: 'paid', items }).subscribe({
      next: result => {
        this.resolvingPaid.set(false);
        this.snackBar.open(
          result.fiscalWarning || 'Оплата подтверждена, чек пробивается на ККТ',
          'OK',
          { duration: result.fiscalWarning ? 5200 : 3200 },
        );
        this.dialogRef.close({ resolved: true, receiptId: result.receipt?.id });
      },
      error: (err: unknown) => {
        this.resolvingPaid.set(false);
        this.snackBar.open(
          employeeApiErrorMessage(err, 'Не удалось подтвердить оплату'),
          'OK',
          { duration: 3600 },
        );
      },
    });
  }

  resolveUnpaid(): void {
    this.resolvingUnpaid.set(true);
    this.posApi.resolvePayment(this.payment.id, { outcome: 'unpaid' }).subscribe({
      next: () => {
        this.resolvingUnpaid.set(false);
        this.snackBar.open('Оплата помечена как несостоявшаяся', 'OK', { duration: 2800 });
        this.dialogRef.close({ resolved: true });
      },
      error: (err: unknown) => {
        this.resolvingUnpaid.set(false);
        this.snackBar.open(
          employeeApiErrorMessage(err, 'Не удалось обновить оплату'),
          'OK',
          { duration: 3600 },
        );
      },
    });
  }
}
