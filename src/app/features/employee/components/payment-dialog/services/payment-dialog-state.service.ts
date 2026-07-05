import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime } from 'rxjs';
import {
  PricingApiService,
  type AccountDiscountSummary,
  type WaterfallItem,
} from '../../../../../core/services/pricing-api.service';
import {
  type UiCategory,
  type UiServiceOption,
  type SelectedItem,
  type ExpandedSelectedItem,
  type QuickPreset,
  type BreakdownItem,
  type PaymentCartDetails,
  type PaymentDialogPrefillService,
} from '../models/payment-dialog.models';

/** Fallback presets — used when DB templates haven't loaded yet */
const FALLBACK_PRESETS: readonly QuickPreset[] = [
  { id: 'photo-docs-retouch', label: 'Фото + ретушь', icon: 'photo_camera', optionSlugs: ['express', 'retouch-studio-only'] },
  { id: 'copy-bw', label: 'Ксерокопия ч/б', icon: 'content_copy', optionSlugs: ['copy-a4-bw'] },
  { id: 'photo-express', label: 'Экспресс фото', icon: 'bolt', optionSlugs: ['express'] },
  { id: 'fallback-gift-svo-full', label: 'Сертификат СВО', icon: 'card_giftcard', optionSlugs: ['gift-svo-full'] },
  { id: 'fallback-gift-photo-print-260', label: '260 фото 10x15', icon: 'photo_library', optionSlugs: ['gift-photo-print-260-10x15-premium'] },
] as const;

const PRINT_FILL_PERCENT_BY_SLUG = new Map<string, number>([
  ['copy-a4-bw', 15],
  ['copy-a4-color', 15],
  ['print-a4-bw', 15],
  ['print-a4-color', 15],
  ['student-print-a4', 15],
  ['km-а4-ксерокопия', 15],
  ['km-а4-до-15-цвет', 15],
  ['km-а4-печать-документа', 15],
  ['km-а4-печать-документа-студент', 15],
  ['km-а4-печать-до-15-цвет', 15],
  ['km-а4-ксерокопия-цветная', 50],
  ['km-а4-печать-документа-цветная', 50],
  ['km-а4-до-75', 75],
  ['km-а4-печать-до-75', 75],
  ['km-а4-ксерокопия-фото-цветная', 100],
  ['km-а4-фото-документ', 100],
]);

const LOYALTY_MAX_DISCOUNT_RATIO = 0.15;

export interface PricingRequestItem {
  readonly serviceOptionId: string;
  readonly quantity: number;
  readonly pricingGroupKey?: string;
  readonly printFillPercent?: number;
}

export interface PricingSelectedOption {
  readonly option_slug: string;
  readonly quantity: number;
  readonly pricing_group_key?: string;
  readonly print_fill_percent?: number;
}

export interface PaymentServiceItem {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly price: number;
  readonly quantity: number;
  readonly pricingGroupKey?: string;
  readonly printFillPercent?: number;
}

export interface CustomerPricingIdentity {
  readonly clientUserId?: string;
  readonly clientContactId?: string;
}

/**
 * Scoped state service for the Payment Dialog.
 * NOT providedIn: 'root' — provided at the shell component level,
 * so each dialog instance gets its own state.
 */
