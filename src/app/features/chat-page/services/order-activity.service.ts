import {
  Injectable,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth.service';
import { AuthChatService } from '../../../core/services/auth-chat.service';

export interface VisitorOrderItem {
  service?: string;
  tariff?: string;
  document?: string;
  price?: number;
  quantity?: number;
}

export interface VisitorOrder {
  id: string;
  status: string;
  paymentStatus: string;
  totalPrice: number;
  createdAt: string;
  items: VisitorOrderItem[];
  priority?: string;
  contactName?: string;
  email?: string;
  deliveryMethod?: string;
}

@Injectable({ providedIn: 'root' })
export class OrderActivityService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly chatService = inject(AuthChatService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly apiUrl = environment.apiUrl;

  private readonly _orders = signal<VisitorOrder[]>([]);
  private readonly _loading = signal(false);
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _loaded = false;

  readonly orders = this._orders.asReadonly();
  readonly loading = this._loading.asReadonly();

  /** Неоплаченные, paymentStatus === 'pending' и статус не cancelled */
  readonly unpaidOrders = computed(() =>
    this._orders().filter(o =>
      o.paymentStatus === 'pending' &&
      o.status !== 'cancelled' &&
      o.status !== 'refunded'
    )
  );

  /** Активные, оплачены, в работе или в очереди */
  readonly activeOrders = computed(() =>
    this._orders().filter(o =>
      o.paymentStatus === 'paid' &&
      ['new', 'paid', 'processing'].includes(o.status)
    )
  );

  /** Готовые к выдаче */
  readonly readyOrders = computed(() =>
    this._orders().filter(o => o.status === 'ready')
  );

  /** Завершённые */
  readonly completedOrders = computed(() =>
    this._orders().filter(o =>
      o.status === 'completed' ||
      o.status === 'delivered' ||
      o.status === 'cancelled' ||
      o.status === 'refunded'
    )
  );

  readonly hasOrders = computed(() => this._orders().length > 0);

  readonly hasUnpaidOrders = computed(() => this.unpaidOrders().length > 0);

  /** Флаг, есть что-то интересное для клиента (неоплаченное, активное, готовое) */
  readonly hasActiveActivity = computed(() =>
    this.unpaidOrders().length > 0 ||
    this.activeOrders().length > 0 ||
    this.readyOrders().length > 0
  );

  /**
   * Загружает заказы: для авторизованных, с токеном, для гостей, по visitorId.
   * Безопасно вызывать повторно.
   */
  async loadOrders(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    this._loading.set(true);
    try {
      if (this.authService.isAuthenticated()) {
        await this._loadAuthenticated();
      } else {
        await this._loadByVisitorId();
      }
      this._loaded = true;
      this._startPollingIfNeeded();
    } catch {
      // Не бросаем, просто orders останутся пустыми
    } finally {
      this._loading.set(false);
    }
  }

  /** Вызвать при первом использовании, загружает если ещё не грузил */
  ensureLoaded(): void {
    if (!this._loaded && !this._loading()) {
      this.loadOrders();
    }
  }

  /** Сбросить и перезагрузить (напр. после оплаты или смены авторизации) */
  reload(): void {
    this._loaded = false;
    this.loadOrders();
  }

  private async _loadAuthenticated(): Promise<void> {
    const resp = await firstValueFrom(
      this.http.get<{ success: boolean; data: {
        id: string;
        total_price: number;
        status: string;
        payment_status: string;
        mode: string;
        items: VisitorOrderItem[];
        created_at: string;
        priority?: string;
        delivery_method?: string;
      }[]; total?: number }>(
        `${this.apiUrl}/orders/my-history?limit=50`
      )
    );
    if (resp?.success && Array.isArray(resp.data)) {
      this._orders.set(resp.data.map(r => ({
        id: r.id,
        status: r.status,
        paymentStatus: r.payment_status,
        totalPrice: Number(r.total_price) || 0,
        createdAt: r.created_at,
        items: Array.isArray(r.items) ? r.items : [],
        priority: r.priority,
        deliveryMethod: r.delivery_method,
      })));
    }
  }

  private async _loadByVisitorId(): Promise<void> {
    const visitorId = this.chatService.getVisitorId();
    if (!visitorId) return;

    const resp = await firstValueFrom(
      this.http.get<{ success: boolean; orders: {
        id: string;
        status: string;
        paymentStatus: string;
        totalPrice: number;
        createdAt: string;
        items: VisitorOrderItem[];
        priority?: string;
        contactName?: string;
        email?: string;
        deliveryMethod?: string;
      }[] }>(
        `${this.apiUrl}/payments/my-orders?visitorId=${encodeURIComponent(visitorId)}`
      )
    );
    if (resp?.success && Array.isArray(resp.orders)) {
      this._orders.set(resp.orders.map(r => ({
        id: r.id,
        status: r.status,
        paymentStatus: r.paymentStatus,
        totalPrice: Number(r.totalPrice) || 0,
        createdAt: r.createdAt,
        items: Array.isArray(r.items) ? r.items : [],
        priority: r.priority,
        contactName: r.contactName,
        email: r.email,
        deliveryMethod: r.deliveryMethod,
      })));
    }
  }

  /** Автополинг каждые 60с если есть активные/неоплаченные заказы */
  private _startPollingIfNeeded(): void {
    this._stopPolling();
    if (this.activeOrders().length > 0 || this.unpaidOrders().length > 0 || this.readyOrders().length > 0) {
      this._pollTimer = setInterval(() => this.loadOrders(), 60_000);
    }
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }
}
