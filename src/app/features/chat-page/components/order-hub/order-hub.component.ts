import {
  Component,
  ChangeDetectionStrategy,
  inject,
  output,
  signal,
  computed,
  OnInit,
  OnDestroy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DatePipe, CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { OrderActivityService, VisitorOrder } from '../../services/order-activity.service';
import { formatOrderId } from '../../utils/format-order-id';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../../../core/services/auth.service';
import { OrderTrackerComponent } from '../order-tracker/order-tracker.component';
import { TrustHeroComponent } from '../trust-hero/trust-hero.component';
import { ServiceCatalogComponent } from '../service-catalog/service-catalog.component';
import { SubscriptionBuilderComponent } from '../subscription-builder/subscription-builder.component';
import { SocialProofComponent } from '../social-proof/social-proof.component';
import { PromoReferralComponent } from '../promo-referral/promo-referral.component';

@Component({
  selector: 'app-order-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    CurrencyPipe,
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    OrderTrackerComponent,
    TrustHeroComponent,
    ServiceCatalogComponent,
    SubscriptionBuilderComponent,
    SocialProofComponent,
    PromoReferralComponent,
  ],
  template: `
    <!-- Загрузка заказов -->
    @if (orderActivity.loading()) {
      <div class="hub-loading">
        <mat-spinner diameter="36" />
        <span>Загружаем ваши заказы...</span>
      </div>
    }

    <!-- Есть активность по заказам -->
    @if (!orderActivity.loading() && orderActivity.hasOrders()) {

      <!-- ══════════════════════════════════════════════════════════
           A. НЕОПЛАЧЕННЫЕ ЗАКАЗЫ, Высший приоритет
           ══════════════════════════════════════════════════════════ -->
      @for (order of visibleUnpaid(); track order.id) {
        <div class="unpaid-card" id="unpaid-{{ order.id }}">
          <div class="unpaid-header">
            <mat-icon class="unpaid-icon">shopping_bag</mat-icon>
            <div class="unpaid-title-group">
              <span class="unpaid-label">Заказ оформлен</span>
              <span class="unpaid-subtitle">Осталось только оплатить</span>
            </div>
            <span class="unpaid-order-id">{{ formatOrderId(order.id) }}</span>
          </div>

          <!-- Состав заказа -->
          @if (order.items.length > 0) {
            <ul class="unpaid-items">
              @for (item of order.items; track $index) {
                <li class="unpaid-item">
                  <mat-icon class="item-icon">photo_camera</mat-icon>
                  <span class="item-name">{{ item.service || item.tariff || 'Услуга' }}</span>
                  @if (item.document) {
                    <span class="item-doc">{{ item.document }}</span>
                  }
                  @if (item.price) {
                    <span class="item-price">{{ item.price | currency:'RUB':'symbol':'1.0-0':'ru' }}</span>
                  }
                </li>
              }
            </ul>
          }

          <!-- Итого и кнопки оплаты -->
          <div class="unpaid-footer">
            <div class="unpaid-total">
              <span class="total-label">К оплате:</span>
              <span class="total-amount">{{ order.totalPrice | currency:'RUB':'symbol':'1.0-0':'ru' }}</span>
            </div>
            <div class="pay-actions">
              <button
                class="pay-btn pay-btn-card"
                (click)="payOrder(order)"
              >
                <mat-icon>credit_card</mat-icon>
                Оплатить картой или СБП
              </button>
            </div>
          </div>

          <p class="unpaid-note">
            <mat-icon>info</mat-icon>
            Заказ зарезервирован за вами. После оплаты мы приступим к работе немедленно.
          </p>
        </div>
      }
      @if (!showAllUnpaid() && orderActivity.unpaidOrders().length > 2) {
        <button class="show-more-btn" (click)="showAllUnpaid.set(true)">
          <mat-icon>expand_more</mat-icon>
          Показать ещё {{ orderActivity.unpaidOrders().length - 2 }}
        </button>
      }

      <!-- ══════════════════════════════════════════════════════════
           B. АКТИВНЫЕ ЗАКАЗЫ (оплачены, в работе)
           ══════════════════════════════════════════════════════════ -->
      @if (orderActivity.activeOrders().length > 0) {
        <div class="section-title">
          <mat-icon>pending_actions</mat-icon>
          <span>В работе</span>
        </div>
        @for (order of visibleActive(); track order.id) {
          <app-order-tracker [orderId]="order.id" />
        }
        @if (!showAllActive() && orderActivity.activeOrders().length > 2) {
          <button class="show-more-btn" (click)="showAllActive.set(true)">
            <mat-icon>expand_more</mat-icon>
            Показать ещё {{ orderActivity.activeOrders().length - 2 }}
          </button>
        }
      }

      <!-- ГОТОВО -->
      @if (orderActivity.readyOrders().length > 0) {
        <div class="section-title section-title-ready">
          <mat-icon>check_circle</mat-icon>
          <span>Готово!</span>
        </div>
        @for (order of orderActivity.readyOrders(); track order.id) {
          <app-order-tracker [orderId]="order.id" />
        }
      }

      <!-- ══════════════════════════════════════════════════════════
           C. ЗАВЕРШЁННЫЕ ЗАКАЗЫ
           ══════════════════════════════════════════════════════════ -->
      @if (orderActivity.completedOrders().length > 0) {
        <div class="section-title section-title-muted">
          <mat-icon>history</mat-icon>
          <span>Выполненные заказы</span>
        </div>
        <div class="completed-list">
          @for (order of orderActivity.completedOrders().slice(0, 5); track order.id) {
            <div class="completed-item" [class.completed-cancelled]="order.status === 'cancelled'">
              <div class="completed-icon-wrap">
                <mat-icon class="completed-icon">
                  {{ order.status === 'cancelled' ? 'cancel' : 'task_alt' }}
                </mat-icon>
              </div>
              <div class="completed-info">
                <span class="completed-title">
                  {{ order.items[0]?.service || order.items[0]?.tariff || 'Заказ' }}
                </span>
                <span class="completed-date">{{ order.createdAt | date:'d MMM yyyy':'':'ru' }}</span>
              </div>
              <div class="completed-right">
                <span class="completed-price">{{ order.totalPrice | currency:'RUB':'symbol':'1.0-0':'ru' }}</span>
                <span class="completed-status" [class.status-cancelled]="order.status === 'cancelled'">
                  {{ order.status === 'cancelled' ? 'Отменён' : order.status === 'refunded' ? 'Возврат' : 'Выполнен' }}
                </span>
              </div>
            </div>
          }
        </div>

        @if (authService.isAuthenticated()) {
          <a class="all-orders-link" routerLink="/user-profile/orders">
            <mat-icon>open_in_new</mat-icon>
            Все заказы в личном кабинете
          </a>
        }
      }

    }

    <!-- ══════════════════════════════════════════════════════════
         D. НЕТ ЗАКАЗОВ, стандартный каталог услуг
         ══════════════════════════════════════════════════════════ -->
    @if (!orderActivity.loading()) {
      <!-- Trust Hero, только если нет заказов -->
      @if (!orderActivity.hasOrders()) {
        <app-trust-hero />
      }

      <!-- Service Catalog -->
      <section class="content-section">
        <div class="section-header">
          <mat-icon>storefront</mat-icon>
          <span>Услуги и заказ</span>
        </div>
        <app-service-catalog (orderConfigured)="orderConfigured.emit($event)" />
      </section>

      <!-- Subscription Builder -->
      <section class="content-section">
        <div class="section-header">
          <mat-icon>card_membership</mat-icon>
          <span>Подписки</span>
        </div>
        <app-subscription-builder />
      </section>

      @defer (on viewport) {
        <section class="content-section">
          <div class="section-header">
            <mat-icon>star</mat-icon>
            <span>Отзывы</span>
          </div>
          <app-social-proof />
        </section>

        <section class="content-section">
          <app-promo-referral />
        </section>
      } @placeholder {
        <div class="defer-placeholder"></div>
      }
    }
  `,
  styles: [`
    :host {
      display: block;
      color: #20242a;
    }

    /* ─── Загрузка ─── */
    .hub-loading {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 32px 24px;
      color: #737985;
      font-size: 14px;
    }

    /* ─── НЕОПЛАЧЕННЫЙ ЗАКАЗ, карточка ─── */
    .unpaid-card {
      margin: 16px 0;
      border-radius: 8px;
      background: #ffffff;
      border: 2px solid #ef3124;
      overflow: hidden;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.06);
    }

    .unpaid-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      background: #fff4f2;
      border-bottom: 1px solid #ffd2c9;
    }

    .unpaid-icon {
      color: #ef3124;
      font-size: 28px;
      width: 28px;
      height: 28px;
      flex-shrink: 0;
    }

    .unpaid-title-group {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .unpaid-label {
      font-size: 16px;
      font-weight: 700;
      color: #20242a;
    }

    .unpaid-subtitle {
      font-size: 12px;
      color: #737985;
    }

    .unpaid-order-id {
      font-size: 12px;
      font-family: monospace;
      color: #737985;
      background: #ffffff;
      padding: 3px 8px;
      border-radius: 6px;
    }

    /* Состав */
    .unpaid-items {
      list-style: none;
      margin: 0;
      padding: 12px 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .unpaid-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .item-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #9aa1ac;
      flex-shrink: 0;
    }

    .item-name {
      font-size: 14px;
      color: #20242a;
      flex: 1;
    }

    .item-doc {
      font-size: 12px;
      color: #737985;
    }

    .item-price {
      font-size: 14px;
      font-weight: 600;
      color: #20242a;
      white-space: nowrap;
    }

    /* Итого и кнопки */
    .unpaid-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 20px;
      border-top: 1px solid #dfe3e8;
      flex-wrap: wrap;
    }

    .unpaid-total {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .total-label {
      font-size: 13px;
      color: #737985;
    }

    .total-amount {
      font-size: 28px;
      font-weight: 800;
      color: #20242a;
      letter-spacing: 0;
    }

    .pay-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .pay-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s ease, filter 0.15s ease;
    }

    .pay-btn:hover {
      transform: translateY(-1px);
      filter: brightness(1.1);
    }

    .pay-btn:active {
      transform: translateY(0);
    }

    .pay-btn mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .pay-btn-card {
      background: #ef3124;
      color: #ffffff;
      box-shadow: 0 8px 18px rgba(239, 49, 36, 0.18);
    }

    .unpaid-note {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 10px 20px 14px;
      font-size: 12px;
      color: #737985;
    }

    .unpaid-note mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    /* ─── Заголовки секций ─── */
    .section-title {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 20px 0 8px;
      font-size: 15px;
      font-weight: 600;
      color: #20242a;
      border-bottom: 1px solid #dfe3e8;
      margin-bottom: 12px;
    }

    .section-title mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: #ef3124;
    }

    .section-title-ready mat-icon {
      color: #4ade80;
    }

    .section-title-muted {
      color: #20242a;
    }

    .section-title-muted mat-icon {
      color: #737985;
    }

    /* ─── Готово к выдаче ─── */
    .ready-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px 20px;
      margin-bottom: 12px;
      background: #e8f8ef;
      border: 1px solid #c7efd8;
      border-radius: 8px;
    }

    .ready-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      color: #4ade80;
    }

    .ready-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .ready-title {
      font-size: 16px;
      font-weight: 700;
      color: #17663a;
    }

    .ready-sub {
      font-size: 12px;
      color: #1f7a45;
    }

    /* ─── Завершённые заказы ─── */
    .completed-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .completed-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      transition: background 0.15s;
    }

    .completed-item:hover {
      background: #f7f8fa;
    }

    .completed-cancelled {
      opacity: 0.6;
    }

    .completed-icon-wrap {
      flex-shrink: 0;
    }

    .completed-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: #9aa1ac;
    }

    .completed-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .completed-title {
      font-size: 13px;
      color: #20242a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .completed-date {
      font-size: 11px;
      color: #737985;
    }

    .completed-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }

    .completed-price {
      font-size: 13px;
      font-weight: 600;
      color: #20242a;
    }

    .completed-status {
      font-size: 11px;
      color: #4ade80;
    }

    .status-cancelled {
      color: #f87171;
    }

    .all-orders-link {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 12px;
      margin-top: 8px;
      font-size: 13px;
      color: #ef3124;
      text-decoration: none;
      border-radius: 8px;
      transition: background 0.15s;
    }

    .all-orders-link:hover {
      background: #fff4f2;
    }

    .all-orders-link mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    /* ─── Кнопка "Показать ещё" ─── */
    .show-more-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 10px 16px;
      margin-bottom: 8px;
      background: #ffffff;
      border: 1px solid #dfe3e8;
      border-radius: 8px;
      color: #737985;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s;
      justify-content: center;
    }

    .show-more-btn:hover {
      background: #f7f8fa;
      color: #20242a;
    }

    .show-more-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    /* ─── Каталог услуг (fallback) ─── */
    .content-section {
      margin-bottom: 24px;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px 0 12px;
      font-size: 16px;
      font-weight: 600;
      color: #20242a;
      border-bottom: 1px solid #dfe3e8;
      margin-bottom: 16px;
    }

    .section-header mat-icon {
      color: #ef3124;
    }
  `],
})
export class OrderHubComponent implements OnInit, OnDestroy {
  readonly orderActivity = inject(OrderActivityService);
  readonly cartService = inject(CartService);
  readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Проброс события настроенного заказа наверх в ChatPageComponent */
  readonly orderConfigured = output<{ categorySlug: string; message: string }>();