@Injectable()
export class PaymentDialogStateService {
  private readonly pricingApi = inject(PricingApiService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Primary state signals ──

  readonly categories = signal<readonly UiCategory[]>([]);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  readonly activeCategory = signal<string | null>(null);
  readonly selectedItems = signal<readonly SelectedItem[]>([]);
  readonly manualAmount = signal(0);
  readonly description = signal('');
  readonly generating = signal(false);
  readonly generatingPos = signal(false);

  /** Loyalty: how many points the customer wants to spend */
  readonly loyaltyPointsToUse = signal(0);

  /** Loyalty: available customer balance */
  readonly loyaltyPointsBalance = signal(0);

  /** Loyalty: active customer profile */
  readonly loyaltyProfileId = signal<string | null>(null);

  /** Loyalty: conversion rate from profile (default 1 bonus per 1₽) */
  readonly conversionRate = signal(1);

  /** DB-loaded templates (from /api/pricing/templates) */
  readonly dbTemplates = signal<readonly QuickPreset[]>([]);

  /** Customer phone — set by component for pricing API calls when the cashier typed/knows it. */
  readonly customerPhone = signal<string | null>(null);

  /** Backend-only customer identity for pricing when the employee UI only has a masked phone. */
  readonly customerIdentity = signal<CustomerPricingIdentity | null>(null);

  /** Pricing channel changes studio/CRM price rules. */
  readonly pricingChannel = signal<'crm' | 'pos'>('crm');

  /** Оператор запросил скидку за объём */
  readonly volumeDiscountRequested = signal(false);

  /** Показывать кнопку скидки за объём — если есть позиция с qty >= 10 */
  readonly showVolumeToggle = computed(() =>
    this.volumeDiscountRequested() || this.selectedItems().some(i => i.quantity >= 10),
  );

  // ── Pricing API state ──

  /** Whether pricing API request is in flight */
  readonly pricingLoading = signal(false);

  /** Waterfall items from pricing API response */
  private readonly waterfallItems = signal<readonly WaterfallItem[]>([]);

  /** Exact cart details passed from an existing client cart. Cleared on manual edits. */
  private readonly externalCartDetails = signal<PaymentCartDetails | null>(null);
  private readonly externalCartAmount = signal(0);

  readonly cartPrefillDetails = computed(() => this.externalCartDetails());
  readonly cartPrefillAmount = computed(() => this.externalCartAmount());
  readonly cartPrefillItemCount = computed(() => this.externalCartDetails()?.lines.length ?? 0);

  /** Total from pricing API (null = not yet loaded, use local calc) */
  private readonly apiTotal = signal<number | null>(null);

  /** Savings from pricing API */
  readonly apiSavings = signal(0);

  /** Subscriber discount info from API */
  readonly subscriberDiscount = signal<{ percent: number; amount: number } | null>(null);

  /** Account type discount info from API */
  readonly accountDiscount = signal<AccountDiscountSummary | null>(null);

  /** Account discounts and bonuses do not stack. */
  readonly loyaltyAccountDiscountBlocked = computed<boolean>(() => {
    if ((this.accountDiscount()?.amount ?? 0) > 0) return true;

    const external = this.externalCartDetails();
    if (!external) return false;
    return external.lines.some(line =>
      line.discountAmount > 0 && this.isAccountDiscountText(line.discountLabel),
    );
  });

  /** Total eligible for bonus spend. A3 photo print is excluded by business rule. */
  readonly loyaltyEligibleSubtotal = computed<number>(() => {
    const external = this.externalCartDetails();
    const externalEligible = external
      ? external.lines.reduce((sum, line) =>
          this.isA3PhotoPrintText(line.name) ? sum : sum + line.total, 0)
      : 0;

    const items = this.selectedItems();
    if (items.length === 0) {
      return this.roundCurrency(externalEligible + Math.max(0, this.manualAmount()));
    }

    const waterfall = this.waterfallItems();
    const selectedEligible = items.reduce((sum, item) => {
      if (this.isA3PhotoPrintService(item.service)) return sum;

      const matched = waterfall.filter(w => w.serviceOptionId === item.service.id);
      const itemTotal = matched.length > 0
        ? matched.reduce((lineSum, w) => lineSum + w.finalPrice, 0)
        : item.service.price * item.quantity;
      return sum + itemTotal;
    }, 0);

    return this.roundCurrency(externalEligible + selectedEligible);
  });

  readonly loyaltyMaxDiscount = computed<number>(() => {
    if (this.loyaltyAccountDiscountBlocked()) return 0;
    return Math.floor(this.loyaltyEligibleSubtotal() * LOYALTY_MAX_DISCOUNT_RATIO);
  });

  /** Loyalty discount in roubles after all local caps. */
  readonly loyaltyDiscount = computed<number>(() =>
    Math.min(
      Math.floor(this.loyaltyPointsToUse() * this.conversionRate()),
      this.loyaltyMaxDiscount(),
    ),
  );

  /** Actual points that will be sent to the server after capping. */
  readonly loyaltyPointsUsed = computed<number>(() =>
    Math.min(
      this.loyaltyPointsToUse(),
      this.loyaltyPointsRequiredForRubles(this.loyaltyDiscount()),
    ),
  );

  readonly loyaltyMaxPointsToUse = computed<number>(() =>
    Math.min(
      this.loyaltyPointsBalance(),
      this.loyaltyPointsRequiredForRubles(this.loyaltyMaxDiscount()),
    ),
  );

  readonly loyaltyUnavailableReason = computed<string | null>(() => {
    if (this.loyaltyPointsBalance() <= 0) return null;
    if (this.loyaltyAccountDiscountBlocked()) return 'Скидка аккаунта уже применена';
    if (this.loyaltyEligibleSubtotal() <= 0) return 'Бонусы недоступны для этих позиций';
    if (this.loyaltyMaxPointsToUse() <= 0) return 'Минимальная сумма для списания бонусов не набрана';
    return null;
  });

  /** Trigger for debounced pricing recalculation */
  private readonly recalcTrigger$ = new Subject<void>();

  constructor() {
    this.recalcTrigger$.pipe(
      debounceTime(300),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.fetchPricing());
  }

  // ── Derived state (computed) ──

  /** O(1) lookup set for selected service IDs */
  readonly selectedIds = computed<ReadonlySet<string>>(() =>
    new Set(this.selectedItems().map(i => i.service.id)),
  );

  /** Sections visible when browsing (not searching) */
  readonly visibleSections = computed<readonly UiCategory[]>(() => {
    const cat = this.activeCategory();
    const all = this.categories();
    return cat !== null ? all.filter(c => c.slug === cat) : all;
  });

  /** Total from selected services — uses API total when available, else local calc */
  readonly servicesTotal = computed<number>(() => {
    const api = this.apiTotal();
    if (api !== null) return api;
    return this.selectedItems().reduce((sum, i) => sum + i.service.price * i.quantity, 0);
  });

  /** Amount before loyalty discount (used to compute max spendable bonuses) */
  readonly amountBeforeLoyalty = computed<number>(() => {
    const fromExternalCart = this.externalCartAmount();
    const fromServices = this.servicesTotal();
    return this.roundCurrency(fromExternalCart + fromServices + this.manualAmount());
  });

  /** Final amount = services + manual − loyalty discount */
  readonly finalAmount = computed<number>(() =>
    Math.max(0, this.amountBeforeLoyalty() - this.loyaltyDiscount()),
  );

  /** Whether the form can be submitted (loyalty can cover the full amount → finalAmount=0 is OK) */
  readonly canSubmit = computed<boolean>(() => {
    const hasValue = this.amountBeforeLoyalty() >= 1;
    return hasValue && !this.generating() && !this.generatingPos();
  });

  /** Auto-generated description from selected services */
  readonly autoDescription = computed<string>(() => {
    const externalNames = this.externalCartDetails()?.lines
      .map(line => line.name.trim())
      .filter(name => name.length > 0) ?? [];
    const selectedNames = this.selectedItems().map(i => i.service.name);
    return [...externalNames, ...selectedNames].join(', ');
  });

  /** Breakdown items for summary display — uses waterfall data when available */
  readonly breakdown = computed<readonly BreakdownItem[]>(() => {
    const waterfall = this.waterfallItems();
    const items = this.selectedItems();

    if (waterfall.length > 0) {
      return items.map(item => this.aggregateBreakdownForItem(item, waterfall));
    }

    return items.map(i => ({
      name: i.service.name,
      quantity: i.quantity,
      unitPrice: i.service.price,
      total: i.service.price * i.quantity,
      priceNote: null,
      discountLabel: null,
      discountAmount: 0,
    }));
  });

  /** Quick presets — DB templates take priority, fallback to hardcoded */
  readonly quickPresets = computed<readonly QuickPreset[]>(() => {
    const cats = this.categories();
    if (cats.length === 0) return [];
    const allOptions = cats.flatMap(c => c.allOptions);

    const source = this.dbTemplates().length > 0 ? this.dbTemplates() : FALLBACK_PRESETS;
    return source.filter(p =>
      p.optionSlugs.every(slug => allOptions.some(o => o.slug === slug)),
    );
  });

  // ── Actions ──

  isSelected(serviceId: string): boolean {
    return this.selectedIds().has(serviceId);
  }

  selectService(service: UiServiceOption, categoryName: string): void {
    if (this.isSelected(service.id)) {
      this.selectedItems.update(items => items.filter(i => i.service.id !== service.id));
    } else {
      this.selectedItems.update(items => [...items, { service, categoryName, quantity: 1 }]);
    }
    this.syncDescription();
    this.triggerRecalc();
  }

  removeService(serviceId: string): void {
    this.selectedItems.update(items => items.filter(i => i.service.id !== serviceId));
    this.syncDescription();
    this.triggerRecalc();
  }

  changeQuantity(serviceId: string, delta: number): void {
    this.selectedItems.update(items =>
      items
        .map(i => {
          if (i.service.id !== serviceId) return i;
          const quantity = i.quantity + delta;
          return { ...i, quantity, peopleCount: this.clampPeopleCount(i.peopleCount ?? 1, quantity) };
        })
        .filter(i => i.quantity > 0),
    );
    this.syncDescription();
    this.triggerRecalc();
  }

  setQuantity(serviceId: string, quantity: number): void {
    if (quantity < 1) return;
    this.selectedItems.update(items =>
      items.map(i => {
        if (i.service.id !== serviceId) return i;
        return { ...i, quantity, peopleCount: this.clampPeopleCount(i.peopleCount ?? 1, quantity) };
      }),
    );
    this.syncDescription();
    this.triggerRecalc();
  }

  changePeopleCount(serviceId: string, delta: number): void {
    this.selectedItems.update(items =>
      items.map(i => {
        if (i.service.id !== serviceId || !this.isMultiPersonCapable(i)) return i;
        return { ...i, peopleCount: this.clampPeopleCount((i.peopleCount ?? 1) + delta, i.quantity) };
      }),
    );
    this.triggerRecalc();
  }

  setPeopleCount(serviceId: string, peopleCount: number): void {
    this.selectedItems.update(items =>
      items.map(i => {
        if (i.service.id !== serviceId || !this.isMultiPersonCapable(i)) return i;
        return { ...i, peopleCount: this.clampPeopleCount(peopleCount, i.quantity) };
      }),
    );
    this.triggerRecalc();
  }

  addPreset(preset: QuickPreset): void {
    const allOptions = this.categories().flatMap(c =>
      c.groups.flatMap(g => g.options.map(o => ({ option: o, categoryName: c.name }))),
    );
    for (const slug of preset.optionSlugs) {
      const found = allOptions.find(x => x.option.slug === slug);
      if (found && !this.isSelected(found.option.id)) {
        this.selectedItems.update(items => [...items, {
          service: found.option,
          categoryName: found.categoryName,
          quantity: 1,
        }]);
      }
    }
    this.syncDescription();
    this.triggerRecalc();
  }

  /** Apply prefill slugs (F58 Repeat Order) — resolve slugs from loaded categories */
  applyPrefill(slugs: readonly { slug: string; quantity: number }[]): void {
    this.clearExternalCartDetails();
    const allOptions = this.categories().flatMap(c =>
      c.groups.flatMap(g => g.options.map(o => ({ option: o, categoryName: c.name }))),
    );
    for (const { slug, quantity } of slugs) {
      const found = allOptions.find(x => x.option.slug === slug);
      if (found && !this.isSelected(found.option.id)) {
        this.selectedItems.update(items => [...items, {
          service: found.option,
          categoryName: found.categoryName,
          quantity: quantity || 1,
        }]);
      }
    }
    this.syncDescription();
    this.triggerRecalc();
  }

  /** Apply existing pending payment link values when reopening the invoice dialog for editing. */
  applyPaymentLinkPrefill(
    services: readonly PaymentDialogPrefillService[],
    totalAmount: number,
    fallbackDescription: string,
  ): void {
    this.clearExternalCartDetails();
    const allOptions = this.categories().flatMap(c =>
      c.groups.flatMap(g => g.options.map(o => ({ option: o, categoryName: c.name }))),
    );
    const selectedById = new Map<string, SelectedItem>();
    let matchedTotal = 0;

    for (const service of services) {
      const serviceId = service.id?.trim();
      const serviceSlug = service.slug?.trim();
      const found = allOptions.find(x =>
        (!!serviceId && x.option.id === serviceId) ||
        (!!serviceSlug && x.option.slug === serviceSlug),
      );
      if (!found) continue;

      const quantity = Math.max(1, Math.trunc(Number(service.quantity) || 1));
      const existing = selectedById.get(found.option.id);
      selectedById.set(found.option.id, {
        service: found.option,
        categoryName: found.categoryName,
        quantity: (existing?.quantity ?? 0) + quantity,
      });
      matchedTotal += found.option.price * quantity;
    }

    const amount = Math.max(0, Number(totalAmount) || 0);
    const description = fallbackDescription.trim()
      || services.map(service => service.name).filter(Boolean).join(', ')
      || `Оплата ${amount}₽`;

    if (selectedById.size === 0 || matchedTotal > amount + 0.01) {
      this.selectedItems.set([]);
      this.manualAmount.set(amount);
      this.description.set(description);
      this.triggerRecalc();
      return;
    }

    const selectedItems = Array.from(selectedById.values());
    const manualRemainder = Math.max(0, Math.round((amount - matchedTotal) * 100) / 100);

    this.selectedItems.set(selectedItems);
    this.manualAmount.set(manualRemainder);
    this.description.set(description);
    this.triggerRecalc();
  }

  /** Apply a ready client cart, preserving its exact line details for chat/payment output. */
  applyCartPrefill(
    services: readonly PaymentDialogPrefillService[],
    totalAmount: number,
    fallbackDescription: string,
    cartDetails: PaymentCartDetails | null,
  ): void {
    const normalizedCartDetails = this.normalizeExternalCartDetails(cartDetails);
    const amount = this.roundCurrency(Math.max(0, Number(totalAmount) || normalizedCartDetails?.subtotal || 0));

    const detailNames = normalizedCartDetails?.lines.map(line => line.name).filter(Boolean).join(', ') ?? '';
    const description = fallbackDescription.trim()
      || detailNames
      || services.map(service => service.name).filter(Boolean).join(', ')
      || `Оплата ${amount}₽`;

    // Пытаемся сопоставить позиции корзины с каталогом и провести их как selectedItems —
    // тогда waterfall пересчитает цену С УЧЁТОМ клиента (образовательная/бонусная скидка
    // по customerPhone). Раньше корзина из чата всегда шла «внешней» с фикс-ценой каталога
    // и selectedItems=[], поэтому waterfall не запускался и скидка клиента НЕ применялась.
    const allOptions = this.categories().flatMap(c =>
      c.groups.flatMap(g => g.options.map(o => ({ option: o, categoryName: c.name }))),
    );
    const selectedById = new Map<string, SelectedItem>();
    let matchedTotal = 0;
    let allMatched = services.length > 0;
    for (const service of services) {
      const serviceId = service.id?.trim();
      const serviceSlug = service.slug?.trim();
      const found = allOptions.find(x =>
        (!!serviceId && x.option.id === serviceId) ||
        (!!serviceSlug && x.option.slug === serviceSlug),
      );
      if (!found) { allMatched = false; break; }
      const quantity = Math.max(1, Math.trunc(Number(service.quantity) || 1));
      const existing = selectedById.get(found.option.id);
      selectedById.set(found.option.id, {
        service: found.option,
        categoryName: found.categoryName,
        quantity: (existing?.quantity ?? 0) + quantity,
      });
      matchedTotal += found.option.price * quantity;
    }

    // Все позиции каталожные и их сумма не превышает заявленный итог (нет «ручной» наценки,
    // которую нельзя восстановить) → ведём через selectedItems, waterfall применит скидку клиента.
    if (allMatched && matchedTotal <= amount + 0.01) {
      this.clearExternalCartDetails();
      this.selectedItems.set(Array.from(selectedById.values()));
      this.manualAmount.set(Math.max(0, this.roundCurrency(amount - matchedTotal)));
      this.description.set(description);
      this.triggerRecalc();
      return;
    }

    // Фолбэк: кастомные/несопоставимые позиции — внешняя корзина с фикс-ценой (как было).
    // Скидка по клиенту тут не считается (нечего пересчитывать через каталог).
    this.externalCartDetails.set(normalizedCartDetails);
    this.externalCartAmount.set(amount);
    this.selectedItems.set([]);
    this.manualAmount.set(0);
    this.description.set(description);
    this.triggerRecalc();
  }

  setManualAmount(value: string): void {
    const n = parseFloat(value) || 0;
    this.manualAmount.set(n < 0 ? 0 : n);
  }

  syncDescription(): void {
    const auto = this.autoDescription();
    this.description.set(auto);
  }

  toggleVolumeDiscount(): void {
    this.volumeDiscountRequested.update(v => !v);
    this.triggerRecalc();
  }

  setLoyaltyPointsToUse(points: number): void {
    const safePoints = Math.max(0, Math.floor(Number.isFinite(points) ? points : 0));
    this.loyaltyPointsToUse.set(Math.min(safePoints, this.loyaltyMaxPointsToUse()));
  }

  /**
   * Привязать телефон клиента к расчёту и пересчитать цену.
   * Нужно, когда кассир вводит телефон ПОСЛЕ выбора позиций (клиент пришёл из чата
   * без телефона) — простой `customerPhone.set` не запускает пересчёт сам по себе,
   * а скидки (`discounts.account` образовательная / бонусы) приходят только когда
   * `/v2/calculate` зовётся с телефоном. Пустая корзина — пересчёт пропускается.
   */
  setCustomerPhone(phone: string | null): void {
    const hasIdentity = this.customerIdentity() !== null;
    if (this.customerPhone() === phone && !hasIdentity) return;
    this.customerPhone.set(phone);
    if (hasIdentity) this.customerIdentity.set(null);
    this.triggerRecalc();
  }

  setCustomerIdentity(identity: CustomerPricingIdentity | null): void {
    const next = identity && (identity.clientUserId || identity.clientContactId)
      ? {
          ...(identity.clientUserId ? { clientUserId: identity.clientUserId } : {}),
          ...(identity.clientContactId ? { clientContactId: identity.clientContactId } : {}),
        }
      : null;
    const current = this.customerIdentity();
    if (
      current?.clientUserId === next?.clientUserId
      && current?.clientContactId === next?.clientContactId
    ) {
      return;
    }
    this.customerIdentity.set(next);
    if (next) this.customerPhone.set(null);
    this.triggerRecalc();
  }

  setLoyaltyProfile(profile: { id: string | null; points: number; conversionRate?: number | null }): void {
    const points = Math.max(0, Math.floor(Number.isFinite(profile.points) ? profile.points : 0));
    const conversionRate = Number(profile.conversionRate);

    this.loyaltyProfileId.set(profile.id);
    this.loyaltyPointsBalance.set(points);
    this.conversionRate.set(Number.isFinite(conversionRate) && conversionRate > 0 ? conversionRate : 1);
    this.setLoyaltyPointsToUse(this.loyaltyPointsToUse());
  }

  buildPricingItems(): PricingRequestItem[] {
    return this.expandedSelectedItems().map(expanded => {
      const printFillPercent = this.inferPrintFillPercent(expanded.item.service);
      return {
        serviceOptionId: expanded.item.service.id,
        quantity: expanded.quantity,
        ...(expanded.pricingGroupKey ? { pricingGroupKey: expanded.pricingGroupKey } : {}),
        ...(printFillPercent !== null ? { printFillPercent } : {}),
      };
    });
  }

  buildSelectedOptions(): PricingSelectedOption[] {
    return this.expandedSelectedItems().map(expanded => {
      const printFillPercent = this.inferPrintFillPercent(expanded.item.service);
      return {
        option_slug: expanded.item.service.slug,
        quantity: expanded.quantity,
        ...(expanded.pricingGroupKey ? { pricing_group_key: expanded.pricingGroupKey } : {}),
        ...(printFillPercent !== null ? { print_fill_percent: printFillPercent } : {}),
      };
    });
  }

  buildPaymentServices(): PaymentServiceItem[] {
    return this.expandedSelectedItems().map(expanded => {
      const peopleSuffix = expanded.personIndex != null
        ? ` — человек ${expanded.personIndex + 1}`
        : '';
      const printFillPercent = this.inferPrintFillPercent(expanded.item.service);
      return {
        id: expanded.item.service.id,
        slug: expanded.item.service.slug,
        name: `${expanded.item.service.name}${peopleSuffix}`,
        price: expanded.item.service.price,
        quantity: expanded.quantity,
        ...(expanded.pricingGroupKey ? { pricingGroupKey: expanded.pricingGroupKey } : {}),
        ...(printFillPercent !== null ? { printFillPercent } : {}),
      };
    });
  }

  buildCartDetails(): PaymentCartDetails {
    const externalCartDetails = this.externalCartDetails();
    const manualAmount = this.manualAmount();
    const selectedLines = this.breakdown().map(line => ({ ...line }));
    const lines = [
      ...(externalCartDetails?.lines.map(line => ({ ...line })) ?? []),
      ...selectedLines,
      ...(manualAmount > 0
        ? [{
            name: 'Дополнительно',
            quantity: 1,
            unitPrice: manualAmount,
            total: manualAmount,
            priceNote: null,
            discountLabel: null,
            discountAmount: 0,
          }]
        : []),
    ];
    const selectedSavings = selectedLines.reduce((sum, line) => sum + line.discountAmount, 0);
    return {
      lines,
      subtotal: this.roundCurrency(lines.reduce((sum, line) => sum + line.total, 0)),
      savings: this.roundCurrency((externalCartDetails?.savings ?? 0) + selectedSavings),
    };
  }

  private clearExternalCartDetails(): void {
    this.externalCartDetails.set(null);
    this.externalCartAmount.set(0);
  }

  private normalizeExternalCartDetails(details: PaymentCartDetails | null): PaymentCartDetails | null {
    if (!details?.lines.length) return null;

    const lines = details.lines
      .map(line => ({
        name: line.name.trim(),
        quantity: Math.max(1, Math.trunc(Number(line.quantity) || 1)),
        unitPrice: this.roundCurrency(Number(line.unitPrice) || 0),
        total: this.roundCurrency(Number(line.total) || 0),
        priceNote: line.priceNote?.trim() || null,
        discountLabel: line.discountLabel?.trim() || null,
        discountAmount: this.roundCurrency(Math.max(0, Number(line.discountAmount) || 0)),
      }))
      .filter(line => line.name.length > 0);
    if (lines.length === 0) return null;

    const lineSubtotal = lines.reduce((sum, line) => sum + line.total, 0);
    const lineSavings = lines.reduce((sum, line) => sum + line.discountAmount, 0);
    return {
      lines,
      subtotal: this.roundCurrency(Number(details.subtotal) || lineSubtotal),
      savings: this.roundCurrency(Math.max(0, Number(details.savings) || lineSavings)),
    };
  }

  private roundCurrency(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
  }

  // ── Pricing API integration ──

  private triggerRecalc(): void {
    const items = this.selectedItems();
    if (items.length === 0) {
      this.waterfallItems.set([]);
      this.apiTotal.set(null);
      this.apiSavings.set(0);
      this.subscriberDiscount.set(null);
      this.accountDiscount.set(null);
      return;
    }
    this.recalcTrigger$.next();
  }

  private async fetchPricing(): Promise<void> {
    const items = this.selectedItems();
    if (items.length === 0) return;

    this.pricingLoading.set(true);

    try {
      const response = await this.pricingApi.calculateV2({
        items: this.buildPricingItems(),
        channel: this.pricingChannel(),
        customerPhone: this.customerPhone() ?? undefined,
        clientUserId: this.customerIdentity()?.clientUserId,
        clientContactId: this.customerIdentity()?.clientContactId,
        applyVolumeDiscount: this.volumeDiscountRequested() || undefined,
      });

      if (response.success) {
        this.waterfallItems.set(response.items);
        this.apiTotal.set(response.total);
        this.apiSavings.set(response.savings);
        this.subscriberDiscount.set(response.discounts?.subscriber ?? null);
        this.accountDiscount.set(response.discounts?.account ?? null);
        this.setLoyaltyPointsToUse(this.loyaltyPointsToUse());
      }
    } catch {
      // On API error, fall back to local calculation
      this.waterfallItems.set([]);
      this.apiTotal.set(null);
      this.apiSavings.set(0);
      this.subscriberDiscount.set(null);
      this.accountDiscount.set(null);
    } finally {
      this.pricingLoading.set(false);
    }
  }

  private aggregateBreakdownForItem(item: SelectedItem, waterfall: readonly WaterfallItem[]): BreakdownItem {
    const matched = waterfall.filter(w => w.serviceOptionId === item.service.id);
    if (matched.length === 0) {
      return {
        name: item.service.name,
        quantity: item.quantity,
        unitPrice: item.service.price,
        total: item.service.price * item.quantity,
        priceNote: null,
        discountLabel: null,
        discountAmount: 0,
      };
    }

    const total = matched.reduce((sum, w) => sum + w.finalPrice, 0);
    const discountAmount = matched.reduce((sum, w) => sum + w.discountAmount, 0);
    const peopleLabel = this.multiPersonLabel(item);
    const waterfallLabel = matched.find(w => w.discountLabel)?.discountLabel ?? null;
    const adjustmentLabels = matched
      .map(w => w.priceAdjustmentNotice ?? w.priceAdjustmentLabel)
      .filter((label): label is string => typeof label === 'string' && label.length > 0);
    const priceNote = Array.from(new Set(adjustmentLabels)).join('; ') || null;
    const discountLabel = peopleLabel
      ? (discountAmount > 0 ? `${peopleLabel}; скидка ${discountAmount}₽` : peopleLabel)
      : waterfallLabel;

    return {
      name: item.service.name,
      quantity: item.quantity,
      unitPrice: item.quantity > 0 ? Math.round(total / item.quantity) : item.service.price,
      total,
      priceNote,
      discountLabel,
      discountAmount,
    };
  }

  private expandedSelectedItems(): readonly ExpandedSelectedItem[] {
    return this.selectedItems().flatMap(item => this.expandSelectedItem(item));
  }

  private expandSelectedItem(item: SelectedItem): readonly ExpandedSelectedItem[] {
    const peopleCount = this.normalizedPeopleCount(item);
    const pricingGroupKey = this.documentPricingGroupKey(item);
    if (peopleCount <= 1) {
      return [{
        item,
        quantity: item.quantity,
        ...(pricingGroupKey ? { pricingGroupKey } : {}),
      }];
    }

    return this.distributeQuantity(item.quantity, peopleCount).map((quantity, index) => ({
      item,
      quantity,
      ...(pricingGroupKey ? { pricingGroupKey: `${pricingGroupKey}:person:${index + 1}` } : {}),
      personIndex: index,
    }));
  }

  private distributeQuantity(quantity: number, peopleCount: number): readonly number[] {
    const base = Math.floor(quantity / peopleCount);
    const remainder = quantity % peopleCount;
    return Array.from({ length: peopleCount }, (_, index) => base + (index < remainder ? 1 : 0));
  }

  private normalizedPeopleCount(item: SelectedItem): number {
    if (!this.isMultiPersonCapable(item)) return 1;
    return this.clampPeopleCount(item.peopleCount ?? 1, item.quantity);
  }

  private clampPeopleCount(peopleCount: number, quantity: number): number {
    const safeQuantity = Math.max(1, Math.floor(quantity || 1));
    const safePeople = Math.max(1, Math.floor(peopleCount || 1));
    return Math.min(safePeople, safeQuantity);
  }

  private isMultiPersonCapable(item: SelectedItem): boolean {
    return item.service.categorySlug === 'photo-docs' && item.service.groupSlug === 'document-type';
  }

  private documentPricingGroupKey(item: SelectedItem): string | null {
    if (!this.isMultiPersonCapable(item)) return null;

    const serviceKey = this.normalizePricingGroupPart(item.service.slug)
      || this.normalizePricingGroupPart(item.service.id);
    return serviceKey ? `document:${serviceKey}` : null;
  }

  private normalizePricingGroupPart(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, '-');
  }

