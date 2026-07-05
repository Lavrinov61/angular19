import { Component, inject, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { OrdersApiService } from '../../services/orders-api.service';
import { PosApiService } from '../../services/pos-api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { formatRelativeTime } from '../../utils/crm-helpers';
import { employeeApiErrorMessage } from '../../utils/api-error-message';

@Component({
  selector: 'app-order-payment-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
  template: `
    @if (paymentStatus() === 'paid') {
      <div class="paid-badge">
        <mat-icon>check_circle</mat-icon>
        <span class="paid-label">Оплачено</span>
        @if (paidAt()) {
          <span class="paid-date">{{ formatDate(paidAt()!) }}</span>
        }
        @if (paymentCardInfo()) {
          <span class="paid-card">{{ paymentCardInfo() }}</span>
        }
        @if (receiptUrl()) {
          <a [href]="receiptUrl()!" target="_blank" class="receipt-link" matTooltip="Открыть чек">
            <mat-icon>receipt</mat-icon>
          </a>
        }
      </div>
    } @else {
      <div class="payment-section">
        <span class="section-label">Оплата</span>
        <div class="payment-methods">
          <button mat-stroked-button class="pay-btn" (click)="payCash()" [disabled]="processing()">
            <mat-icon>payments</mat-icon> Наличные
          </button>
          <button
            mat-stroked-button
            class="pay-btn"
            matTooltip="Карта принимается через окно оплаты с POS-чеком"
            (click)="payCard()"
            [disabled]="processing()"
          >
            <mat-icon>credit_card</mat-icon> Карта
          </button>
          <button mat-stroked-button class="pay-btn" (click)="paySbp()" [disabled]="processing()">
            <mat-icon>qr_code_2</mat-icon> СБП
          </button>
          <button mat-stroked-button class="pay-btn link-btn" (click)="sendPaymentLink()" [disabled]="processing()">
            <mat-icon>link</mat-icon> Ссылка
          </button>
        </div>
        @if (processing()) {
          <mat-progress-bar mode="indeterminate" class="pay-progress" />
        }
        @if (paymentError()) {
          <div class="pay-error">{{ paymentError() }}</div>
        }
      </div>
    }
  `,
  host: {
    class: 'order-payment-section',
  },
  styles: [`
    :host { display: block; margin-bottom: 8px; }

    .paid-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: var(--crm-radius-md);
      background: var(--crm-status-success-muted);
      color: var(--crm-status-success);
      font-size: 13px;
      font-weight: 600;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .paid-date, .paid-card {
      font-weight: 400;
      color: var(--crm-text-secondary);
      font-size: 12px;
    }

    .receipt-link {
      margin-left: auto;
      color: var(--crm-accent);
      display: flex;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .payment-section {
      padding: 8px 10px;
      border-radius: var(--crm-radius-md);
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
    }

    .section-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--crm-text-muted);
      margin-bottom: 6px;
      display: block;
    }

    .payment-methods {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .pay-btn {
      font-size: 12px;
      height: 32px;
      line-height: 32px;
      border-radius: var(--crm-radius-sm);

      mat-icon { font-size: 15px; width: 15px; height: 15px; margin-right: 3px; }
    }

    .link-btn {
      margin-left: auto;
      color: var(--crm-text-secondary);
    }

    .pay-progress { margin-top: 8px; border-radius: 2px; }

    .pay-error {
      margin-top: 6px;
      font-size: 12px;
      color: var(--crm-status-error);
    }
  `],
})
export class OrderPaymentSectionComponent {
  private readonly ordersApi = inject(OrdersApiService);
  private readonly posApi = inject(PosApiService);
  private readonly toast = inject(ToastService);
  private readonly clipboard = inject(Clipboard);

  orderId = input.required<string>();
  totalPrice = input.required<number>();
  paymentStatus = input.required<string>();
  paidAt = input<string | null>(null);
  receiptUrl = input<string | null>(null);
  paymentCardInfo = input<string | null>(null);
  studioId = input<string | null>(null);

  paymentRecorded = output<void>();

  processing = signal(false);
  paymentError = signal<string | null>(null);

  formatDate(iso: string): string {
    return formatRelativeTime(iso);
  }

  payCash(): void {
    this.recordPayment('cash');
  }

  payCard(): void {
    this.paymentError.set('Оплата картой доступна только через окно оплаты с POS-чеком');
  }

  paySbp(): void {
    const studioId = this.studioId();
    if (!studioId) {
      this.paymentError.set('Нет активной точки для СБП');
      return;
    }

    this.processing.set(true);
    this.paymentError.set(null);

    this.posApi.bridgePay({ amount: this.totalPrice(), orderId: this.orderId(), studioId }).subscribe({
      next: (res) => {
        if (res.success) {
          this.recordPayment('sbp', res.transactionId, res.cardInfo);
        } else {
          this.processing.set(false);
          this.paymentError.set('СБП не завершён');
        }
      },
      error: (err) => {
        this.processing.set(false);
        this.paymentError.set(err?.error?.message ?? 'Ошибка СБП');
      },
    });
  }

  sendPaymentLink(): void {
    this.processing.set(true);
    this.paymentError.set(null);

    this.ordersApi.createPaymentLink({
      amount: this.totalPrice(),
      description: `Заказ ${this.orderId()}`,
      orderId: this.orderId(),
    }).subscribe({
      next: (res) => {
        this.processing.set(false);
        if (res.success) {
          this.clipboard.copy(res.data.paymentUrl);
          this.toast.success('Ссылка скопирована');
        }
      },
      error: (err: unknown) => {
        this.processing.set(false);
        this.paymentError.set(employeeApiErrorMessage(err, 'Ошибка создания ссылки'));
      },
    });
  }

  private recordPayment(method: 'cash' | 'sbp', transactionId?: string, cardInfo?: string): void {
    this.processing.set(true);
    this.paymentError.set(null);

    this.ordersApi.recordPayment(this.orderId(), {
      payment_method: method,
      ...(transactionId ? { transaction_id: transactionId } : {}),
      ...(cardInfo ? { card_info: cardInfo } : {}),
    }).subscribe({
      next: () => {
        this.processing.set(false);
        this.toast.success('Оплата принята');
        this.paymentRecorded.emit();
      },
      error: (err) => {
        this.processing.set(false);
        this.paymentError.set(err?.error?.message ?? 'Ошибка записи оплаты');
      },
    });
  }
}
