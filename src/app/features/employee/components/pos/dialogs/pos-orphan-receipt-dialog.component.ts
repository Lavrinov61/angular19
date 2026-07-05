import {
  Component, ChangeDetectionStrategy, computed, inject, signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  PosApiService, PosOrphanPayment, PosReceiptItem,
} from '../../../services/pos-api.service';
import { employeeApiErrorMessage } from '../../../utils/api-error-message';

export interface OrphanReceiptDialogData {
  payment: PosOrphanPayment;
  studioId: string;
}

/** Результат: оформлен ли чек (для обновления списка осиротевших в журнале). */
export interface OrphanReceiptDialogResult {
  resolved: boolean;
  receiptId?: string;
}

/** Строка ручного ввода позиции (snapshot осиротевшей оплаты обычно отсутствует). */
interface OrphanItemRow {
  product_name: string;
  quantity: number;
  unit_price: number;
}

@Component({
  selector: 'app-pos-orphan-receipt-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title class="orphan-title">
      <mat-icon class="title-icon">receipt_long</mat-icon>
      Оформить чек по оплате
    </h2>

    <mat-dialog-content class="orphan-content">
      <section class="payment-card">
        <div class="payment-row">
          <span>Сумма оплаты</span>
          <strong>{{ payment.amount | number:'1.0-2' }} ₽</strong>
        </div>
        @if (payment.initiatedAt) {
          <div class="payment-row">
            <span>Время</span>
            <strong>{{ payment.initiatedAt | date:'dd.MM.yyyy HH:mm' }}</strong>
          </div>
        }
        @if (payment.terminalOrderId || payment.orderId) {
          <div class="payment-row">
            <span>Заказ</span>
            <strong>{{ payment.terminalOrderId || payment.orderId }}</strong>
          </div>
        }
        <div class="payment-row">
          <span>Операция</span>
          <strong>{{ shortId(payment.id) }}</strong>
        </div>
      </section>

      <p class="orphan-hint">
        Деньги по карте уже списались, но чек не пробит. Оформите чек на ту же
        сумму — приход уйдёт в ФНС <strong>без повторного списания</strong>.
      </p>

      @if (hasSnapshot()) {
        <section class="items-section">
          <h4>Позиции из снимка корзины</h4>
          <div class="item-list">
            @for (item of snapshotItems(); track $index) {
              <div class="item-row readonly">
                <span class="item-name">{{ item.product_name }}</span>
                <span class="item-qty">{{ item.quantity | number:'1.0-3' }} × {{ item.unit_price | number:'1.0-2' }} ₽</span>
                <strong>{{ item.total | number:'1.0-2' }} ₽</strong>
              </div>
            }
          </div>
        </section>
      } @else {
        <section class="items-section">
          <div class="items-head">
            <h4>Позиции чека</h4>
            <button mat-stroked-button type="button" (click)="addRow()" [disabled]="busy()">
              <mat-icon>add</mat-icon>
              Позиция
            </button>
          </div>

          <div class="item-form-list">
            @for (row of rows(); track $index) {
              <div class="item-form-row">
                <mat-form-field class="name-field" appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Наименование</mat-label>
                  <input
                    matInput
                    [ngModel]="row.product_name"
                    (ngModelChange)="updateRow($index, 'product_name', $event)"
                    [disabled]="busy()"
                  >
                </mat-form-field>
                <mat-form-field class="qty-field" appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Кол-во</mat-label>
                  <input
                    matInput
                    type="number"
                    min="0"
                    step="1"
                    [ngModel]="row.quantity"
                    (ngModelChange)="updateRow($index, 'quantity', $event)"
                    [disabled]="busy()"
                  >
                </mat-form-field>
                <mat-form-field class="price-field" appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Цена, ₽</mat-label>
                  <input
                    matInput
                    type="number"
                    min="0"
                    step="0.01"
                    [ngModel]="row.unit_price"
                    (ngModelChange)="updateRow($index, 'unit_price', $event)"
                    [disabled]="busy()"
                  >
                </mat-form-field>
                <button
                  mat-icon-button
                  type="button"
                  class="remove-btn"
                  aria-label="Удалить позицию"
                  (click)="removeRow($index)"
                  [disabled]="busy() || rows().length <= 1"
                >
                  <mat-icon>delete_outline</mat-icon>
                </button>
              </div>
            }
          </div>

          <div class="totals-row" [class.mismatch]="!totalsMatch()">
            <span>Итого по позициям</span>
            <strong>{{ itemsTotal() | number:'1.0-2' }} ₽</strong>
          </div>
          @if (!totalsMatch()) {
            <p class="totals-note">
              <mat-icon>info</mat-icon>
              Сумма позиций должна совпасть с оплатой ({{ payment.amount | number:'1.0-2' }} ₽).
              Приведите итог к этой сумме, чтобы оформить чек.
            </p>
          }
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions class="orphan-actions">
      <button mat-button mat-dialog-close [disabled]="busy()">Отмена</button>

      <span class="actions-spacer"></span>

      <button
        mat-flat-button
        type="button"
        (click)="createReceipt()"
        [disabled]="busy() || !canSubmit()"
        [matTooltip]="submitHint()"
      >
        @if (creating()) {
          <mat-spinner diameter="18" />
        } @else {
          <mat-icon>check</mat-icon>
        }
        Оформить чек
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .orphan-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .title-icon {
      color: var(--mat-sys-primary);
    }

    .orphan-content {
      width: min(560px, calc(100vw - 48px));
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

    .orphan-hint {
      margin: 12px 0;
      font-size: 13px;
      line-height: 1.4;
      color: var(--mat-sys-on-surface-variant);
    }

    .items-section {
      margin-top: 12px;
    }
    .items-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .items-section h4 {
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      color: var(--mat-sys-on-surface-variant);
    }
    .items-head button mat-icon {
      margin-right: 4px;
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
    .item-row.readonly {
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

    .item-form-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .item-form-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 86px 110px auto;
      gap: 8px;
      align-items: center;
    }
    .name-field, .qty-field, .price-field {
      min-width: 0;
    }
    .remove-btn {
      align-self: center;
    }

    .totals-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-top: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
    }
    .totals-row span {
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }
    .totals-row strong {
      font-size: 16px;
      color: var(--mat-sys-on-surface);
    }
    .totals-row.mismatch strong {
      color: var(--crm-status-warning);
    }
    .totals-note {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin: 8px 0 0;
      font-size: 12px;
      line-height: 1.35;
      color: var(--crm-status-warning);
      mat-icon { flex: 0 0 auto; font-size: 18px; width: 18px; height: 18px; }
    }

    .orphan-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .actions-spacer {
      flex: 1 1 auto;
    }
    .orphan-actions mat-icon {
      margin-right: 4px;
    }

    @media (max-width: 560px) {
      .item-form-row {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          "name name"
          "qty price"
          "remove remove";
      }
      .name-field { grid-area: name; }
      .qty-field { grid-area: qty; }
      .price-field { grid-area: price; }
      .remove-btn { grid-area: remove; justify-self: start; }
    }
  `],
})
export class PosOrphanReceiptDialogComponent {
  readonly data = inject<OrphanReceiptDialogData>(MAT_DIALOG_DATA);
  private readonly posApi = inject(PosApiService);
  private readonly dialogRef =
    inject(MatDialogRef<PosOrphanReceiptDialogComponent, OrphanReceiptDialogResult>);
  private readonly snackBar = inject(MatSnackBar);

  readonly payment = this.data.payment;

  readonly creating = signal(false);
  readonly busy = computed(() => this.creating());

  readonly snapshotItems = computed<PosReceiptItem[]>(() =>
    this.payment.snapshot?.items ?? [],
  );
  readonly hasSnapshot = computed(() => this.snapshotItems().length > 0);

  // Ручной ввод позиций — стартуем с одной строки на полную сумму оплаты.
  readonly rows = signal<OrphanItemRow[]>([
    { product_name: '', quantity: 1, unit_price: this.payment.amount },
  ]);

  readonly itemsTotal = computed(() =>
    this.rows().reduce((sum, row) => sum + this.rowTotal(row), 0),
  );

  readonly totalsMatch = computed(() =>
    Math.abs(this.itemsTotal() - this.payment.amount) <= 0.01,
  );

  readonly canSubmit = computed(() => {
    if (this.hasSnapshot()) return true;
    const hasNamedPositiveRow = this.rows().some(row =>
      row.product_name.trim().length > 0 && this.rowTotal(row) > 0,
    );
    // Сумма позиций должна совпасть с фактически списанной — иначе сервер вернёт 400.
    return hasNamedPositiveRow && this.totalsMatch();
  });

  readonly submitHint = computed(() => {
    if (this.canSubmit()) return '';
    if (this.hasSnapshot()) return '';
    if (!this.totalsMatch()) {
      return 'Сумма позиций должна совпасть с оплатой';
    }
    return 'Заполните хотя бы одну позицию с наименованием и положительной суммой';
  });

  shortId(id: string | null | undefined): string {
    if (!id) return '';
    return id.length > 8 ? id.slice(0, 8) : id;
  }

  addRow(): void {
    this.rows.update(rows => [...rows, { product_name: '', quantity: 1, unit_price: 0 }]);
  }

  removeRow(index: number): void {
    this.rows.update(rows => rows.length <= 1 ? rows : rows.filter((_, i) => i !== index));
  }

  updateRow(index: number, field: keyof OrphanItemRow, value: string | number): void {
    this.rows.update(rows => rows.map((row, i) => {
      if (i !== index) return row;
      if (field === 'product_name') return { ...row, product_name: String(value) };
      const numeric = Number(value);
      return { ...row, [field]: Number.isFinite(numeric) ? numeric : 0 };
    }));
  }

  createReceipt(): void {
    if (!this.canSubmit() || this.busy()) return;
    this.creating.set(true);
    // Со снимком позиции возьмёт сервер; без снимка — передаём ручной ввод.
    const items = this.hasSnapshot() ? undefined : this.buildItems();
    this.posApi.createOrphanReceipt(this.payment.id, items ? { items } : undefined).subscribe({
      next: result => {
        this.creating.set(false);
        this.snackBar.open(
          result.fiscalWarning || 'Чек оформлен, приход пробивается на ККТ',
          'OK',
          { duration: result.fiscalWarning ? 5200 : 3200 },
        );
        this.dialogRef.close({ resolved: true, receiptId: result.receipt?.id });
      },
      error: (err: unknown) => {
        this.creating.set(false);
        this.snackBar.open(
          employeeApiErrorMessage(err, 'Не удалось оформить чек'),
          'OK',
          { duration: 3600 },
        );
      },
    });
  }

  private rowTotal(row: OrphanItemRow): number {
    const quantity = Number(row.quantity) || 0;
    const price = Number(row.unit_price) || 0;
    return Math.max(0, quantity * price);
  }

  private buildItems(): PosReceiptItem[] {
    return this.rows()
      .filter(row => row.product_name.trim().length > 0 && this.rowTotal(row) > 0)
      .map(row => ({
        product_id: null,
        product_name: row.product_name.trim(),
        quantity: Number(row.quantity) || 0,
        unit_price: Number(row.unit_price) || 0,
        discount_amount: 0,
        discount_percent: 0,
        points_used: 0,
        subscription_credits_used: 0,
        total: this.rowTotal(row),
      }));
  }
}