  private inferPrintFillPercent(service: UiServiceOption): number | null {
    const normalizedSlug = service.slug.trim().toLowerCase();
    const fillPercent = PRINT_FILL_PERCENT_BY_SLUG.get(normalizedSlug);
    if (fillPercent !== undefined) return fillPercent;

    const name = service.name.toLowerCase();
    const isA4 = name.includes('а4') || name.includes('a4') || normalizedSlug.includes('а4') || normalizedSlug.includes('a4');
    if (!isA4) return null;

    const match = name.match(/до\s*(15|50|75|100)\s*%/u);
    return match?.[1] ? Number(match[1]) : null;
  }

  private loyaltyPointsRequiredForRubles(amount: number): number {
    const rate = this.conversionRate();
    if (amount <= 0 || rate <= 0) return 0;
    return Math.ceil(amount / rate);
  }

  private isA3PhotoPrintService(service: UiServiceOption): boolean {
    const combined = [
      service.slug,
      service.name,
      service.categorySlug,
      service.groupSlug,
    ].join(' ');
    const normalized = this.normalizeLoyaltyRuleText(combined);
    const isPhotoScope = service.categorySlug === 'photo-print-format'
      || service.categorySlug === 'photo-print'
      || service.groupSlug === 'photo-formats'
      || normalized.includes('фото')
      || normalized.includes('photo');

    return isPhotoScope && this.hasA3Format(normalized);
  }

