import {
  Component, ChangeDetectionStrategy, inject, signal, OnInit, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DatePipe, CurrencyPipe, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { animate, style, transition, trigger } from '@angular/animations';

import { AuthService } from '../../../../core/services/auth.service';
import {
  OrderHistory,
  OrderType,
  OrderStatus,
} from '../../../../core/models/order-history.model';
import { OrderTimelineComponent } from '../order-timeline/order-timeline.component';
import { OrdersHistoryApiResponse, mapRawOrders } from '../../../../core/utils/order-mapping.utils';

const SWR_CACHE_KEY = 'sf_order_history_cache';

@Component({
  selector: 'app-order-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    CurrencyPipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    OrderTimelineComponent,
  ],
  animations: [
    trigger('slideIn', [
      transition(':enter', [
        style({ transform: 'translateX(100%)' }),
        animate('250ms ease-out', style({ transform: 'translateX(0)' })),
      ]),
      transition(':leave', [
        animate('200ms ease-in', style({ transform: 'translateX(100%)' })),
      ]),
    ]),
  ],
  template: `
    <div class="order-details-page" @slideIn>
      <!-- Header -->
      <div class="detail-header">
        <button mat-icon-button class="back-btn" (click)="goBack()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div class="header-title">
          <div class="type-icon" [class]="'icon-' + order()?.orderType">
            <mat-icon>{{ getOrderTypeIcon() }}</mat-icon>
          </div>
          <span class="header-text">{{ getOrderTitle() }}</span>
        </div>
      </div>

      @if (isLoading()) {
        <div class="loading-state">
          <div class="skeleton-block shimmer" style="height: 80px;"></div>
          <div class="skeleton-block shimmer" style="height: 120px;"></div>
          <div class="skeleton-block shimmer" style="height: 60px;"></div>
        </div>
      }

      @if (order(); as o) {
        <div class="detail-content">
          <!-- Order info card -->
          <div class="info-card">
            <div class="info-row">
              <span class="info-label">Номер заказа</span>
              <span class="info-value mono">{{ o.id }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Дата</span>
              <span class="info-value">{{ o.createdAt | date:'dd.MM.yyyy HH:mm' }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Статус</span>
              <span class="status-chip" [class]="'chip-' + o.status">{{ getStatusText() }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Оплата</span>
              <span class="payment-chip" [class]="'pay-' + o.paymentStatus">{{ getPaymentStatusText() }}</span>
            </div>
          </div>

          <!-- Timeline -->
          @if (o.status !== 'cancelled' && o.status !== 'refunded') {
            <div class="timeline-section">
              <app-order-timeline [status]="o.status" [orderType]="o.orderType" />
            </div>
          } @else {
            <div class="timeline-empty">
              <mat-icon>{{ o.status === 'cancelled' ? 'block' : 'currency_exchange' }}</mat-icon>
              <span>{{ o.status === 'cancelled' ? 'Заказ отменён' : 'Оформлен возврат' }}</span>
            </div>
          }

          <mat-divider />

          <!-- Type-specific details -->
          @if (o.orderType === 'photo_session' && o.photoSession) {
            <div class="section">
              <h3 class="section-title">Детали фотосессии</h3>
              @if (o.photoSession.title) {
                <div class="info-row">
                  <span class="info-label">Название</span>
                  <span class="info-value">{{ o.photoSession.title }}</span>
                </div>
              }
              @if (o.photoSession.date) {
                <div class="info-row">
                  <span class="info-label">Дата и время</span>
                  <span class="info-value">{{ o.photoSession.date | date:'dd.MM.yyyy HH:mm' }}</span>
                </div>
              }
              @if (o.photoSession.location) {
                <div class="info-row">
                  <span class="info-label">Локация</span>
                  <span class="info-value">{{ o.photoSession.location }}</span>
                </div>
              }
              @if (o.photoSession.photographerName) {
                <div class="info-row">
                  <span class="info-label">Фотограф</span>
                  <span class="info-value">{{ o.photoSession.photographerName }}</span>
                </div>
              }
              @if (o.photoSession.durationMinutes) {
                <div class="info-row">
                  <span class="info-label">Длительность</span>
                  <span class="info-value">{{ o.photoSession.durationMinutes }} мин</span>
                </div>
              }
              @if (o.photoSession.photoCount) {
                <div class="info-row">
                  <span class="info-label">Фотографий</span>
                  <span class="info-value">{{ o.photoSession.photoCount }} шт</span>
                </div>
              }
            </div>
          }

          @if (o.orderType === 'document_photo' && o.documentPhoto) {
            <div class="section">
              <h3 class="section-title">Фото на документы</h3>
              @if (o.documentPhoto.documentType) {
                <div class="info-row">
                  <span class="info-label">Тип документа</span>
                  <span class="info-value">{{ o.documentPhoto.documentType }}</span>
                </div>
              }
              <div class="info-row">
                <span class="info-label">Количество</span>
                <span class="info-value">{{ o.documentPhoto.quantity }} шт</span>
              </div>
              <div class="info-row">
                <span class="info-label">Формат</span>
                <span class="info-value">{{ o.documentPhoto.format }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Цифровая копия</span>
                <span class="info-value">{{ o.documentPhoto.withDigital ? 'Да' : 'Нет' }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Ретушь</span>
                <span class="info-value">{{ o.documentPhoto.withRetouching ? 'Да' : 'Нет' }}</span>
              </div>
            </div>
          }

          @if (o.orderType === 'photo_restoration' && o.photoRestoration) {
            <div class="section">
              <h3 class="section-title">Реставрация</h3>
              <div class="info-row">
                <span class="info-label">Сложность</span>
                <span class="info-value">{{ getComplexityText(o.photoRestoration.complexity) }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Уровень</span>
                <span class="info-value">{{ o.photoRestoration.restorationLevel }}</span>
              </div>
              @if (o.photoRestoration.comments) {
                <div class="info-row">
                  <span class="info-label">Комментарии</span>
                  <span class="info-value">{{ o.photoRestoration.comments }}</span>
                </div>
              }
            </div>
          }

          @if (o.orderType === 'photo_printing' && o.photoPrinting) {
            <div class="section">
              <h3 class="section-title">Печать фотографий</h3>
              <div class="info-row">
                <span class="info-label">Количество</span>
                <span class="info-value">{{ o.photoPrinting.quantity }} шт</span>
              </div>
              <div class="info-row">
                <span class="info-label">Формат</span>
                <span class="info-value">{{ o.photoPrinting.format }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Бумага</span>
                <span class="info-value">{{ o.photoPrinting.paperType }}</span>
              </div>
              @if (o.photoPrinting.withFrame) {
                <div class="info-row">
                  <span class="info-label">Рамка</span>
                  <span class="info-value">{{ o.photoPrinting.frameType }}</span>
                </div>
              }
            </div>
          }

          @if (o.additionalInfo) {
            <mat-divider />
            <div class="section">
              <h3 class="section-title">Дополнительно</h3>
              @if (o.additionalInfo.comments) {
                <div class="info-row">
                  <span class="info-label">Комментарии</span>
                  <span class="info-value">{{ o.additionalInfo.comments }}</span>
                </div>
              }
              @if (o.additionalInfo.specialRequirements) {
                <div class="info-row">
                  <span class="info-label">Требования</span>
                  <span class="info-value">{{ o.additionalInfo.specialRequirements }}</span>
                </div>
              }
              @if (o.additionalInfo.deliveryInfo) {
                <div class="info-row">
                  <span class="info-label">Получение</span>
                  <span class="info-value">{{ o.additionalInfo.deliveryInfo.method === 'pickup' ? 'Самовывоз' : 'Доставка' }}</span>
                </div>
                @if (o.additionalInfo.deliveryInfo.address) {
                  <div class="info-row">
                    <span class="info-label">Адрес</span>
                    <span class="info-value">{{ o.additionalInfo.deliveryInfo.address }}</span>
                  </div>
                }
                @if (o.additionalInfo.deliveryInfo.trackingNumber) {
                  <div class="info-row">
                    <span class="info-label">Трек-номер</span>
                    <span class="info-value mono">{{ o.additionalInfo.deliveryInfo.trackingNumber }}</span>
                  </div>
                }
              }
            </div>
          }

          <!-- Price section -->
          <mat-divider />
          <div class="price-section">
            <span class="price-label">Итого</span>
            <span class="price-value">{{ o.totalPrice | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
          </div>
        </div>

        <!-- Sticky action bar -->
        <div class="sticky-actions">
          @if (o.status === 'waiting') {
            <button mat-raised-button class="action-btn confirm-btn" (click)="goToApproval()">
              <mat-icon>check_circle</mat-icon>
              Подтвердить заказ
            </button>
          }
          @if (canViewPhotos()) {
            <button mat-raised-button class="action-btn photos-btn" routerLink="/user-profile/my-photos">
              <mat-icon>photo_library</mat-icon>
              Посмотреть фотографии
            </button>
          }
          @if (o.status === 'completed') {
            <button mat-raised-button class="action-btn repeat-btn" (click)="repeatOrder()">
              <mat-icon>replay</mat-icon>
              Повторить заказ
            </button>
          }
          @if (o.paymentStatus === 'pending') {
            <button mat-raised-button class="action-btn pay-btn" (click)="goToChat()">
              <mat-icon>payment</mat-icon>
              Оплатить
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      --amber: #f59e0b;
      --surface: var(--ed-surface, #121212);
      --surface-variant: var(--ed-surface-variant, #1e1e1e);
      --on-surface: var(--ed-on-surface, #f5f5f5);
      --on-surface-variant: var(--ed-on-surface-variant, #999);
      --border: var(--ed-outline, #333);
    }

    .order-details-page {
      min-height: 100dvh;
      padding-bottom: 80px;
    }

    /* ===== HEADER ===== */
    .detail-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 8px 8px 4px;
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    .back-btn {
      color: var(--on-surface) !important;
      min-width: 44px;
      min-height: 44px;
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }

    .type-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .type-icon mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .icon-document_photo   { background: rgba(245, 158, 11, 0.15); }
    .icon-document_photo mat-icon { color: var(--amber); }
    .icon-photo_session    { background: rgba(168, 85, 247, 0.15); }
    .icon-photo_session mat-icon { color: #a855f7; }
    .icon-photo_restoration { background: rgba(236, 72, 153, 0.15); }
    .icon-photo_restoration mat-icon { color: #ec4899; }
    .icon-photo_printing   { background: rgba(34, 197, 94, 0.15); }
    .icon-photo_printing mat-icon { color: #22c55e; }
    .icon-photo_editing    { background: rgba(59, 130, 246, 0.15); }
    .icon-photo_editing mat-icon { color: #3b82f6; }
    .icon-photo_products   { background: rgba(20, 184, 166, 0.15); }
    .icon-photo_products mat-icon { color: #14b8a6; }
    .icon-framing          { background: rgba(161, 107, 60, 0.15); }
    .icon-framing mat-icon { color: #a16b3c; }

    .header-text {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ===== LOADING ===== */
    .loading-state {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .skeleton-block {
      border-radius: 12px;
      width: 100%;
    }

    .shimmer {
      background: linear-gradient(
        90deg,
        var(--surface-variant) 25%,
        rgba(255, 255, 255, 0.06) 50%,
        var(--surface-variant) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ===== CONTENT ===== */
    .detail-content {
      padding: 16px;
    }

    .info-card {
      background: var(--surface-variant);
      border-radius: 12px;
      border: 1px solid var(--border);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 16px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
    }

    .info-label {
      font-size: 0.85rem;
      color: var(--on-surface-variant);
      flex-shrink: 0;
    }

    .info-value {
      font-size: 0.85rem;
      color: var(--on-surface);
      font-weight: 500;
      text-align: right;
    }

    .info-value.mono {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
    }

    .timeline-section {
      margin-bottom: 16px;
    }

    .timeline-empty {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px;
      background: rgba(239, 68, 68, 0.06);
      border: 1px solid rgba(239, 68, 68, 0.15);
      border-radius: 12px;
      margin-bottom: 16px;
    }
    .timeline-empty mat-icon {
      color: #ef4444;
      font-size: 22px;
      width: 22px;
      height: 22px;
    }
    .timeline-empty span {
      font-size: 0.88rem;
      font-weight: 500;
      color: #f87171;
    }

    mat-divider {
      border-color: var(--border) !important;
      margin: 16px 0 !important;
    }

    .section {
      margin-bottom: 16px;
    }

    .section-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--amber);
      margin: 0 0 12px 0;
    }

    .section .info-row {
      margin-bottom: 8px;
    }

    /* ===== STATUS CHIP ===== */
    .status-chip {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 100px;
    }

    .chip-new, .chip-pending_payment { background: rgba(245, 158, 11, 0.15); color: var(--amber); }
    .chip-processing { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
    .chip-ready { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
    .chip-completed { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .chip-cancelled, .chip-refunded { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    .chip-waiting { background: rgba(234, 179, 8, 0.15); color: #eab308; }

    .payment-chip {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 6px;
    }

    .pay-paid { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
    .pay-pending { background: rgba(245, 158, 11, 0.12); color: var(--amber); }
    .pay-partial { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }
    .pay-refunded, .pay-cancelled { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
    .pay-none { background: rgba(156, 163, 175, 0.12); color: #9ca3af; }

    /* ===== PRICE ===== */
    .price-section {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
    }

    .price-label {
      font-size: 1rem;
      font-weight: 600;
      color: var(--on-surface);
    }

    .price-value {
      font-size: 1.3rem;
      font-weight: 700;
      color: var(--amber);
    }

    /* ===== STICKY ACTIONS ===== */
    .sticky-actions {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 12px 16px;
      background: rgba(18, 18, 18, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      z-index: 20;
      padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    }

    .action-btn {
      flex: 1;
      font-weight: 600;
      border-radius: 10px;
      min-height: 48px;
      font-size: 0.9rem;
    }

    .confirm-btn {
      background: var(--amber) !important;
      color: #000 !important;
    }

    .photos-btn {
      background: #3b82f6 !important;
      color: #fff !important;
    }

    .repeat-btn {
      background: rgba(34, 197, 94, 0.15) !important;
      color: #22c55e !important;
    }

    .pay-btn {
      background: var(--amber) !important;
      color: #000 !important;
    }

    .action-btn mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      margin-right: 6px;
    }
  `,
})
export class OrderDetailsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly order = signal<OrderHistory | null>(null);
  readonly isLoading = signal(true);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Try to get order from Router state first
    const navState = this.router.getCurrentNavigation()?.extras?.state ?? history.state;
    if (navState?.['order']) {
      const o = navState['order'] as OrderHistory;
      this.order.set({ ...o, createdAt: new Date(o.createdAt) });
      this.isLoading.set(false);
      return;
    }

    // Fallback: find order in SWR cache or refetch
    const orderId = this.route.snapshot.paramMap.get('id');
    if (!orderId) {
      this.goBack();
      return;
    }

    this.loadFromCacheOrFetch(orderId);
  }

  goBack(): void {
    this.location.back();
  }

  goToApproval(): void {
    const o = this.order();
    if (o) {
      this.router.navigate(['/user-profile/photo-approval', o.id]);
    }
  }

  goToChat(): void {
    this.router.navigate(['/chat']);
  }

  repeatOrder(): void {
    const o = this.order();
    if (o) {
      this.router.navigate(['/chat'], { queryParams: { repeat: o.id } });
    }
  }

  canViewPhotos(): boolean {
    const o = this.order();
    if (!o || o.orderType !== OrderType.PHOTO_SESSION) return false;
    return o.status === OrderStatus.COMPLETED ||
           o.status === OrderStatus.WAITING_APPROVAL ||
           o.status === OrderStatus.READY;
  }

  getOrderTitle(): string {
    const o = this.order();
    if (!o) return 'Заказ';
    switch (o.orderType) {
      case OrderType.PHOTO_SESSION: return o.photoSession?.title || 'Фотосессия';
      case OrderType.DOCUMENT_PHOTO: return `Фото на ${o.documentPhoto?.documentType || 'документы'}`;
      case OrderType.PHOTO_RESTORATION: return 'Реставрация фотографий';
      case OrderType.PHOTO_PRINTING: return 'Печать фотографий';
      case OrderType.PHOTO_EDITING: return 'Ретушь и обработка';
      case OrderType.PHOTO_PRODUCTS: return 'Фотопродукция';
      case OrderType.FRAMING: return 'Багетные работы';
      default: return 'Заказ';
    }
  }

  getOrderTypeIcon(): string {
    const o = this.order();
    if (!o) return 'receipt_long';
    const map: Record<OrderType, string> = {
      [OrderType.DOCUMENT_PHOTO]: 'badge',
      [OrderType.PHOTO_SESSION]: 'photo_camera',
      [OrderType.PHOTO_RESTORATION]: 'auto_fix_high',
      [OrderType.PHOTO_PRINTING]: 'print',
      [OrderType.PHOTO_EDITING]: 'tune',
      [OrderType.PHOTO_PRODUCTS]: 'inventory_2',
      [OrderType.FRAMING]: 'crop_square',
    };
    return map[o.orderType] ?? 'receipt_long';
  }

  getStatusText(): string {
    const map: Record<string, string> = {
      new: 'Новый', processing: 'В обработке', waiting: 'Ожидает',
      ready: 'Готов', completed: 'Завершён', cancelled: 'Отменён',
      refunded: 'Возврат', pending_payment: 'Ожидает оплаты',
    };
    return map[this.order()?.status ?? ''] ?? 'Неизвестно';
  }

  getPaymentStatusText(): string {
    const map: Record<string, string> = {
      pending: 'Ожидает оплаты', partial: 'Частично оплачено',
      paid: 'Оплачено', refunded: 'Возврат', cancelled: 'Отменено', none: 'Не оплачен',
    };
    return map[this.order()?.paymentStatus ?? ''] ?? 'Неизвестно';
  }

  getComplexityText(complexity: string): string {
    const map: Record<string, string> = { simple: 'Простая', medium: 'Средняя', complex: 'Сложная' };
    return map[complexity] ?? complexity;
  }

  private loadFromCacheOrFetch(orderId: string): void {
    try {
      const raw = sessionStorage.getItem(SWR_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { data: OrderHistory[] };
        const found = parsed.data.find(o => o.id === orderId);
        if (found) {
          this.order.set({ ...found, createdAt: new Date(found.createdAt) });
          this.isLoading.set(false);
          return;
        }
      }
    } catch { /* ignore */ }

    // Refetch from API
    const userId = this.authService.getCurrentUser()?.id ?? '';
    this.http.get<OrdersHistoryApiResponse>('/api/orders/my-history?limit=50').subscribe({
      next: (res) => {
        const mapped = mapRawOrders(res.data ?? [], userId);
        const found = mapped.find(o => o.id === orderId);
        if (found) {
          this.order.set(found);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }
}
