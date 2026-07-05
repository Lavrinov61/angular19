import { Injectable, inject, signal, computed, effect, DestroyRef, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError, firstValueFrom } from 'rxjs';

import { OrdersApiService, type CrmCreateOrderRequest } from '../../services/orders-api.service';
import { PosApiService, type CustomerLookup } from '../../services/pos-api.service';
import { PricingApiService, type WaterfallItem, type WaterfallV2Response, type PromoValidationResult } from '../../../../core/services/pricing-api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { DashboardDataService } from '../../services/dashboard-data.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import type { UploadFile, PaymentMethod } from '../order-wizard/order-wizard.types';
import type { RetouchConfigEvent } from '../../../../shared/components/retouch-configurator/retouch-configurator.component';

/** Slug опции «Супер обработки» в группе processing-level (фикс-цена, бесплатные галочки). */
const PROCESSING_SUPER_SLUG = 'processing-super';

/**
 * Канонический slug группы «уровней обработки». Любая категория с такой группой получает
 * лесенку уровней + конфигуратор «Супер» (photo-docs, portrait, …). Логика category-agnostic:
 * блок опознаётся по наличию этой группы, а не по categorySlug.
 */
const PROCESSING_LEVEL_GROUP = 'processing-level';

// ── Catalog types (from DB) ─────────────────────────────────────────────────

export interface FeatureDef {
  readonly id?: string;
  readonly name: string;
  readonly price?: number;
  readonly tierIndex?: number;
  readonly originTierIndex?: number;
  readonly sortOrder?: number;
}

export interface CatalogOption {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly priceStudio: number;
  readonly basePrice: number;
  readonly estimatedMinutes: number;
  readonly icon: string | null;
  readonly description: string | null;
  readonly features: readonly FeatureDef[];
}

export interface CatalogGroup {
  readonly slug: string;
  readonly name: string;
  readonly selectionType: 'single' | 'multi' | 'quantity';
  readonly isRequired: boolean;
  readonly maxSelections: number;
  readonly options: CatalogOption[];
}

export interface CatalogCategory {
  readonly slug: string;
  readonly name: string;
  readonly icon: string;
  readonly groups: CatalogGroup[];
}

// ── Branded types ───────────────────────────────────────────────────────────

declare const __serviceBlockId: unique symbol;
export type ServiceBlockId = string & { readonly [__serviceBlockId]: true };

// ── Service Block (one block = one service in the order) ────────────────────

export interface BlockOption {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly priceStudio: number;
  readonly basePrice: number;
  readonly estimatedMinutes: number;
  readonly description: string | null;
  readonly features: readonly FeatureDef[];
  quantity: number;
}

export interface BlockGroup {
  readonly slug: string;
  readonly name: string;
  readonly selectionType: 'single' | 'multi' | 'quantity';
  readonly isRequired: boolean;
  options: BlockOption[];
}

export interface ServiceBlock {
  readonly id: string;
  readonly categorySlug: string;
  readonly categoryName: string;
  readonly categoryIcon: string;
  groups: BlockGroup[];
}

// ── Processing sub-options (LIGHT: derived from features[], no DB tables) ────

export interface SubOptionInfo {
  readonly label: string;
  readonly inherited: boolean;
  readonly pricePerFeature: number;
}

// ── Photo-docs specific types ───────────────────────────────────────────────

export interface DocumentTypeOption {
  readonly slug: string;
  readonly name: string;
  readonly icon: string;
  readonly defaultSize: string;
  readonly requiresCountry: boolean;
  readonly customSize: boolean;
}

export const DOCUMENT_TYPE_OPTIONS: readonly DocumentTypeOption[] = [
  { slug: 'passport-rf', name: 'Паспорт РФ', icon: 'credit_card', defaultSize: '3,5×4,5', requiresCountry: false, customSize: false },
  { slug: 'zagranpassport', name: 'Загранпаспорт', icon: 'flight', defaultSize: '3,5×4,5', requiresCountry: false, customSize: false },
  { slug: 'visa', name: 'Виза', icon: 'public', defaultSize: '3,5×4,5', requiresCountry: true, customSize: false },
  { slug: 'greencard', name: 'Гринкарта (Green Card)', icon: 'card_travel', defaultSize: '5×5', requiresCountry: false, customSize: false },
  { slug: 'voditelskie-prava', name: 'Вод. права', icon: 'directions_car', defaultSize: '3×4', requiresCountry: false, customSize: false },
  { slug: 'voennyj-bilet', name: 'Военный билет', icon: 'military_tech', defaultSize: '3×4', requiresCountry: false, customSize: false },
  { slug: 'studencheskij', name: 'Студенческий', icon: 'school', defaultSize: '3×4', requiresCountry: false, customSize: false },
  { slug: 'medknizhka', name: 'Медкнижка', icon: 'local_hospital', defaultSize: '3×4', requiresCountry: false, customSize: false },
  { slug: 'lichnoe-delo', name: 'Личное дело', icon: 'folder_shared', defaultSize: '', requiresCountry: false, customSize: true },
  { slug: 'other', name: 'Другой', icon: 'description', defaultSize: '', requiresCountry: false, customSize: true },
] as const;

export const PHOTO_SIZES = ['3×4', '3,5×4,5', '4×6', '4,5×5', '5×5', '9×12'] as const;

const DEFAULT_SIZES: Record<string, string[]> = {
  'passport-rf': ['3,5×4,5'], 'zagranpassport': ['3,5×4,5'], 'visa': ['3,5×4,5'],
  'greencard': ['5×5'], 'voditelskie-prava': ['3×4'], 'voennyj-bilet': ['3×4'],
  'studencheskij': ['3×4'], 'medknizhka': ['3×4'], 'lichnoe-delo': [], 'other': [],
};

const PRICING_SLUG_MAP: Record<string, string> = {
  'passport-rf': 'passport-rf', 'zagranpassport': 'passport-zagran',
  'visa': 'photo-visa', 'greencard': 'photo-greencard',
  'voditelskie-prava': 'photo-license', 'voennyj-bilet': 'photo-military',
  'studencheskij': 'photo-student', 'medknizhka': 'photo-medbook',
  'lichnoe-delo': 'passport-rf', 'other': 'passport-rf',
};

export interface SizeSet { readonly size: string; readonly quantity: number; }

export interface SelectedDocument {
  readonly option: DocumentTypeOption;
  readonly sizeSets: SizeSet[];
  readonly customSize: string;
  readonly visaCountry: string | null;
}

export interface VisaCountryOption {
  readonly code: string;
  readonly name: string;
  readonly photoSize: string;
}

export const VISA_COUNTRY_OPTIONS: readonly VisaCountryOption[] = [
  { code: 'schengen', name: 'Шенген', photoSize: '3,5×4,5' },
  { code: 'us', name: 'США', photoSize: '5×5' },
  { code: 'cn', name: 'Китай', photoSize: '3,3×4,8' },
  { code: 'gb', name: 'Великобритания', photoSize: '3,5×4,5' },
  { code: 'jp', name: 'Япония', photoSize: '4,5×4,5' },
  { code: 'kr', name: 'Корея', photoSize: '3,5×4,5' },
  { code: 'in', name: 'Индия', photoSize: '5×5' },
  { code: 'th', name: 'Таиланд', photoSize: '3,5×4,5' },
  { code: 'au', name: 'Австралия', photoSize: '3,5×4,5' },
  { code: 'ca', name: 'Канада', photoSize: '5×7' },
  { code: 'br', name: 'Бразилия', photoSize: '5×7' },
] as const;

// ── Chat search ─────────────────────────────────────────────────────────────

export interface ChatSearchResult {
  id: string;
  clientName: string;
  clientPhone: string;
  channel: string;
  preview: string;
  sortTime?: string;
}

interface BuiltOrderItem {
  name: string;
  slug: string;
  service_option_id?: string;
  quantity: number;
  sla_quantity?: number;
  price: number;
  disabled_features?: string[];
}

interface PricingRequestItem {
  readonly serviceOptionId: string;
  readonly quantity: number;
  readonly pricingGroupKey?: string;
  readonly lineKey: string;
}

interface ComboHintView {
  readonly name: string;
  readonly missing: string;
  readonly savings: number;
}

type SlaItem = NonNullable<CrmCreateOrderRequest['sla_items']>[number];

// ── S3 presigned ────────────────────────────────────────────────────────────

interface PresignResponse {
  success: boolean;
  data: { uploads: { s3Key: string; uploadUrl: string; contentType: string }[] };
}

interface ApiErrorLike {
  readonly error?: unknown;
  readonly message?: unknown;
}

function isApiErrorLike(value: unknown): value is ApiErrorLike {
  return typeof value === 'object' && value !== null;
}

