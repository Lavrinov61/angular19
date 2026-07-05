import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CartService, CartItem, calcItemSubtotal } from '../../services/cart.service';
import {
  CloudPaymentsService,
  PaymentResult,
} from '../../../../core/services/cloud-payments.service';
import { AuthChatService } from '../../../../core/services/auth-chat.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { ReferralTrackingService } from '../../../../core/services/referral-tracking.service';
import { NavigationService } from '../../../../core/services/navigation.service';
import type {
  CartDisplayDetails,
  CartDisplayLine,
} from '../../../../shared/interfaces/cart-sync.interface';

@Component({
  selector: 'app-cart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    FormsModule,
    MatCheckboxModule,
    MatIconModule,
    MatButtonModule,
    MatBadgeModule,
    MatDividerModule,
    MatSnackBarModule,
  ],
  template: `
    <!-- Плавающая кнопка корзины (скрыта на мобиле когда чат открыт, доступна из хедера) -->
    @if (!cart.isOpen() && cart.itemCount() > 0 && !hideFabOnMobile()) {
      <button
        class="cart-fab"
        (click)="cart.open()"
        [matBadge]="cart.itemCount()"
        matBadgeColor="warn"
        matBadgeSize="small"
      >
        <mat-icon>shopping_cart</mat-icon>
      </button>
    }

    <!-- Панель корзины -->
    @if (cart.isOpen()) {
      <div class="cart-overlay" (click)="closeCart()" (keydown.enter)="closeCart()" tabindex="0"></div>
      <div class="cart-panel">
        <!-- Шапка -->
        <div class="cart-header">
          <div class="cart-title">
            <div class="cart-title-icon">
              <mat-icon>shopping_bag</mat-icon>
            </div>
            <div class="cart-title-text">
              <span class="cart-title-main">Корзина</span>
              @if (cart.itemCount() > 0) {
                <span class="cart-title-count">{{ cart.itemCount() }} {{ itemLabel() }}</span>
              }
            </div>
          </div>
          <button mat-icon-button (click)="closeCart()">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <!-- Содержимое -->
        <div class="cart-content">
          @if (paymentSuccessData(); as success) {
            <div class="payment-success">
              <div class="payment-success-icon">
                <mat-icon>check_circle</mat-icon>
              </div>
              <p class="payment-success-title">Оплата прошла успешно!</p>
              <span class="payment-success-order">Заказ №{{ success.orderId }}</span>
              <span class="payment-success-amount">Сумма: {{ success.amount | number }}₽</span>
              <p class="payment-success-next">Что дальше: ваш заказ принят в обработку. Готовый результат придёт в чат.</p>

              <div class="payment-success-actions">
                <button class="payment-success-btn primary" (click)="closeSuccessScreen()">
                  <mat-icon>chat</mat-icon>
                  Вернуться в чат
                </button>
                <button class="payment-success-btn secondary" (click)="startNewOrder()">
                  <mat-icon>add</mat-icon>
                  Новый заказ
                </button>
              </div>
            </div>
          } @else if (cart.isEmpty()) {
            <div class="empty-cart">
              <div class="empty-illustration">
                <mat-icon>shopping_bag</mat-icon>
              </div>
              <p class="empty-title">Корзина пуста</p>
              <span class="empty-subtitle">Добавьте услуги из каталога или выберите в чате с ассистентом</span>
              <button class="empty-cta" (click)="closeCart()">
                <mat-icon>arrow_back</mat-icon>
                Вернуться к выбору
              </button>
            </div>
          } @else {
            <!-- Список товаров -->
            <div class="cart-items">
              @for (item of cart.items(); track item.service.id; let idx = $index) {
                <div class="cart-item" [style.animation-delay]="idx * 50 + 'ms'">
                  <div class="item-row">
                    <div class="item-icon-wrap">
                      <mat-icon>{{ getServiceIcon(item.service.name) }}</mat-icon>
                    </div>
                    <div class="item-details">
                      <span class="item-name" [class.item-name-wrap]="!!item.displayDetails">{{ item.service.name }}</span>
                      <span class="item-unit-price">
                        @if (item.displayDetails) {
                          {{ compositionLabel(item.displayDetails.lines.length) }}
                        } @else if (item.backendOrderId) {
                          Итого по ссылке
                        } @else if (item.service.priceMax) {
                          {{ item.service.price | number }}-{{ item.service.priceMax | number }}₽ за шт.
                        } @else if (item.service.nextPrice && item.quantity > 1) {
                          {{ item.service.price | number }}₽ первое, далее {{ item.service.nextPrice | number }}₽
                        } @else {
                          {{ item.service.price | number }}₽ за шт.
                        }
                      </span>
                    </div>
                    <button
                      mat-icon-button
                      class="delete-btn"
                      (click)="cart.removeItem(item.service.id)"
                    >
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>

                  @if (item.displayDetails; as details) {
                    <div class="item-breakdown">
                      @for (line of details.lines; track breakdownTrack($index, line)) {
                        <div class="breakdown-line">
                          <div class="breakdown-main">
                            <span class="breakdown-name">{{ line.name }}</span>
                            <span class="breakdown-meta">
                              <span>{{ line.quantity }} × {{ line.unitPrice | number }}₽</span>
                              @if (line.discountLabel) {
                                <span class="breakdown-discount">{{ line.discountLabel }}</span>
                              }
                            </span>
                          </div>
                          <span class="breakdown-total">{{ line.total | number }}₽</span>
                        </div>
                      }

                      @if (breakdownPriceNote(details); as note) {
                        <div class="breakdown-note">
                          <mat-icon>info</mat-icon>
                          <span>{{ note }}</span>
                        </div>
                      }

                      @if ((details.savings ?? 0) > 0) {
                        <div class="breakdown-savings">
                          <mat-icon>sell</mat-icon>
                          <span>Скидка в заказе −{{ (details.savings ?? 0) | number }}₽</span>
                        </div>
                      }
                    </div>
                  }

                  <div class="item-bottom">
                    @if (item.backendOrderId) {
                      <span class="qty-fixed-badge">
                        <mat-icon>smart_toy</mat-icon>
                        Через чат
                      </span>
                    } @else {
                      <div class="qty-stepper">
                        <button
                          class="stepper-btn"
                          (click)="cart.updateQuantity(item.service.id, item.quantity - 1)"
                        >
                          <mat-icon>remove</mat-icon>
                        </button>
                        <span class="stepper-value">{{ item.quantity }}</span>
                        <button
                          class="stepper-btn"
                          (click)="cart.updateQuantity(item.service.id, item.quantity + 1)"
                        >
                          <mat-icon>add</mat-icon>
                        </button>
                      </div>
                    }

                    <span class="item-subtotal">
                      @if (item.service.priceMax) {
                        {{ item.service.price * item.quantity | number }}-{{ item.service.priceMax * item.quantity | number }}₽
                      } @else {
                        {{ getSubtotal(item) | number }}₽
                      }
                    </span>
                  </div>
                </div>
              }
            </div>

            <!-- Промокод -->
            <div class="promo-section">
              @if (!cart.promoData()) {
                <div class="promo-input-row">
                  <mat-icon class="promo-icon">sell</mat-icon>
                  <input
                    type="text"
                    class="promo-input"
                    placeholder="Промокод"
                    [value]="pendingPromo()"
                    (input)="onPromoInput($event)"
                    (keydown.enter)="applyPromo()"
                  />
                  <button
                    class="apply-promo-btn"
                    [disabled]="!pendingPromo() || validatingPromo()"
                    (click)="applyPromo()"
                  >
                    @if (validatingPromo()) {
                      <div class="spinner small"></div>
                    } @else {
                      <mat-icon>arrow_forward</mat-icon>
                    }
                  </button>
                </div>
                @if (promoError()) {
                  <div class="promo-error">{{ promoError() }}</div>
                }
                @if (cart.promoBlockedByDegressive()) {
                  <div class="promo-blocked-info">Промокод не применён, действует скидка за количество</div>
                }
              } @else {
                <div class="promo-applied">
                  <mat-icon>check_circle</mat-icon>
                  <span class="promo-title">{{ cart.promoData()!.title }}</span>
                  <span class="promo-discount-badge">-{{ cart.promoDiscount() | number }}₽</span>
                  <button mat-icon-button class="promo-remove" (click)="removePromo()">
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

            <!-- Поддержать команду -->
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
              <span class="support-price">{{ SUPPORT_AMOUNT }} ₽</span>
            </div>

            <!-- Итого -->
            <div class="cart-summary">
              @if (cart.promoDiscount() > 0 || supportTeam()) {
                <div class="summary-line">
                  <span>Сумма</span>
                  <span class="summary-dash"></span>
                  <span>{{ cart.total() | number }}₽</span>
                </div>
                @if (cart.promoDiscount() > 0) {
                  <div class="summary-line discount">
                    <span>Скидка по промокоду</span>
                    <span class="summary-dash"></span>
                    <span>-{{ cart.promoDiscount() | number }}₽</span>
                  </div>
                }
                @if (supportTeam()) {
                  <div class="summary-line support">
                    <span>Поддержка команды</span>
                    <span class="summary-dash"></span>
                    <span>+{{ SUPPORT_AMOUNT }}₽</span>
                  </div>
                }
              }
              <div class="total-row">
                <span class="total-label">К оплате</span>
                <span class="total-amount">
                  @if (cart.hasRangePrice()) {
                    от {{ payTotal() | number }}₽
                  } @else {
                    {{ payTotal() | number }}₽
                  }
                </span>
              </div>

              @if (hasRangeItems()) {
                <p class="price-note">
                  <mat-icon>info_outline</mat-icon>
                  Точная стоимость зависит от сложности и будет согласована в чате
                </p>
              }
            </div>

            <!-- Ошибка оплаты -->
            @if (paymentError()) {
              <div class="payment-error">
                <mat-icon>error_outline</mat-icon>
                <span>{{ paymentError() }}</span>
              </div>
            }

            <!-- Polling status -->
            @if (pollingStatus()) {
              <div class="polling-status">
                <div class="spinner small"></div>
                <span>{{ pollingStatus() }}</span>
              </div>
            }

            <!-- Кнопки -->
            <div class="cart-actions">
              <button
                class="pay-button"
                [class.loading]="paymentService.isLoading()"
                [class.retry]="!!paymentError()"
                [disabled]="paymentService.isLoading() || !!pollingStatus()"
                (click)="checkout()"
              >
                @if (paymentService.isLoading()) {
                  <div class="spinner"></div>
                  <span>Обработка...</span>
                } @else if (paymentError()) {
                  <mat-icon>refresh</mat-icon>
                  <span>Попробовать снова</span>
                } @else {
                  <mat-icon>lock</mat-icon>
                  <span>Оплатить {{ payTotal() | number }}₽</span>
                }
              </button>

            </div>

            <!-- Безопасность -->
            <div class="security-footer">
              <div class="security-row">
                <mat-icon>verified_user</mat-icon>
                <span>Безопасная оплата</span>
              </div>
              <div class="payment-methods">
                <span class="method-badge">Visa</span>
                <span class="method-badge">MC</span>
                <span class="method-badge">МИР</span>
                <span class="method-badge">SBP</span>
              </div>
            </div>

            <button class="clear-link" (click)="cart.clear()">
              Очистить корзину
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: contents; }

    /* ===== FAB ===== */
    .cart-fab {
      position: fixed;
      bottom: 96px;
      right: 24px;
      z-index: 1100;
      width: 56px;
      height: 56px;
      border-radius: 16px;
      border: none;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      transition: transform 0.2s, box-shadow 0.2s;
      animation: cartPulse 2.5s ease-in-out infinite;
    }
    .cart-fab:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35); }
    .cart-fab mat-icon { font-size: 24px; }
    @keyframes cartPulse {
      0%, 100% { box-shadow: 0 4px 12px rgba(0,0,0,0.25); }
      50% { box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
    }
    @media (max-width: 599px) {
      .cart-fab { bottom: 80px; right: 16px; }
    }

    /* ===== Overlay ===== */
    .cart-overlay {
      position: fixed; inset: 0; z-index: 1200;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(2px);
      animation: fadeIn 0.2s ease;
    }

    /* ===== Panel ===== */
    .cart-panel {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 1300;
      width: 420px; max-width: 100vw;
      background: var(--ed-surface, #0a0a0a);
      color: var(--ed-on-surface, #f5f5f5);
      display: flex; flex-direction: column;
      animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: -8px 0 32px rgba(0, 0, 0, 0.15);
    }
    @media (max-width: 480px) { .cart-panel { width: 100vw; } }

    @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes itemAppear {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ===== Header ===== */
    .cart-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 20px 16px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
    }
    .cart-title { display: flex; align-items: center; gap: 12px; }
    .cart-title-icon {
      width: 40px; height: 40px; border-radius: 12px;
      background: var(--ed-accent-container, #451a03);
      color: var(--ed-on-accent, #0a0a0a);
      display: flex; align-items: center; justify-content: center;
    }
    .cart-title-icon mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .cart-title-text { display: flex; flex-direction: column; }
    .cart-title-main { font-size: 18px; font-weight: 700; line-height: 1.2; }
    .cart-title-count { font-size: 13px; color: var(--ed-on-surface-variant, #a0a0a0); }

    /* ===== Content ===== */
    .cart-content { flex: 1; overflow-y: auto; padding: 16px 20px 20px; }
    .cart-content::-webkit-scrollbar { width: 4px; }
    .cart-content::-webkit-scrollbar-thumb {
      background: var(--ed-outline-variant, #2a2a2a); border-radius: 4px;
    }

    /* ===== Empty state, M3E unified ===== */
    .empty-cart {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 56px 24px; text-align: center; gap: 12px;
    }
    .empty-illustration {
      width: 80px; height: 80px; border-radius: 50%;
      background: var(--ed-surface-container-high, #222);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 4px;
    }
    .empty-illustration mat-icon {
      font-size: 36px; width: 36px; height: 36px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }
    .empty-title {
      font-size: 20px; font-weight: 500; margin: 0;
      color: var(--ed-on-surface, #f5f5f5);
    }
    .empty-subtitle {
      font-size: 14px; color: var(--ed-on-surface-variant, #a0a0a0);
      max-width: 280px; line-height: 1.5; margin: 0;
    }
    .empty-cta {
      display: inline-flex; align-items: center; gap: 6px; margin-top: 8px;
      padding: 10px 20px; border: none;
      border-radius: var(--m3e-corner-full, 9999px);
      background: rgba(245, 158, 11, 0.12);
      color: var(--ed-accent, #f59e0b); font-size: 14px; font-weight: 500;
      cursor: pointer;
      transition: background var(--m3e-effect-fast-duration, 200ms) var(--m3e-effect-fast, cubic-bezier(0.2, 0, 0, 1));
    }
    .empty-cta:hover { background: rgba(245, 158, 11, 0.2); }
    .empty-cta mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* ===== Payment success ===== */
    .payment-success {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 10px;
      min-height: 100%;
      padding: 40px 12px;
    }
    .payment-success-icon {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, #22c55e 20%, transparent);
      animation: successPop 0.28s ease-out;
    }
    .payment-success-icon mat-icon {
      color: #22c55e;
      font-size: 44px;
      width: 44px;
      height: 44px;
    }
    .payment-success-title {
      margin: 0;
      font-size: 22px;
      font-weight: 800;
      color: var(--ed-on-surface, #f5f5f5);
    }
    .payment-success-order {
      font-size: 14px;
      font-weight: 600;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }
    .payment-success-amount {
      font-size: 20px;
      font-weight: 800;
      color: var(--ed-accent, #f59e0b);
    }
    .payment-success-next {
      margin: 2px 0 0;
      font-size: 14px;
      line-height: 1.45;
      color: var(--ed-on-surface-variant, #a0a0a0);
      max-width: 290px;
    }
    .payment-success-actions {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      max-width: 300px;
    }
    .payment-success-btn {
      width: 100%;
      padding: 12px 14px;
      border-radius: 12px;
      border: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }
    .payment-success-btn.primary {
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
    }
    .payment-success-btn.secondary {
      background: var(--ed-surface-container-high, #222);
      color: var(--ed-on-surface, #f5f5f5);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
    }
    .payment-success-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    @keyframes successPop {
      from { transform: scale(0.85); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    /* ===== Items ===== */
    .cart-items { display: flex; flex-direction: column; gap: 10px; }
    .cart-item {
      background: var(--ed-surface-container, #1a1a1a);
      border-radius: 16px; padding: 14px 16px;
      animation: itemAppear 0.3s ease both;
    }

    .item-row { display: flex; align-items: flex-start; gap: 12px; }
    .item-icon-wrap {
      width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
      background: var(--ed-accent-container, #451a03);
      color: var(--ed-on-accent, #0a0a0a);
      display: flex; align-items: center; justify-content: center;
    }
    .item-icon-wrap mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .item-details { flex: 1; min-width: 0; }
    .item-name {
      display: block; font-size: 14px; font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .item-name-wrap {
      white-space: normal;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .item-unit-price {
      display: block; font-size: 12px; color: var(--ed-on-surface-variant, #a0a0a0); margin-top: 2px;
    }
    .delete-btn {
      width: 28px !important; height: 28px !important; padding: 0 !important;
      color: var(--ed-on-surface-variant, #a0a0a0); opacity: 0.5;
      transition: opacity 0.2s, color 0.2s;
    }
    .delete-btn:hover { opacity: 1; color: var(--ed-error, #ef4444); }
    .delete-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .item-breakdown {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 12px;
      background: var(--ed-surface, #0a0a0a);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .breakdown-line {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
    }
    .breakdown-main {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .breakdown-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      line-height: 1.25;
    }
    .breakdown-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 3px 6px;
      font-size: 11px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.25;
    }
    .breakdown-note {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 6px 8px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.08);
      color: var(--ed-primary, #f59e0b);
      font-size: 11px;
      line-height: 1.3;
      font-weight: 700;
    }
    .breakdown-note mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      margin-top: 1px;
      flex-shrink: 0;
    }
    .breakdown-discount {
      color: var(--ed-success, #34d399);
      font-weight: 600;
    }
    .breakdown-total {
      font-size: 12px;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
      white-space: nowrap;
    }
    .breakdown-savings {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: fit-content;
      max-width: 100%;
      padding: 5px 8px;
      border-radius: 999px;
      background: rgba(34, 197, 94, 0.12);
      color: #4ade80;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.25;
    }
    .breakdown-savings mat-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; }

    .item-bottom {
      display: flex; align-items: center; justify-content: space-between; margin-top: 10px;
    }

    /* Qty stepper */
    .qty-stepper {
      display: inline-flex; align-items: center;
      background: var(--ed-surface, #0a0a0a); border-radius: 999px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      overflow: hidden;
    }
    .stepper-btn {
      width: 32px; height: 32px; border: none; background: transparent;
      color: var(--ed-on-surface, #f5f5f5); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
    }
    .stepper-btn:hover { background: var(--ed-surface-container-high, #222); }
    .stepper-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .stepper-value {
      min-width: 28px; text-align: center; font-size: 14px; font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .qty-fixed-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;
      background: var(--ed-surface-container-high, #222); color: var(--ed-on-surface, #f5f5f5);
    }
    .qty-fixed-badge mat-icon { font-size: 14px; width: 14px; height: 14px; }

    .item-subtotal { font-size: 15px; font-weight: 700; color: var(--ed-on-surface, #f5f5f5); }

    /* ===== Promo ===== */
    .promo-section { padding: 14px 0 6px; }
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

    /* ===== Receipt ===== */
    .receipt-section { padding: 6px 0 14px; }
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

    /* ===== Support team tip ===== */
    .support-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      margin-bottom: 12px;
      border-radius: 12px;
      background: var(--ed-surface-container, #1a1a1a);
      cursor: pointer;
      transition: background 0.15s;
    }
    .support-row:hover { background: var(--ed-surface-container-high, #222); }
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
    .summary-line.support { color: #f43f5e; font-weight: 500; }

    /* ===== Summary ===== */
    .cart-summary {
      background: var(--ed-surface-container, #1a1a1a); border-radius: 16px;
      padding: 16px; margin-bottom: 16px;
    }
    .summary-line {
      display: flex; align-items: center; gap: 8px;
      font-size: 13px; color: var(--ed-on-surface-variant, #a0a0a0); padding: 3px 0;
    }
    .summary-line.discount { color: var(--ed-accent, #f59e0b); font-weight: 500; }
    .summary-dash { flex: 1; border-bottom: 1px dashed var(--ed-outline-variant, #2a2a2a); }
    .total-row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding-top: 4px;
    }
    .total-label { font-size: 15px; font-weight: 600; color: var(--ed-on-surface, #f5f5f5); }
    .total-amount { font-size: 24px; font-weight: 800; color: var(--ed-accent, #f59e0b); letter-spacing: -0.02em; }
    .price-note {
      display: flex; align-items: center; gap: 6px;
      margin: 10px 0 0; font-size: 12px; color: var(--ed-on-surface-variant, #a0a0a0);
    }
    .price-note mat-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; }

    /* ===== Payment error / status ===== */
    .payment-error {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px; border-radius: 12px;
      background: var(--ed-error, #ef4444); color: var(--ed-on-surface, #f5f5f5);
      font-size: 13px; margin-bottom: 12px;
    }
    .payment-error mat-icon { font-size: 20px; width: 20px; height: 20px; flex-shrink: 0; }
    .polling-status {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px; border-radius: 12px;
      background: var(--ed-surface-container-high, #222);
      color: var(--ed-on-surface-variant, #a0a0a0); font-size: 13px; margin-bottom: 12px;
    }

    /* ===== Actions ===== */
    .cart-actions { display: flex; flex-direction: column; gap: 10px; }
    .pay-button {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      width: 100%; padding: 16px; border: none; border-radius: 14px;
      background: var(--ed-accent, #f59e0b); color: var(--ed-on-accent, #0a0a0a);
      font-size: 16px; font-weight: 700; cursor: pointer; letter-spacing: 0.01em;
      transition: transform 0.15s, box-shadow 0.15s;
      box-shadow: 0 2px 8px color-mix(in srgb, var(--ed-accent, #f59e0b) 30%, transparent);
    }
    .pay-button:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 4px 16px color-mix(in srgb, var(--ed-accent, #f59e0b) 40%, transparent);
    }
    .pay-button:active:not(:disabled) { transform: scale(0.98); }
    .pay-button:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }
    .pay-button.loading {
      background: var(--ed-surface-container-high, #222);
      color: var(--ed-on-surface-variant, #a0a0a0); box-shadow: none;
    }
    .pay-button.retry { background: var(--ed-error, #ef4444); color: var(--ed-on-surface, #f5f5f5); }

    .spinner {
      width: 20px; height: 20px;
      border: 2.5px solid currentColor; border-right-color: transparent;
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    .spinner.small { width: 16px; height: 16px; border-width: 2px; flex-shrink: 0; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ===== Security footer ===== */
    .security-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 0 4px; margin-top: 8px;
    }
    .security-row {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; color: var(--ed-on-surface-variant, #a0a0a0);
    }
    .security-row mat-icon {
      font-size: 16px; width: 16px; height: 16px; color: var(--ed-accent, #f59e0b);
    }
    .payment-methods { display: flex; gap: 4px; }
    .method-badge {
      padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 700;
      letter-spacing: 0.02em;
      background: var(--ed-surface-container-high, #222);
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .clear-link {
      display: block; width: fit-content; margin: 8px auto 0;
      background: none; border: none;
      color: var(--ed-on-surface-variant, #a0a0a0); font-size: 12px;
      cursor: pointer; opacity: 0.6; transition: opacity 0.2s, color 0.2s;
    }
    .clear-link:hover { opacity: 1; color: var(--ed-error, #ef4444); }
  `,
})
export class CartComponent {
  protected readonly cart = inject(CartService);
  protected readonly paymentService = inject(CloudPaymentsService);
  private readonly chatService = inject(AuthChatService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly log = inject(LoggerService);
  private readonly referralTracking = inject(ReferralTrackingService);
  private readonly navigationService = inject(NavigationService);

  /** На мобиле когда чат открыт, FAB скрыт (корзина доступна из хедера чат-страницы) */
  protected readonly hideFabOnMobile = computed(() =>
    this.navigationService.isMobile() && this.chatService.isOpen(),
  );

  protected readonly SUPPORT_AMOUNT = 39;
  protected readonly supportTeam = signal(false);

  protected readonly email = signal('');
  protected readonly paymentError = signal('');
  protected readonly pollingStatus = signal('');
  protected readonly paymentSuccessData = signal<{ orderId: string; amount: number } | null>(null);

  // Промокод
  protected readonly pendingPromo = signal('');
  protected readonly validatingPromo = signal(false);
  protected readonly promoError = signal('');

  protected readonly hasRangeItems = computed(() =>
    this.cart.items().some((i) => i.service.priceMax != null),
  );

  protected readonly itemLabel = computed(() => {
    const count = this.cart.itemCount();
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 19) return 'услуг';
    if (mod10 === 1) return 'услуга';
    if (mod10 >= 2 && mod10 <= 4) return 'услуги';
    return 'услуг';
  });

