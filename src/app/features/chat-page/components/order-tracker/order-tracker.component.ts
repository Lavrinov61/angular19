/**
 * OrderTracker, карточка заказа с real-time трекингом.
 *
 * Свёрнутая: название услуги, цена, дата, строка статуса.
 * Развёрнутая (по клику): хронология событий, способ получения, live-индикатор.
 */

import {
  Component, ChangeDetectionStrategy, OnInit, OnDestroy,
  input, signal, computed, PLATFORM_ID, inject,
} from '@angular/core';
import { DatePipe, CurrencyPipe, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Socket } from 'socket.io-client';
import { environment } from '../../../../../environments/environment';
import { getSocketIoEndpoint, getSocketIoTransports } from '../../../../core/utils/socket-io-routing.util';
import { formatOrderId } from '../../utils/format-order-id';

interface OrderItem {
  service?: string;
  tariff?: string;
  document?: string;
  price?: number;
}

interface TrackResponse {
  success: boolean;
  order: {
    order_id: string;
    status: string;
    payment_status: string;
    contact_name: string;
    total_price: number;
    priority: string;
    queue_position: number | null;
    estimated_ready_at: string | null;
    created_at: string;
    updated_at: string;
    delivery_method: string | null;
    items: OrderItem[] | null;
  };
  queue: {
    position: number | null;
    estimated_ready_at: string | null;
    total_in_queue: number;
  } | null;
  status_steps: { id: string; label: string; done: boolean }[];
  status_history: { old_status: string | null; new_status: string; created_at: string }[];
  queue_stats: { completed_today: number };
}