// ── Draft persistence ────────────────────────────────────────────────────────

const DRAFT_STORAGE_PREFIX = 'ocf_draft_';
const DRAFT_SAVE_DEBOUNCE = 2000;
const DRAFT_STALE_MS = 24 * 60 * 60 * 1000; // 24h
const LATER_PAYMENT_WITHOUT_CHAT_WARNING =
  'Оплата позже: чат не привязан. Клиент не получит автоматическое сообщение о сроке готовности.';

interface OrderDraft {
  readonly version: 1;
  readonly timestamp: number;
  readonly serviceBlocks: ServiceBlock[];
  readonly selectedDocuments: SelectedDocument[];
  readonly hasFormOverlay: boolean;
  readonly uniformDescription: string;
  readonly hasSuitOverlay: boolean;
  readonly suitWishes: string;
  readonly hasMedals: boolean;
  readonly medalsDescription: string;
  readonly isUrgent: boolean;
  readonly clientPhone: string;
  readonly clientName: string;
  readonly linkedSessionId: string | null;
  readonly linkedSessionName: string | null;
  readonly comment: string;
  readonly disabledFeatures?: readonly (readonly [string, readonly string[]])[];
  readonly retouchConfig?: RetouchConfigEvent | null;
}

// ═════════════════════════════════════════════════════════════════════════════

