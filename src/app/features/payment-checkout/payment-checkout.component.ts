import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CloudPaymentsService, PaymentResult } from '../../core/services/cloud-payments.service';
import { CartItem } from '../../features/chat-page/services/cart.service';

interface CheckoutOrderItem {
  name: string;
  price: number;
  quantity?: number;
  priceNote?: string | null;
  discountLabel?: string | null;
}

interface CheckoutOrder {
  id: string;
  status: string;
  paymentStatus: string;
  totalPrice: number;
  description: string | null;
  items: CheckoutOrderItem[];
  priceNote?: string | null;
  deliveryAddress: string | null;
  receiptUrl: string | null;
}

type CheckoutState = 'loading' | 'not_found' | 'expired' | 'already_paid' | 'ready' | 'paying' | 'success' | 'error';

@Component({
  selector: 'app-payment-checkout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatCheckboxModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="checkout-page">
      @switch (state()) {
        @case ('loading') {
          <div class="center-state">
            <mat-spinner diameter="40" />
            <p>Загрузка заказа...</p>
          </div>
        }

        @case ('not_found') {
          <mat-card class="state-card" appearance="outlined">
            <mat-card-content>
              <div class="state-icon error-icon">
                <mat-icon>search_off</mat-icon>
              </div>
              <h2>Заказ не найден</h2>
              <p>Проверьте ссылку или свяжитесь с нами</p>
              <a mat-flat-button routerLink="/chat" class="action-btn">
                <mat-icon>chat</mat-icon>
                Написать в чат
              </a>
            </mat-card-content>
          </mat-card>
        }

        @case ('expired') {
          <mat-card class="state-card" appearance="outlined">
            <mat-card-content>
              <div class="state-icon warn-icon">
                <mat-icon>schedule</mat-icon>
              </div>
              <h2>Срок оплаты истёк</h2>
              <p>Напишите нам в чат, мы создадим новую ссылку</p>
              <a mat-flat-button routerLink="/chat" class="action-btn">
                <mat-icon>chat</mat-icon>
                Написать в чат
              </a>
            </mat-card-content>
          </mat-card>
        }

        @case ('already_paid') {
          <mat-card class="state-card" appearance="outlined">
            <mat-card-content>
              <div class="state-icon success-icon">
                <mat-icon>check_circle</mat-icon>
              </div>
              <h2>Заказ уже оплачен</h2>
              <p>Мы работаем над вашим заказом</p>
              @if (order(); as o) {
                <a mat-flat-button [routerLink]="'/track/' + o.id" class="action-btn">
                  <mat-icon>local_shipping</mat-icon>
                  Отследить заказ
                </a>
              }
            </mat-card-content>
          </mat-card>
        }

        @case ('success') {
          <mat-card class="state-card" appearance="outlined">
            <mat-card-content>
              <div class="state-icon success-icon pulse">
                <mat-icon>check_circle</mat-icon>
              </div>
              <h2>Оплата прошла!</h2>
              <p>Спасибо! Мы начнём выполнение заказа</p>
              @if (order(); as o) {
                <a mat-flat-button [routerLink]="'/track/' + o.id" class="action-btn">
                  <mat-icon>local_shipping</mat-icon>
                  Отследить заказ
                </a>
              }
            </mat-card-content>
          </mat-card>
        }

        @case ('error') {
          <mat-card class="state-card" appearance="outlined">
            <mat-card-content>
              <div class="state-icon error-icon">
                <mat-icon>error_outline</mat-icon>
              </div>
              <h2>{{ errorMessage() }}</h2>
              <p>Попробуйте ещё раз или свяжитесь с нами</p>
              <div class="action-row">
                <button mat-flat-button class="action-btn" (click)="retryLoad()">
                  <mat-icon>refresh</mat-icon>
                  Попробовать снова
                </button>
                <a mat-stroked-button routerLink="/chat">
                  <mat-icon>chat</mat-icon>
                  Чат
                </a>
              </div>
            </mat-card-content>
          </mat-card>
        }

        @case ('ready') {
          @if (order(); as o) {
            <!-- Карточка заказа -->
            <mat-card class="order-card" appearance="outlined">
              <div class="order-header">
                <span class="order-label">Своё Фото</span>
                <h1>{{ o.description || 'Оплата услуг' }}</h1>
              </div>

              @if (orderPriceNote(); as note) {
                <div class="order-note">
                  <mat-icon>info</mat-icon>
                  <span>{{ note }}</span>
                </div>
              }

              @if (o.items.length > 0) {
                <div class="items-section">
                  @for (item of o.items; track $index) {
                    <div class="item-row">
                      <div class="item-info">
                        <span class="item-name">{{ item.name }}</span>
                        @if (item.discountLabel) {
                          <span class="item-discount">{{ item.discountLabel }}</span>
                        }
                      </div>
                      @if (item.price) {
                        <span class="item-price">{{ item.price | number:'1.0-0' }} &#8381;</span>
                      }
                    </div>
                  }
                </div>
              }

              @if (o.deliveryAddress) {
                <div class="pickup-summary">
                  <mat-icon>storefront</mat-icon>
                  <span>{{ o.deliveryAddress }}</span>
                </div>
              }

              <!-- Промокод -->
              <div class="promo-section">
                @if (!promoApplied()) {
                  <div class="promo-input-row">
                    <mat-icon class="promo-icon">local_offer</mat-icon>
                    <input
                      class="promo-input"
                      placeholder="ПРОМОКОД"
                      [value]="promoCode()"
                      (input)="onPromoInput($event)"
                      (keydown.enter)="validatePromo()"
                    />
                    <button
                      class="apply-promo-btn"
                      [disabled]="!promoCode() || promoLoading()"
                      (click)="validatePromo()"
                    >
                      @if (promoLoading()) {
                        <mat-spinner diameter="18" />
                      } @else {
                        <mat-icon>arrow_forward</mat-icon>
                      }
                    </button>
                  </div>
                  @if (promoError()) {
                    <p class="promo-error">{{ promoError() }}</p>
                  }
                  @if (promoBlockedByDegressive()) {
                    <p class="promo-blocked-info">Промокод не применён, действует скидка за количество</p>
                  }
                } @else {
                  <div class="promo-applied">
                    <mat-icon>sell</mat-icon>
                    <span class="promo-title">Промокод {{ promoCode() }}</span>
                    <span class="promo-discount-badge">-{{ promoDiscount() | number:'1.0-0' }} &#8381;</span>
                    <button mat-icon-button class="promo-remove" (click)="clearPromo()">
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                }
              </div>

              <!-- Email для чека -->
              <div class="receipt-section">
                <div class="receipt-input-row">
                  <mat-icon class="receipt-icon">mail_outline</mat-icon>
                  <input
                    type="email"
                    class="receipt-input"
                    placeholder="Email для чека (необязательно)"
                    [value]="email()"
                    (input)="onEmailInput($event)"
                  />
                </div>
              </div>

              <!-- Support team tip -->
              <div
                class="support-row"
                tabindex="0"
                role="checkbox"
                [attr.aria-checked]="supportTeam()"
                (click)="supportTeam.set(!supportTeam())"
                (keydown.space)="$event.preventDefault(); supportTeam.set(!supportTeam())"
              >
                <mat-checkbox
                  [ngModel]="supportTeam()"
                  (ngModelChange)="supportTeam.set($event)"
                  (click)="$event.stopPropagation()"
                />
                <span class="support-label">
                  <mat-icon class="support-heart">favorite</mat-icon>
                  Поддержать команду «Своё Фото»
                </span>
                <span class="support-price">39 &#8381;</span>
              </div>

              <div class="total-row">
                <span>К оплате</span>
                <span class="total-amount">{{ payTotal() | number:'1.0-0' }} &#8381;</span>
              </div>
            </mat-card>

            <!-- Одна кнопка оплаты, виджет CloudPayments сам предложит карту/СБП/Tinkoff Pay -->
            <button mat-flat-button class="pay-btn main-pay-btn" (click)="startPayment()" [disabled]="paying()">
              @if (paying()) {
                <mat-spinner diameter="20" />
                Открываем форму...
              } @else {
                <ng-container><mat-icon>lock</mat-icon> Оплатить {{ payTotal() | number:'1.0-0' }} &#8381;</ng-container>
              }
            </button>

            <!-- Контакты -->
            <div class="help-line">
              Вопросы? <a routerLink="/chat">Напишите нам</a> или позвоните
              <a href="tel:+78633226575">+7 (863) 322-65-75</a>
            </div>
          }
        }

        @case ('paying') {
          <div class="center-state">
            <mat-spinner diameter="40" />
            <p>Подтверждаем оплату...</p>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .checkout-page {
      max-width: 480px;
      margin: 16px auto;
      padding: 0 16px 32px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Center states (loading, paying) */
    .center-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 80px 0;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    /* State cards (not_found, expired, already_paid, success, error) */
    .state-card mat-card-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 48px 24px;
      gap: 12px;
    }

    .state-icon {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 8px;
    }

    .state-icon mat-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
    }

    .error-icon {
      background: rgba(239, 68, 68, 0.12);
    }

    .error-icon mat-icon {
      color: var(--ed-error, #ef4444);
    }

    .warn-icon {
      background: rgba(245, 158, 11, 0.12);
    }

    .warn-icon mat-icon {
      color: var(--ed-accent, #f59e0b);
    }

    .success-icon {
      background: rgba(34, 197, 94, 0.12);
    }

    .success-icon mat-icon {
      color: #4ade80;
    }

    .success-icon.pulse mat-icon {
      animation: pulse 2s ease-in-out infinite;
    }

    .state-card h2 {
      margin: 0;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 18px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: -0.02em;
    }

    .state-card p {
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0;
      font-size: 14px;
      line-height: 1.5;
    }

    .action-btn {
      margin-top: 8px;
      min-width: 200px;
    }

    .action-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
      margin-top: 8px;
    }

    /* Order card */
    .order-card {
      padding: 20px;
    }

    .order-header {
      margin-bottom: 8px;
    }

    .order-label {
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .order-header h1 {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 18px;
      font-weight: 700;
      margin: 2px 0 0;
      line-height: 1.2;
    }

    .order-desc {
      font-size: 14px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0 0 12px;
    }

    .order-note {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 10px 0 12px;
      padding: 9px 10px;
      border: 1px solid rgba(245, 158, 11, 0.28);
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.08);
      color: var(--ed-accent, #f59e0b);
      font-size: 12px;
      line-height: 1.35;
      font-weight: 600;
    }

    .order-note mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-top: 1px;
      flex-shrink: 0;
    }

    .items-section {
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      padding-top: 12px;
      margin-bottom: 12px;
    }

    .item-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      font-size: 14px;
    }

    .item-row + .item-row {
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .item-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .item-name {
      font-weight: 500;
    }

    .item-discount {
      font-size: 12px;
      line-height: 1.35;
      font-weight: 600;
    }

    .item-discount {
      color: var(--ed-success, #34d399);
    }

    .item-price {
      font-weight: 600;
      margin-left: 12px;
      white-space: nowrap;
    }

    .pickup-summary {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 0 12px;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 13px;
      line-height: 1.45;
    }

    .pickup-summary mat-icon {
      color: var(--ed-accent, #f59e0b);
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-top: 1px;
      flex-shrink: 0;
    }

    /* Promo */
    .promo-section { padding: 12px 0 4px; border-top: 1px solid var(--ed-outline-variant, #2a2a2a); }
    .promo-input-row {
      display: flex; align-items: center; gap: 0;
      border: 1px solid var(--ed-outline-variant, #2a2a2a); border-radius: 12px;
      background: var(--ed-surface-container, #1a1a1a); overflow: hidden;
      transition: border-color 0.2s;
    }
    .promo-input-row:focus-within { border-color: var(--ed-accent, #f59e0b); }
    .promo-icon {
      font-size: 18px; width: 18px; height: 18px; margin-left: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0); flex-shrink: 0;
    }
    .promo-input {
      flex: 1; padding: 10px 8px; border: none; background: transparent;
      color: var(--ed-on-surface, #f5f5f5); font-size: 14px; outline: none;
      text-transform: uppercase;
    }
    .apply-promo-btn {
      width: 36px; height: 36px; margin: 2px; border: none; border-radius: 10px;
      background: var(--ed-accent, #f59e0b); color: var(--ed-on-accent, #0a0a0a);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: opacity 0.2s;
    }
    .apply-promo-btn:hover:not(:disabled) { filter: brightness(1.1); }
    .apply-promo-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .apply-promo-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .promo-error { font-size: 12px; color: var(--ed-error, #ef4444); margin-top: 6px; padding-left: 4px; }
    .promo-blocked-info { font-size: 12px; color: var(--ed-accent, #f59e0b); margin-top: 6px; padding-left: 4px; }
    .promo-applied {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px; border-radius: 12px;
      background: var(--ed-accent-container, #451a03); color: var(--ed-on-surface, #f5f5f5);
    }
    .promo-applied mat-icon:first-child {
      color: var(--ed-accent, #f59e0b); font-size: 20px; width: 20px; height: 20px;
    }
    .promo-title { flex: 1; font-size: 13px; font-weight: 500; }
    .promo-discount-badge { font-size: 14px; font-weight: 700; color: var(--ed-accent, #f59e0b); }
    .promo-remove { width: 28px !important; height: 28px !important; padding: 0 !important; }
    .promo-remove mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* Receipt email */
    .receipt-section { padding: 4px 0 8px; }
    .receipt-input-row {
      display: flex; align-items: center; gap: 0;
      border: 1px solid var(--ed-outline-variant, #2a2a2a); border-radius: 12px;
      background: var(--ed-surface-container, #1a1a1a); overflow: hidden;
      transition: border-color 0.2s;
    }
    .receipt-input-row:focus-within { border-color: var(--ed-accent, #f59e0b); }
    .receipt-icon {
      font-size: 18px; width: 18px; height: 18px; margin-left: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0); flex-shrink: 0;
    }
    .receipt-input {
      flex: 1; padding: 10px 12px 10px 8px; border: none; background: transparent;
      color: var(--ed-on-surface, #f5f5f5); font-size: 14px; outline: none;
      box-sizing: border-box;
    }

    /* Support team tip */
    .support-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 0;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      cursor: pointer;
      margin-top: 4px;
    }

    .support-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 500;
      flex: 1;
    }

    .support-heart {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #f43f5e;
    }

    .support-price {
      font-weight: 600;
      font-size: 14px;
      white-space: nowrap;
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      padding-top: 12px;
      margin-top: 4px;
    }

    .total-row span:first-child {
      font-size: 14px;
      font-weight: 500;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .total-amount {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 28px;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
    }

    /* Pay button */
    .pay-btn {
      width: 100%;
      height: 52px;
      font-size: 17px;
      font-weight: 700;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .main-pay-btn {
      --mdc-filled-button-container-color: var(--ed-accent, #f59e0b);
      --mdc-filled-button-label-text-color: var(--ed-on-accent, #0a0a0a);
    }

    /* Help line */
    .help-line {
      text-align: center;
      font-size: 13px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      padding: 8px 0;
    }

    .help-line a {
      color: var(--ed-accent, #f59e0b);
      text-decoration: none;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(0.9); }
    }

    @media (min-width: 600px) {
      .checkout-page {
        margin-top: 24px;
        gap: 16px;
      }

      .order-card {
        padding: 28px;
      }

      .pay-banner {
        padding: 20px 24px;
      }
    }
  `,
})
export class PaymentCheckoutComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly cloudPayments = inject(CloudPaymentsService);

  protected readonly state = signal<CheckoutState>('loading');
  protected readonly order = signal<CheckoutOrder | null>(null);
  protected readonly paying = signal(false);
  protected readonly errorMessage = signal('Ошибка загрузки');
  protected readonly supportTeam = signal(false);
  private readonly SUPPORT_AMOUNT = 39;

  // Promo
  protected readonly promoCode = signal('');
  protected readonly promoDiscount = signal(0);
  protected readonly promoError = signal('');
  protected readonly promoLoading = signal(false);
  protected readonly promoApplied = signal(false);
  protected readonly promoBlockedByDegressive = signal(false);

  // Email для чека
  protected readonly email = signal('');

  protected readonly payTotal = computed(() => {
    const o = this.order();
    const base = o?.totalPrice ?? 0;
    const tip = this.supportTeam() ? this.SUPPORT_AMOUNT : 0;
    const discount = this.promoApplied() ? this.promoDiscount() : 0;
    return Math.max(0, base + tip - discount);
  });

  protected readonly orderPriceNote = computed(() => {
    const o = this.order();
    if (!o) return null;
    const notes = [o.priceNote, ...o.items.map(item => item.priceNote ?? null)]
      .filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
      .map(note => note.trim());
    const unique = Array.from(new Set(notes));
    return unique.length > 0 ? unique.join('; ') : null;
  });

  ngOnInit(): void {
    this.loadOrder();
  }

  protected retryLoad(): void {
    this.state.set('loading');
    this.loadOrder();
  }

  protected onPromoInput(event: Event): void {
    const val = this.readInputValue(event).toUpperCase();
    this.promoCode.set(val);
    this.promoError.set('');
  }

  protected async validatePromo(): Promise<void> {
    const code = this.promoCode().trim();
    if (!code) return;
    this.promoLoading.set(true);
    this.promoError.set('');
    try {
      const res = await fetch(`/api/promotions/validate/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (data.valid) {
        const base = this.order()?.totalPrice ?? 0;
        const discount = data.discount_percent
          ? Math.round(base * data.discount_percent / 100)
          : (data.discount_amount ?? 0);
        this.promoDiscount.set(discount);
        this.promoApplied.set(true);
        this.promoBlockedByDegressive.set(false);
      } else {
        this.promoError.set(data.error || 'Промокод не найден');
      }
    } catch {
      this.promoError.set('Ошибка проверки промокода');
    } finally {
      this.promoLoading.set(false);
    }
  }

  protected clearPromo(): void {
    this.promoCode.set('');
    this.promoDiscount.set(0);
    this.promoApplied.set(false);
    this.promoError.set('');
    this.promoBlockedByDegressive.set(false);
  }

  protected onEmailInput(event: Event): void {
    this.email.set(this.readInputValue(event));
  }

  protected async startPayment(): Promise<void> {
    const o = this.order();
    if (!o) return;

    this.paying.set(true);

    // Sync tip with backend BEFORE CloudPayments widget opens.
    // PATCH updates total_price in DB (base + tip) for CloudPayments check webhook.
    // We do NOT update the local order signal, payTotal() already adds tip via supportTeam().
    const tipAmount = this.supportTeam() ? this.SUPPORT_AMOUNT : 0;
    try {
      await firstValueFrom(this.http.patch(
        `/api/payments/${encodeURIComponent(o.id)}/tip`,
        { tipAmount },
      ));
    } catch {
      if (tipAmount > 0) {
        this.errorMessage.set('Не удалось добавить поддержку к оплате. Попробуйте ещё раз.');
        this.state.set('error');
        this.paying.set(false);
        return;
      }
    }

    const cartItems = this.buildCartItems(o);
    if (this.supportTeam()) {
      cartItems.push({
        service: { id: 'support-team', name: 'Поддержать команду «Своё Фото»', description: '', price: this.SUPPORT_AMOUNT, icon: '' },
        quantity: 1,
      });
    }
    // serverTotal от бэкенда, source of truth. Фронт НЕ пересчитывает сумму.
    const serverTotal = this.payTotal();
    const result: PaymentResult = await this.cloudPayments.pay(
      o.id, cartItems, this.email() || undefined, undefined, undefined, serverTotal,
    );

    if (result.success) {
      this.state.set('paying');
      const confirmed = await this.cloudPayments.verifyPayment(o.id);
      if (confirmed) {
        this.state.set('success');
      } else {
        this.errorMessage.set('Не удалось подтвердить оплату. Если деньги списались, напишите нам.');
        this.state.set('error');
      }
    }

    this.paying.set(false);
  }

  private loadOrder(): void {
    const orderId = this.route.snapshot.paramMap.get('orderId');
    if (!orderId) {
      this.state.set('not_found');
      return;
    }

    this.http.get<{ success: boolean; order?: CheckoutOrder; error?: string }>(
      `/api/payments/status/${encodeURIComponent(orderId)}`,
    ).subscribe({
      next: (res) => {
        if (!res.success || !res.order) {
          this.state.set('not_found');
          return;
        }

        const o = res.order;
        this.order.set(o);

        if (o.paymentStatus === 'paid') {
          this.state.set('already_paid');
        } else if (['cancelled', 'expired'].includes(o.status)) {
          this.state.set('expired');
        } else if (o.status === 'pending_payment') {
          this.state.set('ready');
        } else {
          this.state.set('already_paid');
        }
      },
      error: (err) => {
        if (err.status === 404) {
          this.state.set('not_found');
        } else {
          this.errorMessage.set('Ошибка загрузки данных');
          this.state.set('error');
        }
      },
    });
  }

  private buildCartItems(o: CheckoutOrder): CartItem[] {
    if (o.items.length > 0) {
      // Проверяем совпадение items sum и totalPrice.
      // Оператор может выставить скидочную сумму (total < items sum) -
      // в этом случае используем единый item с totalPrice, иначе CloudPayments
      // пересчитает total из items и получит неверную сумму (code 12).
      const itemsTotal = o.items.reduce(
        (s, i) => s + (i.price || 0) * (i.quantity || 1), 0,
      );

      if (Math.abs(itemsTotal - o.totalPrice) < 1) {
        return o.items.map((item, i) => ({
          service: {
            id: `${o.id}-${i}`,
            name: item.name,
            description: '',
            price: item.price || o.totalPrice,
            icon: '',
          },
          quantity: item.quantity || 1,
        }));
      }
    }

    // Fallback: единый item, гарантирует amount === totalPrice
    return [{
      service: {
        id: o.id,
        name: o.description || `Заказ ${o.id}`,
        description: '',
        price: o.totalPrice,
        icon: '',
      },
      quantity: 1,
    }];
  }

  private readInputValue(event: Event): string {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      return target.value;
    }
    return '';
  }
}
