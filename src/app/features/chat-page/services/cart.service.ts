import {
  Injectable,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router, NavigationEnd } from '@angular/router';
import { firstValueFrom, filter } from 'rxjs';
import { ServiceOption } from '../data/services.data';
import { AuthChatService } from '../../../core/services/auth-chat.service';
import {
  type CartDisplayDetails,
  type CartDisplayLine,
  type SyncCartItem,
} from '../../../shared/interfaces/cart-sync.interface';
import { ReferralTrackingService } from '../../../core/services/referral-tracking.service';
import { PricingApiService, type WaterfallV2Response } from '../../../core/services/pricing-api.service';

/** Detail из CustomEvent 'chat:orderFinalized' */
interface OrderFinalizedDetail {
  orderId?: string;
  price?: number;
  description?: string;
  categorySlug?: string;
  selectedOptions?: Record<string, string[]>;
  photoCount?: number;
  displayDetails?: CartDisplayDetails;
}

/** Detail из CustomEvent 'cart:addItem' */
interface CartAddItemDetail {
  name?: string;
  price?: number;
  nextPrice?: number;
  icon?: string;
  serviceId?: string;
  description?: string;
  displayDetails?: CartDisplayDetails;
}

/** Данные применённого промокода */
export interface PromoData {
  title: string;
  discount_percent: number | null;
  discount_amount: number | null;
  is_partner_code?: boolean;
  partner_name?: string;
}

/**
 * Данные pricing engine для server-side валидации цены при оплате.
 * Заполняется, когда товар добавлен через PricingConfiguratorComponent.
 */
export interface CartItemPricingData {
  categorySlug: string;
  selectedOptions: { option_slug: string; quantity: number }[];
  deliveryMethod: 'electronic' | 'pickup' | 'postal';
}

/**
 * Элемент корзины
 */
export interface CartItem {
  service: ServiceOption;
  quantity: number;
  /** Заметка клиента (пожелания) */
  note?: string;
  /** ID заказа из бэкенда (chat-{sessionId}-{N}), единый источник правды */
  backendOrderId?: string;
  /** Данные pricing engine, для server-side валидации перед оплатой */
  pricingData?: CartItemPricingData;
  /** Waterfall v2 данные для расчёта (categorySlug + selectedOptions) */
  waterfallSource?: {
    categorySlug: string;
    selectedOptions: Record<string, string[]>;
    photoCount: number;
  };
  /** Детализация агрегированного заказа из CRM/чата для показа клиенту */
  displayDetails?: CartDisplayDetails;
}

/**
 * Заказ для отправки на оплату
 */
export interface Order {
  id: string;
  items: CartItem[];
  total: number;
  email?: string;
  phone?: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  createdAt: Date;
  transactionId?: number;
}

const CART_STORAGE_KEY = 'svoe_foto_cart';