@Component({
  selector: 'app-order-tracker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, CurrencyPipe],
  template: `
    @if (loading() && !data()) {
      <div class="ot-loading">
        <span class="ot-spinner"></span>
        Загружаем заказ...
      </div>
    } @else if (error() && !data()) {
      <div class="ot-error">{{ error() }}</div>
    } @else if (data()) {
      <div class="ot-card"
           [class.ot-card-ready]="data()!.order.status === 'ready'"
           [class.ot-card-completed]="data()!.order.status === 'completed' || data()!.order.status === 'cancelled'"
           (click)="expanded.set(!expanded())"
           (keydown.enter)="expanded.set(!expanded())"
           tabindex="0">

        <!-- Строка 1: название услуги + цена -->
        <div class="ot-row ot-row-main">
          <span class="ot-service">{{ serviceName() }}</span>
          <span class="ot-price">{{ data()!.order.total_price | currency:'RUB':'symbol':'1.0-0':'ru' }}</span>
        </div>

        <!-- Строка 2: документ + дата -->
        <div class="ot-row ot-row-sub">
          @if (documentName()) {
            <span class="ot-doc">{{ documentName() }}</span>
          }
          <span class="ot-date">{{ data()!.order.created_at | date:'d MMM':'':'ru' }}</span>
        </div>

        <!-- Строка 3: статус + expand -->
        <div class="ot-row ot-row-status">
          <span class="ot-status-text" [class]="'ot-s-' + data()!.order.status">{{ statusSummary() }}</span>
          <span class="ot-chevron" [class.ot-chevron-open]="expanded()">▾</span>
        </div>

        <!-- Развёрнутые детали -->
        @if (expanded()) {
          <div class="ot-expanded">

            <!-- Хронология -->
            @if (timeline().length > 0) {
              <div class="ot-tl-label">Хронология</div>
              <div class="ot-tl">
                @for (step of timeline(); track step.label) {
                  <div class="ot-tl-step" [class.done]="step.done">
                    <span class="ot-tl-dot">{{ step.done ? '✓' : '○' }}</span>
                    <span class="ot-tl-label-text">{{ step.label }}</span>
                    @if (step.time) {
                      <span class="ot-tl-time">{{ step.time }}</span>
                    }
                  </div>
                }
              </div>
            }

            <!-- Способ получения -->
            @if (deliveryText()) {
              <div class="ot-delivery-row">
                📦 {{ deliveryText() }}
              </div>
            }

            <!-- Footer: соц. доказательство + live -->
            <div class="ot-footer-row">
              @if (data()!.queue_stats.completed_today > 0) {
                <span class="ot-social">✅ {{ data()!.queue_stats.completed_today }} заказов сегодня</span>
              }
              @if (connected()) {
                <span class="ot-live"><span class="ot-live-dot"></span>Live</span>
              }
            </div>

          </div>
        }

      </div>
    }
  `,
  styles: [`
    .ot-card {
      background: #ffffff;
      border-radius: 8px;
      border: 1px solid #dfe3e8;
      padding: 14px 16px;
      margin-bottom: 12px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      user-select: none;
    }
    .ot-card:hover {
      border-color: #cbd2dc;
      background: #f7f8fa;
    }
    .ot-card-ready {
      border-color: #c7efd8;
      background: #e8f8ef;
    }
    .ot-card-ready:hover {
      border-color: rgba(74, 222, 128, 0.5);
    }
    .ot-card-completed {
      opacity: 0.65;
    }

    /* Строки */
    .ot-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ot-row-main {
      justify-content: space-between;
      margin-bottom: 3px;
    }
    .ot-row-sub {
      margin-bottom: 10px;
      gap: 6px;
    }
    .ot-row-status {
      justify-content: space-between;
      align-items: center;
    }

    .ot-service {
      font-size: 14px;
      font-weight: 600;
      color: #20242a;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ot-price {
      font-size: 14px;
      font-weight: 700;
      color: #20242a;
      flex-shrink: 0;
    }
    .ot-doc {
      font-size: 12px;
      color: #737985;
    }
    .ot-date {
      font-size: 12px;
      color: #737985;
      margin-left: auto;
    }

    .ot-status-text {
      font-size: 13px;
      font-weight: 500;
    }
    .ot-s-paid      { color: #60a5fa; }
    .ot-s-processing { color: #ef3124; }
    .ot-s-ready     { color: #4ade80; font-weight: 600; }
    .ot-s-completed { color: var(--ed-on-surface-variant, #777); }
    .ot-s-cancelled { color: #f87171; }

    .ot-chevron {
      font-size: 16px;
      color: #9aa1ac;
      transition: transform 0.2s;
      line-height: 1;
      flex-shrink: 0;
    }
    .ot-chevron-open {
      transform: rotate(180deg);
    }

    /* Развёрнутая часть */
    .ot-expanded {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #dfe3e8;
    }

    /* Хронология */
    .ot-tl-label {
      font-size: 11px;
      font-weight: 600;
      color: #737985;
      letter-spacing: 0;
      margin-bottom: 8px;
    }
    .ot-tl {
      display: flex;
      flex-direction: column;
      gap: 7px;
      margin-bottom: 12px;
    }
    .ot-tl-step {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ot-tl-dot {
      font-size: 12px;
      color: #9aa1ac;
      width: 14px;
      flex-shrink: 0;
      text-align: center;
    }
    .ot-tl-step.done .ot-tl-dot { color: #4ade80; }

    .ot-tl-label-text {
      font-size: 12px;
      color: #737985;
      flex: 1;
    }
    .ot-tl-step.done .ot-tl-label-text { color: #20242a; }

    .ot-tl-time {
      font-size: 11px;
      color: #737985;
      font-variant-numeric: tabular-nums;
    }

    /* Доставка */
    .ot-delivery-row {
      font-size: 12px;
      color: #737985;
      padding: 8px 10px;
      background: #f7f8fa;
      border-radius: 6px;
      margin-bottom: 10px;
    }

    /* Footer */
    .ot-footer-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ot-social {
      font-size: 11px;
      color: #4ade80;
    }
    .ot-live {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #737985;
    }
    .ot-live-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
      animation: ot-live-pulse 1.5s ease-in-out infinite;
      display: inline-block;
    }
    @keyframes ot-live-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* Загрузка / ошибка */
    .ot-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #737985;
      font-size: 13px;
      padding: 12px 0;
    }
    .ot-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid #dfe3e8;
      border-top-color: #737985;
      border-radius: 50%;
      animation: ot-spin 0.8s linear infinite;
      display: inline-block;
      flex-shrink: 0;
    }
    @keyframes ot-spin { to { transform: rotate(360deg); } }

    .ot-error {
      font-size: 12px;
      color: #f87171;
      padding: 8px 0;
    }
  `],
})
export class OrderTrackerComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  readonly orderId = input.required<string>();
  protected readonly formatOrderId = formatOrderId;

  readonly data = signal<TrackResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly connected = signal(false);
  readonly expanded = signal(false);

  private socket: Socket | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  /** Название услуги из items[0] */
  readonly serviceName = computed(() => {
    const items = this.data()?.order.items;
    if (items?.length) {
      return items[0].tariff || items[0].service || null;
    }
    return formatOrderId(this.data()?.order.order_id ?? '');
  });

  /** Документ из items[0] */
  readonly documentName = computed(() => this.data()?.order.items?.[0]?.document || null);

  readonly statusLabel = computed(() => {
    const status = this.data()?.order.status;
    const map: Record<string, string> = {
      paid: 'В очереди',
      processing: 'Принят в работу',
      ready: 'Готово!',
      completed: 'Выполнен',
      cancelled: 'Отменён',
    };
    return status ? (map[status] ?? status) : '';
  });

  readonly inQueue = computed(() => {
    const status = this.data()?.order.status;
    return status === 'paid' || status === 'processing';
  });

  readonly queueAhead = computed(() => {
    const pos = this.data()?.queue?.position;
    return pos ? pos - 1 : 0;
  });

  readonly estimatedTime = computed(() => {
    const est = this.data()?.order.estimated_ready_at;
    if (!est) return null;
    return new Date(est).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  });

  readonly deliveryText = computed(() => {
    switch (this.data()?.order.delivery_method) {
      case 'electronic': return 'Результат отправят в чат';
      case 'pickup':     return 'Заберите в студии на Соборном 21';
      case 'postal':     return 'Отправлено по указанному адресу';
      default:           return null;
    }
  });

  /** Компактная строка статуса: "В работе · перед вами: 2 · ~15:30" */
  readonly statusSummary = computed(() => {
    const d = this.data();
    if (!d) return '';
    const status = d.order.status;
    const label = this.statusLabel();

    // Для "Готово" показываем способ получения
    if (status === 'ready' && this.deliveryText()) {
      return `${label} · ${this.deliveryText()}`;
    }

    // Для заказов в очереди, позиция и ETA
    if (this.inQueue() && d.queue?.position) {
      const ahead = this.queueAhead();
      const parts: string[] = [label];
      if (ahead > 0) {
        parts.push(`перед вами: ${ahead}`);
      } else {
        parts.push('вы следующий!');
      }
      if (this.estimatedTime()) parts.push(`~${this.estimatedTime()}`);
      return parts.join(' · ');
    }

    return label;
  });

  /** Хронология для развёрнутого вида */
  readonly timeline = computed(() => {
    const d = this.data();
    if (!d) return [];

    const labels: Record<string, string> = {
      paid:       'Оплачен',
      processing: 'Принят в работу',
      ready:      'Готов',
      completed:  'Выполнен',
      cancelled:  'Отменён',
    };

    const flow = d.order.status === 'cancelled'
      ? ['paid', 'cancelled']
      : ['paid', 'processing', 'ready', 'completed'];

    // Время каждого статуса из истории
    const timeMap = new Map<string, string>();
    for (const h of d.status_history) {
      if (flow.includes(h.new_status) && !timeMap.has(h.new_status)) {
        const t = new Date(h.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        timeMap.set(h.new_status, t);
      }
    }

    const curIdx = flow.indexOf(d.order.status);
    // Показываем: все достигнутые + 1 следующий ожидаемый (кроме 'completed')
    const showUntil = d.order.status === 'completed'
      ? curIdx
      : Math.min(curIdx + 1, flow.length - 2);

    return flow
      .slice(0, showUntil + 1)
      .map(s => ({
        label: labels[s] ?? s,
        time: timeMap.get(s) ?? null,
        done: flow.indexOf(s) <= curIdx,
      }));
  });

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.load();
    this.connectWebSocket();
    this.pollInterval = setInterval(() => this.load(), 30_000);
  }

  ngOnDestroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.socket) {
      this.socket.emit('order:untrack', this.orderId());
      this.socket.disconnect();
    }
  }

  private load(): void {
    if (!this.data()) this.loading.set(true);
    firstValueFrom(
      this.http.get<TrackResponse>(`/api/orders/photo-print/track/${this.orderId()}`)
    ).then(res => {
      this.data.set(res);
      this.loading.set(false);
      this.error.set(null);
    }).catch(() => {
      this.loading.set(false);
      if (!this.data()) this.error.set('Не удалось загрузить статус заказа');
    });
  }

  private async connectWebSocket(): Promise<void> {
    try {
      const { io } = await import('socket.io-client');
      const endpoint = getSocketIoEndpoint(environment.wsUrl);
      const options = {
        path: '/socket.io/',
        auth: { visitorId: `tracker-${this.orderId()}` },
        transports: getSocketIoTransports(environment.wsUrl),
      };
      const socket = endpoint ? io(endpoint, options) : io(options);
      this.socket = socket;

      socket.on('connect', () => {
        this.connected.set(true);
        socket.emit('order:track', this.orderId());
      });

      socket.on('disconnect', () => {
        this.connected.set(false);
      });

      socket.on('order:status_changed', (payload: {
        orderId: string; status: string;
        queue_position: number | null; estimated_ready_at: string | null;
      }) => {
        if (payload.orderId !== this.orderId()) return;
        this.load();
      });
    } catch {
      // WebSocket недоступен, polling работает
    }
  }
}
