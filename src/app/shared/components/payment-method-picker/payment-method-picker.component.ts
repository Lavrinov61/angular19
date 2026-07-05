import { Component, inject, signal, ChangeDetectionStrategy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CloudPaymentsService, PaymentResult } from '../../../core/services/cloud-payments.service';
import type { CartItem } from '../../../features/chat-page/services/cart.service';

interface SavedCard {
  id: string;
  card_first_six: string;
  card_last_four: string;
  card_type: string;
  card_exp_date: string;
  is_default: boolean;
}

export interface PaymentPickerData {
  orderId: string;
  amount: number;
  title: string;
  items?: CartItem[];
  email?: string;
  phone?: string;
  /** Disable saved cards (e.g. for installment payments) */
  disableSavedCards?: boolean;
}

export interface PaymentPickerResult {
  success: boolean;
  method: 'saved' | 'card' | 'sbp';
  transactionId?: number;
  error?: string;
}

@Component({
  selector: 'app-payment-method-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    MatDialogModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatSnackBarModule,
  ],
  template: `
    <div class="picker-container">
      <div class="picker-header">
        <h3 class="picker-title">Способ оплаты</h3>
        <span class="picker-amount">{{ data.amount | number:'1.0-0' }} &#8381;</span>
      </div>

      <div class="picker-subtitle">{{ data.title }}</div>

      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="32" />
        </div>
      } @else {
        <div class="methods-list">
          <!-- Saved cards -->
          @if (!data.disableSavedCards) {
            @for (card of cards(); track card.id) {
              <button class="method-card" [class.default]="card.is_default"
                      [disabled]="paying()" (click)="payWithSavedCard(card)">
                <div class="method-icon" [class]="'card-brand-' + getCardBrand(card.card_type)">
                  <mat-icon>{{ getCardIcon(card.card_type) }}</mat-icon>
                </div>
                <div class="method-info">
                  <span class="method-label">&bull;&bull;&bull;&bull; {{ card.card_last_four }}</span>
                  <span class="method-meta">
                    {{ card.card_type || 'Карта' }}
                    @if (card.card_exp_date) { &middot; до {{ card.card_exp_date }} }
                    @if (card.is_default) { &middot; основная }
                  </span>
                </div>
                <mat-icon class="method-arrow">chevron_right</mat-icon>
              </button>
            }
          }

          <!-- New card -->
          <button class="method-card method-new-card" [disabled]="paying()" (click)="payWithNewCard()">
            <div class="method-icon method-icon--card">
              <mat-icon>credit_card</mat-icon>
            </div>
            <div class="method-info">
              <span class="method-label">Новая карта</span>
              <span class="method-meta">Visa, Mastercard, Мир</span>
            </div>
            <mat-icon class="method-arrow">chevron_right</mat-icon>
          </button>

          <!-- SBP -->
          <button class="method-card method-sbp" [disabled]="paying()" (click)="payWithSbp()">
            <div class="method-icon method-icon--sbp">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L5 6v12l7 4 7-4V6l-7-4z" fill="#00B956"/>
                <path d="M12 2v20M5 6l7 4 7-4M5 18l7-4 7 4" stroke="#fff" stroke-width="1.5"/>
              </svg>
            </div>
            <div class="method-info">
              <span class="method-label">Система быстрых платежей</span>
              <span class="method-meta">{{ isMobile() ? 'Перевод через банк' : 'QR-код для оплаты' }}</span>
            </div>
            <mat-icon class="method-arrow">chevron_right</mat-icon>
          </button>
        </div>

        @if (paying()) {
          <div class="paying-overlay">
            <mat-spinner diameter="28" />
            <span>Обработка оплаты...</span>
          </div>
        }
      }

      <button class="cancel-btn" mat-button (click)="close()" [disabled]="paying()">Отмена</button>
    </div>
  `,
  styles: `
    :host { display: block; }

    .picker-container {
      padding: 24px;
      min-width: 340px;
      max-width: 420px;
    }

    .picker-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .picker-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--ed-on-surface, #1a1a1a);
      margin: 0;
    }
    .picker-amount {
      font-size: 1.35rem;
      font-weight: 800;
      color: var(--ed-on-surface, #1a1a1a);
      letter-spacing: -0.5px;
    }

    .picker-subtitle {
      font-size: 0.82rem;
      color: var(--ed-on-surface-variant, #666);
      margin-bottom: 20px;
    }

    .loading-state {
      display: flex;
      justify-content: center;
      padding: 40px;
    }

    .methods-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .method-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      border: 1.5px solid var(--ed-outline, #e0e0e0);
      border-radius: 14px;
      background: var(--ed-surface, #fff);
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: left;
      width: 100%;
    }
    .method-card:hover:not(:disabled) {
      border-color: #f59e0b;
      background: rgba(245, 158, 11, 0.04);
    }
    .method-card:disabled { opacity: 0.5; cursor: not-allowed; }
    .method-card.default { border-color: rgba(245, 158, 11, 0.4); }

    .method-icon {
      width: 44px; height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .method-icon mat-icon {
      font-size: 22px; width: 22px; height: 22px;
    }

    .card-brand-visa { background: rgba(26, 115, 232, 0.1); }
    .card-brand-visa mat-icon { color: #1a73e8; }
    .card-brand-mastercard { background: rgba(235, 0, 27, 0.1); }
    .card-brand-mastercard mat-icon { color: #eb001b; }
    .card-brand-mir { background: rgba(0, 150, 64, 0.1); }
    .card-brand-mir mat-icon { color: #009640; }
    .card-brand-unknown { background: rgba(150, 150, 150, 0.1); }
    .card-brand-unknown mat-icon { color: #666; }

    .method-icon--card {
      background: rgba(245, 158, 11, 0.12);
    }
    .method-icon--card mat-icon { color: #f59e0b; }

    .method-icon--sbp {
      background: rgba(0, 185, 86, 0.1);
    }
    .method-icon--sbp svg { display: block; }

    .method-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .method-label {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--ed-on-surface, #1a1a1a);
      letter-spacing: 0.5px;
    }
    .method-meta {
      font-size: 0.75rem;
      color: var(--ed-on-surface-variant, #888);
    }

    .method-arrow {
      color: var(--ed-on-surface-variant, #999);
      font-size: 20px; width: 20px; height: 20px;
      flex-shrink: 0;
    }

    .paying-overlay {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 16px;
      margin-top: 12px;
      border-radius: 12px;
      background: rgba(245, 158, 11, 0.08);
      font-size: 0.9rem;
      color: var(--ed-on-surface-variant, #666);
    }

    .cancel-btn {
      display: block;
      width: 100%;
      margin-top: 12px;
      color: var(--ed-on-surface-variant, #888) !important;
    }

    @media (max-width: 480px) {
      .picker-container { min-width: unset; padding: 20px 16px; }
    }
  `,
})
export class PaymentMethodPickerDialogComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly cloudPayments = inject(CloudPaymentsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialogRef = inject(MatDialogRef<PaymentMethodPickerDialogComponent>);
  readonly data: PaymentPickerData = inject(MAT_DIALOG_DATA);
  private readonly platformId = inject(PLATFORM_ID);

  readonly loading = signal(true);
  readonly paying = signal(false);
  readonly cards = signal<SavedCard[]>([]);

  ngOnInit(): void {
    if (this.data.disableSavedCards) {
      this.loading.set(false);
      return;
    }
    this.http.get<{ data: SavedCard[] }>('/api/orders/saved-cards').subscribe({
      next: (res) => {
        this.cards.set(res.data || []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  isMobile(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  getCardBrand(type: string): string {
    const t = (type || '').toLowerCase();
    if (t.includes('visa')) return 'visa';
    if (t.includes('master')) return 'mastercard';
    if (t.includes('mir') || t.includes('мир')) return 'mir';
    return 'unknown';
  }

  getCardIcon(type: string): string {
    const t = (type || '').toLowerCase();
    if (t.includes('mir') || t.includes('мир')) return 'account_balance';
    return 'credit_card';
  }

  async payWithSavedCard(card: SavedCard): Promise<void> {
    this.paying.set(true);
    this.http.post<{ success: boolean; transactionId?: number; message?: string }>(
      '/api/orders/pay-with-saved-card',
      { cardId: card.id, orderId: this.data.orderId },
    ).subscribe({
      next: (res) => {
        this.paying.set(false);
        if (res.success) {
          this.dialogRef.close({
            success: true,
            method: 'saved',
            transactionId: res.transactionId,
          } as PaymentPickerResult);
        } else {
          this.snackBar.open(res.message || 'Ошибка оплаты', 'Закрыть', { duration: 5000 });
        }
      },
      error: (err) => {
        this.paying.set(false);
        this.snackBar.open(err.error?.message || 'Ошибка оплаты картой', 'Закрыть', { duration: 5000 });
      },
    });
  }

  async payWithNewCard(): Promise<void> {
    this.paying.set(true);
    const cartItems = this.data.items || [this.buildCartItem()];
    const result = await this.cloudPayments.pay(
      this.data.orderId, cartItems, this.data.email, this.data.phone,
    );

    if (result.success) {
      const confirmed = await this.cloudPayments.verifyPayment(this.data.orderId);
      this.paying.set(false);
      if (confirmed) {
        this.handleResult(result, 'card');
      } else {
        this.snackBar.open('Не удалось подтвердить оплату. Если деньги списались, напишите нам.', 'Закрыть', { duration: 7000 });
      }
    } else {
      this.paying.set(false);
      this.handleResult(result, 'card');
    }
  }

  async payWithSbp(): Promise<void> {
    this.paying.set(true);
    const cartItems = this.data.items || [this.buildCartItem()];
    const result = await this.cloudPayments.paySbp(
      this.data.orderId, cartItems, this.data.email, this.data.phone,
    );
    this.paying.set(false);
    this.handleResult(result, 'sbp');
  }

  close(): void {
    this.dialogRef.close(null);
  }

  private buildCartItem(): CartItem {
    return {
      service: {
        id: `backend-order-${this.data.orderId}`,
        name: this.data.title,
        description: '',
        price: this.data.amount,
        icon: 'photo_camera',
      },
      quantity: 1,
      backendOrderId: this.data.orderId,
    };
  }

  private handleResult(result: PaymentResult, method: 'card' | 'sbp'): void {
    if (result.success) {
      this.dialogRef.close({
        success: true,
        method,
        transactionId: result.transactionId,
      } as PaymentPickerResult);
    } else if (result.error && result.error !== 'Оплата отменена') {
      this.snackBar.open(result.error, 'Закрыть', { duration: 5000 });
    }
    // If cancelled, keep dialog open
  }
}
