import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { PayrollApiService, PayoutRecord } from '../../services/payroll-api.service';
import { ToastService } from '../../../../core/services/toast.service';

export interface PayoutMarkPaidDialogData {
  payout: PayoutRecord;
}

const PAYMENT_METHODS = [
  { value: 'phone_transfer', label: 'Перевод по телефону' },
  { value: 'card_transfer', label: 'Перевод на карту' },
  { value: 'cash', label: 'Наличные' },
] as const;

@Component({
  selector: 'app-payout-mark-paid-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe, FormsModule, MatDialogModule, MatButtonModule,
    MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule,
  ],
  template: `
    <div class="pmp-dialog">
      <div class="pmp-header">
        <mat-icon class="pmp-icon">payments</mat-icon>
        <h2>Отметить выплату</h2>
      </div>

      <div class="pmp-info">
        <div class="pmp-info-row">
          <span class="pmp-label">Сотрудник</span>
          <span class="pmp-value">{{ payout.employee_name }}</span>
        </div>
        @if (payout.payout_account; as acc) {
          <div class="pmp-info-row">
            <span class="pmp-label">Реквизиты</span>
            <span class="pmp-value">{{ acc.bank_name ?? '' }} {{ acc.account_identifier ?? '' }} ({{ acc.recipient_name }})</span>
          </div>
        }
        <div class="pmp-info-row">
          <span class="pmp-label">Комиссия</span>
          <span class="pmp-value">{{ payout.total_commission | number:'1.0-0' }} &#8381;</span>
        </div>
      </div>

      <div class="pmp-fields">
        <mat-form-field appearance="outline" class="pmp-field">
          <mat-label>Способ оплаты</mat-label>
          <mat-select [(ngModel)]="paymentMethod">
            @for (m of paymentMethods; track m.value) {
              <mat-option [value]="m.value">{{ m.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="pmp-field">
          <mat-label>Сумма на руки</mat-label>
          <input matInput type="number" [(ngModel)]="netAmount" min="0" />
          <span matSuffix>&#8381;</span>
        </mat-form-field>

        <mat-form-field appearance="outline" class="pmp-field">
          <mat-label>Номер перевода / комментарий</mat-label>
          <input matInput [(ngModel)]="transferReference" />
        </mat-form-field>
      </div>

      <div class="pmp-actions">
        <button mat-button (click)="dialogRef.close()">Отмена</button>
        <button mat-flat-button color="primary" [disabled]="saving() || netAmount <= 0" (click)="markPaid()">
          <mat-icon>check_circle</mat-icon>
          Оплачено
        </button>
      </div>
    </div>
  `,
  styles: `
    .pmp-dialog {
      width: 460px;
      max-width: 90vw;
      padding: 24px;
      color: var(--crm-text-primary, #f5f5f5);
    }

    .pmp-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 20px;

      h2 { margin: 0; font-size: 20px; font-weight: 600; }
    }

    .pmp-icon { color: var(--crm-accent, #f59e0b); font-size: 28px; width: 28px; height: 28px; }

    .pmp-info {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 16px;
      border-radius: 8px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 20px;
    }

    .pmp-info-row { display: flex; justify-content: space-between; font-size: 13px; }
    .pmp-label { color: var(--crm-text-secondary, #999); }
    .pmp-value { font-weight: 500; }

    .pmp-fields { display: flex; flex-direction: column; gap: 8px; }
    .pmp-field { width: 100%; }

    .pmp-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }
  `,
})
export class PayoutMarkPaidDialogComponent {
  readonly dialogRef = inject<MatDialogRef<PayoutMarkPaidDialogComponent>>(MatDialogRef);
  private readonly data = inject<PayoutMarkPaidDialogData>(MAT_DIALOG_DATA);
  private readonly payrollApi = inject(PayrollApiService);
  private readonly toast = inject(ToastService);

  readonly payout = this.data.payout;
  readonly paymentMethods = PAYMENT_METHODS;
  readonly saving = signal(false);

  paymentMethod = this.payout.payout_account?.method ?? 'phone_transfer';
  netAmount = this.payout.net_amount ?? this.payout.total_commission;
  transferReference = '';

  markPaid(): void {
    this.saving.set(true);
    this.payrollApi.markPaid(this.payout.id, {
      payment_method: this.paymentMethod,
      transfer_reference: this.transferReference || undefined,
      net_amount: this.netAmount,
    }).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.toast.success('Выплата отмечена');
        this.dialogRef.close(res.payout);
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Не удалось отметить выплату');
      },
    });
  }
}
