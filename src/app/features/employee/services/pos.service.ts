import { Injectable, inject, signal, computed } from '@angular/core';
import { Product } from './catalog-api.service';
import {
  PricingApiService,
  PricingCategory,
  WaterfallItem,
  WaterfallV2Response,
} from '../../../core/services/pricing-api.service';
import type { PosReceiptItem, StudentDiscountInfo } from './pos-api.service';

export interface CartItem {
  product: Product;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  discount_percent: number;
  points_used: number;
  subscription_credits_used: number;
  total: number;
}

export interface CustomerInfo {
  phone: string;
  name?: string;
  loyalty?: { id: string; points: number; level: number; total_spent: number };
  subscription?: {
    id: string;
    plan_name: string;
    credits: { product_id: string; product_name: string; remaining: number }[];
  };
  studentDiscount?: StudentDiscountInfo | null;
}

const MINIMUM_CHECK_TOTAL = 10;
const MINIMUM_CHECK_STEP = 'minimum_check';

@Injectable({ providedIn: 'root' })
export class PosService {
  private readonly pricingApi = inject(PricingApiService);

  readonly items = signal<CartItem[]>([]);
  readonly customer = signal<CustomerInfo | null>(null);
  readonly shiftId = signal<string | null>(null);
  readonly studioId = signal<string | null>(null);
  readonly employeeId = signal<string | null>(null);

  // ── Waterfall V2 ──
  readonly waterfallResult = signal<WaterfallV2Response | null>(null);
  readonly waterfallLoading = signal(false);
  readonly waterfallError = signal<string | null>(null);
  /** Оператор запросил скидку за объём (по умолчанию не применяется в POS) */
  readonly volumeDiscountRequested = signal(false);
  private serviceOptionIdByProductId = new Map<string, string>();

  readonly itemCount = computed(() => this.items().reduce((sum, i) => sum + i.quantity, 0));
  readonly subtotal = computed(() => this.items().reduce((sum, i) => sum + i.unit_price * i.quantity, 0));
  readonly discountTotal = computed(() => this.items().reduce((sum, i) => sum + i.discount_amount, 0));
  readonly pointsTotal = computed(() => this.items().reduce((sum, i) => sum + i.points_used, 0));
  readonly subscriptionTotal = computed(() => this.items().reduce((sum, i) => sum + i.subscription_credits_used, 0));
  private readonly totalBeforeMinimum = computed(() => {
    const sub = this.subtotal();
    const disc = this.discountTotal();
    const pts = this.pointsTotal();
    return Math.max(0, Math.round((sub - disc - pts) * 100) / 100);
  });
  readonly minimumCheckSurcharge = computed(() => {
    const wf = this.waterfallResult();
    if (wf) {
      const step = wf.waterfall?.find(s => s.step === MINIMUM_CHECK_STEP && s.amount > 0);
      return step ? Math.round(step.amount * 100) / 100 : 0;
    }

    const total = this.totalBeforeMinimum();
    if (total <= 0 || total >= MINIMUM_CHECK_TOTAL) return 0;
    return Math.round((MINIMUM_CHECK_TOTAL - total) * 100) / 100;
  });
  readonly total = computed(() => {
    const localMinimumSurcharge = this.waterfallResult() ? 0 : this.minimumCheckSurcharge();
    return Math.round((this.totalBeforeMinimum() + localMinimumSurcharge) * 100) / 100;
  });
  readonly isEmpty = computed(() => this.items().length === 0);

  /** Total from waterfall when available, otherwise local calculation */
  readonly effectiveTotal = computed(() => {
    const wf = this.waterfallResult();
    return wf ? wf.total : this.total();
  });

  /**
   * Recalculate prices via Waterfall V2 API.
   * Maps cart products to serviceOptionIds via PricingServiceOption.product_id.
   */
  recalculateWaterfall(
    pricingCategories: PricingCategory[],
    promoCode?: string | null,
    customerPhone?: string | null,
    loyaltyPointsToUse?: number,
    loyaltyProfileId?: string | null,
  ): void {
    const cartItems = this.items();
    if (cartItems.length === 0) {
      this.waterfallResult.set(null);
      this.waterfallError.set(null);
      return;
    }

    if (cartItems.some(item => item.discount_amount > 0)) {
      this.serviceOptionIdByProductId = new Map();
      this.waterfallResult.set(null);
      this.waterfallError.set(null);
      return;
    }

    // Map product.id → serviceOptionId via pricing categories
    const waterfallItems: { serviceOptionId: string; quantity: number }[] = [];
    const serviceOptionMap = new Map<string, string>();
    for (const ci of cartItems) {
      const optionId = this.resolveProductToServiceOptionId(ci.product.id, pricingCategories);
      if (optionId) {
        waterfallItems.push({ serviceOptionId: optionId, quantity: ci.quantity });
        serviceOptionMap.set(ci.product.id, optionId);
      }
    }

    if (waterfallItems.length === 0 || waterfallItems.length !== cartItems.length) {
      this.serviceOptionIdByProductId = new Map();
      this.waterfallResult.set(null);
      this.waterfallError.set(null);
      return;
    }

    this.serviceOptionIdByProductId = serviceOptionMap;

    this.waterfallLoading.set(true);
    this.waterfallError.set(null);

    this.pricingApi.calculateV2({
      items: waterfallItems,
      channel: 'pos',
      customerPhone: customerPhone ?? undefined,
      loyaltyProfileId: loyaltyProfileId ?? undefined,
      promoCode: promoCode ?? undefined,
      loyaltyPointsToUse: loyaltyPointsToUse ?? 0,
      applyVolumeDiscount: this.volumeDiscountRequested() || undefined,
    }).then(response => {
      if (response.success) {
        this.waterfallResult.set(response);
      } else {
        this.waterfallResult.set(null);
      }
      this.waterfallLoading.set(false);
    }).catch(() => {
      this.waterfallError.set('Не удалось рассчитать цену');
      this.waterfallLoading.set(false);
    });
  }

