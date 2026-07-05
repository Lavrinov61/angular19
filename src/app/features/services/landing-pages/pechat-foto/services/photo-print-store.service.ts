import {
  Injectable, inject, signal, computed, PLATFORM_ID, OnDestroy
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Observable, of, Subscription } from 'rxjs';
import { map, catchError, tap, finalize } from 'rxjs/operators';
import {
  PrintFormatId, PaperType, PaperPriceTier, FORMATS_MAP, paperPriceTier,
  preferredPaperTypeForTier, CustomPrintSizeSettings,
  DEFAULT_CUSTOM_PRINT_SIZE, CUSTOM_CROP_FEE
} from '../models/format-config';
import { PricesService, type PhotoPrintPrices } from '../../../../../core/services/prices.service';
import { ADDRESSES } from '../../../../../core/data/address.data';
import {
  DeliveryService, type DeliveryQuote, type LonLat,
} from '../../../../../core/services/delivery.service';
import type { SelectedAddress } from '../../../../../shared/components/address-autocomplete/address-autocomplete.component';

export type UploadStatus = 'pending' | 'uploading' | 'uploaded' | 'error';
export type PickupLocationStatus = 'open' | 'closed' | 'maintenance';

/** Способ получения заказа печати */
export type DeliveryMethod = 'pickup' | 'courier';

/** Элемент фото в заказе */
export interface PrintItem {
  id: string;
  formatId: PrintFormatId;
  file: File;
  previewUrl: string;
  uploadedUrl?: string;
  paperType: PaperType;
  quantity: number;
  /** Только для 15x20, всегда '3mm' */
  margins: 'none' | '3mm';
  /** Только для нестандартных размеров */
  customSize?: CustomPrintSizeSettings;
  status: UploadStatus;
  uploadProgress: number;
  errorMessage?: string;
}

/** Контактная информация клиента */
export interface PrintContactInfo {
  name: string;
  phone: string;
  email?: string;
  comments?: string;
}

export interface PickupLocationHour {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isOpen: boolean;
}

export interface PickupLocation {
  id: string;
  studioId?: string;
  name: string;
  address: string;
  status: PickupLocationStatus;
  statusMessage?: string | null;
  statusUntil?: string | null;
  workHours: string;
  hours: PickupLocationHour[];
}

export interface CustomSizeGroup {
  key: string;
  label: string;
  sizeLabel: string;
  quantity: number;
  needsCropping: boolean;
  whiteBorder: boolean;
  cropFeeTotal: number;
}

/** Результат отправки заказа */
export interface PrintOrderResult {
  success: boolean;
  orderId?: string;
  paymentUrl?: string | null;
  message?: string;
  error?: string;
}

interface PickupLocationsResponse {
  success: boolean;
  data?: PickupLocation[];
  error?: string;
}

interface SubscriptionPaymentResponse {
  success: boolean;
  subscription_coverage?: {
    total_credits_consumed: number;
  };
  error?: string;
}

interface PrintDirectUploadTarget {
  s3Key: string;
  uploadUrl: string;
  contentType: string;
}

interface PrintDirectPresignResponse {
  success: boolean;
  data?: {
    uploads: PrintDirectUploadTarget[];
  };
  error?: string;
}

interface PrintDirectCompleteResponse {
  success: boolean;
  data?: {
    files: {
      url: string;
      s3Key: string;
      fileName: string;
    }[];
    count: number;
  };
  error?: string;
}

interface PrintDirectUploadPlan {
  item: PrintItem;
  uploadTarget: PrintDirectUploadTarget;
  contentType: string;
}

interface PrintDirectStorageUpload {
  itemId: string;
  file: File;
  uploadTarget: PrintDirectUploadTarget;
  contentType: string;
}

export interface AddFilesOptions {
  customSize?: CustomPrintSizeSettings;
}

/** Допустимые типы файлов */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const DIRECT_UPLOAD_BATCH_SIZE = 50;
const DIRECT_UPLOAD_CONCURRENCY = 4;
const FALLBACK_PICKUP_LOCATIONS: PickupLocation[] = ADDRESSES.map(address => ({
  id: address.id,
  name: address.name,
  address: address.address,
  status: 'open',
  statusMessage: null,
  statusUntil: null,
  workHours: address.workHours,
  hours: [],
}));