  private isA3PhotoPrintText(value: string | null | undefined): boolean {
    const normalized = this.normalizeLoyaltyRuleText(value);
    const isPhotoScope = normalized.includes('фото') || normalized.includes('photo');
    return isPhotoScope && this.hasA3Format(normalized);
  }

  private hasA3Format(value: string): boolean {
    return /(^|[^a-zа-я0-9])(a3|а3)([^a-zа-я0-9]|$)/i.test(value)
      || /(^|[^0-9])(29[,.]?7|30)\s*[xх×]\s*(42|40)([^0-9]|$)/i.test(value);
  }

  private isAccountDiscountText(value: string | null | undefined): boolean {
    const normalized = this.normalizeLoyaltyRuleText(value);
    return normalized.includes('личн')
      || normalized.includes('personal')
      || normalized.includes('образоват')
      || normalized.includes('education')
      || normalized.includes('бизнес')
      || normalized.includes('business');
  }

  private normalizeLoyaltyRuleText(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  }

  private multiPersonLabel(item: SelectedItem): string | null {
    const peopleCount = this.normalizedPeopleCount(item);
    if (peopleCount <= 1) return null;

    const quantities = this.distributeQuantity(item.quantity, peopleCount);
    const sameQuantity = quantities.every(q => q === quantities[0]);
    if (sameQuantity) {
      return `${peopleCount} чел. × ${quantities[0]} компл.`;
    }
    return `${peopleCount} чел.: ${quantities.join(', ')} компл.`;
  }
}