  readonly showAllActive = signal(false);
  readonly showAllUnpaid = signal(false);

  readonly visibleActive = computed(() =>
    this.showAllActive()
      ? this.orderActivity.activeOrders()
      : this.orderActivity.activeOrders().slice(0, 2)
  );

  readonly visibleUnpaid = computed(() =>
    this.showAllUnpaid()
      ? this.orderActivity.unpaidOrders()
      : this.orderActivity.unpaidOrders().slice(0, 2)
  );

  protected readonly formatOrderId = formatOrderId;

  getReadySubtext(order: VisitorOrder): string {
    switch (order.deliveryMethod) {
      case 'electronic': return 'Результат отправлен в чат';
      case 'pickup': return 'Заберите в студии на Соборном 21';
      case 'postal': return 'Отправлено по указанному адресу';
      default: return 'Проверьте чат для получения результата';
    }
  }

  private readonly _payHandler = () => this.orderActivity.reload();
  private readonly _finalizeHandler = () => this.orderActivity.reload();

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.orderActivity.ensureLoaded();
      window.addEventListener('order:paid', this._payHandler);
      window.addEventListener('chat:orderFinalized', this._finalizeHandler);
    }
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('order:paid', this._payHandler);
      window.removeEventListener('chat:orderFinalized', this._finalizeHandler);
    }
  }

  payOrder(order: VisitorOrder): void {
    window.dispatchEvent(new CustomEvent('chat:orderFinalized', {
      detail: {
        orderId: order.id,
        price: order.totalPrice,
        description: order.items[0]?.service || order.items[0]?.tariff || 'Фото на документы',
      },
    }));
    this.cartService.open();
  }

  openCart(): void {
    this.cartService.open();
  }
}