@Injectable()
export class OrderCreationFormStore {
  private readonly http = inject(HttpClient);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly posApi = inject(PosApiService);
  private readonly pricingApi = inject(PricingApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dashboardData = inject(DashboardDataService);
  private readonly wsService = inject(WebSocketService);

  // ── Catalog (from DB) ─────────────────────────────────────────────────
  readonly categories = signal<CatalogCategory[]>([]);
  readonly showCategoryPicker = signal(false);

  // ── Service blocks (the order) ────────────────────────────────────────
  readonly serviceBlocks = signal<ServiceBlock[]>([]);

  // ── Photo-docs specific state ─────────────────────────────────────────
  readonly selectedDocuments = signal<SelectedDocument[]>([]);
  readonly hasFormOverlay = signal(false);
  readonly uniformDescription = signal('');
  readonly hasSuitOverlay = signal(false);
  readonly suitWishes = signal('');
  readonly hasMedals = signal(false);
  readonly medalsDescription = signal('');

  /** Disabled sub-option labels per block */
  readonly disabledFeatures = signal<ReadonlyMap<ServiceBlockId, readonly string[]>>(new Map());

  /**
   * Конфигуратор «Супер обработки»: выбор галочек ретуши (бесплатные, инструкции ретушёру).
   * Заполняется только когда в processing-level выбран `processing-super`; иначе null.
   */
  readonly retouchConfig = signal<RetouchConfigEvent | null>(null);

  // ── Priority (global) ─────────────────────────────────────────────────
  readonly isUrgent = signal(false);

  // ── Files ─────────────────────────────────────────────────────────────
  readonly clientFiles = signal<UploadFile[]>([]);
  readonly formExampleFiles = signal<UploadFile[]>([]);

  // ── Client ────────────────────────────────────────────────────────────
  readonly clientPhone = signal('');
  readonly clientName = signal('');
  readonly customerLookup = signal<CustomerLookup | null>(null);

  // ── Chat linking ──────────────────────────────────────────────────────
  readonly linkedSessionId = signal<string | null>(null);
  readonly linkedSessionName = signal<string | null>(null);
  readonly showChatPickerPopup = signal(false);
  readonly chatSearchResults = signal<ChatSearchResult[]>([]);

  // ── Comment ───────────────────────────────────────────────────────────
  readonly comment = signal('');

  // ── Promo code ─────────────────────────────────────────────────────────
  readonly promoCode = signal('');
  readonly promoValidation = signal<PromoValidationResult | null>(null);
  readonly promoValidating = signal(false);
  private readonly promoInput$ = new Subject<string>();

  // ── State ─────────────────────────────────────────────────────────────
  readonly submitting = signal(false);
  readonly documentTemplates = computed(() => this.dashboardData.documentTemplates());

  // ── Pricing API ──────────────────────────────────────────────────────
  readonly pricingResult = signal<WaterfallV2Response | null>(null);
  readonly pricingLoading = signal(false);
  private readonly pricingRequest$ = new Subject<void>();

  // ── Draft persistence ────────────────────────────────────────────────
  readonly draftStatus = signal<'idle' | 'saving' | 'saved' | 'restored'>('idle');
  readonly draftTime = signal('');
  readonly draftStale = signal(false);
  private draftKey = DRAFT_STORAGE_PREFIX + 'walkin';
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Streams ───────────────────────────────────────────────────────────
  private readonly phoneSearch$ = new Subject<string>();
  private readonly chatSearchQuery = signal('');
  private readonly chatSearchRefresh$ = new Subject<void>();

  constructor() {
    this.phoneSearch$.pipe(
      debounceTime(500), distinctUntilChanged(),
      switchMap(phone => {
        const cleaned = phone.replace(/\D/g, '');
        // Поиск ТОЛЬКО по полному номеру (11 цифр: 7 + 10) — защита от слива базы
        if (cleaned.length < 11) { this.customerLookup.set(null); return of(null); }
        return this.posApi.lookupCustomer(cleaned).pipe(catchError(() => of(null)));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => {
      this.customerLookup.set(result);
      if (result?.customer_name && !this.clientName()) this.clientName.set(result.customer_name);
    });

    this.chatSearchRefresh$.pipe(
      debounceTime(300),
      switchMap(() => {
        const query = this.chatSearchQuery().trim();
        const params: Record<string, string> = { types: 'chat', limit: '20' };
        if (query.length >= 2) params['search'] = query;
        return this.http.get<{ success: boolean; data: ChatSearchResult[] }>(
          '/api/crm/inbox', { params },
        ).pipe(catchError(() => of({ success: false, data: [] as ChatSearchResult[] })));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(res => this.chatSearchResults.set(res.data ?? []));

    effect(() => {
      const msg = this.wsService.visitorNewMessage();
      if (!msg || !untracked(() => this.showChatPickerPopup())) return;
      this.chatSearchRefresh$.next();
    });

    this.promoInput$.pipe(
      debounceTime(500), distinctUntilChanged(),
      switchMap(code => {
        const trimmed = code.trim();
        if (trimmed.length < 2) {
          this.promoValidation.set(null);
          this.promoValidating.set(false);
          return of(null);
        }
        this.promoValidating.set(true);
        return this.http.get<PromoValidationResult>(
          `/api/promotions/validate/${encodeURIComponent(trimmed)}`,
        ).pipe(catchError(() => of({ valid: false, error: 'Ошибка проверки' } as PromoValidationResult)));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => {
      this.promoValidation.set(result);
      this.promoValidating.set(false);
      this.requestPricing();
    });

    this.pricingRequest$.pipe(
      debounceTime(300),
      switchMap(() => {
        const items = this.collectPricingItems();
        if (items.length === 0) {
          this.pricingResult.set(null);
          return of(null);
        }
        this.pricingLoading.set(true);
        const validPromo = this.promoValidation()?.valid ? this.promoCode().trim() : undefined;
        return of(items).pipe(
          switchMap(i => this.pricingApi.calculateV2({
            items: this.toPricingPayload(i),
            channel: 'crm',
            customerPhone: this.clientPhone()?.replace(/\D/g, '') || undefined,
            promoCode: validPromo,
          })),
          catchError(() => of(null)),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => {
      this.pricingResult.set(result);
      this.pricingLoading.set(false);
    });

    this.loadCategories();
    this.dashboardData.loadDocumentTemplates();
    this.restoreDraft();

    // Auto-save draft when serializable state changes
    effect(() => {
      // Track all serializable signals
      this.serviceBlocks();
      this.selectedDocuments();
      this.hasFormOverlay();
      this.uniformDescription();
      this.hasSuitOverlay();
      this.suitWishes();
      this.hasMedals();
      this.medalsDescription();
      this.isUrgent();
      this.clientPhone();
      this.clientName();
      this.linkedSessionId();
      this.linkedSessionName();
      this.comment();
      this.disabledFeatures();
      this.retouchConfig();

      // Debounced save
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveDraft(), DRAFT_SAVE_DEBOUNCE);
    });

    this.destroyRef.onDestroy(() => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.cleanupFiles();
    });
  }

  // ── Pricing API helpers ──────────────────────────────────────────────

  private requestPricing(): void {
    this.pricingRequest$.next();
  }

  private collectPricingItems(): PricingRequestItem[] {
    const items: PricingRequestItem[] = [];
    for (const block of this.serviceBlocks()) {
      if (block.categorySlug === 'photo-docs') {
        this.collectDocsBlockItems(block, items);
      } else {
        this.collectGenericBlockItems(block, items);
      }
    }
    return items;
  }

  private toPricingPayload(
    items: readonly PricingRequestItem[],
  ): { serviceOptionId: string; quantity: number; pricingGroupKey?: string }[] {
    return items.map(item => item.pricingGroupKey
      ? { serviceOptionId: item.serviceOptionId, quantity: item.quantity, pricingGroupKey: item.pricingGroupKey }
      : { serviceOptionId: item.serviceOptionId, quantity: item.quantity });
  }

  private collectDocsBlockItems(
    block: ServiceBlock,
    items: PricingRequestItem[],
  ): void {
    const docGroup = block.groups.find(g => g.slug === 'document-type');
    for (const doc of this.selectedDocuments()) {
      const dbSlug = PRICING_SLUG_MAP[doc.option.slug] ?? doc.option.slug;
      const opt = docGroup?.options.find(o => o.slug === dbSlug);
      if (!opt?.id) continue;

      if (!doc.option.customSize) {
        this.appendDocumentPricingItem(items, opt, doc, doc.option.defaultSize || 'default', this.documentTotalQty(doc));
        continue;
      }

      let hasDocumentLine = false;
      for (const ss of doc.sizeSets) {
        this.appendDocumentPricingItem(items, opt, doc, ss.size, ss.quantity);
        hasDocumentLine = true;
      }

      const customSize = doc.customSize.trim();
      if (customSize) {
        this.appendDocumentPricingItem(items, opt, doc, customSize, 1);
        hasDocumentLine = true;
      }

      if (!hasDocumentLine) {
        this.appendDocumentPricingItem(items, opt, doc, 'default', 1);
      }
    }

    for (const g of block.groups) {
      if (g.slug === 'document-type') continue;
      for (const o of g.options) {
        if (o.quantity > 0 && o.id) {
          items.push({
            serviceOptionId: o.id,
            quantity: o.quantity,
            lineKey: this.optionLineKey(block.id, g.slug, o.slug),
          });
        }
      }
    }
  }

  private appendDocumentPricingItem(
    items: PricingRequestItem[],
    opt: BlockOption,
    doc: SelectedDocument,
    size: string,
    quantity: number,
  ): void {
    const lineKey = this.documentLineKey(doc.option.slug, size);
    items.push({
      serviceOptionId: opt.id,
      quantity: Math.max(1, quantity),
      pricingGroupKey: lineKey,
      lineKey,
    });
  }

  private collectGenericBlockItems(
    block: ServiceBlock,
    items: PricingRequestItem[],
  ): void {
    for (const g of block.groups) {
      for (const o of g.options) {
        if (o.quantity > 0 && o.id) {
          items.push({
            serviceOptionId: o.id,
            quantity: o.quantity,
            lineKey: this.optionLineKey(block.id, g.slug, o.slug),
          });
        }
      }
    }
  }

  documentLineKey(docSlug: string, size: string | null | undefined): string {
    return `document:${docSlug}:${this.normalizeLineKeyPart(size)}`;
  }

  optionLineKey(blockId: string, groupSlug: string, optionSlug: string): string {
    return `option:${blockId}:${groupSlug}:${optionSlug}`;
  }

  private normalizeLineKeyPart(value: string | null | undefined): string {
    const normalized = (value ?? '').trim().toLowerCase();
    return normalized || 'default';
  }

  private readonly apiLinePriceMap = computed(() => {
    const result = this.pricingResult();
    const map = new Map<string, WaterfallItem>();
    if (!result) return map;

    const requestItems = this.collectPricingItems();
    for (const [index, item] of result.items.entries()) {
      const lineKey = requestItems[index]?.lineKey;
      if (lineKey) map.set(lineKey, item);
    }
    return map;
  });

  apiLinePrice(lineKey: string): WaterfallItem | null {
    return this.apiLinePriceMap().get(lineKey) ?? null;
  }

  readonly apiTotal = computed(() => this.pricingResult()?.total ?? null);
  readonly apiSavings = computed(() => this.pricingResult()?.savings ?? 0);

  /** Applied promo discount from waterfall API */
  readonly promoDiscount = computed(() => this.pricingResult()?.discounts?.promo ?? null);

  /** Promo code was sent but blocked by degressive discount */
  readonly promoBlocked = computed(() => this.pricingResult()?.promoBlocked ?? false);

  /** Combo hints from pricing API — partially matched combos for cross-sell */
  readonly comboHints = computed<readonly ComboHintView[]>(() => {
    const combos = this.pricingResult()?.detectedCombos;
    if (!combos) return [];
    return combos
      .filter(c => c.missing_option_slugs.length > 0)
      .map(c => {
        const savings = c.original_total === null ? 0 : c.original_total - c.combo_price;
        return {
          name: c.name,
          missing: c.missing_option_slugs.join(', '),
          savings,
        };
      })
      .filter(h => h.savings > 0);
  });

  // ── Pricing local helpers ──────────────────────────────────────────

  /** Get price_studio for an option within a block */
  private findBlockOptionPrice(block: ServiceBlock, groupSlug: string, optionSlug: string): number {
    const group = block.groups.find(g => g.slug === groupSlug);
    return group?.options.find(o => o.slug === optionSlug)?.priceStudio ?? 0;
  }

  /** Sum selected options in a generic block */
  blockSubtotal(block: ServiceBlock): number {
    let total = 0;
    for (const g of block.groups) {
      for (const o of g.options) {
        if (o.quantity > 0) total += o.priceStudio * o.quantity;
      }
    }
    return total;
  }

  /** Photo-docs block: find the photo-docs block if it exists */
  private getDocsBlock(): ServiceBlock | undefined {
    return this.serviceBlocks().find(b => b.categorySlug === 'photo-docs');
  }

  /**
   * Блок с группой уровней обработки (`processing-level`) — category-agnostic.
   * Если передан `blockId` — возвращает именно его (нужно денежным методам, когда в заказе
   * может быть несколько блоков с уровнями, напр. photo-docs + portrait). Без `blockId` —
   * первый найденный (для computed'ов, где блок единственный или порядок не важен).
   */
  private getProcessingBlock(blockId?: string): ServiceBlock | undefined {
    const hasLevels = (b: ServiceBlock): boolean => b.groups.some(g => g.slug === PROCESSING_LEVEL_GROUP);
    if (blockId) {
      const block = this.serviceBlocks().find(b => b.id === blockId);
      return block && hasLevels(block) ? block : undefined;
    }
    return this.serviceBlocks().find(hasLevels);
  }

  /** Document type price from photo-docs block */
  getDocumentPrice(formSlug: string): number {
    const block = this.getDocsBlock();
    if (!block) return 0;
    const dbSlug = PRICING_SLUG_MAP[formSlug] ?? formSlug;
    return this.findBlockOptionPrice(block, 'document-type', dbSlug);
  }

  /** Speed surcharge — flat amount added to the whole order (not per-set) */
  readonly speedSurcharge = computed(() => {
    const block = this.getDocsBlock();
    if (!block) return 0;
    return this.findBlockOptionPrice(block, 'speed', 'urgent');
  });

  /** Per-set price (document base price only, speed is added once to grand total) */
  setPrice(formSlug: string): number {
    return this.getDocumentPrice(formSlug);
  }

  // ── Computed ──────────────────────────────────────────────────────────

  readonly documentTypeOptions = computed(() => DOCUMENT_TYPE_OPTIONS);
  readonly visaCountryOptions = computed(() => VISA_COUNTRY_OPTIONS);
  readonly photoSizes = computed(() => PHOTO_SIZES);

  readonly hasDocsBlock = computed(() => this.serviceBlocks().some(b => b.categorySlug === 'photo-docs'));

  /** Price of "uniform" (Подстановка формы) from DB extras group */
  readonly uniformPrice = computed(() => {
    const block = this.getDocsBlock();
    if (!block) return 290;
    const extras = block.groups.find(g => g.slug === 'extras');
    return extras?.options.find(o => o.slug === 'uniform')?.priceStudio ?? 290;
  });

  /**
   * Sub-options for each processing tier, derived from features[].
   * Feature-Level Pricing v2: inherited определяется через `originTierIndex < tierIndex`,
   * цена — per feature (f.price). Fallback (legacy string[]): inherited — по имени
   * относительно предыдущего tier'а, цена — avg (priceDiff / newFeatures.length).
   */
  readonly processingTierSubs = computed((): ReadonlyMap<string, readonly SubOptionInfo[]> => {
    const block = this.getProcessingBlock();
    if (!block) return new Map();
    const group = block.groups.find(g => g.slug === PROCESSING_LEVEL_GROUP);
    if (!group) return new Map();

    const sorted = [...group.options].sort((a, b) => a.priceStudio - b.priceStudio);
    const result = new Map<string, SubOptionInfo[]>();
    let prevNames: readonly string[] = [];
    let prevPrice = 0;

    for (let i = 0; i < sorted.length; i++) {
      const opt = sorted[i];
      if (!opt.features.length) { result.set(opt.slug, []); prevPrice = opt.priceStudio; continue; }

      // v2: feature metadata carries tierIndex/originTierIndex → используем inheritance по индексу
      const hasV2 = opt.features.some(f => typeof f.tierIndex === 'number' && typeof f.originTierIndex === 'number');
      if (hasV2) {
        const currentTier = opt.features[0]?.tierIndex ?? i;
        result.set(opt.slug, opt.features.map(f => {
          const isInherited = (f.originTierIndex ?? currentTier) < currentTier;
          return {
            label: f.name,
            inherited: isInherited,
            pricePerFeature: isInherited ? 0 : (f.price ?? 0),
          };
        }));
      } else {
        // Legacy fallback: name-based inheritance + avg price
        const inherited = prevNames;
        const newFeatures = opt.features.filter(f => !inherited.includes(f.name));
        const priceDiff = opt.priceStudio - prevPrice;
        const avgPerFeature = newFeatures.length > 0 ? Math.round(priceDiff / newFeatures.length) : 0;

        result.set(opt.slug, [
          ...inherited.map(name => ({ label: name, inherited: true, pricePerFeature: 0 })),
          ...newFeatures.map(f => ({
            label: f.name,
            inherited: false,
            pricePerFeature: typeof f.price === 'number' ? f.price : avgPerFeature,
          })),
        ]);
      }

      prevNames = opt.features.map(f => f.name);
      prevPrice = opt.priceStudio;
    }
    return result;
  });

  /** Adjusted price of processing tier after disabling sub-options */
  processingAdjustedPrice(blockId: string, tierSlug: string): number {
    const opt = this.getProcessingBlock(blockId)?.groups
      .find(g => g.slug === PROCESSING_LEVEL_GROUP)?.options
      .find(o => o.slug === tierSlug);
    if (!opt) return 0;
    // «Супер обработка» = фикс-цена; галочки нашего конфигуратора бесплатны и НЕ вычитают.
    if (tierSlug === PROCESSING_SUPER_SLUG) return opt.priceStudio;
    // Уровень без скидочных под-фич (portrait, либо «без обработки») → полная цена уровня,
    // вычитать нечего. Для photo-docs basic/extended/max subs всегда есть → идём в расчёт скидок.
    const subs = this.processingTierSubs().get(tierSlug);
    if (!subs?.length) return opt.priceStudio;
    const disabled = this.disabledFeatures().get(blockId as ServiceBlockId) ?? [];
    let discount = 0;
    for (const sub of subs) {
      if (!sub.inherited && disabled.includes(sub.label)) discount += sub.pricePerFeature;
    }
    return Math.max(0, opt.priceStudio - discount);
  }

  toggleSubOption(blockId: string, featureLabel: string): void {
    this.disabledFeatures.update(prev => {
      const key = blockId as ServiceBlockId;
      const current = prev.get(key) ?? [];
      const updated = current.includes(featureLabel)
        ? current.filter(f => f !== featureLabel)
        : [...current, featureLabel];
      return new Map(prev).set(key, updated);
    });
    this.requestPricing();
  }

  isSubOptionDisabled(blockId: string, featureLabel: string): boolean {
    return (this.disabledFeatures().get(blockId as ServiceBlockId) ?? []).includes(featureLabel);
  }

  /** Снимок конфигуратора «Супер обработки» (галочки бесплатны — на цену не влияют). */
  setRetouchConfig(config: RetouchConfigEvent | null): void {
    this.retouchConfig.set(config);
  }

  /** Names of disabled non-inherited features for the given tier (used in payload) */
  private disabledFeaturesForTier(blockId: string, tierSlug: string): string[] {
    const subs = this.processingTierSubs().get(tierSlug) ?? [];
    const all = this.disabledFeatures().get(blockId as ServiceBlockId) ?? [];
    return subs.filter(s => !s.inherited && all.includes(s.label)).map(s => s.label);
  }

  documentTotalQty(doc: SelectedDocument): number {
    return doc.sizeSets.reduce((sum, s) => sum + s.quantity, 0) || 1;
  }

  documentLineTotal(doc: SelectedDocument): number {
    return this.setPrice(doc.option.slug) * this.documentTotalQty(doc);
  }

  /** Photo-docs: sum of all document sets */
  readonly docsSetTotal = computed(() =>
    this.selectedDocuments().reduce((sum, d) => sum + this.documentLineTotal(d), 0),
  );

  /** Photo-docs subtotal = sets + selected options from processing/extras */
  readonly docsSubtotal = computed(() => {
    const block = this.getDocsBlock();
    if (!block || this.selectedDocuments().length === 0) return 0;
    let total = this.docsSetTotal();
    // Add processing-level & extras from block (retouch, speed already in setPrice for speed)
    for (const g of block.groups) {
      if (g.slug === 'document-type' || g.slug === 'speed') continue; // handled separately
      for (const o of g.options) {
        if (o.quantity <= 0) continue;
        // processing-level: use adjusted price (respects disabled sub-features)
        if (g.slug === 'processing-level') {
          total += this.processingAdjustedPrice(block.id, o.slug) * o.quantity;
        } else {
          total += o.priceStudio * o.quantity;
        }
      }
    }
    return total;
  });

  /** Grand total across all blocks — backend calculates everything via pricing API */
  readonly grandTotal = computed(() => {
    const apiT = this.apiTotal();
    if (apiT !== null) {
      return apiT + (this.isUrgent() ? this.speedSurcharge() : 0);
    }
    // Local fallback only when API is unavailable
    let total = 0;
    for (const block of this.serviceBlocks()) {
      if (block.categorySlug === 'photo-docs') {
        total += this.docsSubtotal();
      } else {
        total += this.blockSubtotal(block);
      }
    }
    if (this.isUrgent()) total += this.speedSurcharge();
    return total;
  });

  readonly hasVisa = computed(() => this.selectedDocuments().some(d => d.option.slug === 'visa'));
  readonly hasZagran = computed(() => this.selectedDocuments().some(d => d.option.slug === 'zagranpassport'));
  readonly hasGreenCard = computed(() => this.selectedDocuments().some(d => d.option.slug === 'greencard'));
  readonly showZagranAlert = computed(() => this.hasZagran() || this.hasVisa());

  readonly estimatedSlaMinutes = computed(() => this.calculateLocalSlaMinutes());
  readonly estimatedTime = computed(() => this.formatSlaMinutes(this.estimatedSlaMinutes()));

  readonly canSubmit = computed(() => {
    if (this.submitting()) return false;
    if (this.serviceBlocks().length === 0) return false;
    if (this.hasDocsBlock() && this.selectedDocuments().length === 0) return false;
    return true;
  });

  readonly docNormalSetPrice = computed(() => this.getDocumentPrice('passport-rf'));

  private clientImageWorkUnits(): number {
    const imageCount = this.clientFiles().filter(file => file.isImage).length;
    return Math.max(1, imageCount);
  }

  private shouldScaleByUploadedImages(block: ServiceBlock, group: BlockGroup, option: BlockOption): boolean {
    if ((option.estimatedMinutes ?? 0) <= 0 || group.selectionType !== 'single') return false;
    if (group.slug === 'speed') return false;
    if (this.clientImageWorkUnits() <= 1) return false;
    return block.categorySlug === 'photo-docs'
      || block.categorySlug.includes('retouch')
      || block.categorySlug.includes('restore')
      || group.slug.includes('processing')
      || group.slug.includes('retouch');
  }

  private slaUnitsForOption(block: ServiceBlock, group: BlockGroup, option: BlockOption): number {
    const optionQty = Math.max(1, option.quantity || 1);
    if (this.shouldScaleByUploadedImages(block, group, option)) {
      return Math.max(optionQty, this.clientImageWorkUnits());
    }
    return optionQty;
  }

  private appendSlaItem(items: SlaItem[], option: BlockOption | undefined, quantity: number, slaQuantity?: number): void {
    if (!option?.id) return;
    const safeQuantity = Math.max(1, Math.floor(quantity || 1));
    const safeSlaQuantity = slaQuantity ? Math.max(1, Math.floor(slaQuantity)) : undefined;
    items.push({
      service_option_id: option.id,
      quantity: safeQuantity,
      ...(safeSlaQuantity && safeSlaQuantity !== safeQuantity ? { sla_quantity: safeSlaQuantity } : {}),
    });
  }

  private appendPhotoDocsSpeedSla(items: SlaItem[], block: ServiceBlock): void {
    const speedGroup = block.groups.find(group => group.slug === 'speed');
    const speedSlug = this.isUrgent() ? 'urgent' : 'normal';
    const speedOption = speedGroup?.options.find(option => option.slug === speedSlug);
    this.appendSlaItem(items, speedOption, 1);
  }

  private buildSlaItems(): SlaItem[] {
    const items: SlaItem[] = [];

    for (const block of this.serviceBlocks()) {
      if (block.categorySlug === 'photo-docs') {
        const docGroup = block.groups.find(group => group.slug === 'document-type');
        for (const doc of this.selectedDocuments()) {
          const dbSlug = PRICING_SLUG_MAP[doc.option.slug] ?? doc.option.slug;
          const option = docGroup?.options.find(o => o.slug === dbSlug);
          this.appendSlaItem(items, option, this.documentTotalQty(doc));
        }
        this.appendPhotoDocsSpeedSla(items, block);
      }

      for (const group of block.groups) {
        if (block.categorySlug === 'photo-docs' && (group.slug === 'document-type' || group.slug === 'speed')) continue;
        for (const option of group.options) {
          if (option.quantity <= 0) continue;
          this.appendSlaItem(items, option, option.quantity, this.slaUnitsForOption(block, group, option));
        }
      }
    }

    return items;
  }

  private calculateLocalSlaMinutes(): number | null {
    const buckets = new Map<string, { maxSingle: number; sumMulti: number; sumQuantity: number }>();

    const add = (block: ServiceBlock, group: BlockGroup, option: BlockOption, quantity: number): void => {
      const contribution = Math.max(0, option.estimatedMinutes ?? 0) * Math.max(1, Math.floor(quantity || 1));
      if (contribution <= 0) return;
      const bucket = buckets.get(block.categorySlug) ?? { maxSingle: 0, sumMulti: 0, sumQuantity: 0 };
      if (group.selectionType === 'multi') bucket.sumMulti += contribution;
      else if (group.selectionType === 'quantity') bucket.sumQuantity += contribution;
      else bucket.maxSingle = Math.max(bucket.maxSingle, contribution);
      buckets.set(block.categorySlug, bucket);
    };

    for (const block of this.serviceBlocks()) {
      if (block.categorySlug === 'photo-docs') {
        const docGroup = block.groups.find(group => group.slug === 'document-type');
        if (docGroup) {
          for (const doc of this.selectedDocuments()) {
            const dbSlug = PRICING_SLUG_MAP[doc.option.slug] ?? doc.option.slug;
            const option = docGroup.options.find(o => o.slug === dbSlug);
            if (option) add(block, docGroup, option, this.documentTotalQty(doc));
          }
        }

        const speedGroup = block.groups.find(group => group.slug === 'speed');
        const speedOption = speedGroup?.options.find(option => option.slug === (this.isUrgent() ? 'urgent' : 'normal'));
        if (speedGroup && speedOption) add(block, speedGroup, speedOption, 1);
      }

      for (const group of block.groups) {
        if (block.categorySlug === 'photo-docs' && (group.slug === 'document-type' || group.slug === 'speed')) continue;
        for (const option of group.options) {
          if (option.quantity <= 0) continue;
          add(block, group, option, this.slaUnitsForOption(block, group, option));
        }
      }
    }

    let total = 0;
    for (const bucket of buckets.values()) {
      total += bucket.maxSingle + bucket.sumMulti + bucket.sumQuantity;
    }
    return total > 0 ? total : null;
  }

  private formatSlaMinutes(minutes: number | null): string {
    if (!minutes) return 'срок по SLA';
    if (minutes < 60) return `${minutes} мин`;
    if (minutes < 24 * 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
    }
    const days = Math.floor(minutes / (24 * 60));
    const restHours = Math.round((minutes % (24 * 60)) / 60);
    return restHours > 0 ? `${days} д ${restHours} ч` : `${days} д`;
  }

  // ── Block management ──────────────────────────────────────────────────

  addBlock(categorySlug: string): void {
    const cat = this.categories().find(c => c.slug === categorySlug);
    if (!cat) return;
    // Only one photo-docs block allowed
    if (categorySlug === 'photo-docs' && this.hasDocsBlock()) return;
    const block: ServiceBlock = {
      id: crypto.randomUUID(),
      categorySlug: cat.slug,
      categoryName: cat.name,
      categoryIcon: cat.icon,
      groups: cat.groups.map(g => ({
        slug: g.slug, name: g.name,
        selectionType: g.selectionType, isRequired: g.isRequired,
        options: g.options.map(o => ({
          id: o.id,
          slug: o.slug,
          name: o.name,
          priceStudio: o.priceStudio,
          basePrice: o.basePrice,
          estimatedMinutes: o.estimatedMinutes,
          description: o.description,
          features: o.features,
          quantity: 0,
        })),
      })),
    };
    this.serviceBlocks.update(blocks => [...blocks, block]);
    this.showCategoryPicker.set(false);
    this.requestPricing();
  }

  removeBlock(id: string): void {
    const block = this.serviceBlocks().find(b => b.id === id);
    if (block?.categorySlug === 'photo-docs') {
      this.selectedDocuments.set([]);
      this.hasFormOverlay.set(false);
      this.uniformDescription.set('');
      this.hasSuitOverlay.set(false);
      this.suitWishes.set('');
      this.hasMedals.set(false);
      this.medalsDescription.set('');
      this.retouchConfig.set(null);
    }
    // Clean up disabled features for removed block
    this.disabledFeatures.update(prev => {
      const next = new Map(prev);
      next.delete(id as ServiceBlockId);
      return next;
    });
    this.serviceBlocks.update(blocks => blocks.filter(b => b.id !== id));
    this.requestPricing();
  }

  setBlockOption(blockId: string, groupSlug: string, optionSlug: string, qty: number): void {
    const clamped = Math.max(0, Math.min(99, qty));
    // Смена уровня обработки на не-Супер → сбросить конфигуратор ретуши (страховка;
    // компонент сам эмитит null при active→false, но при смене single-выбора это надёжнее).
    if (groupSlug === 'processing-level' && (clamped <= 0 || optionSlug !== PROCESSING_SUPER_SLUG)) {
      this.retouchConfig.set(null);
    }
    this.serviceBlocks.update(blocks => blocks.map(b => {
      if (b.id !== blockId) return b;
      return {
        ...b,
        groups: b.groups.map(g => {
          if (g.slug !== groupSlug) return g;
          if (g.selectionType === 'single') {
            return { ...g, options: g.options.map(o => ({ ...o, quantity: o.slug === optionSlug ? (clamped > 0 ? 1 : 0) : 0 })) };
          }
          return { ...g, options: g.options.map(o => o.slug === optionSlug ? { ...o, quantity: clamped } : o) };
        }),
      };
    }));
    this.requestPricing();
  }

  toggleBlockOption(blockId: string, groupSlug: string, optionSlug: string): void {
    const block = this.serviceBlocks().find(b => b.id === blockId);
    if (!block) return;
    const group = block.groups.find(g => g.slug === groupSlug);
    const opt = group?.options.find(o => o.slug === optionSlug);
    this.setBlockOption(blockId, groupSlug, optionSlug, (opt?.quantity ?? 0) > 0 ? 0 : 1);
  }

  /** Toggle form overlay — syncs hasFormOverlay signal with DB 'uniform' option in extras group */
  toggleFormOverlay(blockId: string): void {
    const newVal = !this.hasFormOverlay();
    this.hasFormOverlay.set(newVal);
    // Sync with DB-driven 'uniform' option in 'extras' group for pricing
    const block = this.serviceBlocks().find(b => b.id === blockId);
    if (block) {
      const extrasGroup = block.groups.find(g => g.slug === 'extras');
      if (extrasGroup?.options.some(o => o.slug === 'uniform')) {
        this.setBlockOption(blockId, 'extras', 'uniform', newVal ? 1 : 0);
      }
    }
  }

  // ── Photo-docs specific ───────────────────────────────────────────────

  toggleDocument(option: DocumentTypeOption): void {
    const current = this.selectedDocuments();
    const exists = current.find(d => d.option.slug === option.slug);
    if (exists) {
      this.selectedDocuments.set(current.filter(d => d.option.slug !== option.slug));
    } else {
      const defaultSizes = DEFAULT_SIZES[option.slug] ?? [];
      this.selectedDocuments.set([...current, {
        option, sizeSets: defaultSizes.map(s => ({ size: s, quantity: 1 })),
        customSize: '', visaCountry: null,
      }]);
    }
    this.requestPricing();
  }

  isDocumentSelected(slug: string): boolean {
    return this.selectedDocuments().some(d => d.option.slug === slug);
  }

  toggleDocumentSize(slug: string, size: string): void {
    this.selectedDocuments.update(docs => docs.map(d => {
      if (d.option.slug !== slug) return d;
      const has = d.sizeSets.some(s => s.size === size);
      return { ...d, sizeSets: has ? d.sizeSets.filter(s => s.size !== size) : [...d.sizeSets, { size, quantity: 1 }] };
    }));
    this.requestPricing();
  }

  setSizeQuantity(docSlug: string, size: string, qty: number): void {
    const clamped = Math.max(1, Math.min(99, qty));
    this.selectedDocuments.update(docs => docs.map(d => {
      if (d.option.slug !== docSlug) return d;
      return { ...d, sizeSets: d.sizeSets.map(s => s.size === size ? { ...s, quantity: clamped } : s) };
    }));
    this.requestPricing();
  }

  setCustomDocSize(slug: string, size: string): void {
    this.selectedDocuments.update(docs => docs.map(d => d.option.slug === slug ? { ...d, customSize: size } : d));
  }

  getDocSizes(slug: string): string[] {
    return this.selectedDocuments().find(d => d.option.slug === slug)?.sizeSets.map(s => s.size) ?? [];
  }

  getDocSizeSets(slug: string): SizeSet[] {
    return this.selectedDocuments().find(d => d.option.slug === slug)?.sizeSets ?? [];
  }

  getDocCustomSize(slug: string): string {
    return this.selectedDocuments().find(d => d.option.slug === slug)?.customSize ?? '';
  }

  getSizeQty(docSlug: string, size: string): number {
    return this.getDocSizeSets(docSlug).find(s => s.size === size)?.quantity ?? 1;
  }

  setVisaCountry(code: string): void {
    const country = VISA_COUNTRY_OPTIONS.find(c => c.code === code);
    if (!country) return;
    this.selectedDocuments.update(docs => docs.map(d => {
      if (d.option.slug !== 'visa') return d;
      const hasSizeSet = d.sizeSets.some(s => s.size === country.photoSize);
      const newSizeSets = d.sizeSets.length === 0
        ? [{ size: country.photoSize, quantity: 1 }]
        : (hasSizeSet ? d.sizeSets : [...d.sizeSets, { size: country.photoSize, quantity: 1 }]);
      return { ...d, visaCountry: code, sizeSets: newSizeSets };
    }));
  }

  // ── Files ─────────────────────────────────────────────────────────────

  addClientFiles(files: File[]): void {
    const additions: UploadFile[] = files.map(f => ({
      id: crypto.randomUUID(), file: f, name: f.name,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
      isImage: f.type.startsWith('image/'),
    }));
    this.clientFiles.update(existing => [...existing, ...additions]);
  }

  removeClientFile(id: string): void {
    const file = this.clientFiles().find(f => f.id === id);
    if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
    this.clientFiles.update(files => files.filter(f => f.id !== id));
  }

  addFormExampleFiles(files: File[]): void {
    const additions: UploadFile[] = files.map(f => ({
      id: crypto.randomUUID(), file: f, name: f.name,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
      isImage: f.type.startsWith('image/'),
    }));
    this.formExampleFiles.update(existing => [...existing, ...additions]);
  }

  removeFormExampleFile(id: string): void {
    const file = this.formExampleFiles().find(f => f.id === id);
    if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
    this.formExampleFiles.update(files => files.filter(f => f.id !== id));
  }

  /** Formatted display for phone input (without +7 prefix) */
  readonly phoneDisplay = computed(() => {
    const raw = this.clientPhone().replace(/\D/g, '');
    // Remove leading 7 or 8 if present
    const digits = raw.replace(/^[78]/, '');
    if (!digits) return '';
    const p = digits.padEnd(10, '');
    let result = '(' + p.slice(0, 3);
    if (digits.length > 3) result += ') ' + p.slice(3, 6);
    else result += ')';
    if (digits.length > 6) result += '-' + p.slice(6, 8);
    if (digits.length > 8) result += '-' + p.slice(8, 10);
    return result.replace(/[() -]+$/, '');
  });

  onPhoneInput(formatted: string): void {
    const digits = formatted.replace(/\D/g, '').slice(0, 10);
    const full = digits ? '7' + digits : '';
    this.clientPhone.set(full ? '+' + full : '');
    this.phoneSearch$.next(this.clientPhone());
  }

  /** @deprecated — use onPhoneInput */
  onPhoneChange(phone: string): void {
    this.clientPhone.set(phone);
    this.phoneSearch$.next(phone);
  }

  // ── Promo code ──────────────────────────────────────────────────────

  onPromoInput(code: string): void {
    this.promoCode.set(code);
    if (!code.trim()) {
      this.promoValidation.set(null);
      this.promoValidating.set(false);
      this.requestPricing();
      return;
    }
    this.promoInput$.next(code);
  }

  clearPromo(): void {
    this.promoCode.set('');
    this.promoValidation.set(null);
    this.promoValidating.set(false);
    this.requestPricing();
  }

  // ── Chat linking ──────────────────────────────────────────────────────

  linkChat(sessionId: string, clientName: string): void {
    this.linkedSessionId.set(sessionId);
    this.linkedSessionName.set(clientName);
    this.showChatPickerPopup.set(false);
    this.chatSearchQuery.set('');
    this.chatSearchResults.set([]);
  }

  unlinkChat(): void {
    this.linkedSessionId.set(null);
    this.linkedSessionName.set(null);
  }

  openChatPicker(): void {
    this.showChatPickerPopup.set(true);
    this.chatSearchQuery.set('');
    this.chatSearchRefresh$.next();
  }

  closeChatPicker(): void {
    this.showChatPickerPopup.set(false);
    this.chatSearchQuery.set('');
    this.chatSearchResults.set([]);
  }

  searchChats(query: string): void {
    this.chatSearchQuery.set(query);
    this.chatSearchRefresh$.next();
  }

  selectChatFromSearch(item: ChatSearchResult): void {
    this.linkChat(item.id, item.clientName || item.clientPhone || 'Чат');
    // Always update phone/name when switching client — previous values must be replaced
    if (item.clientPhone) {
      this.clientPhone.set(item.clientPhone);
      this.phoneSearch$.next(item.clientPhone);
    } else {
      this.clientPhone.set('');
      this.customerLookup.set(null);
    }
    this.clientName.set(item.clientName || '');
  }

  initFromContext(phone: string, name: string, sessionId: string): void {
    // Update draft key for session-specific drafts
    if (sessionId) this.updateDraftKey(sessionId);
    if (phone) { this.clientPhone.set(phone); this.phoneSearch$.next(phone); }
    if (name) this.clientName.set(name);
    if (sessionId) this.linkChat(sessionId, name);
  }

  warnIfLaterPaymentWithoutChat(method: PaymentMethod): boolean {
    if (method !== 'later' || this.linkedSessionId()) return false;
    this.toast.warning(LATER_PAYMENT_WITHOUT_CHAT_WARNING);
    return true;
  }

  // ── Submit ────────────────────────────────────────────────────────────

  async submitPayment(method: PaymentMethod): Promise<{ orderId: string; orderNumber: string } | null> {
    if (this.submitting()) return null;
    this.submitting.set(true);

    try {
      const clientFilesList = this.clientFiles();
      const formFilesList = this.formExampleFiles();
      let uploadedClientFiles: { s3Key: string; s3Url: string; fileName: string }[] = [];
      let uploadedFormFiles: { s3Key: string; s3Url: string; fileName: string }[] = [];
      if (clientFilesList.length > 0) uploadedClientFiles = await this.uploadFilesToS3(clientFilesList);
      if (formFilesList.length > 0) uploadedFormFiles = await this.uploadFilesToS3(formFilesList);

      const items = this.buildOrderItems();
      const description = this.buildDescription();

      const appliedPromo = this.promoDiscount() ? this.promoCode().trim() : undefined;
      const primaryDoc = this.selectedDocuments()[0];
      const documentTemplateId = primaryDoc
        ? this.dashboardData.resolveDocumentTemplateId(primaryDoc.option.slug, primaryDoc.visaCountry ?? null)
        : null;
      const photoSize = primaryDoc
        ? (primaryDoc.customSize.trim() || primaryDoc.sizeSets[0]?.size || primaryDoc.option.defaultSize || null)
        : null;
      const res = await firstValueFrom(this.ordersApi.createCrmOrder({
        items, total_price: this.grandTotal(), description,
        sla_items: this.buildSlaItems(),
        client_name: this.clientName() || undefined,
        client_phone: this.clientPhone() || undefined,
        chat_session_id: this.linkedSessionId() || undefined,
        priority: this.isUrgent() ? 'urgent' : 'normal',
        comment: this.comment() || undefined,
        source: this.linkedSessionId() ? 'chat' : 'walk_in',
        payment_method: method,
        promo_code: appliedPromo,
        retouch_config: this.retouchConfig() ?? undefined,
        wishes: this.suitWishes() || undefined,
        medals_required: this.hasMedals() || undefined,
        medals_description: this.medalsDescription() || undefined,
        uniform_description: this.hasFormOverlay() ? (this.uniformDescription() || undefined) : undefined,
        document_template_id: documentTemplateId ?? undefined,
        photo_size: photoSize ?? undefined,
      }));

      if (uploadedClientFiles.length > 0) {
        await firstValueFrom(this.http.post('/api/orders/photo-print/attachments/complete', {
          orderId: res.data.orderId,
          attachment_type: 'client_photo',
          files: uploadedClientFiles.map(f => ({ s3Key: f.s3Key, fileName: f.fileName, contentType: 'image/jpeg', fileSize: 0 })),
        }));
      }
      if (uploadedFormFiles.length > 0) {
        await firstValueFrom(this.http.post('/api/orders/photo-print/attachments/complete', {
          orderId: res.data.orderId,
          attachment_type: 'form_sample',
          files: uploadedFormFiles.map(f => ({ s3Key: f.s3Key, fileName: f.fileName, contentType: 'image/jpeg', fileSize: 0 })),
        }));
      }

      this.submitting.set(false);
      this.toast.success(`Заказ ${res.data.orderNumber} создан`);
      const result = { orderId: res.data.orderId, orderNumber: res.data.orderNumber };
      this.resetForm();
      return result;
    } catch (err: unknown) {
      this.submitting.set(false);
      this.toast.error(this.getApiErrorMessage(err, 'Ошибка создания заказа'));
      return null;
    }
  }

  private getApiErrorMessage(err: unknown, fallback: string): string {
    const error = isApiErrorLike(err) ? err : null;
    const body = error?.error;

    if (typeof body === 'string') {
      try {
        const parsed: unknown = JSON.parse(body);
        if (isApiErrorLike(parsed)) {
          const parsedMessage = parsed.error ?? parsed.message;
          if (typeof parsedMessage === 'string' && parsedMessage.trim()) return parsedMessage;
        }
      } catch {
        if (body.trim()) return body;
      }
    }

    if (isApiErrorLike(body)) {
      const message = body.error ?? body.message;
      if (typeof message === 'string' && message.trim()) return message;
    }

    if (typeof error?.message === 'string' && error.message.trim()) return error.message;
    return fallback;
  }

  // ── Private: build ────────────────────────────────────────────────────

  private buildOrderItems(): BuiltOrderItem[] {
    const items: BuiltOrderItem[] = [];

    for (const block of this.serviceBlocks()) {
      if (block.categorySlug === 'photo-docs') {
        // Document sets — resolve service_option_id from block's document-type group
        const docGroup = block.groups.find(g => g.slug === 'document-type');
        for (const doc of this.selectedDocuments()) {
          const visaPart = doc.visaCountry
            ? ` (${VISA_COUNTRY_OPTIONS.find(c => c.code === doc.visaCountry)?.name ?? doc.visaCountry})`
            : '';
          const docPrice = this.setPrice(doc.option.slug);
          const dbSlug = PRICING_SLUG_MAP[doc.option.slug] ?? doc.option.slug;
          const docOpt = docGroup?.options.find(o => o.slug === dbSlug);
          const docOptionId = docOpt?.id || undefined;
          if (doc.option.customSize) {
            for (const ss of doc.sizeSets) {
              items.push({ name: `${doc.option.name} ${ss.size}${visaPart}`, slug: doc.option.slug, service_option_id: docOptionId, quantity: ss.quantity, price: docPrice });
            }
            const customSize = doc.customSize.trim();
            if (customSize) items.push({ name: `${doc.option.name} ${customSize}${visaPart}`, slug: doc.option.slug, service_option_id: docOptionId, quantity: 1, price: docPrice });
            if (doc.sizeSets.length === 0 && !customSize) {
              items.push({ name: `${doc.option.name}${visaPart}`, slug: doc.option.slug, service_option_id: docOptionId, quantity: 1, price: docPrice });
            }
          } else {
            const sizeLabel = doc.option.defaultSize ? ` ${doc.option.defaultSize}` : '';
            items.push({ name: `${doc.option.name}${sizeLabel}${visaPart}`, slug: doc.option.slug, service_option_id: docOptionId, quantity: this.documentTotalQty(doc), price: docPrice });
          }
        }
        // Processing/extras from block groups (skip document-type and speed)
        for (const g of block.groups) {
          if (g.slug === 'document-type' || g.slug === 'speed') continue;
          for (const o of g.options) {
            if (o.quantity <= 0) continue;
            if (g.slug === 'processing-level') {
              const adjustedPrice = this.processingAdjustedPrice(block.id, o.slug);
              // «Супер обработка»: фикс-цена, галочки бесплатны → НЕ слать disabled_features
              // (иначе серверная перепроверка features даст 400 «disabled_features недопустим»).
              const disabled = o.slug === PROCESSING_SUPER_SLUG
                ? []
                : this.disabledFeaturesForTier(block.id, o.slug);
              items.push({
                name: o.name, slug: o.slug, service_option_id: o.id || undefined,
                quantity: o.quantity,
                price: adjustedPrice || o.priceStudio,
                ...(disabled.length ? { disabled_features: disabled } : {}),
              });
            } else {
              items.push({ name: o.name, slug: o.slug, service_option_id: o.id || undefined, quantity: o.quantity, price: o.priceStudio });
            }
          }
        }
        // Urgent = flat surcharge as separate line item
        if (this.isUrgent()) {
          items.push({ name: 'Срочно (без очереди)', slug: 'urgent', quantity: 1, price: this.speedSurcharge() });
        }
      } else {
        // Generic block: all selected options
        for (const g of block.groups) {
          for (const o of g.options) {
            if (o.quantity > 0) items.push({ name: `${block.categoryName}: ${o.name}`, slug: o.slug, service_option_id: o.id || undefined, quantity: o.quantity, price: o.priceStudio });
          }
        }
      }
    }

    return items;
  }

  private buildDescription(): string {
    const parts: string[] = [];
    for (const block of this.serviceBlocks()) {
      if (block.categorySlug === 'photo-docs') {
        parts.push('Фото на документы');
        const docNames = this.selectedDocuments().map(d => {
          const sizeParts = d.sizeSets.map(ss => ss.quantity > 1 ? `${ss.size} ×${ss.quantity}` : ss.size);
          if (d.customSize) sizeParts.push(d.customSize);
          let name = d.option.name;
          if (sizeParts.length > 0) name += ` ${sizeParts.join(', ')}`;
          else if (d.option.defaultSize) name += ` ${d.option.defaultSize}`;
          return name;
        });
        if (docNames.length) parts.push(docNames.join(', '));
      } else {
        const selected = block.groups.flatMap(g => g.options.filter(o => o.quantity > 0).map(o => o.name));
        if (selected.length) parts.push(`${block.categoryName}: ${selected.join(', ')}`);
      }
    }
    if (this.hasFormOverlay()) parts.push(`Подставка формы${this.uniformDescription() ? ': ' + this.uniformDescription() : ''}`);
    if (this.hasSuitOverlay()) parts.push(`Костюм: ${this.suitWishes() || 'да'}`);
    if (this.hasMedals()) parts.push(`Медали: ${this.medalsDescription() || 'да'}`);
    if (this.isUrgent()) parts.push('СРОЧНО');
    return parts.join(' | ');
  }

  // ── Private: load ─────────────────────────────────────────────────────

  private loadCategories(): void {
    this.http.get<{ success: boolean; categories: {
      slug: string; name: string; icon: string; crm_orderable: boolean;
      optionGroups: { slug: string; name: string; selection_type: string; is_required: boolean; max_selections: number;
        options: {
          id: string; slug: string; name: string; base_price: number; price_studio: number | null;
          estimated_minutes: number | null;
          icon: string | null; description: string | null;
          features?: string[];
          features_v2?: { id: string; name: string; price: number; tier_index: number; origin_tier_index: number; sort_order: number }[];
        }[];
      }[];
    }[] }>('/api/pricing/categories', { params: { crm: 'true' } }).pipe(
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(res => {
      if (!res?.success) return;
      const cats: CatalogCategory[] = res.categories.map(c => ({
        slug: c.slug, name: c.name, icon: c.icon || 'category',
        groups: (c.optionGroups ?? []).map(g => ({
          slug: g.slug, name: g.name,
          selectionType: g.selection_type as CatalogGroup['selectionType'],
          isRequired: g.is_required,
          maxSelections: g.max_selections,
          options: (g.options ?? []).map(o => {
            const v2 = o.features_v2;
            const features: FeatureDef[] = v2 && v2.length > 0
              ? [...v2]
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map(f => ({
                    id: f.id, name: f.name, price: f.price,
                    tierIndex: f.tier_index,
                    originTierIndex: f.origin_tier_index,
                    sortOrder: f.sort_order,
                  }))
              : (o.features ?? []).map(name => ({ name }));
            return {
              id: o.id, slug: o.slug, name: o.name,
              priceStudio: o.price_studio ?? o.base_price,
              basePrice: o.base_price,
              estimatedMinutes: o.estimated_minutes ?? 0,
              icon: o.icon,
              description: o.description ?? null,
              features,
            };
          }),
        })),
      }));
      this.categories.set(cats);
      this.refreshServiceBlocksFromCatalog(cats);
      if (this.serviceBlocks().length > 0) this.requestPricing();
    });
  }

  /**
   * Drafts persist full service blocks, including catalog prices/features.
   * Refresh them from the latest catalog so old drafts cannot submit stale prices.
   */
  private refreshServiceBlocksFromCatalog(categories: readonly CatalogCategory[] = this.categories()): void {
    const blocks = this.serviceBlocks();
    if (blocks.length === 0 || categories.length === 0) return;

    const refreshedBlocks = blocks.map(block => {
      const freshCategory = categories.find(c => c.slug === block.categorySlug);
      if (!freshCategory) return block;

      return {
        id: block.id,
        categorySlug: freshCategory.slug,
        categoryName: freshCategory.name,
        categoryIcon: freshCategory.icon,
        groups: freshCategory.groups.map(freshGroup => {
          const oldGroup = block.groups.find(g => g.slug === freshGroup.slug);
          return {
            slug: freshGroup.slug,
            name: freshGroup.name,
            selectionType: freshGroup.selectionType,
            isRequired: freshGroup.isRequired,
            options: freshGroup.options.map(freshOption => {
              const oldOption = oldGroup?.options.find(o => o.slug === freshOption.slug || o.id === freshOption.id);
              return {
                id: freshOption.id,
                slug: freshOption.slug,
                name: freshOption.name,
                priceStudio: freshOption.priceStudio,
                basePrice: freshOption.basePrice,
                estimatedMinutes: freshOption.estimatedMinutes,
                description: freshOption.description,
                features: freshOption.features,
                quantity: oldOption?.quantity ?? 0,
              };
            }),
          };
        }),
      } satisfies ServiceBlock;
    });

    this.serviceBlocks.set(refreshedBlocks);
  }

  private async uploadFilesToS3(files: readonly UploadFile[]): Promise<{ s3Key: string; s3Url: string; fileName: string }[]> {
    const filesMeta = files.map(f => ({ fileName: f.name, contentType: f.file.type || 'application/octet-stream', fileSize: f.file.size }));
    const presignRes = await firstValueFrom(this.http.post<PresignResponse>('/api/orders/photo-print/attachments/presign', { files: filesMeta }));
    if (!presignRes?.success) throw new Error('Presign failed');
    const results: { s3Key: string; s3Url: string; fileName: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const { s3Key, uploadUrl } = presignRes.data.uploads[i];
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.file.type || 'application/octet-stream');
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload ${xhr.status}`));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(file.file);
      });
      results.push({ s3Key, s3Url: uploadUrl.split('?')[0], fileName: file.name });
    }
    return results;
  }

  // ── Draft persistence ───────────────────────────────────────────────

  /** Update draft key when context changes (e.g. linked to a chat session) */
  updateDraftKey(sessionId: string | null): void {
    this.draftKey = DRAFT_STORAGE_PREFIX + (sessionId || 'walkin');
  }

  private saveDraft(): void {
    const blocks = this.serviceBlocks();
    const docs = this.selectedDocuments();
    // Only save if there is meaningful data
    if (blocks.length === 0 && !this.clientPhone() && !this.clientName()) {
      this.draftStatus.set('idle');
      return;
    }

    this.draftStatus.set('saving');
    const draft: OrderDraft = {
      version: 1,
      timestamp: Date.now(),
      serviceBlocks: blocks,
      selectedDocuments: docs,
      hasFormOverlay: this.hasFormOverlay(),
      uniformDescription: this.uniformDescription(),
      hasSuitOverlay: this.hasSuitOverlay(),
      suitWishes: this.suitWishes(),
      hasMedals: this.hasMedals(),
      medalsDescription: this.medalsDescription(),
      isUrgent: this.isUrgent(),
      clientPhone: this.clientPhone(),
      clientName: this.clientName(),
      linkedSessionId: this.linkedSessionId(),
      linkedSessionName: this.linkedSessionName(),
      comment: this.comment(),
      disabledFeatures: [...this.disabledFeatures().entries()],
      retouchConfig: this.retouchConfig(),
    };

    try {
      localStorage.setItem(this.draftKey, JSON.stringify(draft));
      const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      this.draftTime.set(time);
      this.draftStale.set(false);
      this.draftStatus.set('saved');
    } catch {
      // localStorage full or unavailable — silent fail
      this.draftStatus.set('idle');
    }
  }

  private restoreDraft(): void {
    try {
      const raw = localStorage.getItem(this.draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as OrderDraft;
      if (draft.version !== 1) return;

      // Check staleness
      const age = Date.now() - draft.timestamp;
      this.draftStale.set(age > DRAFT_STALE_MS);

      // Restore serializable state
      if (draft.serviceBlocks?.length) this.serviceBlocks.set(draft.serviceBlocks);
      if (draft.selectedDocuments?.length) this.selectedDocuments.set(draft.selectedDocuments);
      this.hasFormOverlay.set(draft.hasFormOverlay ?? false);
      this.uniformDescription.set(draft.uniformDescription ?? '');
      this.hasSuitOverlay.set(draft.hasSuitOverlay ?? false);
      this.suitWishes.set(draft.suitWishes ?? '');
      this.hasMedals.set(draft.hasMedals ?? false);
      this.medalsDescription.set(draft.medalsDescription ?? '');
      this.isUrgent.set(draft.isUrgent ?? false);
      if (draft.clientPhone) { this.clientPhone.set(draft.clientPhone); this.phoneSearch$.next(draft.clientPhone); }
      if (draft.clientName) this.clientName.set(draft.clientName);
      if (draft.linkedSessionId) {
        this.linkedSessionId.set(draft.linkedSessionId);
        this.linkedSessionName.set(draft.linkedSessionName);
      }
      if (draft.comment) this.comment.set(draft.comment);
      if (draft.disabledFeatures?.length) {
        this.disabledFeatures.set(new Map(draft.disabledFeatures.map(([k, v]) => [k as ServiceBlockId, v])));
      }
      if (draft.retouchConfig) this.retouchConfig.set(draft.retouchConfig);

      const time = new Date(draft.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      this.draftTime.set(time);
      this.draftStatus.set('restored');

      // Trigger pricing recalculation for restored blocks.
      // If the catalog is already loaded, also replace stale draft prices/features.
      if (draft.serviceBlocks?.length) {
        this.refreshServiceBlocksFromCatalog();
        this.requestPricing();
      }
    } catch {
      // Corrupt draft — remove it
      try { localStorage.removeItem(this.draftKey); } catch { /* noop */ }
    }
  }

  clearDraft(): void {
    try { localStorage.removeItem(this.draftKey); } catch { /* noop */ }
    this.draftStatus.set('idle');
    this.draftTime.set('');
    this.draftStale.set(false);
  }

  resetForm(): void {
    this.clearDraft();
    this.serviceBlocks.set([]);
    this.selectedDocuments.set([]);
    this.pricingResult.set(null);
    this.hasFormOverlay.set(false);
    this.uniformDescription.set('');
    this.hasSuitOverlay.set(false);
    this.suitWishes.set('');
    this.hasMedals.set(false);
    this.medalsDescription.set('');
    this.disabledFeatures.set(new Map());
    this.retouchConfig.set(null);
    this.isUrgent.set(false);
    this.cleanupFiles();
    this.clientFiles.set([]);
    this.formExampleFiles.set([]);
    this.clientPhone.set('');
    this.clientName.set('');
    this.customerLookup.set(null);
    this.linkedSessionId.set(null);
    this.linkedSessionName.set(null);
    this.showChatPickerPopup.set(false);
    this.chatSearchQuery.set('');
    this.chatSearchResults.set([]);
    this.comment.set('');
    this.promoCode.set('');
    this.promoValidation.set(null);
    this.promoValidating.set(false);
  }

  private cleanupFiles(): void {
    for (const f of this.clientFiles()) { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }
    for (const f of this.formExampleFiles()) { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }
  }
}
