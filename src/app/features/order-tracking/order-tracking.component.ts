import { Component, ChangeDetectionStrategy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DecimalPipe, DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

interface TrackingOrder {
  id: string;
  status: string;
  paymentStatus: string;
  totalPrice: number;
  paidAt: string | null;
  createdAt: string;
  items: TrackingOrderItem[];
  deliveryAddress: string | null;
  deliveryCost: number | null;
  receiptUrl: string | null;
  cardInfo: string | null;
  contactName: string | null;
  contactEmail: string | null;
  promoCode: string | null;
  promoDiscount: number | null;
}

interface TrackingOrderItem {
  name?: string;
  service?: string;
  tariff?: string;
  document?: string;
  format?: string;
  paperType?: string;
  details?: string[];
  price?: number | null;
  unitPrice?: number | null;
  quantity?: number | null;
  photoCount?: number | null;
}

interface TimelineStep {
  key: string;
  label: string;
  icon: string;
  active: boolean;
  current: boolean;
  date: string | null;
  failed?: boolean;
}

@Component({
  selector: 'app-order-tracking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    DatePipe,
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="tracking-page">
      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="40" />
          <p>Загрузка данных заказа...</p>
        </div>
      } @else if (error()) {
        <div class="error-state">
          <mat-card class="error-card" appearance="outlined">
            <mat-card-content>
              <div class="error-icon-wrap">
                <mat-icon>search_off</mat-icon>
              </div>
              <h2>{{ error() }}</h2>
              <p>Проверьте ссылку или свяжитесь с нами, мы поможем найти ваш заказ</p>
              <div class="error-actions">
                <a mat-flat-button routerLink="/chat" class="chat-btn">
                  <mat-icon>chat</mat-icon>
                  Написать в чат
                </a>
                <a mat-stroked-button href="tel:+78633226575">
                  <mat-icon>phone</mat-icon>
                  Позвонить
                </a>
              </div>
            </mat-card-content>
          </mat-card>
        </div>
      } @else {
        @let o = order();
        @if (o) {
        <!-- Контекстное сообщение -->
        <div class="status-banner" [class]="'banner-' + o.status">
          <mat-icon>{{ statusIcon(o.status) }}</mat-icon>
          <div class="banner-text">
            <strong>{{ statusMessage(o.status) }}</strong>
            @if (statusHint(o); as hint) {
              <span>{{ hint }}</span>
            }
          </div>
        </div>

        <mat-card class="order-card" appearance="outlined">
          <!-- Шапка -->
          <div class="order-header">
            <div class="order-info">
              <span class="order-label">Заказ</span>
              <h1>{{ shortOrderId(o.id) }}</h1>
              <span class="created-date">{{ o.createdAt | date:'dd MMMM yyyy, HH:mm' }}</span>
            </div>
            <div class="status-badges">
              <mat-chip [class]="'s-' + o.status" highlighted>{{ statusLabel(o.status) }}</mat-chip>
              @if (o.paymentStatus !== 'none') {
                <mat-chip [class]="'p-' + o.paymentStatus">{{ paymentLabel(o.paymentStatus) }}</mat-chip>
              }
            </div>
          </div>

          <!-- Timeline -->
          <div class="timeline">
            @for (step of timelineSteps(); track step.key; let last = $last) {
              <div class="timeline-step" [class.active]="step.active" [class.current]="step.current" [class.failed]="step.failed">
                <div class="step-track">
                  <div class="step-dot">
                    <mat-icon>{{ step.active ? (step.failed ? 'cancel' : 'check_circle') : step.icon }}</mat-icon>
                  </div>
                  @if (!last) {
                    <div class="step-line" [class.filled]="step.active && !step.current"></div>
                  }
                </div>
                <div class="step-content">
                  <span class="step-label">{{ step.label }}</span>
                  @if (step.date) {
                    <span class="step-date">{{ step.date | date:'dd.MM.yyyy HH:mm' }}</span>
                  }
                </div>
              </div>
            }
          </div>

          <!-- Состав заказа -->
          @if (o.items.length > 0) {
            <div class="section">
              <h3><mat-icon>receipt_long</mat-icon> Состав заказа</h3>
              @for (item of o.items; track $index) {
                @let details = itemDetails(item);
                @let price = itemPrice(item);
                <div class="item-row">
                  <div class="item-info">
                    <span class="item-name">{{ itemTitle(item) }}</span>
                    @if (details) {
                      <span class="item-doc">{{ details }}</span>
                    }
                  </div>
                  @if (price !== null) {
                    <span class="item-price">{{ price | number:'1.0-0' }} &#8381;</span>
                  }
                </div>
              }
            </div>
          }

          <!-- Итого -->
          <div class="section pricing">
            @if (o.promoDiscount && o.promoDiscount > 0) {
              <div class="price-row">
                <span>Сумма</span>
                <span>{{ o.totalPrice + o.promoDiscount | number:'1.0-0' }} &#8381;</span>
              </div>
              <div class="price-row discount">
                <span>Скидка{{ o.promoCode ? ' (' + o.promoCode + ')' : '' }}</span>
                <span>&minus;{{ o.promoDiscount | number:'1.0-0' }} &#8381;</span>
              </div>
            }
            @if (o.deliveryCost) {
              <div class="price-row">
                <span>Доставка</span>
                <span>{{ o.deliveryCost | number:'1.0-0' }} &#8381;</span>
              </div>
            }
            <div class="price-row total">
              <span>Итого</span>
              <span>{{ o.totalPrice | number:'1.0-0' }} &#8381;</span>
            </div>
          </div>

          <!-- Доставка -->
          @if (o.deliveryAddress) {
            <div class="section">
              <h3><mat-icon>local_shipping</mat-icon> Доставка</h3>
              <p class="detail-text">{{ o.deliveryAddress }}</p>
            </div>
          }

          <!-- Оплата -->
          @if (o.cardInfo) {
            <div class="section">
              <h3><mat-icon>credit_card</mat-icon> Оплата</h3>
              <p class="detail-text">{{ o.cardInfo }}</p>
            </div>
          }

          <!-- Чек -->
          @if (o.receiptUrl) {
            <a mat-stroked-button class="receipt-btn" [href]="o.receiptUrl" target="_blank" rel="noopener">
              <mat-icon>receipt</mat-icon>
              Открыть чек
            </a>
          }
        </mat-card>

        <!-- Контакты -->
        <mat-card class="contacts-card" appearance="outlined">
          <div class="contacts-content">
            <h3>Вопросы по заказу?</h3>
            <p>Напишите нам, ответим в течение пары минут</p>
            <div class="contact-actions">
              <a mat-flat-button routerLink="/chat" class="chat-btn">
                <mat-icon>chat</mat-icon>
                Написать в чат
              </a>
            </div>
            <div class="contact-alt">
              <a mat-button href="tel:+78633226575">
                <mat-icon>phone</mat-icon> +7 (863) 322-65-75
              </a>
            </div>
          </div>
        </mat-card>
      }
      }
    </div>
  `,
  styles: `
    .tracking-page {
      max-width: 560px;
      margin: 16px auto;
      padding: 0 16px 32px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Loading */
    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 80px 0;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    /* Error */
    .error-state {
      padding-top: 32px;
    }

    .error-card mat-card-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 40px 24px;
      gap: 16px;
    }

    .error-icon-wrap {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: var(--ed-surface-container, #1a1a1a);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .error-icon-wrap mat-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .error-card h2 {
      margin: 0;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 18px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: -0.02em;
    }

    .error-card p {
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0;
      font-size: 14px;
      line-height: 1.5;
    }

    .error-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
      margin-top: 8px;
    }

    /* Status banner */
    .status-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border-radius: 16px;
      background: var(--ed-accent-container, #451a03);
      color: var(--ed-on-surface, #f5f5f5);
    }

    .status-banner mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      flex-shrink: 0;
    }

    .banner-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .banner-text strong {
      font-size: 15px;
    }

    .banner-text span {
      font-size: 13px;
      opacity: 0.85;
    }

    .banner-ready {
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
    }

    .banner-completed {
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface, #f5f5f5);
    }

    .banner-cancelled,
    .banner-expired,
    .banner-payment_failed {
      background: rgba(239, 68, 68, 0.15);
      color: var(--ed-error, #ef4444);
    }

    .banner-pending_payment {
      background: rgba(245, 158, 11, 0.15);
      color: var(--ed-accent, #f59e0b);
    }

    /* Order card */
    .order-card {
      padding: 20px;
    }

    .order-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }

    .order-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
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
      font-size: 20px;
      font-weight: 700;
      margin: 0;
      line-height: 1.2;
    }

    .created-date {
      font-size: 13px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-top: 2px;
    }

    .status-badges {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* Timeline */
    .timeline {
      margin: 20px 0 8px;
    }

    .timeline-step {
      display: flex;
      gap: 14px;
      opacity: 0.3;
      transition: opacity 0.2s;
    }

    .timeline-step.active {
      opacity: 1;
    }

    .step-track {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex-shrink: 0;
      width: 24px;
    }

    .step-dot mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: var(--ed-accent, #f59e0b);
    }

    .timeline-step.failed .step-dot mat-icon {
      color: var(--ed-error, #ef4444);
    }

    .timeline-step.current .step-dot mat-icon {
      animation: pulse 2s ease-in-out infinite;
    }

    .step-line {
      width: 2px;
      flex: 1;
      min-height: 20px;
      background: var(--ed-outline-variant, #2a2a2a);
      margin: 4px 0;
      border-radius: 1px;
    }

    .step-line.filled {
      background: var(--ed-accent, #f59e0b);
    }

    .step-content {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 1px 0 16px;
    }

    .step-label {
      font-size: 14px;
      font-weight: 500;
    }

    .step-date {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.9); }
    }

    /* Sections */
    .section {
      margin: 16px 0 0;
    }

    .section h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0 0 10px;
    }

    .section h3 mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .item-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 8px 0;
      font-size: 14px;
    }

    .item-row + .item-row {
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .item-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }

    .item-name {
      font-weight: 500;
      line-height: 1.3;
    }

    .item-doc {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.35;
    }

    .item-price {
      font-weight: 600;
      white-space: nowrap;
      text-align: right;
    }

    /* Pricing */
    .pricing {
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      padding-top: 12px;
    }

    .price-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      font-size: 14px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .price-row.discount {
      color: #4ade80;
    }

    .price-row.total {
      font-weight: 700;
      font-size: 18px;
      color: var(--ed-on-surface, #f5f5f5);
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      margin-top: 8px;
      padding-top: 10px;
    }

    .detail-text {
      font-size: 14px;
      margin: 0;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .receipt-btn {
      margin-top: 16px;
      width: 100%;
    }

    /* Contacts card */
    .contacts-card {
      padding: 20px;
    }

    .contacts-content {
      text-align: center;
    }

    .contacts-content h3 {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 16px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: -0.02em;
      margin: 0 0 4px;
    }

    .contacts-content p {
      font-size: 13px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0 0 16px;
    }

    .contact-actions {
      margin-bottom: 12px;
    }

    .chat-btn {
      min-width: 200px;
    }

    .contact-alt {
      display: flex;
      justify-content: center;
      gap: 4px;
      flex-wrap: wrap;
    }

    .contact-alt a {
      font-size: 13px;
    }

    /* Status chips */
    mat-chip.s-pending_payment,
    mat-chip.s-new { --mdc-chip-elevated-container-color: rgba(245, 158, 11, 0.15); --mdc-chip-label-text-color: var(--ed-accent, #f59e0b); }
    mat-chip.s-processing { --mdc-chip-elevated-container-color: var(--ed-accent-container, #451a03); --mdc-chip-label-text-color: var(--ed-accent, #f59e0b); }
    mat-chip.s-ready { --mdc-chip-elevated-container-color: rgba(34, 197, 94, 0.15); --mdc-chip-label-text-color: #4ade80; }
    mat-chip.s-completed { --mdc-chip-elevated-container-color: var(--ed-accent, #f59e0b); --mdc-chip-label-text-color: var(--ed-on-accent, #0a0a0a); }
    mat-chip.s-cancelled,
    mat-chip.s-expired,
    mat-chip.s-payment_failed { --mdc-chip-elevated-container-color: rgba(239, 68, 68, 0.15); --mdc-chip-label-text-color: var(--ed-error, #ef4444); }

    mat-chip.p-paid { --mdc-chip-elevated-container-color: rgba(34, 197, 94, 0.15); --mdc-chip-label-text-color: #4ade80; }
    mat-chip.p-none,
    mat-chip.p-pending { --mdc-chip-elevated-container-color: rgba(245, 158, 11, 0.15); --mdc-chip-label-text-color: var(--ed-accent, #f59e0b); }
    mat-chip.p-failed,
    mat-chip.p-expired { --mdc-chip-elevated-container-color: rgba(239, 68, 68, 0.15); --mdc-chip-label-text-color: var(--ed-error, #ef4444); }

    @media (min-width: 600px) {
      .tracking-page {
        margin-top: 24px;
        gap: 16px;
      }

      .order-card,
      .contacts-card {
        padding: 28px;
      }

      .status-banner {
        padding: 20px 24px;
      }
    }
  `,
})
export class OrderTrackingComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  protected readonly order = signal<TrackingOrder | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly timelineSteps = signal<TimelineStep[]>([]);

  ngOnInit(): void {
    const orderId = this.route.snapshot.paramMap.get('orderId');
    if (!orderId) {
      this.error.set('ID заказа не указан');
      this.loading.set(false);
      return;
    }

    this.http.get<{ success: boolean; order?: TrackingOrder; error?: string }>(
      `/api/payments/status/${encodeURIComponent(orderId)}`,
    ).subscribe({
      next: (res) => {
        if (res.success && res.order) {
          this.order.set(res.order);
          this.buildTimeline(res.order);
        } else {
          this.error.set(res.error || 'Заказ не найден');
        }
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Ошибка загрузки данных');
        this.loading.set(false);
      },
    });
  }

  private buildTimeline(o: TrackingOrder): void {
    const statusOrder = ['pending_payment', 'paid', 'processing', 'ready', 'completed'];
    const idx = statusOrder.indexOf(o.status);

    const steps: TimelineStep[] = [
      { key: 'created', label: 'Заказ создан', icon: 'radio_button_unchecked', active: true, current: false, date: o.createdAt },
      { key: 'paid', label: 'Оплачен', icon: 'radio_button_unchecked', active: o.paymentStatus === 'paid' || idx >= 1, current: o.status === 'paid', date: o.paidAt },
      { key: 'processing', label: 'Принят в работу', icon: 'radio_button_unchecked', active: idx >= 2, current: o.status === 'processing', date: null },
      { key: 'ready', label: 'Готов к выдаче', icon: 'radio_button_unchecked', active: idx >= 3, current: o.status === 'ready', date: null },
      { key: 'completed', label: 'Выполнен', icon: 'radio_button_unchecked', active: idx >= 4, current: o.status === 'completed', date: null },
    ];

    if (['cancelled', 'expired', 'payment_failed'].includes(o.status)) {
      steps.push({
        key: o.status,
        label: this.statusLabel(o.status),
        icon: 'cancel',
        active: true,
        current: true,
        date: null,
        failed: true,
      });
    }

    this.timelineSteps.set(steps);
  }

  protected shortOrderId(id: string): string {
    // chat-c5376730-cfda-413c-9b30-4860b9b946b8-1005 → #1005
    const parts = id.split('-');
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) return `#${last}`;
    // PP-260210-F602 → PP-260210-F602
    return id;
  }

  protected statusIcon(s: string): string {
    return ({
      pending_payment: 'hourglass_top',
      paid: 'schedule',
      processing: 'autorenew',
      ready: 'check_circle',
      completed: 'verified',
      cancelled: 'block',
      expired: 'schedule',
      payment_failed: 'error_outline',
      new: 'fiber_new',
    } as Record<string, string>)[s] || 'info';
  }

  protected statusMessage(s: string): string {
    return ({
      pending_payment: 'Ожидает оплаты',
      paid: 'Заказ оплачен и ждёт очереди',
      processing: 'Заказ принят в работу',
      ready: 'Заказ готов!',
      completed: 'Заказ выполнен. Спасибо!',
      cancelled: 'Заказ отменён',
      expired: 'Срок оплаты истёк',
      payment_failed: 'Ошибка оплаты',
      new: 'Заказ создан',
    } as Record<string, string>)[s] || 'Статус заказа';
  }

  protected statusHint(order: TrackingOrder): string {
    if (order.status === 'ready') {
      return order.deliveryAddress
        ? `Заказ можно забрать: ${order.deliveryAddress}`
        : 'Заказ можно забрать в выбранной точке';
    }

    return ({
      paid: 'Скоро примем заказ в работу',
      processing: 'Мы уведомим вас, когда заказ будет готов',
      pending_payment: 'Оплатите заказ, чтобы мы начали выполнение',
      cancelled: 'Если это ошибка, напишите нам в чат',
      expired: 'Вы можете создать новый заказ через чат',
      payment_failed: 'Попробуйте оплатить ещё раз или свяжитесь с нами',
    } as Record<string, string>)[order.status] || '';
  }

  protected statusLabel(s: string): string {
    return ({
      pending_payment: 'Ожидает оплаты',
      paid: 'В очереди',
      processing: 'Принят в работу',
      ready: 'Готов к выдаче',
      completed: 'Выполнен',
      cancelled: 'Отменён',
      expired: 'Истёк',
      payment_failed: 'Ошибка оплаты',
      new: 'Новый',
    } as Record<string, string>)[s] || s;
  }

  protected paymentLabel(s: string): string {
    return ({
      paid: 'Оплачен',
      none: 'Не оплачен',
      pending: 'Ожидание',
      failed: 'Ошибка',
      expired: 'Истёк',
    } as Record<string, string>)[s] || s;
  }

  protected itemTitle(item: TrackingOrderItem): string {
    return item.name || item.service || item.tariff || 'Услуга';
  }

  protected itemDetails(item: TrackingOrderItem): string {
    const parts: string[] = [];
    const quantity = this.itemQuantity(item);
    if (quantity !== null) {
      parts.push(`${quantity} шт.`);
    }

    for (const detail of [
      ...(item.details ?? []),
      item.format,
      item.paperType,
      item.document,
    ]) {
      if (detail && !parts.includes(detail)) {
        parts.push(detail);
      }
    }

    const unitPrice = this.itemUnitPrice(item);
    if (unitPrice !== null && quantity !== null && quantity > 1) {
      parts.push(`${unitPrice.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽/шт.`);
    }

    return parts.join(' · ');
  }

  protected itemPrice(item: TrackingOrderItem): number | null {
    return typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null;
  }

  private itemUnitPrice(item: TrackingOrderItem): number | null {
    if (typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice)) return item.unitPrice;
    const price = this.itemPrice(item);
    const quantity = this.itemQuantity(item);
    return price !== null && quantity !== null && quantity > 0 ? price / quantity : null;
  }

  private itemQuantity(item: TrackingOrderItem): number | null {
    const quantity = item.quantity ?? item.photoCount ?? null;
    return typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0
      ? Math.trunc(quantity)
      : null;
  }
}