/** Type-safe extraction of CustomEvent detail */
function getEventDetail<T>(e: Event): T | undefined {
  if ('detail' in e) return (e as CustomEvent<T>).detail;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberFromUnknown(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function combinedPriceNote(values: Iterable<string | null | undefined>): string | null {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = textFromUnknown(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result.length > 0 ? result.join('; ') : null;
}

function parseDisplayLine(value: unknown): CartDisplayLine | null {
  if (!isRecord(value)) return null;
  const name = typeof value['name'] === 'string' ? value['name'].trim() : '';
  if (!name) return null;

  const quantity = Math.max(1, Math.trunc(numberFromUnknown(value['quantity']) ?? 1));
  const unitPrice = numberFromUnknown(value['unitPrice']) ?? 0;
  const total = numberFromUnknown(value['total']) ?? unitPrice * quantity;
  const priceNote = textFromUnknown(value['priceNote']);
  const discountLabel = textFromUnknown(value['discountLabel']);
  const discountAmount = Math.max(0, numberFromUnknown(value['discountAmount']) ?? 0);

  return { name, quantity, unitPrice, total, priceNote, discountLabel, discountAmount };
}

function parseDisplayDetails(value: unknown): CartDisplayDetails | undefined {
  if (!isRecord(value) || !Array.isArray(value['lines'])) return undefined;
  const lines = value['lines']
    .map(parseDisplayLine)
    .filter((line): line is CartDisplayLine => line !== null);
  if (lines.length === 0) return undefined;

  return {
    lines,
    subtotal: numberFromUnknown(value['subtotal']) ?? lines.reduce((sum, line) => sum + line.total, 0),
    savings: numberFromUnknown(value['savings']) ?? lines.reduce((sum, line) => sum + (line.discountAmount ?? 0), 0),
    priceNote: textFromUnknown(value['priceNote']) ?? combinedPriceNote(lines.map(line => line.priceNote ?? null)),
  };
}

function displayDetailsFromSyncItem(item: SyncCartItem): CartDisplayDetails | undefined {
  return parseDisplayDetails(item.displayDetails)
    ?? parseDisplayDetails(item.metadata?.['displayDetails']);
}

function backendOrderIdFromSyncItem(item: SyncCartItem): string | undefined {
  if (typeof item.backendOrderId === 'string' && item.backendOrderId) {
    return item.backendOrderId;
  }
  const metadataOrderId = item.metadata?.['backendOrderId'];
  return typeof metadataOrderId === 'string' && metadataOrderId ? metadataOrderId : undefined;
}

function syncItemToCartItem(item: SyncCartItem): CartItem {
  return {
    service: {
      id: item.serviceId,
      name: item.name,
      description: item.description || '',
      price: item.price,
      nextPrice: item.nextPrice,
      priceMax: item.priceMax,
      icon: item.icon || 'photo_camera',
    },
    quantity: item.quantity,
    note: item.note,
    backendOrderId: backendOrderIdFromSyncItem(item),
    displayDetails: displayDetailsFromSyncItem(item),
  };
}

function metadataFromCartItem(item: CartItem): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  if (item.backendOrderId) {
    metadata['backendOrderId'] = item.backendOrderId;
  }
  if (item.displayDetails) {
    metadata['displayDetails'] = item.displayDetails;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * Рассчитать стоимость позиции с учётом прогрессивной цены.
 * Если у услуги есть nextPrice, первая штука стоит price, остальные, nextPrice.
 */
export function calcItemSubtotal(item: CartItem): number {
  const { price, nextPrice } = item.service;
  if (nextPrice != null && nextPrice !== price && item.quantity > 1) {
    return price + nextPrice * (item.quantity - 1);
  }
  return price * item.quantity;
}

/**
 * Сервис корзины с Signals и localStorage
 */
@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly visitorChatService = inject(AuthChatService);
  private readonly referralTracking = inject(ReferralTrackingService);
  private readonly pricingApi = inject(PricingApiService);

  /** Флаг предотвращения цикла sync: server→client→server */
  private _syncInProgress = false;
  /** Текущая сессия, для которой загружали server cart */
  private _loadedServerCartSessionId: string | null = null;

  /** Элементы корзины */
  readonly items = signal<CartItem[]>([]);

  /** Открыта ли корзина */
  readonly isOpen = signal(false);

  // ---- Промокод ----
  /** Применённый промокод */
  readonly promoCode = signal('');
  /** Данные промоакции */
  readonly promoData = signal<PromoData | null>(null);
  /** Партнёрский код (отдельно от скидочного промокода) */
  readonly partnerPromoCode = signal<string | null>(null);
  /** Промокод заблокирован degressive скидкой */
  readonly promoBlockedByDegressive = signal(false);

  /** Скидка от динамического ценообразования (ночные скидки, bundle и т.д.) */
  readonly dynamicDiscount = signal<number>(0);
  /** Процент динамической скидки */
  readonly dynamicDiscountPercent = signal<number>(0);
  /** Описание примененных динамических скидок */
  readonly dynamicDiscountReasons = signal<string[]>([]);

  /** Waterfall v2: серверная итоговая цена (null = пересчёт не выполнялся) */
  readonly waterfallTotal = signal<number | null>(null);
  /** Waterfall v2: экономия из waterfall */
  readonly waterfallSavings = signal<number>(0);
  /** Waterfall v2: загрузка пересчёта */
  readonly waterfallLoading = signal(false);
  /** Waterfall v2: полный ответ (для детализации) */
  readonly waterfallResult = signal<WaterfallV2Response | null>(null);

  /** Размер скидки в рублях */
  readonly promoDiscount = computed(() => {
    const data = this.promoData();
    if (!data) return 0;
    const t = this.total();
    if (data.discount_percent) {
      return Math.round(t * data.discount_percent / 100);
    }
    if (data.discount_amount) {
      return Math.min(data.discount_amount, t);
    }
    return 0;
  });

  /** Итого со скидкой: waterfall v2 total (если доступен) или fallback (промокод + динамическая скидка) */
  readonly discountedTotal = computed(() => {
    const wfTotal = this.waterfallTotal();
    if (wfTotal != null) return wfTotal;
    return Math.max(0, this.total() - this.promoDiscount() - this.dynamicDiscount());
  });

  /** Количество товаров */
  readonly itemCount = computed(() =>
    this.items().reduce((sum, item) => sum + item.quantity, 0),
  );

  /** Общая сумма (с учётом прогрессивной цены) */
  readonly total = computed(() =>
    this.items().reduce((sum, item) => sum + calcItemSubtotal(item), 0),
  );

  /** Общая сумма (максимальная цена, если есть priceMax) */
  readonly totalMax = computed(() =>
    this.items().reduce(
      (sum, item) =>
        sum + (item.service.priceMax ?? item.service.price) * item.quantity,
      0,
    ),
  );

  /** Есть ли услуги с диапазоном цен */
  readonly hasRangePrice = computed(() =>
    this.items().some((item) => item.service.priceMax != null),
  );

  /** Корзина пуста */
  readonly isEmpty = computed(() => this.items().length === 0);

  constructor() {
    // Загрузить из localStorage
    if (isPlatformBrowser(this.platformId)) {
      this.loadFromStorage();
      this.listenForChatCartEvents();
      // Pre-fill partner code from ReferralTrackingService
      const storedPartnerCode = this.referralTracking.getPartnerCode();
      if (storedPartnerCode) {
        this.partnerPromoCode.set(storedPartnerCode);
      }
    }

    // Закрывать корзину при навигации
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
    ).subscribe(() => {
      if (this.isOpen()) {
        this.close();
      }
    });

    // Автосохранение в localStorage
    effect(() => {
      const items = this.items();
      if (isPlatformBrowser(this.platformId)) {
        this.saveToStorage(items);
      }
    });

    // При появлении/смене чат-сессии загружаем серверную корзину как источник правды.
    effect(() => {
      const session = this.visitorChatService.session();
      if (!session?.id) return;
      if (this._loadedServerCartSessionId === session.id) return;

      this._loadedServerCartSessionId = session.id;
      void this.loadServerCart(session.id);
    });
  }

  /**
   * Глобальные обработчики событий корзины из чата.
   * Работают на ВСЕХ страницах (не только /online-services),
   * потому что CartService, root singleton.
   */
  private listenForChatCartEvents(): void {
    // Единый обработчик: бэкенд посчитал итоговую цену (base + addons) → кладём в корзину
    // При наличии categorySlug+selectedOptions, пересчитываем через waterfall v2
    window.addEventListener('chat:orderFinalized', (e: Event) => {
      const detail = getEventDetail<OrderFinalizedDetail>(e);
      if (!detail?.price || !detail.orderId) return;

      // Убираем "Заказ №X:" из описания для чистого названия в корзине
      const rawDesc = detail.description || 'Фото на документы';
      const name = rawDesc.replace(/^Заказ\s*№\d+:\s*/i, '');

      const service: ServiceOption = {
        id: `backend-order-${detail.orderId}`,
        name,
        description: `Заказ ${detail.orderId}`,
        price: detail.price,
        icon: 'photo_camera',
      };

      // Waterfall source для v2 пересчёта (если есть данные из chat flow)
      const waterfallSource = detail.categorySlug && detail.selectedOptions
        ? {
            categorySlug: detail.categorySlug,
            selectedOptions: detail.selectedOptions,
            photoCount: detail.photoCount ?? 1,
          }
        : undefined;

      // Очищаем корзину и ставим единственный item с бэкендовой ценой
      this.clear();
      this.items.set([{
        service,
        quantity: 1,
        backendOrderId: detail.orderId,
        waterfallSource,
        displayDetails: detail.displayDetails,
      }]);
      this.emitCartToServer();

      // Запускаем v2 waterfall пересчёт для точной цены
      if (waterfallSource) {
        void this.recalculateWaterfall(waterfallSource, detail.price);
      }
    });

    // Добавить услугу в корзину (без очистки) из чат-бота
    window.addEventListener('cart:addItem', (e: Event) => {
      const detail = getEventDetail<CartAddItemDetail>(e);
      if (!detail?.name || !detail.price) return;

      const service: ServiceOption = {
        id: detail.serviceId || `chat-${detail.name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '-')}`,
        name: detail.name,
        description: detail.description || '',
        price: detail.price,
        nextPrice: detail.nextPrice && detail.nextPrice !== detail.price ? detail.nextPrice : undefined,
        icon: detail.icon || 'photo_camera',
      };

      this.addItem(service);
    });

    // Открыть корзину по событию из чат-компонентов
    window.addEventListener('cart:open', () => {
      this.open();
    });

    // Синхронизация корзины от оператора (через WebSocket)
    window.addEventListener('cart:syncFromServer', (e: Event) => {
      const items = getEventDetail<SyncCartItem[]>(e);
      if (!Array.isArray(items)) return;

      this._syncInProgress = true;
      this.items.set(items.map(syncItemToCartItem));
      this._syncInProgress = false;
    });
  }

  /** Добавить услугу в корзину.
   *  Если услуга с таким id уже есть, увеличивает количество
   *  И обновляет данные услуги (price, nextPrice и т.д.),
   *  чтобы не оставалось устаревших значений из localStorage.
   */
  addItem(service: ServiceOption, quantity = 1): void {
    this.items.update((items) => {
      const existing = items.find((i) => i.service.id === service.id);
      if (existing) {
        return items.map((i) =>
          i.service.id === service.id
            ? { ...i, service, quantity: i.quantity + quantity }
            : i,
        );
      }
      return [...items, { service, quantity }];
    });
    this.emitCartToServer();
  }

  /** Удалить элемент из корзины */
  removeItem(serviceId: string): void {
    this.items.update((items) =>
      items.filter((i) => i.service.id !== serviceId),
    );
    this.emitCartToServer();
  }

  /** Изменить количество */
  updateQuantity(serviceId: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeItem(serviceId);
      return;
    }
    this.items.update((items) =>
      items.map((i) =>
        i.service.id === serviceId ? { ...i, quantity } : i,
      ),
    );
    this.emitCartToServer();
  }

  /** Добавить заметку к услуге */
  updateNote(serviceId: string, note: string): void {
    this.items.update((items) =>
      items.map((i) =>
        i.service.id === serviceId ? { ...i, note } : i,
      ),
    );
  }

  /** Проверить, есть ли услуга в корзине */
  isInCart(serviceId: string): boolean {
    return this.items().some((i) => i.service.id === serviceId);
  }

  /** Получить количество конкретной услуги */
  getQuantity(serviceId: string): number {
    return this.items().find((i) => i.service.id === serviceId)?.quantity ?? 0;
  }

  /** Очистить корзину */
  clear(): void {
    this.items.set([]);
    this.removePromo();
    this.emitCartToServer();
  }

  /** Открыть/закрыть корзину */
  toggle(): void {
    this.isOpen.update((v) => !v);
  }

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  /** Сформировать ID заказа */
  generateOrderId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `SF-${timestamp}-${random}`.toUpperCase();
  }

  /** Валидировать и применить промокод */
  async validatePromo(code: string): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.get<{
          valid: boolean;
          title?: string;
          discount_percent?: number | null;
          discount_amount?: number | null;
          is_partner_code?: boolean;
          partner_name?: string;
          error?: string;
        }>(`/api/promotions/validate/${encodeURIComponent(code.trim())}`),
      );
      if (res.valid) {
        this.promoCode.set(code.trim().toUpperCase());
        this.promoData.set({
          title: res.title || code,
          discount_percent: res.discount_percent ?? null,
          discount_amount: res.discount_amount ?? null,
          is_partner_code: res.is_partner_code ?? false,
          partner_name: res.partner_name,
        });
        // Store partner code separately for checkout payload
        if (res.is_partner_code) {
          this.partnerPromoCode.set(code.trim().toUpperCase());
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Удалить промокод */
  removePromo(): void {
    this.promoCode.set('');
    this.promoData.set(null);
    this.promoBlockedByDegressive.set(false);
  }

  /** Отправить текущее состояние корзины на сервер через WebSocket */
  private emitCartToServer(): void {
    if (this._syncInProgress) return;
    const sessionId = this.visitorChatService.getSessionId();
    if (!sessionId) return;

    const syncItems: SyncCartItem[] = this.items().map(item => ({
      serviceId: item.service.id,
      name: item.service.name,
      description: item.service.description,
      price: item.service.price,
      nextPrice: item.service.nextPrice,
      priceMax: item.service.priceMax,
      icon: item.service.icon,
      quantity: item.quantity,
      note: item.note,
      backendOrderId: item.backendOrderId,
      displayDetails: item.displayDetails,
      metadata: metadataFromCartItem(item),
    }));

    this.visitorChatService.emitCartUpdate(syncItems);

    // Параллельно сохраняем в серверную корзину (AI-first источник правды).
    void this.syncServerCart(sessionId, syncItems);
  }

  private async loadServerCart(sessionId: string): Promise<void> {
    try {
      const visitorId = this.visitorChatService.getVisitorId();
      if (!visitorId) return;

      const response = await firstValueFrom(this.http.get<{
        success: boolean;
        data?: { items?: SyncCartItem[] };
      }>(`/api/visitor-chat/sessions/${sessionId}/cart?visitorId=${encodeURIComponent(visitorId)}`));

      const items = response.data?.items;
      if (!Array.isArray(items)) return;

      this._syncInProgress = true;
      this.items.set(items.map(syncItemToCartItem));
      this._syncInProgress = false;
    } catch {
      // Мягкий fallback: если сервер недоступен, продолжаем с локальной корзиной.
      this._syncInProgress = false;
    }
  }

  private async syncServerCart(sessionId: string, items: SyncCartItem[]): Promise<void> {
    try {
      const visitorId = this.visitorChatService.getVisitorId();
      if (!visitorId) return;

      await firstValueFrom(this.http.post(`/api/visitor-chat/sessions/${sessionId}/cart/sync`, { visitorId, items }));
    } catch {
      // Ошибка sync не должна ломать UX корзины.
    }
  }

  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem(CART_STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data) as CartItem[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.items.set(parsed);
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private saveToStorage(items: CartItem[]): void {
    try {
      if (items.length === 0) {
        localStorage.removeItem(CART_STORAGE_KEY);
      } else {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Пересчитать цену через Waterfall V2 API.
   * Обновляет waterfallTotal / waterfallSavings и цену в CartItem.
   * Fallback: при ошибке API оставляет исходную цену из chat flow.
   */
  private async recalculateWaterfall(
    source: NonNullable<CartItem['waterfallSource']>,
    fallbackPrice: number,
  ): Promise<void> {
    this.waterfallLoading.set(true);
    this.waterfallTotal.set(null);
    this.waterfallSavings.set(0);
    this.waterfallResult.set(null);

    try {
      const result = await this.pricingApi.calculateV2BySlugs({
        categorySlug: source.categorySlug,
        selectedOptions: source.selectedOptions,
        photoCount: source.photoCount,
        channel: 'online',
        promoCode: this.promoCode() || undefined,
      });

      this.waterfallResult.set(result);
      this.waterfallTotal.set(result.total);
      this.waterfallSavings.set(result.savings);

      // Обновить цену в CartItem если waterfall дал другую цену
      if (result.total !== fallbackPrice) {
        this.items.update(items =>
          items.map(item =>
            item.waterfallSource
              ? { ...item, service: { ...item.service, price: result.total } }
              : item,
          ),
        );
      }

      // Если waterfall обнаружил, что промокод заблокирован дегрессией
      if (result.promoBlocked) {
        this.promoBlockedByDegressive.set(true);
      }
    } catch {
      // Fallback: оставляем исходную цену из chat flow
      this.waterfallTotal.set(null);
    } finally {
      this.waterfallLoading.set(false);
    }
  }
}