  protected readonly payTotal = computed(() => {
    const base = this.cart.discountedTotal();
    return this.supportTeam() ? base + this.SUPPORT_AMOUNT : base;
  });

  protected getSubtotal(item: CartItem): number {
    return calcItemSubtotal(item);
  }

  protected breakdownTrack(index: number, line: CartDisplayLine): string {
    return `${line.name}-${line.quantity}-${line.total}-${index}`;
  }

  protected breakdownPriceNote(details: CartDisplayDetails): string | null {
    const notes = [details.priceNote, ...details.lines.map(line => line.priceNote ?? null)]
      .filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
      .map(note => note.trim());
    const unique = Array.from(new Set(notes));
    return unique.length > 0 ? unique.join('; ') : null;
  }

  protected compositionLabel(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 19) return `${count} позиций в заказе`;
    if (mod10 === 1) return `${count} позиция в заказе`;
    if (mod10 >= 2 && mod10 <= 4) return `${count} позиции в заказе`;
    return `${count} позиций в заказе`;
  }

  protected getServiceIcon(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('паспорт') || lower.includes('документ') || lower.includes('виз'))
      return 'badge';
    if (lower.includes('печать') || lower.includes('фотопечать') || lower.includes('принт'))
      return 'print';
    if (lower.includes('скан') || lower.includes('копи'))
      return 'scanner';
    if (lower.includes('фото на') || lower.includes('фотография'))
      return 'photo_camera';
    if (lower.includes('ретушь') || lower.includes('обработк'))
      return 'auto_fix_high';
    if (lower.includes('рамк') || lower.includes('рамок'))
      return 'filter_frames';
    if (lower.includes('холст') || lower.includes('canvas'))
      return 'panorama';
    return 'camera_alt';
  }

  protected onEmailInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.email.set(input.value);
  }

  protected onPromoInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pendingPromo.set(input.value);
    this.promoError.set('');
  }

  protected async applyPromo(): Promise<void> {
    const code = this.pendingPromo().trim();
    if (!code) return;

    this.validatingPromo.set(true);
    this.promoError.set('');

    const valid = await this.cart.validatePromo(code);
    this.validatingPromo.set(false);

    if (valid) {
      this.pendingPromo.set('');
    } else {
      this.promoError.set('Промокод недействителен или истёк');
    }
  }

  protected removePromo(): void {
    this.cart.removePromo();
    this.promoError.set('');
  }

  /** Собрать items для оплаты (с tip если включён) */
  private buildPaymentItems(): CartItem[] {
    const items = [...this.cart.items()];
    if (this.supportTeam()) {
      items.push({
        service: { id: 'support-team', name: 'Поддержать команду «Своё Фото»', description: '', price: this.SUPPORT_AMOUNT, icon: '' },
        quantity: 1,
      });
    }
    return items;
  }

  /**
   * Создать заказ в БД перед оплатой (чтобы webhook мог его найти).
   * Если у первого item есть backendOrderId, заказ уже создан через чат.
   */
  private async ensureOrderInDb(items: CartItem[], total: number): Promise<string> {
    if (items[0].backendOrderId) {
      return items[0].backendOrderId;
    }

    const orderItems = items.map(i => ({
      service: i.service.name,
      price: i.service.price,
      nextPrice: i.service.nextPrice,
      quantity: i.quantity,
      subtotal: calcItemSubtotal(i),
    }));

    if (this.supportTeam()) {
      orderItems.push({
        service: 'Поддержать команду «Своё Фото»',
        price: this.SUPPORT_AMOUNT,
        nextPrice: undefined,
        quantity: 1,
        subtotal: this.SUPPORT_AMOUNT,
      });
    }

    const payload = {
      items: orderItems,
      total,
      email: this.email() || undefined,
      chatSessionId: this.chatService.session()?.id || undefined,
      promoCode: this.cart.promoCode() || undefined,
      promoDiscount: this.cart.promoDiscount() || undefined,
      partnerPromoCode: this.cart.partnerPromoCode() || undefined,
    };

    const res = await fetch('/api/payments/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!data.success || !data.orderId) {
      throw new Error(data.error || 'Не удалось создать заказ');
    }

    return data.orderId;
  }

  /** Оплатить через СБП */
  protected async checkoutSbp(): Promise<void> {
    if (this.cart.items().length === 0) return;

    try {
      const payItems = this.buildPaymentItems();
      const total = this.payTotal();
      const orderId = await this.ensureOrderInDb(this.cart.items(), total);
      const result: PaymentResult = await this.paymentService.paySbp(
        orderId,
        payItems,
        this.email() || undefined,
      );

      if (result.success) {
        // На мобильном, редирект, на десктопе, QR показан в диалоге
        // Корзину не чистим сразу, ждём webhook подтверждения
      } else if (result.error) {
        this.snackBar.open(`Ошибка: ${result.error}`, 'OK', {
          duration: 5000,
          panelClass: 'error-snackbar',
        });
      }
    } catch (err) {
      this.snackBar.open(`Ошибка: ${err instanceof Error ? err.message : 'Не удалось создать заказ'}`, 'OK', {
        duration: 5000,
        panelClass: 'error-snackbar',
      });
    }
  }

  /** Оплатить через CloudPayments (карта и другие методы) */
  protected async checkout(): Promise<void> {
    if (this.cart.items().length === 0) return;

    this.paymentError.set('');
    this.pollingStatus.set('');
    this.paymentSuccessData.set(null);

    try {
      const payItems = this.buildPaymentItems();
      const total = this.payTotal();
      const orderId = await this.ensureOrderInDb(this.cart.items(), total);
      const discount = this.cart.promoDiscount();
      const result: PaymentResult = await this.paymentService.pay(
        orderId,
        payItems,
        this.email() || undefined,
        undefined,
        discount > 0 ? discount : undefined,
      );

      if (result.success) {
        this.pollingStatus.set('Подтверждаем оплату...');
        const confirmed = await this.awaitPaymentConfirmation(orderId);
        this.pollingStatus.set('');
        if (confirmed) {
          this.handlePaymentSuccess(orderId, total);
        } else {
          this.paymentError.set('Не удалось подтвердить оплату. Если деньги списались, напишите нам, мы разберёмся.');
        }
      } else if (result.error && result.error !== 'Оплата отменена') {
        this.paymentError.set(result.error);
      }
    } catch (err) {
      this.paymentError.set(err instanceof Error ? err.message : 'Ошибка оплаты');
    }
  }

  private handlePaymentSuccess(orderId: string, amount: number): void {
    this.paymentError.set('');
    this.snackBar.open('Оплата прошла успешно! Заказ принят в обработку.', 'OK', {
      duration: 7000,
      panelClass: 'success-snackbar',
    });
    // Уведомляем чат о смене статуса (если чат активен)
    window.dispatchEvent(new CustomEvent('order:paid', {
      detail: { orderId },
    }));
    // Clear partner referral code after successful order
    this.referralTracking.clear();
    this.cart.clear();
    this.paymentSuccessData.set({ orderId, amount });

    // Ненавязчиво просим browser-разрешение только после успешной оплаты.
    void this.chatService.requestNotificationsAfterPayment(5000);
  }

  protected closeSuccessScreen(): void {
    this.closeCart();
  }

  protected async startNewOrder(): Promise<void> {
    try {
      const session = this.chatService.session();
      if (session) {
        const targetMenu = this.chatService.channel() === 'studio' ? 'studio_main_menu' : 'main_menu';
        await this.chatService.sendButtonClick({
          id: 'main_menu_from_cart_success',
          label: 'Новый заказ',
          value: targetMenu,
        });
      }
    } finally {
      this.closeSuccessScreen();
    }
  }

  protected closeCart(): void {
    this.paymentSuccessData.set(null);
    this.cart.close();
  }

  /**
   * Ожидание серверного подтверждения оплаты.
   *
   * ENTERPRISE: Фронтенд НЕ может подтвердить оплату.
   * Вызываем /confirm-from-widget (сервер верифицирует через CloudPayments API).
   * Если сервер возвращает pending_payment, поллим до 15 секунд (webhook может задержаться).
   * Возвращает true только если сервер подтвердил оплату.
   */
  private async awaitPaymentConfirmation(orderId: string): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) return false;

    const MAX_ATTEMPTS = 5;
    const POLL_INTERVAL = 3000; // 3 секунды между попытками

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch('/api/payments/confirm-from-widget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        });
        const data = await res.json();
        this.log.debug(`[Cart] Payment verify attempt ${attempt + 1}: ${data.status}`);

        if (data.status === 'confirmed' || data.status === 'already_processed') {
          return true;
        }

        // Если статус pending, ждём и пробуем снова (webhook мог задержаться)
        if (data.status === 'pending_payment' && attempt < MAX_ATTEMPTS - 1) {
          this.pollingStatus.set(`Подтверждаем оплату... (${attempt + 2}/${MAX_ATTEMPTS})`);
          await new Promise(r => setTimeout(r, POLL_INTERVAL));
          continue;
        }

        // Другие статусы или последняя попытка
        return false;
      } catch (err) {
        this.log.warn(`[Cart] Payment verify attempt ${attempt + 1} failed:`, err);
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL));
        }
      }
    }

    return false;
  }

}
