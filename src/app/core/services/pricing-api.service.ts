/**
 * PricingApiService — единственный источник цен на фронтенде.
 *
 * Загружает каталог категорий / опций с /api/pricing/categories (кэш 60s).
 * Предоставляет сигналы categories/loading/error и метод calculate().
 *
 * Phase 3: Frontend Price Unification
 */

import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';

// ============================================================================
// Типы (subset бэкендовых типов — только то, что нужно фронтенду)
// ============================================================================

export type DeliveryMethod = 'electronic' | 'pickup' | 'postal';

export interface PricingServiceOption {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  base_price: number;
  price_online: number | null;
  price_studio: number | null;
  price_next_unit: number | null;
  price_max: number | null;
  promo_first_price: number | null;
  promo_description: string | null;
  features: string[];
  popular: boolean;
  original_price: number | null;
  discount_percent: number | null;
  satisfies_requires: boolean;
  estimated_minutes: number | null;
  sort_order: number;
  product_id: string | null;
}

export interface PricingOptionGroup {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  selection_type: 'single' | 'multi' | 'quantity';
  is_required: boolean;
  min_selections: number;
  max_selections: number;
  sort_order: number;
  options: PricingServiceOption[];
}

export interface PricingOptionRule {
  rule_type: 'requires' | 'excludes' | 'includes' | 'price_override';
  source_option_id: string;
  source_option_slug: string;
  target_option_id: string;
  target_option_slug: string;
  override_price: number | null;
  description: string | null;
}

export interface PricingCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  gradient: string | null;
  image_url: string | null;
  price_range: string | null;
  display_channels: string[];
  valid_delivery_methods: DeliveryMethod[];
  sort_order: number;
  optionGroups: PricingOptionGroup[];
  rules: PricingOptionRule[];
}

export interface SelectedOption {
  option_slug: string;
  quantity: number;
}

export interface CalculateRequest {
  categorySlug: string;
  selectedOptions: SelectedOption[];
  deliveryMethod?: DeliveryMethod;
  isReturning?: boolean;
  promoCode?: string;
  loyaltyPointsToUse?: number;
}

