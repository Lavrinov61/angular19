import {
  Component, inject, signal, computed, OnInit, OnDestroy,
  PLATFORM_ID, ChangeDetectionStrategy, ElementRef,
} from '@angular/core';
import { isPlatformBrowser, DatePipe, CurrencyPipe, NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Subscription } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { MEDIA_QUERIES } from '../../../../core/constants/breakpoints';
import {
  OrderHistory,
  OrderType,
  OrderStatus,
  PaymentStatus
} from '../../../../core/models/order-history.model';
import { OrderDetailsDialogComponent } from '../order-details-dialog/order-details-dialog.component';
import { OrderTimelineComponent } from '../order-timeline/order-timeline.component';
import { OrdersHistoryApiResponse, mapRawOrders } from '../../../../core/utils/order-mapping.utils';

type OrderListState = 'loading' | 'loaded' | 'empty' | 'error';

const SWR_CACHE_KEY = 'sf_order_history_cache';
const SWR_TTL_MS = 5 * 60 * 1000;

interface CachedOrders {
  data: OrderHistory[];
  total: number;
  ts: number;
}

@Component({
  selector: 'app-order-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    CurrencyPipe,
    NgTemplateOutlet,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatDividerModule,
    MatTabsModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatDialogModule,
    OrderTimelineComponent,
  ],
  template: `
    <div class="order-history-container"
         (touchstart)="onTouchStart($event)"
         (touchmove)="onTouchMove($event)"
         (touchend)="onTouchEnd()">

      <!-- Pull-to-refresh indicator -->
      @if (pullDistance() > 0) {
        <div class="pull-indicator" [style.height.px]="pullDistance()">
          <div class="pull-icon" [class.refreshing]="isRefreshing()"
               [style.transform]="'rotate(' + pullRotation() + 'deg)'">
            <mat-icon>{{ isRefreshing() ? 'sync' : 'arrow_downward' }}</mat-icon>
          </div>
        </div>
      }

      <!-- Header -->
      <div class="page-header">
        <h2 class="page-title">
          <mat-icon>receipt_long</mat-icon>
          История заказов
        </h2>
        @if (total() > 0) {
          <span class="total-badge">{{ total() }} заказов</span>
        }
      </div>

      <!-- Skeleton Loading -->
      @if (state() === 'loading') {
        <div class="orders-list">
          @for (_ of skeletonCards; track $index) {
            <div class="skeleton-card">
              <div class="skeleton-header">
                <div class="skeleton-icon shimmer"></div>
                <div class="skeleton-text-block">
                  <div class="skeleton-line w60 shimmer"></div>
                  <div class="skeleton-line w40 shimmer"></div>
                </div>
                <div class="skeleton-right">
                  <div class="skeleton-line w30 shimmer"></div>
                  <div class="skeleton-line w20 shimmer"></div>
                </div>
              </div>
              <div class="skeleton-footer">
                <div class="skeleton-line w25 shimmer"></div>
                <div class="skeleton-line w15 shimmer"></div>
              </div>
            </div>
          }
        </div>
      }

      <!-- Error -->
      @if (state() === 'error') {
        <div class="error-message">
          <mat-icon>error_outline</mat-icon>
          <p>{{ errorMsg() }}</p>
          <button mat-button (click)="loadOrderHistory()">Повторить</button>
        </div>
      }

      <!-- Empty -->
      @if (state() === 'empty') {
        <div class="empty-state">
          <div class="empty-icon-wrap">
            <mat-icon>receipt_long</mat-icon>
          </div>
          <h3>История заказов пуста</h3>
          <p>Здесь будут отображаться ваши заказы в фотостудии</p>
          <a mat-raised-button routerLink="/chat" class="empty-cta">
            <mat-icon>chat</mat-icon>
            Сделать заказ
          </a>
        </div>
      }

      <!-- Content -->
      @if (state() === 'loaded') {
        <!-- Filters row -->
        <div class="filters-row">
          <div class="search-bar">
            <mat-icon>search</mat-icon>
            <input type="text" placeholder="Поиск по названию или номеру..."
              [value]="searchQuery()"
              (input)="onSearchInput($event)">
            @if (searchQuery()) {
              <button class="search-clear" (click)="searchQuery.set('')">
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>

          <div class="status-filters">
          <button class="status-chip" [class.active]="!statusFilter()" (click)="statusFilter.set(null)">Все</button>
          <button class="status-chip" [class.active]="statusFilter() === 'pending'" (click)="statusFilter.set('pending')">В работе</button>
          <button class="status-chip" [class.active]="statusFilter() === 'completed'" (click)="statusFilter.set('completed')">Завершён</button>
          <button class="status-chip" [class.active]="statusFilter() === 'cancelled'" (click)="statusFilter.set('cancelled')">Отменён</button>
          </div>
        </div>

        <mat-tab-group animationDuration="200ms" class="orders-tabs">

          <!-- ===== ВСЕ ЗАКАЗЫ ===== -->
          <mat-tab>
            <ng-template mat-tab-label>
              Все заказы
              <span class="tab-count">{{ filteredOrders().length }}</span>
            </ng-template>
            <div class="orders-list">
              @for (order of filteredOrders(); track order.id) {
                <ng-container *ngTemplateOutlet="orderCard; context: { $implicit: order }" />
              }
            </div>
          </mat-tab>

          <!-- ===== ФОТО НА ДОКУМЕНТЫ ===== -->
          @if (byType(OrderType.DOCUMENT_PHOTO).length > 0) {
            <mat-tab>
              <ng-template mat-tab-label>
                Документы
                <span class="tab-count">{{ byType(OrderType.DOCUMENT_PHOTO).length }}</span>
              </ng-template>
              <div class="orders-list">
                @for (order of byType(OrderType.DOCUMENT_PHOTO); track order.id) {
                  <ng-container *ngTemplateOutlet="orderCard; context: { $implicit: order }" />
                }
              </div>
            </mat-tab>
          }

          <!-- ===== ФОТОСЕССИИ ===== -->
          @if (byType(OrderType.PHOTO_SESSION).length > 0) {
            <mat-tab>
              <ng-template mat-tab-label>
                Фотосессии
                <span class="tab-count">{{ byType(OrderType.PHOTO_SESSION).length }}</span>
              </ng-template>
              <div class="orders-list">
                @for (order of byType(OrderType.PHOTO_SESSION); track order.id) {
                  <ng-container *ngTemplateOutlet="orderCard; context: { $implicit: order }" />
                }
              </div>
            </mat-tab>
          }

          <!-- ===== ПРОЧИЕ ===== -->
          @if (otherOrders().length > 0) {
            <mat-tab>
              <ng-template mat-tab-label>
                Прочие
                <span class="tab-count">{{ otherOrders().length }}</span>
              </ng-template>
              <div class="orders-list">
                @for (order of otherOrders(); track order.id) {
                  <ng-container *ngTemplateOutlet="orderCard; context: { $implicit: order }" />
                }
              </div>
            </mat-tab>
          }

        </mat-tab-group>

        <!-- Shared order card template -->
        <ng-template #orderCard let-order>
          <div class="order-card" [class]="'status-border-' + order.status">
            <div class="order-card-header">
              <div class="order-icon-wrap" [class]="'icon-' + order.orderType">
                <mat-icon>{{ getOrderTypeIcon(order.orderType) }}</mat-icon>
              </div>
              <div class="order-title-block">
                <span class="order-title">{{ getOrderTitle(order) }}</span>
                <span class="order-date">{{ order.createdAt | date:'d MMM yyyy, HH:mm':'':'ru' }}</span>
              </div>
              <div class="order-right-block">
                <span class="order-price">{{ order.totalPrice | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                <span class="status-chip" [class]="'chip-' + order.status">{{ getStatusText(order.status) }}</span>
              </div>
            </div>

            <!-- Timeline -->
            @if (order.status !== 'cancelled' && order.status !== 'refunded') {
              <app-order-timeline [status]="order.status" [orderType]="order.orderType" />
            }

            @if (getOrderDetails(order).length > 0) {
              <div class="order-details-row">
                @for (detail of getOrderDetails(order); track detail.label) {
                  <div class="detail-tag">
                    <mat-icon>{{ detail.icon }}</mat-icon>
                    <span>{{ detail.value }}</span>
                  </div>
                }
              </div>
            }
            <div class="order-card-footer">
              <span class="payment-chip" [class]="'pay-' + order.paymentStatus">
                <mat-icon>{{ getPaymentIcon(order.paymentStatus) }}</mat-icon>
                {{ getPaymentStatusText(order.paymentStatus) }}
              </span>
              <div class="footer-actions">
                @if (order.status === 'completed') {
                  <button mat-button class="repeat-btn" (click)="repeatOrder(order)">
                    <mat-icon>replay</mat-icon>
                    Повторить
                  </button>
                }
                <button mat-button class="details-btn" (click)="viewOrderDetails(order)">
                  <mat-icon>open_in_new</mat-icon>
                  Детали
                </button>
              </div>
            </div>
          </div>
        </ng-template>
      }

    </div>
  `,
  styles: `
    :host {
      display: block;
      --amber: #f59e0b;
      --amber-dim: #92610a;
      --amber-glow: rgba(245, 158, 11, 0.12);
      --surface: var(--ed-surface, #121212);
      --surface-variant: var(--ed-surface-variant, #1e1e1e);
      --on-surface: var(--ed-on-surface, #f5f5f5);
      --on-surface-variant: var(--ed-on-surface-variant, #999);
      --border: var(--ed-outline, #333);
    }

    .order-history-container {
      padding: 0 0 32px;
      max-width: 1200px;
      margin: 0 auto;
    }

    /* ===== PULL TO REFRESH ===== */
    .pull-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      transition: height 0.2s ease;
    }

    .pull-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(245, 158, 11, 0.1);
      box-shadow: 0 0 16px rgba(245, 158, 11, 0.2);
      transition: transform 0.2s ease;
    }

    .pull-icon mat-icon {
      color: var(--amber);
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .pull-icon.refreshing mat-icon {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* ===== STAGGERED CARD ANIMATION ===== */
    @keyframes cardSlideIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ===== HEADER ===== */
    .page-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }

    .page-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--on-surface);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .page-title mat-icon {
      color: var(--amber);
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    .total-badge {
      background: var(--amber-glow);
      color: var(--amber);
      font-size: 0.8rem;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 12px;
      border: 1px solid rgba(245, 158, 11, 0.2);
    }

    /* ===== SKELETON ===== */
    .skeleton-card {
      background: var(--surface-variant);
      border-radius: 16px;
      border: 1px solid var(--border);
      overflow: hidden;
    }

    .skeleton-header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 20px;
    }

    .skeleton-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      flex-shrink: 0;
    }

    .skeleton-text-block {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .skeleton-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    .skeleton-line {
      height: 12px;
      border-radius: 6px;
    }

    .skeleton-line.w60 { width: 60%; }
    .skeleton-line.w40 { width: 40%; }
    .skeleton-line.w30 { width: 60px; }
    .skeleton-line.w25 { width: 80px; }
    .skeleton-line.w20 { width: 50px; }
    .skeleton-line.w15 { width: 40px; }

    .skeleton-footer {
      display: flex;
      justify-content: space-between;
      padding: 12px 20px;
      border-top: 1px solid var(--border);
    }

    .shimmer {
      background: linear-gradient(
        90deg,
        var(--surface) 25%,
        rgba(255, 255, 255, 0.06) 50%,
        var(--surface) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ===== ERROR ===== */
    .error-message {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 16px;
      padding: 16px 20px;
      color: #ef4444;
      margin-bottom: 24px;
    }

    .error-message p {
      flex: 1;
      margin: 0;
      font-size: 0.9rem;
    }

    /* ===== TABS ===== */
    .orders-tabs {
      margin-top: 0;
    }

    ::ng-deep .orders-tabs .mdc-tab {
      min-width: 0;
      padding: 0 20px;
      height: 48px;
    }

    ::ng-deep .orders-tabs .mdc-tab__text-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
    }

    ::ng-deep .orders-tabs .mdc-tab-indicator__content--underline {
      border-color: var(--amber) !important;
      border-radius: 3px 3px 0 0;
      border-width: 3px;
    }

    ::ng-deep .orders-tabs .mdc-tab--active .mdc-tab__text-label {
      color: var(--amber) !important;
    }

    .tab-count {
      background: var(--amber);
      color: #000;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 100px;
      line-height: 1.4;
      min-height: 20px;
      display: inline-flex;
      align-items: center;
      margin-left: 6px;
    }

    /* ===== ORDERS LIST ===== */
    .orders-list {
      padding: 16px 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* ===== ORDER CARD ===== */
    .order-card {
      background: rgba(255, 255, 255, 0.03);
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      overflow: hidden;
      transition: all 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
      animation: cardSlideIn 350ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }

    .order-card:nth-child(1) { animation-delay: 0ms; }
    .order-card:nth-child(2) { animation-delay: 50ms; }
    .order-card:nth-child(3) { animation-delay: 100ms; }
    .order-card:nth-child(4) { animation-delay: 150ms; }
    .order-card:nth-child(5) { animation-delay: 200ms; }
    .order-card:nth-child(6) { animation-delay: 250ms; }
    .order-card:nth-child(7) { animation-delay: 300ms; }
    .order-card:nth-child(8) { animation-delay: 350ms; }
    .order-card:nth-child(9) { animation-delay: 400ms; }
    .order-card:nth-child(10) { animation-delay: 450ms; }

    .order-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      border-color: rgba(245, 158, 11, 0.2);
    }

    /* Remove left-border accents, unified card style */
    .status-border-completed,
    .status-border-ready,
    .status-border-processing,
    .status-border-cancelled,
    .status-border-refunded,
    .status-border-new,
    .status-border-pending_payment {
      border-left: none;
    }

    .order-card-header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 20px 20px 12px;
    }

    .order-icon-wrap {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .order-icon-wrap mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .icon-document_photo   { background: rgba(244, 63, 94, 0.12); }
    .icon-document_photo mat-icon { color: #f43f5e; }
    .icon-photo_session    { background: rgba(168, 85, 247, 0.12); }
    .icon-photo_session mat-icon { color: #a855f7; }
    .icon-photo_restoration { background: rgba(59, 130, 246, 0.12); }
    .icon-photo_restoration mat-icon { color: #3b82f6; }
    .icon-photo_printing   { background: rgba(34, 197, 94, 0.12); }
    .icon-photo_printing mat-icon { color: #22c55e; }
    .icon-photo_editing    { background: rgba(245, 158, 11, 0.12); }
    .icon-photo_editing mat-icon { color: #f59e0b; }
    .icon-photo_products   { background: rgba(20, 184, 166, 0.15); }
    .icon-photo_products mat-icon { color: #14b8a6; }
    .icon-framing          { background: rgba(161, 107, 60, 0.15); }
    .icon-framing mat-icon { color: #a16b3c; }

    .order-title-block {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .order-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .order-date {
      font-size: 0.78rem;
      color: var(--on-surface-variant);
    }

    .order-right-block {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 5px;
      flex-shrink: 0;
    }

    .order-price {
      font-size: 1.3rem;
      font-weight: 700;
      color: #f59e0b;
      text-shadow: 0 2px 8px rgba(245, 158, 11, 0.15);
    }

    /* ===== STATUS CHIP (pill) ===== */
    .status-chip {
      font-size: 12px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 9999px;
      white-space: nowrap;
      min-height: 28px;
      display: inline-flex;
      align-items: center;
    }

    .chip-new, .chip-pending_payment { background: rgba(245, 158, 11, 0.15); color: #fcd34d; }
    .chip-processing { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
    .chip-ready { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
    .chip-completed { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
    .chip-cancelled, .chip-refunded { background: rgba(239, 68, 68, 0.15); color: #f87171; }
    .chip-waiting { background: rgba(234, 179, 8, 0.15); color: #fcd34d; }
    .chip-expired { background: rgba(156, 163, 175, 0.15); color: #9ca3af; }

    /* ===== DETAILS ROW ===== */
    .order-details-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 20px 12px;
    }

    .detail-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 3px 10px;
      font-size: 0.78rem;
      color: var(--on-surface-variant);
    }

    .detail-tag mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--amber);
    }

    /* ===== FOOTER ===== */
    .order-card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px 8px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .payment-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 6px;
    }

    .payment-chip mat-icon {
      font-size: 13px;
      width: 13px;
      height: 13px;
    }

    .pay-paid { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
    .pay-pending { background: rgba(245, 158, 11, 0.12); color: var(--amber); }
    .pay-partial { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }
    .pay-refunded, .pay-cancelled { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
    .pay-none { background: rgba(156, 163, 175, 0.12); color: #9ca3af; }

    .footer-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .details-btn, .repeat-btn {
      color: var(--on-surface-variant) !important;
      font-size: 0.8rem;
      min-width: 0;
      min-height: 44px;
    }

    .details-btn mat-icon, .repeat-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .details-btn:hover {
      color: var(--amber) !important;
    }

    .repeat-btn:hover {
      color: #22c55e !important;
    }

    /* ===== EMPTY STATE ===== */
    /* Empty state, M3E unified */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 56px 24px;
      gap: 12px;
      text-align: center;
    }

    .empty-icon-wrap {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: var(--ed-surface-container-high, #222);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 4px;
    }

    .empty-icon-wrap mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: var(--on-surface-variant);
    }

    .empty-state h3 {
      font-size: 20px;
      font-weight: 500;
      color: var(--on-surface);
      margin: 0;
    }

    .empty-state p {
      font-size: 14px;
      color: var(--on-surface-variant);
      margin: 0;
      max-width: 280px;
      line-height: 1.5;
    }

    .empty-cta {
      margin-top: 8px;
      padding: 10px 24px;
      background: rgba(245, 158, 11, 0.12) !important;
      color: var(--amber) !important;
      font-weight: 600;
      border-radius: var(--m3e-corner-full, 9999px);
      box-shadow: none;
    }

    /* ===== FILTERS ROW ===== */
    .filters-row {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    /* ===== SEARCH BAR ===== */
    .search-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--surface-variant, #1a1a1a);
      border: 1px solid var(--border, #2a2a2a);
      border-radius: 12px;
      padding: 8px 16px;
      flex: 1;
      min-width: 200px;
    }
    .search-bar input {
      flex: 1;
      background: none;
      border: none;
      outline: none;
      color: var(--on-surface, #f5f5f5);
      font-size: 0.9rem;
    }
    .search-bar input::placeholder { color: var(--on-surface-variant, #666); }
    .search-bar mat-icon { color: var(--on-surface-variant, #a0a0a0); font-size: 20px; }
    .search-clear {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: var(--on-surface-variant);
    }

    /* ===== STATUS FILTER CHIPS ===== */
    .status-filters {
      display: flex;
      gap: 8px;
      overflow-x: auto;
    }
    .status-chip {
      background: var(--surface-variant, #1a1a1a);
      border: 1px solid var(--border, #2a2a2a);
      border-radius: 100px;
      padding: 6px 14px;
      font-size: 0.8rem;
      color: var(--on-surface-variant, #a0a0a0);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    }
    .status-chip:hover { border-color: var(--amber, #f59e0b); color: var(--on-surface); }
    .status-chip.active {
      background: var(--amber, #f59e0b);
      color: #000;
      border-color: var(--amber);
      font-weight: 600;
    }

    /* ===== RESPONSIVE ===== */
    @media (max-width: 600px) {
      .order-card-header {
        flex-wrap: wrap;
        padding: 16px 16px 12px;
      }

      .order-right-block {
        flex-direction: row;
        align-items: center;
        gap: 8px;
        width: 100%;
        justify-content: space-between;
        padding: 0 48px 0 0;
        margin-top: -4px;
      }

      .order-icon-wrap {
        width: 42px;
        height: 42px;
      }

      .order-card-footer {
        padding: 8px 12px 8px 16px;
      }

      .order-details-row {
        padding: 0 16px 12px;
      }
    }
  `,
})
export class OrderHistoryComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly elRef = inject(ElementRef);

  readonly OrderType = OrderType;

  readonly orders = signal<OrderHistory[]>([]);
  readonly total = signal(0);
  readonly state = signal<OrderListState>('loading');
  readonly errorMsg = signal<string | null>(null);
  readonly isRefreshing = signal(false);
  readonly pullDistance = signal(0);
  readonly pullRotation = computed(() => Math.min(this.pullDistance() * 3, 180));

  readonly searchQuery = signal('');
  readonly statusFilter = signal<string | null>(null);

  readonly filteredOrders = computed(() => {
    const query = this.searchQuery().toLowerCase();
    const status = this.statusFilter();
    return this.orders().filter(order => {
      if (query && !(this.getOrderTitle(order).toLowerCase().includes(query) || order.id?.toLowerCase().includes(query))) return false;
      if (status && order.status !== status) return false;
      return true;
    });
  });

  readonly skeletonCards = [0, 1, 2];

  private isMobile = false;
  private bpSub: Subscription | undefined;

  // Pull-to-refresh gesture state
  private touchStartY = 0;
  private pulling = false;
  private readonly PULL_THRESHOLD = 60;

  readonly byType = (type: OrderType) => this.filteredOrders().filter(o => o.orderType === type);

  readonly otherOrders = computed(() =>
    this.filteredOrders().filter(o =>
      o.orderType !== OrderType.DOCUMENT_PHOTO && o.orderType !== OrderType.PHOTO_SESSION
    )
  );

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.bpSub = this.breakpointObserver
      .observe(MEDIA_QUERIES.OnlyMobile)
      .subscribe(result => { this.isMobile = result.matches; });

    // SWR: show cached data first, then revalidate
    const cached = this.readCache();
    if (cached) {
      this.orders.set(cached.data);
      this.total.set(cached.total);
      this.state.set(cached.data.length > 0 ? 'loaded' : 'empty');
      this.fetchOrders(true);
    } else {
      this.loadOrderHistory();
    }
  }

  ngOnDestroy(): void {
    this.bpSub?.unsubscribe();
  }

  loadOrderHistory(): void {
    this.state.set('loading');
    this.errorMsg.set(null);
    this.fetchOrders(false);
  }

  viewOrderDetails(order: OrderHistory): void {
    if (this.isMobile) {
      this.router.navigate(['/user-profile/orders', order.id], {
        state: { order },
      });
    } else {
      this.dialog.open(OrderDetailsDialogComponent, {
        width: '600px',
        maxWidth: '95vw',
        data: order,
      });
    }
  }

  repeatOrder(order: OrderHistory): void {
    this.router.navigate(['/chat'], {
      queryParams: { repeat: order.id },
    });
  }

  onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  // ===== Pull-to-refresh touch handlers =====
  onTouchStart(e: TouchEvent): void {
    if (!this.isMobile || this.isRefreshing()) return;
    const el = this.elRef.nativeElement as HTMLElement;
    if (el.scrollTop <= 0) {
      this.touchStartY = e.touches[0].clientY;
      this.pulling = true;
    }
  }

  onTouchMove(e: TouchEvent): void {
    if (!this.pulling) return;
    const dy = e.touches[0].clientY - this.touchStartY;
    if (dy > 0) {
      this.pullDistance.set(Math.min(dy * 0.5, 80));
    }
  }

  onTouchEnd(): void {
    if (!this.pulling) return;
    this.pulling = false;

    if (this.pullDistance() >= this.PULL_THRESHOLD) {
      this.isRefreshing.set(true);
      this.pullDistance.set(40);
      this.fetchOrders(false, () => {
        this.isRefreshing.set(false);
        this.pullDistance.set(0);
      });
    } else {
      this.pullDistance.set(0);
    }
  }

  // ===== Data helpers =====
  getOrderTitle(order: OrderHistory): string {
    switch (order.orderType) {
      case OrderType.PHOTO_SESSION: return order.photoSession?.title || 'Фотосессия';
      case OrderType.DOCUMENT_PHOTO: return `Фото на ${order.documentPhoto?.documentType || 'документы'}`;
      case OrderType.PHOTO_RESTORATION: return 'Реставрация фотографии';
      case OrderType.PHOTO_PRINTING: return `Печать фотографий ${order.photoPrinting?.format || ''}`.trim();
      case OrderType.PHOTO_EDITING: return 'Ретушь и обработка';
      case OrderType.PHOTO_PRODUCTS: return 'Фотопродукция';
      case OrderType.FRAMING: return 'Багетные работы';
      default: return 'Заказ';
    }
  }

  getOrderTypeIcon(type: OrderType): string {
    const map: Record<OrderType, string> = {
      [OrderType.DOCUMENT_PHOTO]: 'badge',
      [OrderType.PHOTO_SESSION]: 'photo_camera',
      [OrderType.PHOTO_RESTORATION]: 'auto_fix_high',
      [OrderType.PHOTO_PRINTING]: 'print',
      [OrderType.PHOTO_EDITING]: 'tune',
      [OrderType.PHOTO_PRODUCTS]: 'inventory_2',
      [OrderType.FRAMING]: 'crop_square',
    };
    return map[type] ?? 'receipt_long';
  }

  getOrderDetails(order: OrderHistory): { icon: string; label: string; value: string }[] {
    const details: { icon: string; label: string; value: string }[] = [];
    if (order.orderType === OrderType.DOCUMENT_PHOTO && order.documentPhoto) {
      if (order.documentPhoto.documentType) {
        details.push({ icon: 'badge', label: 'Документ', value: order.documentPhoto.documentType });
      }
      if (order.documentPhoto.withRetouching) {
        details.push({ icon: 'face_retouching_natural', label: 'Ретушь', value: 'С ретушью' });
      }
    }
    if (order.orderType === OrderType.PHOTO_SESSION && order.photoSession) {
      if (order.photoSession.photographerName) {
        details.push({ icon: 'person', label: 'Фотограф', value: order.photoSession.photographerName });
      }
      if (order.photoSession.photoCount) {
        details.push({ icon: 'collections', label: 'Фото', value: `${order.photoSession.photoCount} фото` });
      }
    }
    if (order.orderType === OrderType.PHOTO_PRINTING && order.photoPrinting) {
      if (order.photoPrinting.format) {
        details.push({ icon: 'aspect_ratio', label: 'Формат', value: order.photoPrinting.format });
      }
      if (order.photoPrinting.quantity) {
        details.push({ icon: 'filter', label: 'Кол-во', value: `${order.photoPrinting.quantity} шт.` });
      }
    }
    return details;
  }

  getStatusText(status: OrderStatus | string): string {
    const map: Record<string, string> = {
      new: 'Новый',
      processing: 'В обработке',
      waiting: 'Ожидает',
      ready: 'Готов',
      completed: 'Завершён',
      cancelled: 'Отменён',
      refunded: 'Возврат',
      pending_payment: 'Ожидает оплаты',
      expired: 'Истёк',
    };
    return map[status] ?? String(status);
  }

  getPaymentStatusText(status: PaymentStatus | string): string {
    const map: Record<string, string> = {
      pending: 'Ожидает оплаты',
      partial: 'Частично оплачено',
      paid: 'Оплачено',
      refunded: 'Возврат',
      cancelled: 'Отменено',
      none: 'Не оплачен',
    };
    return map[status] ?? String(status);
  }

  getPaymentIcon(status: PaymentStatus | string): string {
    const map: Record<string, string> = {
      paid: 'check_circle',
      pending: 'schedule',
      partial: 'pending',
      refunded: 'currency_exchange',
      cancelled: 'cancel',
      none: 'radio_button_unchecked',
    };
    return map[status] ?? 'payments';
  }

  // ===== Private methods =====
  private fetchOrders(background: boolean, onDone?: () => void): void {
    const userId = this.authService.getCurrentUser()?.id ?? '';

    this.http.get<OrdersHistoryApiResponse>('/api/orders/my-history?limit=50').subscribe({
      next: (res) => {
        const mapped = mapRawOrders(res.data ?? [], userId);
        this.orders.set(mapped);
        this.total.set(res.total ?? res.data?.length ?? 0);
        this.state.set(mapped.length > 0 ? 'loaded' : 'empty');
        this.writeCache(mapped, res.total ?? mapped.length);
        onDone?.();
      },
      error: () => {
        if (!background) {
          this.errorMsg.set('Не удалось загрузить историю заказов. Попробуйте позже.');
          this.state.set('error');
        }
        onDone?.();
      },
    });
  }

  private readCache(): CachedOrders | null {
    try {
      const raw = sessionStorage.getItem(SWR_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedOrders;
      if (Date.now() - parsed.ts > SWR_TTL_MS) {
        sessionStorage.removeItem(SWR_CACHE_KEY);
        return null;
      }
      parsed.data = parsed.data.map(o => ({
        ...o,
        createdAt: new Date(o.createdAt),
        photoSession: o.photoSession ? { ...o.photoSession, date: new Date(o.photoSession.date) } : undefined,
      }));
      return parsed;
    } catch {
      return null;
    }
  }

  private writeCache(data: OrderHistory[], total: number): void {
    try {
      const cached: CachedOrders = { data, total, ts: Date.now() };
      sessionStorage.setItem(SWR_CACHE_KEY, JSON.stringify(cached));
    } catch {
      // sessionStorage quota exceeded, ignore
    }
  }
}