  /** Resolve product ID to service_option ID via pricing categories */
  private resolveProductToServiceOptionId(productId: string, categories: PricingCategory[]): string | null {
    for (const cat of categories) {
      for (const group of cat.optionGroups) {
        const opt = group.options.find(o => o.product_id === productId);
        if (opt) return opt.id;
      }
    }
    return null;
  }

  addItem(product: Product, quantity = 1): void {
    const current = this.items();
    const existing = current.find(i => i.product.id === product.id);

    if (existing) {
      this.items.set(current.map(i =>
        i.product.id === product.id
          ? { ...i, quantity: i.quantity + quantity, total: (i.quantity + quantity) * i.unit_price - i.discount_amount }
          : i
      ));
    } else {
      const newItem: CartItem = {
        product,
        quantity,
        unit_price: product.sell_price,
        discount_amount: 0,
        discount_percent: 0,
        points_used: 0,
        subscription_credits_used: 0,
        total: product.sell_price * quantity,
      };
      this.items.set([...current, newItem]);
    }
  }

  removeItem(productId: string): void {
    this.items.set(this.items().filter(i => i.product.id !== productId));
  }

  updateQuantity(productId: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeItem(productId);
      return;
    }
    this.items.set(this.items().map(i =>
      i.product.id === productId
        ? { ...i, quantity, total: quantity * i.unit_price - i.discount_amount }
        : i
    ));
  }

  applyDiscount(productId: string, percent: number): void {
    this.items.set(this.items().map(i => {
      if (i.product.id !== productId) return i;
      const discountAmount = Math.round(i.unit_price * i.quantity * percent / 100 * 100) / 100;
      return {
        ...i,
        discount_percent: percent,
        discount_amount: discountAmount,
        total: i.unit_price * i.quantity - discountAmount,
      };
    }));
  }

  setCustomer(info: CustomerInfo | null): void {
    this.customer.set(info);
  }

  clear(): void {
    this.items.set([]);
    this.customer.set(null);
    this.serviceOptionIdByProductId = new Map();
    this.waterfallResult.set(null);
    this.waterfallLoading.set(false);
    this.waterfallError.set(null);
    this.volumeDiscountRequested.set(false);
  }

  private waterfallItemForProduct(productId: string): WaterfallItem | null {
    const wf = this.waterfallResult();
    if (!wf) return null;
    const serviceOptionId = this.serviceOptionIdByProductId.get(productId);
    if (!serviceOptionId) return null;
    return wf.items.find(item => item.serviceOptionId === serviceOptionId) ?? null;
  }

  private waterfallReceiptLabel(item: WaterfallItem): string | null {
    if (item.discountLabel) return item.discountLabel;
    return item.discountApplied === 'student' ? 'Студенческая скидка' : null;
  }

  private roundReceiptMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private joinReceiptLabels(...labels: Array<string | null | undefined>): string | null {
    const parts = labels.filter((label): label is string => !!label?.trim());
    return parts.length > 0 ? parts.join(' | ') : null;
  }

  private waterfallGlobalDiscountLabel(wf: WaterfallV2Response): string {
    if (wf.discounts.promo) return `Промокод ${wf.discounts.promo.code}`;
    if (wf.discounts.partner) return 'Партнёрская скидка';
    if (wf.discounts.loyalty) return 'Бонусы лояльности';
    return wf.discounts.account?.label ?? 'Скидка';
  }

  private waterfallReceiptDiscounts(): ReadonlyMap<string, { amount: number; label: string | null; type: 'account' | 'global' }> {
    const wf = this.waterfallResult();
    if (!wf) return new Map();

    const buckets = wf.items.map(item => ({
      serviceOptionId: item.serviceOptionId,
      remaining: Math.max(0, this.roundReceiptMoney(item.finalPrice)),
      amount: 0,
      labels: new Set<string>(),
      type: 'global' as 'account' | 'global',
    }));
    const totalBeforeGlobalDiscounts = this.roundReceiptMoney(buckets.reduce((sum, bucket) => sum + bucket.remaining, 0));
    const targetWithoutMinimum = this.roundReceiptMoney(Math.max(0, wf.total - this.minimumCheckSurcharge()));
    let discountLeft = Math.min(
      totalBeforeGlobalDiscounts,
      Math.max(0, this.roundReceiptMoney(totalBeforeGlobalDiscounts - targetWithoutMinimum)),
    );

    if (discountLeft <= 0.004) return new Map();

    for (const line of wf.discounts.account?.lines ?? []) {
      if (discountLeft <= 0.004) break;
      const bucket = buckets.find(candidate => candidate.serviceOptionId === line.serviceOptionId);
      if (!bucket || bucket.remaining <= 0) continue;

      const amount = Math.min(
        this.roundReceiptMoney(Number(line.amount) || 0),
        bucket.remaining,
        discountLeft,
      );
      if (amount <= 0.004) continue;

      bucket.amount = this.roundReceiptMoney(bucket.amount + amount);
      bucket.remaining = this.roundReceiptMoney(bucket.remaining - amount);
      bucket.type = 'account';
      if (line.label) bucket.labels.add(line.label);
      discountLeft = this.roundReceiptMoney(discountLeft - amount);
    }

    if (discountLeft > 0.004) {
      const globalLabel = this.waterfallGlobalDiscountLabel(wf);
      let remainingBase = this.roundReceiptMoney(buckets.reduce((sum, bucket) => sum + bucket.remaining, 0));
      for (const bucket of buckets) {
        if (discountLeft <= 0.004 || bucket.remaining <= 0 || remainingBase <= 0) break;

        const amount = Math.min(
          this.roundReceiptMoney(discountLeft * (bucket.remaining / remainingBase)),
          bucket.remaining,
          discountLeft,
        );
        if (amount <= 0.004) {
          remainingBase = this.roundReceiptMoney(remainingBase - bucket.remaining);
          continue;
        }

        bucket.amount = this.roundReceiptMoney(bucket.amount + amount);
        bucket.remaining = this.roundReceiptMoney(bucket.remaining - amount);
        bucket.labels.add(globalLabel);
        discountLeft = this.roundReceiptMoney(discountLeft - amount);
        remainingBase = this.roundReceiptMoney(remainingBase - bucket.remaining - amount);
      }
    }

    const result = new Map<string, { amount: number; label: string | null; type: 'account' | 'global' }>();
    for (const bucket of buckets) {
      if (bucket.amount <= 0.004) continue;
      result.set(bucket.serviceOptionId, {
        amount: this.roundReceiptMoney(bucket.amount),
        label: [...bucket.labels][0] ?? null,
        type: bucket.type,
      });
    }
    return result;
  }

  getReceiptItems(): PosReceiptItem[] {
    const waterfallDiscounts = this.waterfallReceiptDiscounts();
    const receiptItems: PosReceiptItem[] = this.items().map(i => {
      const wfItem = this.waterfallItemForProduct(i.product.id);
      const receiptDiscount = wfItem ? waterfallDiscounts.get(wfItem.serviceOptionId) ?? null : null;
      const waterfallDiscountType = wfItem && wfItem.discountApplied !== 'none'
        ? wfItem.discountApplied
        : null;
      const manualDiscountType = i.discount_percent > 0 || i.discount_amount > 0 ? 'manual' : null;
      const waterfallLabel = wfItem ? this.waterfallReceiptLabel(wfItem) : null;
      return {
        product_id: i.product.id,
        product_name: i.product.name,
        quantity: wfItem?.quantity ?? i.quantity,
        unit_price: wfItem?.basePrice ?? i.unit_price,
        discount_amount: wfItem
          ? this.roundReceiptMoney(wfItem.discountAmount + (receiptDiscount?.amount ?? 0))
          : i.discount_amount,
        discount_percent: wfItem ? 0 : i.discount_percent,
        points_used: i.points_used,
        subscription_credits_used: i.subscription_credits_used,
        total: wfItem
          ? this.roundReceiptMoney(Math.max(0, wfItem.finalPrice - (receiptDiscount?.amount ?? 0)))
          : i.total,
        vat_rate: i.product.vat_rate,
        discount_type: receiptDiscount ? receiptDiscount.type : waterfallDiscountType ?? manualDiscountType,
        discount_label: wfItem
          ? this.joinReceiptLabels(waterfallLabel, receiptDiscount?.label)
          : manualDiscountType ? 'Ручная скидка ' + i.discount_percent + '%' : null,
        student_discount_benefit: wfItem?.studentDiscountBenefit ?? null,
        student_discount_units: wfItem?.studentDiscountUnits ?? 0,
      };
    });

    const minimumCheckSurcharge = this.minimumCheckSurcharge();
    if (minimumCheckSurcharge > 0) {
      receiptItems.push({
        product_id: null,
        product_name: 'Минимальный чек',
        quantity: 1,
        unit_price: minimumCheckSurcharge,
        discount_amount: 0,
        discount_percent: 0,
        points_used: 0,
        subscription_credits_used: 0,
        total: minimumCheckSurcharge,
        vat_rate: 'NoVat',
        discount_type: MINIMUM_CHECK_STEP,
        discount_label: `Минимальный чек ${MINIMUM_CHECK_TOTAL}₽`,
        student_discount_benefit: null,
        student_discount_units: 0,
      });
    }

    return receiptItems;
  }
}