export interface PriceBreakdownItem {
  option_slug: string;
  name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

export interface CalculateResponse {
  success: boolean;
  breakdown: {
    base_items: PriceBreakdownItem[];
    subtotal: number;
    promo_discount: { code: string; title: string; amount: number; percent: number | null } | null;
    loyalty_discount: { points_used: number; amount: number } | null;
    total: number;
    savings: number;
  };
  product_ids: string[];
  validation: {
    valid: boolean;
    warnings: string[];
    errors: string[];
  };
}

// ── Waterfall V2 types ──

export type StudentDiscountBenefitType = 'print_a4_bw' | 'print_a4_color' | 'binding_spring_a4';

export type WaterfallDiscountApplied =
  | 'degressive'
  | 'category_degressive'
  | 'subscription'
  | 'volume'
  | 'cross_category'
  | 'student'
  | 'none'
  | (string & {});

export interface StudentDiscountWaterfallSummary {
  entitlementId: string;
  userId: string;
  amount: number;
  printSheets: number;
  bindingUses: number;
  expiresAt: string;
}

export interface WaterfallItem {
  serviceOptionId: string;
  slug: string;
  name: string;
  basePrice: number;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  priceAdjustmentLabel?: string | null;
  priceAdjustmentNotice?: string | null;
  priceAdjustmentAmount?: number;
  discountApplied: WaterfallDiscountApplied;
  discountAmount: number;
  discountLabel: string | null;
  studentDiscountBenefit?: StudentDiscountBenefitType | null;
  studentDiscountUnits?: number;
  categoryRank: number | null;
  finalPrice: number;
  /** F122: подсказка о следующем пороге volume-скидки */
  volumeHint: string | null;
  /** F122: структурированные данные следующего порога (для UI) */
  nextThreshold: {
    nextQuantity: number;
    remainingToNext: number;
    nextDiscountPercent: number;
  } | null;
}

export interface DetectedCombo {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly combo_price: number;
  readonly original_total: number | null;
  readonly savings_label: string | null;
  readonly fully_matched: boolean;
  readonly missing_option_slugs: string[];
}

export interface PriceAdjustmentSummary {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly customerNotice?: string | null;
  readonly multiplier?: number | null;
  readonly amount?: number;
}

export interface WaterfallStep {
  readonly step: string;
  readonly description: string;
  readonly amount: number;
  readonly runningTotal: number;
}

export interface AccountDiscountSummary {
  readonly accountType: 'personal' | 'education' | 'business';
  readonly label: string;
  readonly source: 'none' | 'default' | 'explicit' | 'education_verification';
  readonly percent: number;
  readonly amount: number;
  readonly description?: string;
  readonly lines?: readonly {
    readonly serviceOptionId: string;
    readonly name: string;
    readonly kind: 'document_print' | 'photo_print';
    readonly label: string;
    readonly percent: number;
    readonly amount: number;
    readonly quantity: number;
  }[];
}

export interface WaterfallV2Response {
  success: boolean;
  items: WaterfallItem[];
  subtotal: number;
  total: number;
  savings: number;
  waterfall?: WaterfallStep[];
  discounts: {
    subscriber: { percent: number; amount: number } | null;
    account?: AccountDiscountSummary | null;
    student?: StudentDiscountWaterfallSummary | null;
    loyalty: { points_used: number; amount: number; remaining_balance: number } | null;
    promo: { code: string; title: string; amount: number; percent: number | null } | null;
    partner: { percent: number; amount: number } | null;
  };
  /** Промокод передан, но заблокирован degressive скидкой */
  promoBlocked?: boolean;
  promoBlockedReason?: 'degressive_discount_applied' | 'student_discount_applied';
  adjustments?: PriceAdjustmentSummary[];
  detectedCombos?: DetectedCombo[];
}

export interface WaterfallV2Request {
  items: { serviceOptionId: string; quantity: number; pricingGroupKey?: string; printFillPercent?: number }[];
  channel: 'pos' | 'online' | 'crm';
  customerId?: string;
  customerPhone?: string;
  clientUserId?: string;
  clientContactId?: string;
  loyaltyProfileId?: string;
  promoCode?: string;
  loyaltyPointsToUse?: number;
  applyVolumeDiscount?: boolean;
}

export interface WaterfallV2BySlugRequest {
  categorySlug: string;
  selectedOptions: Record<string, string[]>;
  photoCount?: number;
  channel?: 'pos' | 'online' | 'crm';
  customerPhone?: string;
  promoCode?: string;
  loyaltyPointsToUse?: number;
}

// ── Dynamic Pricing types ──

export interface AppliedModifier {
  id: string;
  name: string;
  modifier_type: string;
  action: string;
  value: number;
  description: string;
}

export interface DynamicPriceInfo {
  base_price: number;
  final_price: number;
  total_discount: number;
  discount_percent: number;
  applied_modifiers: AppliedModifier[];
  reasons: string[];
  minutes_to_price_change: number;
}

export interface DynamicCalculateResponse extends CalculateResponse {
  dynamic: DynamicPriceInfo;
}

export interface CurrentPriceResponse {
  success: boolean;
  category_slug: string;
  base_price: number;
  current_price: number;
  discount_percent: number;
  total_discount: number;
  reasons: string[];
  minutes_to_price_change: number;
  applied_modifiers: AppliedModifier[];
}

export interface PriceLock {
  id: string;
  visitor_id: string | null;
  user_id: string | null;
  category_slug: string;
  locked_price: number;
  lock_fee: number;
  lock_fee_paid: boolean;
  expires_at: string;
  used: boolean;
}

// ── Volume Threshold Hints (F122) ──

export interface VolumeThresholdHint {
  nextTierMinQty: number;
  remaining: number;
  discountPercent: number;
  modifierAction: string;
  modifierValue: number;
  label: string;
}

export interface VolumeHintsResponse {
  success: boolean;
  hint: VolumeThresholdHint | null;
}

export interface DynamicCalculateRequest extends CalculateRequest {
  paymentTime?: string;
  loyaltyLevel?: number;
  isSubscriber?: boolean;
  bundleCount?: number;
  slotDate?: string;
}

// ============================================================================
// Сервис
// ============================================================================

@Injectable({ providedIn: 'root' })
export class PricingApiService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _categories = signal<PricingCategory[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private _lastFetch = 0;
  private readonly CACHE_TTL = 60_000; // 60 секунд

  readonly categories = this._categories.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Только категории, доступные для онлайн-заказа (electronic или postal delivery) */
  readonly onlineCategories = computed(() =>
    this._categories().filter(cat =>
      cat.valid_delivery_methods.some(m => m === 'electronic' || m === 'postal')
    )
  );

  /**
   * Загрузить каталог (idempotent — повторный вызов использует кэш).
   * Безопасно вызывать из ngOnInit на SSR и в браузере.
   */
  loadCategories(): void {
    const now = Date.now();
    if (this._categories().length > 0 && now - this._lastFetch < this.CACHE_TTL) {
      return;
    }
    if (this._loading()) return;

    this._loading.set(true);
    this._error.set(null);

    this.http
      .get<{ success: boolean; categories: PricingCategory[] }>('/api/pricing/categories')
      .subscribe({
        next: (res) => {
          this._categories.set(res.categories);
          this._lastFetch = Date.now();
          this._loading.set(false);
        },
        error: () => {
          this._error.set('Не удалось загрузить цены');
          this._loading.set(false);
        },
      });
  }

  /** Получить категорию по slug (из кэша) */
  getCategoryBySlug(slug: string): PricingCategory | null {
    return this._categories().find(c => c.slug === slug) ?? null;
  }

  /**
   * Минимальная цена online-доставки для категории.
   * Используется для отображения "от X₽" в карточках.
   */
  getMinOnlinePrice(slug: string): number | null {
    const cat = this.getCategoryBySlug(slug);
    if (!cat) return null;
    const prices: number[] = [];
    for (const group of cat.optionGroups) {
      for (const opt of group.options) {
        const p = opt.promo_first_price ?? opt.price_online ?? opt.base_price;
        if (p > 0) prices.push(p);
      }
    }
    return prices.length ? Math.min(...prices) : null;
  }

  /**
   * Минимальная студийная цена для категории.
   */
  getMinStudioPrice(slug: string): number | null {
    const cat = this.getCategoryBySlug(slug);
    if (!cat) return null;
    const prices: number[] = [];
    for (const group of cat.optionGroups) {
      if (!group.is_required) continue; // пропускаем опциональные группы (speed, extras)
      for (const opt of group.options) {
        const p = opt.price_studio ?? opt.base_price;
        if (p > 0) prices.push(p);
      }
    }
    return prices.length ? Math.min(...prices) : null;
  }

  /**
   * Эффективная цена опции с учётом delivery method.
   */
  resolveOptionPrice(
    opt: PricingServiceOption,
    deliveryMethod: DeliveryMethod = 'electronic',
    isNew = false,
  ): number {
    if (isNew && opt.promo_first_price != null) return opt.promo_first_price;
    if (deliveryMethod === 'pickup' && opt.price_studio != null) return opt.price_studio;
    if ((deliveryMethod === 'electronic' || deliveryMethod === 'postal') && opt.price_online != null)
      return opt.price_online;
    return opt.base_price;
  }

  /**
   * Итоговая сумма опции с учётом quantity и price_next_unit для 2+ единиц.
   */
  resolveOptionTotal(
    opt: PricingServiceOption,
    quantity: number,
    deliveryMethod: DeliveryMethod = 'electronic',
    isNew = false,
  ): number {
    const safeQty = Math.max(1, Math.floor(quantity || 1));
    const firstUnitPrice = this.resolveOptionPrice(opt, deliveryMethod, isNew);
    if (safeQty === 1) return firstUnitPrice;

    if (opt.price_next_unit != null) {
      return firstUnitPrice + opt.price_next_unit * (safeQty - 1);
    }

    return firstUnitPrice * safeQty;
  }

  /**
   * Расчёт цены через Waterfall V2 API — полный waterfall с дегрессией.
   * Используется в CRM-форме создания заказа.
   */
  calculateV2(req: WaterfallV2Request): Promise<WaterfallV2Response> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject(new Error('calculateV2 недоступен на сервере'));
    }
    return firstValueFrom(
      this.http.post<WaterfallV2Response>('/api/pricing/v2/calculate', {
        items: req.items,
        channel: req.channel,
        customer_id: req.customerId ?? null,
        customer_phone: req.customerPhone ?? null,
        client_user_id: req.clientUserId ?? null,
        client_contact_id: req.clientContactId ?? null,
        loyalty_profile_id: req.loyaltyProfileId ?? null,
        promo_code: req.promoCode ?? null,
        loyalty_points_to_use: req.loyaltyPointsToUse ?? 0,
        apply_volume_discount: req.applyVolumeDiscount ?? undefined,
      })
    );
  }

  /**
   * Расчёт цены через Waterfall V2 API по slug-ам (для chat cart).
   * Конвертирует categorySlug+selectedOptions(slugs) → serviceOptionId на бэкенде.
   */
  calculateV2BySlugs(req: WaterfallV2BySlugRequest): Promise<WaterfallV2Response> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject(new Error('calculateV2BySlugs недоступен на сервере'));
    }
    return firstValueFrom(
      this.http.post<WaterfallV2Response>('/api/pricing/v2/calculate-by-slugs', {
        category_slug: req.categorySlug,
        selected_options: req.selectedOptions,
        photo_count: req.photoCount ?? 1,
        channel: req.channel ?? 'online',
        customer_phone: req.customerPhone ?? null,
        promo_code: req.promoCode ?? null,
        loyalty_points_to_use: req.loyaltyPointsToUse ?? 0,
      })
    );
  }

  /**
   * Расчёт цены через API (серверная валидация + финальная цена).
   * Используется перед оплатой и в конфигураторе.
   */
  calculate(req: CalculateRequest): Promise<CalculateResponse> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject(new Error('calculate недоступен на сервере'));
    }
    return firstValueFrom(
      this.http.post<CalculateResponse>('/api/pricing/calculate', {
        category_slug: req.categorySlug,
        selected_options: req.selectedOptions,
        delivery_method: req.deliveryMethod ?? 'electronic',
        is_returning: req.isReturning ?? false,
        promo_code: req.promoCode ?? null,
        loyalty_points_to_use: req.loyaltyPointsToUse ?? 0,
      })
    );
  }

  /**
   * Расчёт с динамическими модификаторами (ночные скидки, bundle, loyalty).
   */
  calculateDynamic(req: DynamicCalculateRequest): Promise<DynamicCalculateResponse> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject(new Error('calculateDynamic недоступен на сервере'));
    }
    return firstValueFrom(
      this.http.post<DynamicCalculateResponse>('/api/pricing/calculate-dynamic', {
        category_slug: req.categorySlug,
        selected_options: req.selectedOptions,
        delivery_method: req.deliveryMethod ?? 'electronic',
        is_returning: req.isReturning ?? false,
        promo_code: req.promoCode ?? null,
        loyalty_points_to_use: req.loyaltyPointsToUse ?? 0,
        payment_time: req.paymentTime ?? new Date().toISOString(),
        loyalty_level: req.loyaltyLevel ?? null,
        is_subscriber: req.isSubscriber ?? false,
        bundle_count: req.bundleCount ?? req.selectedOptions.length,
        slot_date: req.slotDate ?? null,
      })
    );
  }

  /**
   * Текущая динамическая цена для live-виджета (polling 60s).
   */
  getCurrentPrice(categorySlug: string, basePrice: number, loyaltyLevel?: number): Promise<CurrentPriceResponse> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject(new Error('getCurrentPrice недоступен на сервере'));
    }
    const params: Record<string, string> = {
      base_price: String(basePrice),
    };
    if (loyaltyLevel) params['loyalty_level'] = String(loyaltyLevel);

    return firstValueFrom(
      this.http.get<CurrentPriceResponse>(`/api/pricing/current-price/${categorySlug}`, { params })
    );
  }

  /**
   * Создать price lock на 24ч.
   */
  lockPrice(params: { visitorId?: string; userId?: string; categorySlug: string; currentPrice: number }): Promise<{ success: boolean; lock: PriceLock }> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject(new Error('lockPrice недоступен на сервере'));
    }
    return firstValueFrom(
      this.http.post<{ success: boolean; lock: PriceLock }>('/api/pricing/lock-price', {
        visitor_id: params.visitorId ?? null,
        user_id: params.userId ?? null,
        category_slug: params.categorySlug,
        current_price: params.currentPrice,
      })
    );
  }

  /**
   * Подсказка о следующем пороге volume-скидки (F122).
   * Возвращает hint вида "ещё 5 шт и скидка 10%!" или null.
   */
  getVolumeHint(params: {
    serviceOptionId?: string;
    serviceCategoryId?: string;
    currentQty: number;
  }): Promise<VolumeThresholdHint | null> {
    if (!isPlatformBrowser(this.platformId)) return Promise.resolve(null);

    const queryParams: Record<string, string> = {
      current_qty: String(params.currentQty),
    };
    if (params.serviceOptionId) queryParams['service_option_id'] = params.serviceOptionId;
    if (params.serviceCategoryId) queryParams['service_category_id'] = params.serviceCategoryId;

    return firstValueFrom(
      this.http.get<VolumeHintsResponse>('/api/pricing/volume-hints', { params: queryParams })
    ).then(res => res.hint);
  }

  /**
   * Валидация промокода (акционный или партнёрский).
   */
  validatePromoCode(code: string): Promise<PromoValidationResult> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject(new Error('validatePromoCode недоступен на сервере'));
    }
    return firstValueFrom(
      this.http.get<PromoValidationResult>(`/api/promotions/validate/${encodeURIComponent(code)}`)
    );
  }
}

export interface PromoValidationResult {
  valid: boolean;
  error?: string;
  title?: string;
  is_partner_code?: boolean;
  partner_name?: string;
  discount_percent?: number | null;
  discount_amount?: number | null;
}