function generateId(): string {
  return `pi-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function uploadErrorMessage(error: unknown, fallback: string): string {
  if (isRecord(error)) {
    const nested = error['error'];
    if (typeof nested === 'string' && nested.trim()) {
      return nested;
    }

    if (isRecord(nested)) {
      const nestedError = nested['error'];
      if (typeof nestedError === 'string' && nestedError.trim()) {
        return nestedError;
      }

      const nestedMessage = nested['message'];
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
        return nestedMessage;
      }
    }

    const status = error['status'];
    if (typeof status === 'number' && status > 0) {
      return `${fallback}: HTTP ${status}`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

/**
 * Сервис состояния заказа фотопечати.
 * Provided на уровне PechatFotoPageComponent, очищается при навигации.
 */
@Injectable()
export class PhotoPrintStoreService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly pricesService = inject(PricesService);
  private readonly deliveryService = inject(DeliveryService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly uploadQueue: PrintItem[] = [];
  private isProcessingUploadQueue = false;
  private quoteSub: Subscription | null = null;

  // ─── Состояние ────────────────────────────────────────────────────────────

  private readonly _items = signal<PrintItem[]>([]);
  private readonly _contact = signal<PrintContactInfo>({ name: '', phone: '' });
  private readonly _isSubmitting = signal(false);
  private readonly _isPayingWithSubscription = signal(false);
  private readonly _submitError = signal<string | null>(null);
  private readonly _subscriptionPaymentError = signal<string | null>(null);
  private readonly _subscriptionPaymentCredits = signal<number | null>(null);
  private readonly _orderId = signal<string | null>(null);
  private readonly _paymentUrl = signal<string | null>(null);
  private readonly _pickupLocations = signal<PickupLocation[]>(FALLBACK_PICKUP_LOCATIONS);
  private readonly _selectedPickupLocationId = signal<string | null>(FALLBACK_PICKUP_LOCATIONS[0]?.id ?? null);
  private readonly _pickupLocationsError = signal<string | null>(null);
  private readonly _isLoadingPickupLocations = signal(false);

  // ─── Состояние доставки ──────────────────────────────────────────────────
  private readonly _deliveryMethod = signal<DeliveryMethod>('pickup');
  private readonly _deliveryAddress = signal<SelectedAddress | null>(null);
  private readonly _deliveryQuote = signal<DeliveryQuote | null>(null);
  private readonly _isLoadingQuote = signal(false);
  /** true, фича курьера выключена на backend (reason=feature_disabled) → прячем опцию */
  private readonly _courierDisabled = signal(false);

  // ─── Публичные signals ─────────────────────────────────────────────────────

  readonly items = this._items.asReadonly();
  readonly contact = this._contact.asReadonly();
  readonly isSubmitting = this._isSubmitting.asReadonly();
  readonly isPayingWithSubscription = this._isPayingWithSubscription.asReadonly();
  readonly submitError = this._submitError.asReadonly();
  readonly subscriptionPaymentError = this._subscriptionPaymentError.asReadonly();
  readonly subscriptionPaymentCredits = this._subscriptionPaymentCredits.asReadonly();
  readonly orderId = this._orderId.asReadonly();
  readonly paymentUrl = this._paymentUrl.asReadonly();
  readonly pickupLocations = this._pickupLocations.asReadonly();
  readonly selectedPickupLocationId = this._selectedPickupLocationId.asReadonly();
  readonly pickupLocationsError = this._pickupLocationsError.asReadonly();
  readonly isLoadingPickupLocations = this._isLoadingPickupLocations.asReadonly();
  readonly deliveryMethod = this._deliveryMethod.asReadonly();
  readonly deliveryAddress = this._deliveryAddress.asReadonly();
  readonly deliveryQuote = this._deliveryQuote.asReadonly();
  readonly isLoadingQuote = this._isLoadingQuote.asReadonly();
  readonly courierDisabled = this._courierDisabled.asReadonly();
  readonly isSuccess = computed(() => !!this._orderId());
  readonly isPaidWithSubscription = computed(() => this._subscriptionPaymentCredits() !== null);

  /** Курьер выбран и quote подтверждает доступность + прохождение мин. заказа */
  readonly isCourierReady = computed(() => {
    if (this._deliveryMethod() !== 'courier') return false;
    const quote = this._deliveryQuote();
    return !!quote && quote.available && quote.meetsMinOrder;
  });

  /** Стоимость доставки в рублях (0 для самовывоза или без валидного quote) */
  readonly deliveryPrice = computed(() => {
    const quote = this._deliveryQuote();
    if (this._deliveryMethod() !== 'courier' || !quote || !quote.available) return 0;
    return quote.priceRub;
  });

  /** Итог к оплате с учётом доставки (для отображения; сервер пересчитывает) */
  readonly grandTotal = computed(() => this.totalPrice() + this.deliveryPrice());

  // ─── Computed ──────────────────────────────────────────────────────────────

  readonly totalItems = computed(() => this._items().length);
  readonly hasItems = computed(() => this._items().length > 0);
  readonly isAnyUploading = computed(() => this._items().some(i => i.status === 'uploading' || i.status === 'pending'));
  readonly allUploaded = computed(() => this._items().length > 0 && this._items().every(i => i.status === 'uploaded'));
  readonly uploadedItemsCount = computed(() => this._items().filter(i => i.status === 'uploaded').length);
  readonly uploadProgressPercent = computed(() => {
    const items = this._items();
    if (items.length === 0) return 0;

    const totalProgress = items.reduce((sum, item) => {
      if (item.status === 'uploaded') return sum + 100;
      return sum + Math.min(100, Math.max(0, item.uploadProgress));
    }, 0);

    return Math.round(totalProgress / items.length);
  });

  readonly totalPhotoCount = computed(() =>
    this._items().reduce((sum, i) => sum + i.quantity, 0)
  );

  readonly selectedPickupLocation = computed(() => {
    const selectedId = this._selectedPickupLocationId();
    return this._pickupLocations().find(location => location.id === selectedId && location.status === 'open') ?? null;
  });

  readonly totalPrice = computed(() => {
    const p = this.pricesService.prices();
    return this._items().reduce((sum, item) => sum + this.unitPriceForItem(item, p) * item.quantity, 0);
  });

  readonly customSizeGroups = computed<CustomSizeGroup[]>(() => {
    const groups = new Map<string, CustomSizeGroup>();

    for (const item of this._items().filter(i => i.formatId === 'custom')) {
      const customSize = this.customSizeForItem(item);
      const key = [
        customSize.label,
        customSize.sizeLabel,
        customSize.needsCropping ? 'crop' : 'no-crop',
        customSize.whiteBorder ? 'border' : 'no-border',
      ].join('|');
      const existing = groups.get(key);
      const quantity = item.quantity;
      const cropFeeTotal = customSize.needsCropping ? CUSTOM_CROP_FEE * quantity : 0;

      if (existing) {
        groups.set(key, {
          ...existing,
          quantity: existing.quantity + quantity,
          cropFeeTotal: existing.cropFeeTotal + cropFeeTotal,
        });
      } else {
        groups.set(key, {
          key,
          label: customSize.label,
          sizeLabel: customSize.sizeLabel,
          quantity,
          needsCropping: customSize.needsCropping,
          whiteBorder: customSize.whiteBorder,
          cropFeeTotal,
        });
      }
    }

    return [...groups.values()];
  });

  readonly selectedPrintTier = computed<PaperPriceTier | 'mixed' | null>(() => {
    const items = this._items();
    if (items.length === 0) return null;

    const firstTier = paperPriceTier(items[0].paperType);
    return items.every(item => paperPriceTier(item.paperType) === firstTier) ? firstTier : 'mixed';
  });

  readonly canSubmit = computed(() => {
    const c = this._contact();
    const baseValid =
      !this._isSubmitting() &&
      this._items().length > 0 &&
      this._items().every(i => i.status === 'uploaded') &&
      c.name.trim().length >= 2 &&
      c.phone.replace(/\D/g, '').length >= 10;

    if (!baseValid) return false;

    return this._deliveryMethod() === 'courier'
      ? this.isCourierReady()
      : !!this.selectedPickupLocation();
  });

  /** Количество фото по формату */
  countByFormat(formatId: PrintFormatId): number {
    return this._items().filter(i => i.formatId === formatId).length;
  }

  /** Количество копий по формату */
  totalQtyByFormat(formatId: PrintFormatId): number {
    return this._items()
      .filter(i => i.formatId === formatId)
      .reduce((sum, i) => sum + i.quantity, 0);
  }

  /** Элементы по формату */
  itemsByFormat(formatId: PrintFormatId): PrintItem[] {
    return this._items().filter(i => i.formatId === formatId);
  }

  /** Количество фото по формату и бумаге */
  paperCountByFormat(formatId: PrintFormatId, paperType: PaperType): number {
    return this._items().filter(i => i.formatId === formatId && i.paperType === paperType).length;
  }

  /** Количество фото по формату и типу печати */
  printTierCountByFormat(formatId: PrintFormatId, tier: PaperPriceTier): number {
    return this._items().filter(i => i.formatId === formatId && paperPriceTier(i.paperType) === tier).length;
  }

  /** Доступен ли тип печати хотя бы для одного фото в текущем заказе */
  hasPrintTierAvailable(tier: PaperPriceTier): boolean {
    return this._items().some(item => this.paperTypeForPrintTier(item.formatId, tier) !== null);
  }

  /** Подобрать внутренний тип бумаги для пользовательского типа печати */
  paperTypeForPrintTier(formatId: PrintFormatId, tier: PaperPriceTier): PaperType | null {
    const paperTypes = FORMATS_MAP.get(formatId)?.paperTypes ?? [];
    return preferredPaperTypeForTier(paperTypes, tier);
  }

  // ─── Мутации ───────────────────────────────────────────────────────────────

  /** Добавить файлы в указанный формат */
  addFiles(formatId: PrintFormatId, files: FileList | File[], options: AddFilesOptions = {}): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const cfg = FORMATS_MAP.get(formatId);
    if (!cfg) return;

    const arr = Array.from(files);
    const valid = arr.filter(f => this.validateFile(f));
    const defaultPaperType = cfg.paperTypes[0] ?? 'matte';
    const customSize = formatId === 'custom'
      ? { ...(options.customSize ?? this.defaultCustomSizeSettings()) }
      : undefined;

    const newItems: PrintItem[] = valid.map(file => {
      const previewUrl = URL.createObjectURL(file);
      return {
        id: generateId(),
        formatId,
        file,
        previewUrl,
        paperType: defaultPaperType,
        quantity: 1,
        margins: cfg.marginsRequired ? '3mm' : 'none',
        customSize,
        status: 'pending',
        uploadProgress: 0,
      };
    });

    if (newItems.length === 0) return;

    this._items.update(items => [...items, ...newItems]);
    this.enqueueUploads(newItems);
  }

  /** Удалить фото */
  removeItem(id: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const item = this._items().find(i => i.id === id);
    if (item) {
      URL.revokeObjectURL(item.previewUrl);
      this._items.update(items => items.filter(i => i.id !== id));
    }
  }

  /** Обновить параметры элемента */
  updateItem(id: string, updates: Partial<Pick<PrintItem, 'paperType' | 'quantity'>>): void {
    const item = this._items().find(i => i.id === id);
    if (updates.paperType && item && !this.isPaperAllowed(item.formatId, updates.paperType)) {
      return;
    }

    this._items.update(items =>
      items.map(i => i.id === id ? { ...i, ...updates } : i)
    );
  }

  /** Обновить нестандартный размер для одного фото */
  updateItemCustomSize(id: string, customSize: CustomPrintSizeSettings): void {
    this._items.update(items =>
      items.map(item => item.id === id && item.formatId === 'custom'
        ? { ...item, customSize: { ...customSize } }
        : item)
    );
  }

  /** Применить тип печати к одному фото */
  updateItemPrintTier(id: string, tier: PaperPriceTier): void {
    const item = this._items().find(i => i.id === id);
    if (!item) return;

    const paperType = this.paperTypeForPrintTier(item.formatId, tier);
    if (!paperType) return;

    this.updateItem(id, { paperType });
  }

  /** Применить тип бумаги ко всем в формате */
  applyPaperToFormat(formatId: PrintFormatId, paperType: PaperType): void {
    if (!this.isPaperAllowed(formatId, paperType)) return;

    this._items.update(items =>
      items.map(i => i.formatId === formatId ? { ...i, paperType } : i)
    );
  }

  /** Применить тип печати ко всем в формате */
  applyPrintTierToFormat(formatId: PrintFormatId, tier: PaperPriceTier): void {
    const paperType = this.paperTypeForPrintTier(formatId, tier);
    if (!paperType) return;

    this.applyPaperToFormat(formatId, paperType);
  }

  /** Применить тип бумаги ко всем фото, где этот тип доступен */
  applyPaperToAll(paperType: PaperType): void {
    this._items.update(items =>
      items.map(i => this.isPaperAllowed(i.formatId, paperType) ? { ...i, paperType } : i)
    );
  }

  /** Применить тип печати ко всему заказу, где он доступен */
  applyPrintTierToAll(tier: PaperPriceTier): void {
    this._items.update(items =>
      items.map(item => {
        const paperType = this.paperTypeForPrintTier(item.formatId, tier);
        return paperType ? { ...item, paperType } : item;
      })
    );
  }

  /** Повторить загрузку ошибочного файла */
  retryUpload(id: string): void {
    const item = this._items().find(i => i.id === id);
    if (item?.status === 'error') {
      this._items.update(items =>
        items.map(i => i.id === id ? { ...i, status: 'pending', uploadProgress: 0, errorMessage: undefined } : i)
      );
      this.enqueueUploads([item]);
    }
  }

  /** Обновить контактную информацию */
  updateContact(updates: Partial<PrintContactInfo>): void {
    this._contact.update(c => ({ ...c, ...updates }));
  }

  /** Загрузить публичный список точек самовывоза */
  async ensurePickupLocationsLoaded(): Promise<void> {
    if (this._isLoadingPickupLocations()) return;

    this._isLoadingPickupLocations.set(true);
    this._pickupLocationsError.set(null);

    try {
      const response = await firstValueFrom(
        this.http.get<PickupLocationsResponse>('/api/studios/pickup-locations'),
      );
      const locations = response.success && response.data?.length
        ? response.data
        : FALLBACK_PICKUP_LOCATIONS;

      this._pickupLocations.set(locations);
      this._pickupLocationsError.set(response.success
        ? null
        : response.error || 'Не удалось обновить список точек самовывоза');
    } catch {
      this._pickupLocations.set(FALLBACK_PICKUP_LOCATIONS);
      this._pickupLocationsError.set('Показываем точки из справочника. При создании заказа проверим доступность.');
    } finally {
      this.ensureSelectedPickupLocation();
      this._isLoadingPickupLocations.set(false);
    }
  }

  /** Выбрать точку самовывоза */
  selectPickupLocation(id: string): void {
    const location = this._pickupLocations().find(item => item.id === id);
    if (!location || location.status !== 'open') return;
    this._selectedPickupLocationId.set(id);
  }

  // ─── Доставка ────────────────────────────────────────────────────────────

  /** Переключить способ получения (самовывоз / курьер) */
  setDeliveryMethod(method: DeliveryMethod): void {
    if (this._deliveryMethod() === method) return;
    this._deliveryMethod.set(method);
    if (method === 'pickup') {
      this.cancelQuote();
    } else if (this._deliveryAddress()) {
      // Возврат к курьеру с уже выбранным адресом, пересчитываем
      this.requestQuote();
    }
  }

  /** Установить адрес доставки (из AddressAutocomplete) и запросить расчёт */
  setDeliveryAddress(address: SelectedAddress): void {
    this._deliveryAddress.set(address);
    this.requestQuote();
  }

  /** Сбросить адрес доставки (поле очищено / адрес невалиден) */
  clearDeliveryAddress(): void {
    this._deliveryAddress.set(null);
    this.cancelQuote();
  }

  /** Запросить расчёт стоимости доставки по текущему адресу и сумме заказа */
  requestQuote(): void {
    const address = this._deliveryAddress();
    if (!address) {
      this.cancelQuote();
      return;
    }

    this.quoteSub?.unsubscribe();
    this._deliveryQuote.set(null);
    this._isLoadingQuote.set(true);

    const coordinates: LonLat = address.coordinates;
    this.quoteSub = this.deliveryService
      .quote({
        orderTotalRub: this.totalPrice(),
        address: address.address,
        coordinates,
        parcel: { weightGrams: this.estimateWeightGrams(), quantity: this.totalPhotoCount() },
      })
      .subscribe(quote => {
        this._isLoadingQuote.set(false);
        this._courierDisabled.set(!quote.available && quote.reason === 'feature_disabled');
        this._deliveryQuote.set(quote);
      });
  }

  /** Грубая оценка веса посылки для check-price (фактический вес считает backend) */
  private estimateWeightGrams(): number {
    // ~5 г на отпечаток + 50 г упаковка; нижняя граница 100 г
    const photos = this.totalPhotoCount();
    return Math.max(100, photos * 5 + 50);
  }

  private cancelQuote(): void {
    this.quoteSub?.unsubscribe();
    this.quoteSub = null;
    this._deliveryQuote.set(null);
    this._isLoadingQuote.set(false);
  }

  /** Очистить заказ */
  clearOrder(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.uploadQueue.length = 0;
    this._items().forEach(i => URL.revokeObjectURL(i.previewUrl));
    this._items.set([]);
    this._contact.set({ name: '', phone: '' });
    this._orderId.set(null);
    this._paymentUrl.set(null);
    this._submitError.set(null);
    this._subscriptionPaymentError.set(null);
    this._subscriptionPaymentCredits.set(null);
    this._deliveryMethod.set('pickup');
    this._deliveryAddress.set(null);
    this.cancelQuote();
    this.ensureSelectedPickupLocation();
  }

  // ─── Отправка заказа ───────────────────────────────────────────────────────

  /** Отправить заказ через API */
  submitOrder(): Observable<PrintOrderResult> {
    const isCourier = this._deliveryMethod() === 'courier';
    const pickupLocation = this.selectedPickupLocation();
    const address = this._deliveryAddress();

    if (isCourier) {
      if (!address || !this.isCourierReady()) {
        return of({ success: false, error: 'Укажите адрес доставки в зоне обслуживания' });
      }
    } else if (!pickupLocation) {
      return of({ success: false, error: 'Выберите точку самовывоза' });
    }

    if (!this.canSubmit()) {
      return of({ success: false, error: 'Заполните все обязательные поля' });
    }

    this._isSubmitting.set(true);
    this._submitError.set(null);
    this._subscriptionPaymentError.set(null);
    this._subscriptionPaymentCredits.set(null);

    const cfg_map = FORMATS_MAP;
    const prices = this.pricesService.prices();
    const orderItems = this._items().map(item => {
      const cfg = cfg_map.get(item.formatId)!;
      const customSize = item.formatId === 'custom' ? this.customSizeForItem(item) : undefined;
      return {
        uploadedUrl: item.uploadedUrl,
        format: cfg.backendFormatKey(item.paperType),
        paperType: item.paperType,
        quantity: item.quantity,
        margins: item.margins,
        border: customSize?.whiteBorder ? 'white' : 'none',
        customSize,
        sourceFormat: item.formatId,
        cropFee: customSize?.needsCropping ? CUSTOM_CROP_FEE : 0,
        unitPrice: this.unitPriceForItem(item, prices),
      };
    });

    // Доставку шлём отдельным блоком; сервер пере-резолвит зону/цену по координатам
    // (P0-2 в архитектуре), клиентскую цену доставки backend игнорирует.
    const payload: Record<string, unknown> = {
      mode: 'custom',
      items: orderItems,
      contact: this.contactWithCustomOrderComment(),
      deadline: 'standard',
      options: { autoEnhance: false, removeRedEyes: false },
      totalPrice: this.totalPrice(),
      source: 'website',
    };

    if (isCourier && address) {
      payload['delivery'] = {
        method: 'courier',
        address: address.address,
        coordinates: address.coordinates,
      };
    } else if (pickupLocation) {
      payload['pickupLocationId'] = pickupLocation.id;
    }

    return this.http.post<{ success: boolean; data?: { orderId: string; paymentUrl?: string | null }; error?: string }>(
      '/api/orders/photo-print',
      payload
    ).pipe(
      map(r => {
        if (r.success && r.data) {
          this._orderId.set(r.data.orderId);
          this._paymentUrl.set(r.data.paymentUrl ?? null);
          return {
            success: true,
            orderId: r.data.orderId,
            paymentUrl: r.data.paymentUrl ?? null,
            message: 'Заказ создан. Оплатите онлайн, и мы начнём печать.',
          };
        }
        return { success: false, error: r.error || 'Ошибка при отправке заказа' };
      }),
      catchError(err => {
        const msg = err?.error?.error || err?.message || 'Ошибка при отправке заказа. Попробуйте позже.';
        return of({ success: false, error: msg });
      }),
      tap(r => { if (!r.success) this._submitError.set(r.error || null); }),
      finalize(() => this._isSubmitting.set(false))
    );
  }

  /** Оплатить созданный заказ активной подпиской */
  payOrderWithSubscription(subscriptionId: string): Observable<PrintOrderResult> {
    const orderId = this._orderId();
    if (!orderId) {
      return of({ success: false, error: 'Сначала отправьте заказ' });
    }

    this._isPayingWithSubscription.set(true);
    this._subscriptionPaymentError.set(null);

    return this.http.post<SubscriptionPaymentResponse>(
      `/api/orders/photo-print/${encodeURIComponent(orderId)}/pay-with-subscription`,
      { subscription_id: subscriptionId }
    ).pipe(
      map(r => {
        if (r.success) {
          this._subscriptionPaymentCredits.set(r.subscription_coverage?.total_credits_consumed ?? 0);
          return { success: true, orderId, message: 'Заказ оплачен по подписке' };
        }
        return { success: false, error: r.error || 'Не удалось оплатить заказ по подписке' };
      }),
      catchError(err => {
        const msg = err?.error?.error || err?.message || 'Не удалось оплатить заказ по подписке';
        return of({ success: false, error: msg });
      }),
      tap(r => {
        if (!r.success) {
          this._subscriptionPaymentError.set(r.error || null);
        }
      }),
      finalize(() => this._isPayingWithSubscription.set(false))
    );
  }

  // ─── Приватные методы ─────────────────────────────────────────────────────

  private validateFile(file: File): boolean {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      return false;
    }
    return true;
  }

  private isPaperAllowed(formatId: PrintFormatId, paperType: PaperType): boolean {
    return FORMATS_MAP.get(formatId)?.paperTypes.includes(paperType) ?? false;
  }

  private priceKeyForItem(item: PrintItem): keyof PhotoPrintPrices | null {
    const tier = paperPriceTier(item.paperType);
    const formatId = item.formatId === 'custom'
      ? this.billableFormatForCustomSize(this.customSizeForItem(item))
      : item.formatId;

    switch (formatId) {
      case '10x15':
        return tier === 'super' ? 'super_10x15' : 'premium_10x15';
      case '15x20':
        return tier === 'super' ? 'super_15x20' : 'premium_15x20';
      case '20x30':
        return tier === 'super' ? 'super_20x30' : 'premium_20x30';
      case '30x40':
      case '40x50':
        return null;
    }
  }

  private billableFormatForCustomSize(customSize: CustomPrintSizeSettings): Extract<PrintFormatId, '10x15' | '15x20' | '20x30'> {
    const dimensions = this.parseCustomSizeDimensions(customSize.sizeLabel);
    if (!dimensions) return customSize.presetId === '10_5_square' ? '15x20' : '10x15';
    if (this.sizeFitsPaper(dimensions.widthMm, dimensions.heightMm, 100, 150)) return '10x15';
    if (this.sizeFitsPaper(dimensions.widthMm, dimensions.heightMm, 150, 200)) return '15x20';
    return '20x30';
  }

  private parseCustomSizeDimensions(sizeLabel: string): { widthMm: number; heightMm: number } | null {
    const match = sizeLabel.match(/(\d{1,3}(?:[,.]\d+)?)\s*(?:x|х|×|\*)\s*(\d{1,3}(?:[,.]\d+)?)/iu);
    if (!match) return null;

    const widthMm = this.parseCustomDimensionToMm(match[1]);
    const heightMm = this.parseCustomDimensionToMm(match[2]);
    return widthMm && heightMm ? { widthMm, heightMm } : null;
  }

  private parseCustomDimensionToMm(value: string | undefined): number | null {
    const numeric = Number(String(value ?? '').replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const mm = numeric > 60 ? numeric : numeric * 10;
    if (mm < 10 || mm > 600) return null;
    return Math.round(mm);
  }

  private sizeFitsPaper(widthMm: number, heightMm: number, paperWidthMm: number, paperHeightMm: number): boolean {
    return (widthMm <= paperWidthMm && heightMm <= paperHeightMm)
      || (widthMm <= paperHeightMm && heightMm <= paperWidthMm);
  }

  private unitPriceForItem(item: PrintItem, prices: PhotoPrintPrices): number {
    const key = this.priceKeyForItem(item);
    let basePrice: number;

    if (key) {
      basePrice = prices[key] || FORMATS_MAP.get(item.formatId)?.fallbackPriceMin || 0;
    } else {
      // 30x40 = 450, 40x50 = 600 (статика)
      basePrice = item.formatId === '30x40' ? 450 : 600;
    }

    const cropFee = item.formatId === 'custom' && this.customSizeForItem(item).needsCropping
      ? CUSTOM_CROP_FEE
      : 0;

    return basePrice + cropFee;
  }

  private defaultCustomSizeSettings(): CustomPrintSizeSettings {
    return {
      presetId: DEFAULT_CUSTOM_PRINT_SIZE.id,
      label: DEFAULT_CUSTOM_PRINT_SIZE.label,
      sizeLabel: DEFAULT_CUSTOM_PRINT_SIZE.sizeLabel,
      needsCropping: DEFAULT_CUSTOM_PRINT_SIZE.defaultNeedsCropping,
      whiteBorder: DEFAULT_CUSTOM_PRINT_SIZE.whiteBorder,
    };
  }

  private customSizeForItem(item: PrintItem): CustomPrintSizeSettings {
    return item.customSize ?? this.defaultCustomSizeSettings();
  }

  private contactWithCustomOrderComment(): PrintContactInfo {
    const contact = this._contact();
    const customComment = this.customOrderInstruction();
    if (!customComment) return contact;

    const comments = [contact.comments?.trim(), customComment]
      .filter((value): value is string => !!value)
      .join('\n\n');

    return { ...contact, comments };
  }

  private customOrderInstruction(): string | null {
    const lines = this.customOrderInstructionLines();
    if (lines.length === 0) return null;

    return [
      'Нестандартные размеры:',
      ...lines.map(line => `- ${line}`),
      `Цена: минимальный подходящий лист за фото, обрезка/подгонка +${CUSTOM_CROP_FEE} ₽ за фото при выбранной опции.`,
    ].join('\n');
  }

  private customOrderInstructionLines(): string[] {
    return this.customSizeGroups().map(group => {
      const flags = [
        group.whiteBorder ? 'белая рамка' : '',
        group.needsCropping ? `обрезка +${CUSTOM_CROP_FEE} ₽/фото` : 'без обрезки',
      ].filter(Boolean).join(', ');

      return `${group.label} (${group.sizeLabel}), ${group.quantity} фото${flags ? `, ${flags}` : ''}`;
    });
  }

  private enqueueUploads(items: readonly PrintItem[]): void {
    this.uploadQueue.push(...items);
    if (this.isProcessingUploadQueue) return;

    this.isProcessingUploadQueue = true;
    void this.processUploadQueue();
  }

  private async processUploadQueue(): Promise<void> {
    try {
      while (this.uploadQueue.length > 0) {
        const batch = this.uploadQueue
          .splice(0, DIRECT_UPLOAD_BATCH_SIZE)
          .filter(item => this.isPendingUploadItem(item.id));

        if (batch.length === 0) continue;
        await this.uploadItemsBatch(batch);
      }
    } finally {
      this.isProcessingUploadQueue = false;
      if (this.uploadQueue.length > 0) {
        this.enqueueUploads([]);
      }
    }
  }

  private async uploadItemsBatch(batch: readonly PrintItem[]): Promise<void> {
    const items = batch.filter(item => this.isPendingUploadItem(item.id));
    if (items.length === 0) return;

    const itemIds = items.map(item => item.id);
    this.patchItems(itemIds, {
      status: 'uploading',
      uploadProgress: 0,
      errorMessage: undefined,
    });

    let uploadTargets: PrintDirectUploadTarget[];
    try {
      const presign = await firstValueFrom(
        this.http.post<PrintDirectPresignResponse>('/api/orders/photo-print/direct-upload/presign', {
          files: items.map(item => ({
            fileName: item.file.name,
            contentType: item.file.type,
            fileSize: item.file.size,
          })),
        }),
      );

      uploadTargets = presign.data?.uploads ?? [];
      if (!presign.success || uploadTargets.length !== items.length) {
        throw new Error(presign.error || 'Не удалось подготовить загрузку файлов');
      }
    } catch (error: unknown) {
      this.patchItems(itemIds, {
        status: 'error',
        errorMessage: uploadErrorMessage(error, 'Не удалось подготовить загрузку файлов'),
      });
      return;
    }

    const uploadPlans: PrintDirectUploadPlan[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const uploadTarget = uploadTargets[index];
      if (item && uploadTarget) {
        uploadPlans.push({ item, uploadTarget, contentType: item.file.type });
      }
    }

    const completedUploads: PrintDirectStorageUpload[] = [];
    await this.runWithConcurrency(uploadPlans, DIRECT_UPLOAD_CONCURRENCY, async plan => {
      if (!this.hasItem(plan.item.id)) return;

      try {
        this.patchItem(plan.item.id, { uploadProgress: 3 });
        await this.uploadToStorage(plan.item.id, plan.item.file, plan.uploadTarget);
        this.patchItem(plan.item.id, { uploadProgress: 96 });
        completedUploads.push({
          itemId: plan.item.id,
          file: plan.item.file,
          uploadTarget: plan.uploadTarget,
          contentType: plan.contentType,
        });
      } catch (error: unknown) {
        this.patchItem(plan.item.id, {
          status: 'error',
          errorMessage: uploadErrorMessage(error, 'Ошибка загрузки файла'),
        });
      }
    });

    const currentUploads = completedUploads.filter(upload => this.hasItem(upload.itemId));
    if (currentUploads.length === 0) return;

    try {
      const complete = await firstValueFrom(
        this.http.post<PrintDirectCompleteResponse>('/api/orders/photo-print/direct-upload/complete', {
          files: currentUploads.map(upload => ({
            s3Key: upload.uploadTarget.s3Key,
            fileName: upload.file.name,
            contentType: upload.uploadTarget.contentType || upload.contentType,
            fileSize: upload.file.size,
          })),
        }),
      );

      if (!complete.success) {
        throw new Error(complete.error || 'Не удалось завершить загрузку файлов');
      }

      const uploadedFiles = new Map((complete.data?.files ?? []).map(file => [file.s3Key, file]));
      for (const upload of currentUploads) {
        const uploadedFile = uploadedFiles.get(upload.uploadTarget.s3Key);
        if (uploadedFile?.url) {
          this.patchItem(upload.itemId, {
            uploadedUrl: uploadedFile.url,
            status: 'uploaded',
            uploadProgress: 100,
            errorMessage: undefined,
          });
        } else {
          this.patchItem(upload.itemId, {
            status: 'error',
            errorMessage: 'Не удалось завершить загрузку файла',
          });
        }
      }
    } catch (error: unknown) {
      this.patchItems(currentUploads.map(upload => upload.itemId), {
        status: 'error',
        errorMessage: uploadErrorMessage(error, 'Не удалось завершить загрузку файлов'),
      });
    }
  }

  private uploadToStorage(id: string, file: File, uploadTarget: PrintDirectUploadTarget): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadTarget.uploadUrl, true);
      xhr.setRequestHeader('Content-Type', uploadTarget.contentType || file.type);

      xhr.upload.onprogress = event => {
        if (!event.lengthComputable) return;
        const storageProgress = Math.round((event.loaded / event.total) * 92);
        this.patchItem(id, { uploadProgress: Math.min(95, Math.max(3, 3 + storageProgress)) });
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        reject(new Error(`Ошибка загрузки файла: ${xhr.status}`));
      };

      xhr.onerror = () => reject(new Error('Сеть прервала загрузку файла'));
      xhr.onabort = () => reject(new Error('Загрузка файла отменена'));
      xhr.send(file);
    });
  }

  private patchItem(id: string, patch: Partial<PrintItem>): void {
    this._items.update(items =>
      items.map(i => i.id === id ? { ...i, ...patch } : i)
    );
  }

  private patchItems(ids: readonly string[], patch: Partial<PrintItem>): void {
    const idSet = new Set(ids);
    this._items.update(items =>
      items.map(i => idSet.has(i.id) ? { ...i, ...patch } : i)
    );
  }

  private hasItem(id: string): boolean {
    return this._items().some(item => item.id === id);
  }

  private isPendingUploadItem(id: string): boolean {
    return this._items().some(item => item.id === id && item.status === 'pending');
  }

  private async runWithConcurrency<T>(
    entries: readonly T[],
    concurrency: number,
    worker: (entry: T) => Promise<void>,
  ): Promise<void> {
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, entries.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < entries.length) {
        const index = nextIndex;
        nextIndex += 1;

        const entry = entries[index];
        if (entry !== undefined) {
          await worker(entry);
        }
      }
    }));
  }

  private ensureSelectedPickupLocation(): void {
    const selectedId = this._selectedPickupLocationId();
    const locations = this._pickupLocations();
    const selected = selectedId
      ? locations.find(location => location.id === selectedId && location.status === 'open')
      : null;
    const firstOpen = locations.find(location => location.status === 'open');
    if (!selected) {
      this._selectedPickupLocationId.set(firstOpen?.id ?? null);
    }
  }

  ngOnDestroy(): void {
    this.cancelQuote();
    this.clearOrder();
  }
}
