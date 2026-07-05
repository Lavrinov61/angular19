import { Component, ChangeDetectionStrategy, inject, signal, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { PayrollApiService, BankAccount } from '../../services/payroll-api.service';
import { ToastService } from '../../../../core/services/toast.service';

const BANKS = ['Тбанк', 'Сбер', 'Альфа-Банк', 'Другой'] as const;

@Component({
  selector: 'app-bank-account-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <div class="bank-form">
      <h3 class="bank-form-title">
        <mat-icon>account_balance</mat-icon>
        {{ account() ? 'Редактировать реквизиты' : 'Добавить реквизиты' }}
      </h3>

      <div class="bank-form-fields">
        <mat-form-field appearance="outline" class="bank-field">
          <mat-label>Банк</mat-label>
          <mat-select [(ngModel)]="bankName">
            @for (b of banks; track b) {
              <mat-option [value]="b">{{ b }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="bank-field">
          <mat-label>Телефон или номер карты</mat-label>
          <input matInput [(ngModel)]="accountIdentifier" placeholder="+7 или номер карты" />
        </mat-form-field>

        <mat-form-field appearance="outline" class="bank-field">
          <mat-label>ФИО получателя</mat-label>
          <input matInput [(ngModel)]="recipientName" placeholder="Иванов Иван Иванович" />
        </mat-form-field>
      </div>

      <div class="bank-form-actions">
        <button mat-button (click)="cancelled.emit()">Отмена</button>
        <button mat-flat-button color="primary" [disabled]="saving() || !isValid()" (click)="save()">
          <mat-icon>save</mat-icon>
          Сохранить
        </button>
      </div>
    </div>
  `,
  styles: `
    .bank-form {
      padding: 16px 20px;
      border-radius: var(--crm-radius-lg, 12px);
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08);
    }

    .bank-form-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 16px;
      font-size: 15px;
      font-weight: 600;
      color: var(--crm-text-primary, #fff);

      mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--crm-accent, #f59e0b); }
    }

    .bank-form-fields {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
    }

    .bank-field { width: 100%; }

    .bank-form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
    }
  `,
})
export class BankAccountFormComponent {
  private readonly payrollApi = inject(PayrollApiService);
  private readonly toast = inject(ToastService);

  readonly account = input<BankAccount | null>(null);
  readonly saved = output<BankAccount>();
  readonly cancelled = output<void>();

  readonly banks = BANKS;
  readonly saving = signal(false);

  bankName = '';
  accountIdentifier = '';
  recipientName = '';

  constructor() {
    const acc = this.account();
    if (acc) {
      this.bankName = acc.bank_name ?? '';
      this.accountIdentifier = acc.account_identifier ?? '';
      this.recipientName = acc.recipient_name;
    }
  }

  isValid(): boolean {
    return this.bankName.trim().length > 0 && this.recipientName.trim().length > 0;
  }

  save(): void {
    const digits = this.accountIdentifier.replace(/\D/g, '');
    const method = digits.length === 11 ? 'phone_transfer' : 'card_transfer';

    this.saving.set(true);
    this.payrollApi.updateMyBankAccount({
      method,
      bank_name: this.bankName,
      account_identifier: this.accountIdentifier,
      recipient_name: this.recipientName,
    }).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.toast.success('Реквизиты сохранены');
        this.saved.emit(res.account);
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Не удалось сохранить реквизиты');
      },
    });
  }
}
