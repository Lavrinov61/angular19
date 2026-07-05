import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { PosApiService, PosReceipt, PosReceiptItem } from '../../../services/pos-api.service';

export interface PartialRefundDialogData {
  receipt: PosReceipt;
  shiftId: string;
  studioId: string;
}

interface RefundLine {
  item: PosReceiptItem;
  maxQty: number;
  refundQty: number;
  refundAmount: number;
}

@Component({
  selector: 'app-pos-partial-refund-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, FormsModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="refund-icon">undo</mat-icon>
      Возврат по чеку {{ data.receipt.receipt_number }}
    </h2>

    <mat-dialog-content>
      @if (loading()) {
        <div class="refund-loading">
          <mat-spinner diameter="32" />
        </div>
      } @else {
        <div class="refund-table">
          <div class="refund-header">
            <span class="col-name">Товар</span>
            <span class="col-qty">Кол-во</span>
            <span class="col-refund">Возврат</span>
            <span class="col-amount">Сумма</span>
          </div>
          @for (line of lines(); track $index) {
            <div class="refund-row">
              <span class="col-name">{{ line.item.product_name }}</span>
              <span class="col-qty">{{ line.maxQty }}</span>
              <div class="col-refund qty-control">
                <button mat-icon-button
                        [disabled]="line.refundQty === 0"
                        (click)="changeQty($index, -1)">
                  <mat-icon>remove</mat-icon>
                </button>
                <span class="qty-value">{{ line.refundQty }}</span>
                <button mat-icon-button
                        [disabled]="line.refundQty >= line.maxQty"
                        (click)="changeQty($index, 1)">
                  <mat-icon>add</mat-icon>
                </button>
              </div>
              <span class="col-amount">{{ line.refundAmount }}\u20BD</span>
            </div>
          }
        </div>

        <div class="refund-total">
          <span>Итого к возврату:</span>
          <strong>{{ refundTotal() }}\u20BD</strong>
        </div>

        @if (error()) {
          <div class="refund-error">{{ error() }}</div>
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close [disabled]="processing()">Отмена</button>
      <button mat-flat-button color="warn"
              [disabled]="refundTotal() === 0 || processing() || loading()"
              (click)="confirmRefund()">
        @if (processing()) {
          <mat-icon class="spin">sync</mat-icon>
        } @else {
          <mat-icon>undo</mat-icon>
        }
        Оформить возврат
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .refund-icon { color: var(--crm-status-warning); }

    .refund-loading {
      display: flex;
      justify-content: center;
      padding: 32px;
    }

    .refund-table {
      margin-bottom: 12px;
    }
    .refund-header {
      display: flex;
      align-items: center;
      padding: 8px 0;
      font-size: 11px;
      font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .refund-row {
      display: flex;
      align-items: center;
      padding: 6px 0;
      font-size: 13px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .col-name { flex: 3; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .col-qty { flex: 1; text-align: center; }
    .col-refund { flex: 2; display: flex; justify-content: center; }
    .col-amount { flex: 1; text-align: right; font-weight: 600; white-space: nowrap; }

    .qty-control {
      display: flex;
      align-items: center;
      gap: 2px;
      button {
        width: 32px;
        height: 32px;
        mat-icon { font-size: 18px; width: 18px; height: 18px; }
      }
    }
    .qty-value {
      min-width: 20px;
      text-align: center;
      font-weight: 600;
    }

    .refund-total {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-status-warning) 10%, var(--mat-sys-surface));
      font-size: 16px;
      strong {
        font-size: 20px;
        color: var(--crm-status-warning);
      }
    }

    .refund-error {
      color: var(--mat-sys-error);
      font-size: 12px;
      margin-top: 8px;
    }

    .spin {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class PosPartialRefundDialogComponent implements OnInit {
  readonly data = inject<PartialRefundDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PosPartialRefundDialogComponent>);
  private readonly posApi = inject(PosApiService);

  readonly lines = signal<RefundLine[]>([]);
  readonly loading = signal(true);
  readonly processing = signal(false);
  readonly error = signal<string | null>(null);

  readonly refundTotal = computed(() =>
    Math.round(this.lines().reduce((sum, l) => sum + l.refundAmount, 0) * 100) / 100,
  );

  ngOnInit(): void {
    this.posApi.getReceiptById(this.data.receipt.id).subscribe({
      next: (receipt) => {
        this.lines.set(
          receipt.items.map(item => ({
            item,
            maxQty: item.quantity,
            refundQty: 0,
            refundAmount: 0,
          })),
        );
        this.loading.set(false);
      },
      error: () => {
        // Fallback to data from the journal
        this.lines.set(
          this.data.receipt.items.map(item => ({
            item,
            maxQty: item.quantity,
            refundQty: 0,
            refundAmount: 0,
          })),
        );
        this.loading.set(false);
      },
    });
  }

  changeQty(index: number, delta: number): void {
    const current = this.lines();
    const line = current[index];
    const newQty = Math.max(0, Math.min(line.maxQty, line.refundQty + delta));
    const unitPrice = line.item.total / line.item.quantity;
    const refundAmount = Math.round(newQty * unitPrice * 100) / 100;

    this.lines.set(
      current.map((l, i) => i === index ? { ...l, refundQty: newQty, refundAmount } : l),
    );
  }

  confirmRefund(): void {
    const itemsToRefund = this.lines()
      .filter(l => l.refundQty > 0)
      .map(l => ({
        product_id: l.item.product_id || '',
        quantity: l.refundQty,
        amount: l.refundAmount,
      }));

    if (itemsToRefund.length === 0) return;

    this.processing.set(true);
    this.error.set(null);

    this.posApi.partialRefund(this.data.receipt.id, {
      shift_id: this.data.shiftId,
      studio_id: this.data.studioId,
      items: itemsToRefund,
    }).subscribe({
      next: () => {
        this.processing.set(false);
        this.dialogRef.close(true);
      },
      error: (err: { error?: { error?: string } }) => {
        this.processing.set(false);
        this.error.set(err.error?.error || 'Не удалось оформить возврат');
      },
    });
  }
}
