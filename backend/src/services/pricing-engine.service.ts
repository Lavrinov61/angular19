/**
 * Pricing Engine — единый источник ценообразования.
 * Заменяет хардкод service-pricing.ts на DB-driven конфигуратор опций.
 *
 * Используется в: API routes, чат-бот, POS, CRM.
 */

import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { createLogger } from '../utils/logger.js';
import { getPartnerPromoDiscount } from './partners.service.js';
import { findProfile } from './loyalty.service.js';
import { checkSubscription, checkSubscriptionByUserId } from './subscription.service.js';
import {
  resolveAccountDiscountProfile,
  resolveAccountItemDiscount,
} from './account-discounts.service.js';
import {
  applyStudentDiscountUsageToState,
  calculateStudentDiscountForItem,
  getActiveStudentDiscount,
  isStudentPrintDiscountBenefit,
  type StudentDiscountPricingState,
} from './student-discount.service.js';
import {
  calculateStudentIdPhotoPromoForItem,
  getStudentIdPhotoPromoState,
  type StudentIdPhotoPromoPricing,
  type StudentIdPhotoPromoState,
} from './student-id-photo-promo.service.js';
import type { ExistsResult } from '../types/db-common.types.js';
import type { ServiceOptionsId } from '../types/generated/public/ServiceOptions.js';
import type { ServiceCategoriesId } from '../types/generated/public/ServiceCategories.js';
import type SubscriptionPlans from '../types/generated/public/SubscriptionPlans.js';
import type SubscriptionPlanItems from '../types/generated/public/SubscriptionPlanItems.js';
import type {
  ServiceCategoryRow,
  OptionGroupRow,
  ServiceOptionRow,
  OptionRuleRow,
  ServiceOptionFeatureRow,
  WaterfallOptionRow,
} from '../types/views/pricing-views.js';
import type { StudentDiscountBenefitType } from '../types/views/student-discount-views.js';
import type {
  AccountDiscountLineSummary,
  AccountDiscountProfile,
  AccountDiscountRule,
  AccountDiscountSummary,
} from '../types/views/account-discount-views.js';
import type Promotions from '../types/generated/public/Promotions.js';

const log = createLogger('pricing-engine');

// ============================================================================
// Loyalty: конверсия бонусов в рубли при оплате.
// 1 бонус = 1₽, списание ограничено правилами конкретного расчёта.
// ============================================================================
export const LOYALTY_XP_TO_RUB = 1;
const LOYALTY_MAX_DISCOUNT_RATIO = 0.15;
export const MINIMUM_CHECK_TOTAL = 10;
export const MINIMUM_CHECK_WATERFALL_STEP = 'minimum_check';

// ============================================================================
// Типы
// ============================================================================

/** Feature-Level Pricing: frozen per-feature row из service_option_features */
export interface ServiceOptionFeature {
  id: string;
  name: string;
  price: number;
  tier_index: number;
  origin_tier_index: number;
  sort_order: number;
}

export interface ServiceOption {
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
  /** Feature-Level Pricing rows (processing-*). Пусто/undefined для legacy опций. */
  features_v2?: ServiceOptionFeature[];
  popular: boolean;
  original_price: number | null;
  discount_percent: number | null;
  satisfies_requires: boolean;
  sort_order: number;
  estimated_minutes: number | null;
  product_id: string | null;
  processing_time: string | null;
}

export interface OptionGroup {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  selection_type: 'single' | 'multi' | 'quantity';
  is_required: boolean;
  min_selections: number;
  max_selections: number;
  sort_order: number;
  options: ServiceOption[];
}

export interface OptionRule {
  rule_type: 'requires' | 'excludes' | 'includes' | 'price_override';
  source_option_id: string;
  source_option_slug: string;
  target_option_id: string;
  target_option_slug: string;
  override_price: number | null;
  description: string | null;
}

/** Конфигурация дегрессии по категории из service_categories.metadata.degressive */
export interface DegressiveConfig {
  enabled: boolean;
  /** Шаг снижения цены за каждый следующий комплект (для reference_base) */
  step: number;
  /** Минимальная цена (floor) для reference_base — ниже не опускается */
  min_price: number;
  /** Базовая цена, к которой привязаны step/min_price. Для опций с другой ценой — пропорционально */
  reference_base: number;
  /** Область действия: 'category' = суммируем qty всех items в категории */
  scope: 'category';
  /** Группы опций, участвующие в дегрессии. Если не указано — только 'document-type' */
  degressive_groups: string[];
}

interface JsonObject {
  [key: string]: unknown;
}

type PromotionPriceLookupRow = Pick<
  Promotions,
  'id' | 'title' | 'discount_percent' | 'discount_amount' | 'usage_limit' | 'usage_count'
>;

type PromotionWaterfallLookupRow = PromotionPriceLookupRow & Pick<Promotions, 'service_slug'>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  /** Допустимые способы получения для этой категории */
  valid_delivery_methods: DeliveryMethodParam[];
  sort_order: number;
  processing_time: string | null;
  crm_orderable: boolean;
  /** Алиасы для AI/поиска: человекочитаемые названия и внешние slug-и из metadata.ai_aliases. */
  ai_aliases: string[];
  optionGroups: OptionGroup[];
  rules: OptionRule[];
  /** Конфигурация дегрессии (из metadata.degressive) */
  degressive: DegressiveConfig | null;
}

export interface SelectedOption {
  option_slug: string;
  quantity: number;
}

export interface PriceBreakdownItem {
  option_slug: string;
  name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

export interface PromoDiscount {
  code: string;
  title: string;
  amount: number;
  percent: number | null;
}

export interface LoyaltyDiscount {
  points_used: number;
  amount: number;
}

function loyaltyPointsRequiredForRubles(amount: number): number {
  if (amount <= 0 || LOYALTY_XP_TO_RUB <= 0) return 0;
  return Math.ceil(amount / LOYALTY_XP_TO_RUB);
}

export interface PriceCalculationResult {
  breakdown: {
    base_items: PriceBreakdownItem[];
    subtotal: number;
    promo_discount: PromoDiscount | null;
    loyalty_discount: LoyaltyDiscount | null;
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

export interface ValidationResult {
  valid: boolean;
  available_options: Record<string, boolean>;
  auto_selected: string[];
  warnings: string[];
  errors: string[];
}

// ============================================================================
// Кэш (Redis-backed for multi-node)
// ============================================================================

import { cacheGet, cacheSet, cacheDel } from './redis-cache.service.js';

const PRICING_CACHE_KEY = 'pricing:categories';
const PRICING_CACHE_TTL_SEC = 60; // 60 секунд

/** Инвалидация кэша (вызывается при admin-мутациях) */
export function invalidatePricingCache(): void {
  void cacheDel(PRICING_CACHE_KEY).catch((error: unknown) => {
    log.warn('Failed to invalidate pricing cache', { error: String(error) });
  });
}

// ============================================================================
// Загрузка данных
// ============================================================================

/** Извлекает DegressiveConfig из metadata JSONB, если есть */
function parseDegressive(metadata: unknown): DegressiveConfig | null {
  if (!isJsonObject(metadata)) return null;
  const d = metadata['degressive'];
  if (!isJsonObject(d) || d['enabled'] !== true) return null;
  const step = typeof d['step'] === 'number' ? d['step'] : 0;
  const min_price = typeof d['min_price'] === 'number' ? d['min_price'] : 0;
  const reference_base = typeof d['reference_base'] === 'number' ? d['reference_base'] : 0;
  const scope: DegressiveConfig['scope'] = 'category';
  const degressive_groups = Array.isArray(d['degressive_groups'])
    ? d['degressive_groups'].filter((value): value is string => typeof value === 'string')
    : ['document-type']; // default: только типы документов участвуют в дегрессии
  if (step <= 0) return null;
  return { enabled: true, step, min_price, reference_base, scope, degressive_groups };
}

function parseMetadataStringArray(metadata: unknown, key: string): string[] {
  if (!isJsonObject(metadata)) return [];
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

async function loadAllCategories(): Promise<PricingCategory[]> {
  const cached = await cacheGet<PricingCategory[]>(PRICING_CACHE_KEY);
  if (cached) return applyActivePriceModifiersToCategories(cached);

  const categories = await db.query<ServiceCategoryRow>(
    `SELECT id, slug, name, description, icon, gradient, image_url, price_range,
            display_channels, processing_time,
            COALESCE(valid_delivery_methods, '{electronic,pickup,postal}') AS valid_delivery_methods,
            sort_order, COALESCE(crm_orderable, false) AS crm_orderable,
            COALESCE(metadata, '{}'::jsonb) AS metadata
     FROM service_categories WHERE is_active = true ORDER BY sort_order`
  );

  const groups = await db.query<OptionGroupRow>(
    `SELECT id, service_category_id, slug, name, description, selection_type,
            is_required, min_selections, max_selections, sort_order
     FROM option_groups WHERE is_active = true ORDER BY sort_order`
  );

  const options = await db.query<ServiceOptionRow>(
    `SELECT id, option_group_id, product_id, slug, name, description,
            icon, color, base_price, price_online, price_studio,
            price_next_unit, price_max, promo_first_price, promo_description,
            features, popular, original_price, discount_percent,
          COALESCE(satisfies_requires, true) AS satisfies_requires, sort_order,
          estimated_minutes, processing_time
     FROM service_options WHERE is_active = true ORDER BY sort_order`
  );

  const rules = await db.query<OptionRuleRow>(
    `SELECT service_category_id, rule_type, source_option_id, target_option_id,
            override_price, description
     FROM option_rules WHERE is_active = true`
  );

  const featureRows = await db.query<ServiceOptionFeatureRow>(
    `SELECT id, service_option_id, name, price, tier_index, origin_tier_index, sort_order
     FROM service_option_features
     WHERE is_active = true
     ORDER BY service_option_id, sort_order`
  );
  const featuresByOption = new Map<string, ServiceOptionFeature[]>();
  for (const f of featureRows) {
    const list = featuresByOption.get(f.service_option_id) ?? [];
    list.push({
      id: f.id,
      name: f.name,
      price: parseFloat(f.price),
      tier_index: f.tier_index,
      origin_tier_index: f.origin_tier_index,
      sort_order: f.sort_order,
    });
    featuresByOption.set(f.service_option_id, list);
  }

  // Построить slug-маппинг для option_id → slug
  const optionIdToSlug = new Map<string, string>();
  for (const o of options) {
    optionIdToSlug.set(o.id, o.slug);
  }

  // Собрать дерево
  const result: PricingCategory[] = categories.map(cat => {
    const catGroups = groups
      .filter(g => g.service_category_id === cat.id)
      .map(g => {
        const groupOptions: ServiceOption[] = options
          .filter(o => o.option_group_id === g.id)
          .map(o => ({
            id: o.id,
            slug: o.slug,
            name: o.name,
            description: o.description,
            icon: o.icon,
            color: o.color,
            base_price: parseFloat(o.base_price),
            price_online: o.price_online ? parseFloat(o.price_online) : null,
            price_studio: o.price_studio ? parseFloat(o.price_studio) : null,
            price_next_unit: o.price_next_unit ? parseFloat(o.price_next_unit) : null,
            price_max: o.price_max ? parseFloat(o.price_max) : null,
            promo_first_price: o.promo_first_price ? parseFloat(o.promo_first_price) : null,
            promo_description: o.promo_description,
            features: o.features || [],
            features_v2: featuresByOption.get(o.id),
            popular: o.popular,
            original_price: o.original_price ? parseFloat(o.original_price) : null,
            discount_percent: o.discount_percent,
            satisfies_requires: o.satisfies_requires,
            sort_order: o.sort_order,
            estimated_minutes: o.estimated_minutes,
            product_id: o.product_id,
            processing_time: o.processing_time,
          }));

        return {
          id: g.id,
          slug: g.slug,
          name: g.name,
          description: g.description,
          selection_type: g.selection_type as OptionGroup['selection_type'],
          is_required: g.is_required,
          min_selections: g.min_selections,
          max_selections: g.max_selections,
          sort_order: g.sort_order,
          options: groupOptions,
        };
      });

    const catRules: OptionRule[] = rules
      .filter(r => r.service_category_id === cat.id)
      .map(r => ({
        rule_type: r.rule_type as OptionRule['rule_type'],
        source_option_id: r.source_option_id,
        source_option_slug: optionIdToSlug.get(r.source_option_id) || '',
        target_option_id: r.target_option_id,
        target_option_slug: optionIdToSlug.get(r.target_option_id) || '',
        override_price: r.override_price ? parseFloat(r.override_price) : null,
        description: r.description,
      }));

    return {
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
      description: cat.description,
      icon: cat.icon,
      gradient: cat.gradient,
      image_url: cat.image_url,
      price_range: cat.price_range,
      display_channels: cat.display_channels || [],
      valid_delivery_methods: (cat.valid_delivery_methods || ['electronic', 'pickup', 'postal']) as DeliveryMethodParam[],
      sort_order: cat.sort_order,
      processing_time: cat.processing_time,
      crm_orderable: cat.crm_orderable,
      ai_aliases: parseMetadataStringArray(cat.metadata, 'ai_aliases'),
      optionGroups: catGroups,
      rules: catRules,
      degressive: parseDegressive(cat.metadata),
    };
  });

  await cacheSet(PRICING_CACHE_KEY, result, PRICING_CACHE_TTL_SEC);
  return applyActivePriceModifiersToCategories(result);
}

/** Получить все категории из кэша */
export async function getCategories(): Promise<PricingCategory[]> {
  return loadAllCategories();
}

/** Получить одну категорию по slug */
export async function getCategoryBySlug(slug: string): Promise<PricingCategory | null> {
  const all = await loadAllCategories();
  return all.find(c => c.slug === slug) || null;
}

// ============================================================================
// Pricing Engine — расчёт цены
// ============================================================================

/** Delivery method → price column mapping */
export type DeliveryMethodParam = 'electronic' | 'pickup' | 'postal';

/** @deprecated Backward compat — принимаем и старый channel */
export type ChannelParam = 'online' | 'studio' | 'chatbot';

type PriceChannel = DeliveryMethodParam | ChannelParam;

/** Нормализует channel/delivery_method в единую категорию для выбора цены */
function normalizePriceChannel(param: PriceChannel): 'studio' | 'online' {
  if (param === 'pickup' || param === 'studio') return 'studio';
  // electronic, postal, online, chatbot → online price
  return 'online';
}

function resolveOptionPrice(
  option: ServiceOption,
  channel: PriceChannel,
  isReturning: boolean,
): number {
  // Промо «первый заказ» для новых клиентов
  if (!isReturning && option.promo_first_price != null) {
    return option.promo_first_price;
  }

  const normalized = normalizePriceChannel(channel);
  if (normalized === 'studio' && option.price_studio != null) return option.price_studio;
  if (normalized === 'online' && option.price_online != null) return option.price_online;

  return option.base_price;
}

function resolveNextUnitPrice(
  option: ServiceOption,
  channel: PriceChannel,
): number {
  if (option.price_next_unit != null) return option.price_next_unit;
  const normalized = normalizePriceChannel(channel);
  if (normalized === 'studio' && option.price_studio != null) return option.price_studio;
  if (normalized === 'online' && option.price_online != null) return option.price_online;
  return option.base_price;
}

/** Основной расчёт цены */
export async function calculatePrice(params: {
  categorySlug: string;
  selectedOptions: SelectedOption[];
  /** Способ получения: electronic | pickup | postal */
  deliveryMethod?: DeliveryMethodParam;
  /** @deprecated Используй deliveryMethod */
  channel?: ChannelParam;
  isReturning?: boolean;
  promoCode?: string;
  loyaltyPointsToUse?: number;
  /** Profile ID for server-side balance validation */
  loyaltyProfileId?: string;
}): Promise<PriceCalculationResult> {
  let { categorySlug, selectedOptions, isReturning = false, promoCode, loyaltyPointsToUse } = params;
  // Приоритет: deliveryMethod > channel > fallback 'electronic'
  const channel: PriceChannel = params.deliveryMethod || params.channel || 'electronic';

  const category = await getCategoryBySlug(categorySlug);
  if (!category) throw new AppError(404, `Категория "${categorySlug}" не найдена`);

  // Validate delivery method against category's allowed methods
  if (params.deliveryMethod && !category.valid_delivery_methods.includes(params.deliveryMethod)) {
    throw new AppError(400, `Способ получения "${params.deliveryMethod}" недопустим для категории "${categorySlug}". Допустимые: ${category.valid_delivery_methods.join(', ')}`);
  }

  // Собрать опции flat-map
  const allOptions = new Map<string, ServiceOption>();
  for (const g of category.optionGroups) {
    for (const o of g.options) {
      allOptions.set(o.slug, o);
    }
  }

  // Валидация
  const errors: string[] = [];
  const warnings: string[] = [];
  const resolvedSelection = new Map<string, number>(); // slug → quantity

  for (const sel of selectedOptions) {
    if (!allOptions.has(sel.option_slug)) {
      errors.push(`Опция "${sel.option_slug}" не найдена в категории "${categorySlug}"`);
      continue;
    }
    resolvedSelection.set(sel.option_slug, Math.max(1, sel.quantity || 1));
  }

  // Проверить required-группы + min/max selections
  for (const g of category.optionGroups) {
    const selectedCount = g.options.filter(o => resolvedSelection.has(o.slug)).length;

    if (g.is_required && selectedCount === 0) {
      errors.push(`Обязательная группа "${g.name}" не выбрана`);
    }

    if (selectedCount > 0) {
      if (g.min_selections > 0 && selectedCount < g.min_selections) {
        errors.push(`Группа "${g.name}": выбрано ${selectedCount}, минимум ${g.min_selections}`);
      }
      if (g.max_selections > 0 && selectedCount > g.max_selections) {
        errors.push(`Группа "${g.name}": выбрано ${selectedCount}, максимум ${g.max_selections}`);
      }
    }
  }

  // Переопределения цен из правил price_override
  const priceOverrides = new Map<string, number>();

  // Проверить правила
  for (const rule of category.rules) {
    const sourceSelected = resolvedSelection.has(rule.source_option_slug);
    const targetSelected = resolvedSelection.has(rule.target_option_slug);

    if (!sourceSelected) continue;

    switch (rule.rule_type) {
      case 'requires': {
        // source requires target — target (или альтернатива из той же группы) должен быть выбран
        // Для requires: проверяем мягко — target или другая опция из его группы
        const targetOption = allOptions.get(rule.target_option_slug);
        if (targetOption) {
          const targetGroup = category.optionGroups.find(g =>
            g.options.some(o => o.slug === rule.target_option_slug)
          );
          if (targetGroup) {
            const anyFromGroupSelected = targetGroup.options.some(o =>
              resolvedSelection.has(o.slug) && o.satisfies_requires
            );
            if (!anyFromGroupSelected) {
              warnings.push(rule.description || `"${rule.source_option_slug}" требует "${rule.target_option_slug}"`);
            }
          }
        }
        break;
      }
      case 'excludes':
        if (targetSelected) {
          errors.push(rule.description || `"${rule.source_option_slug}" несовместимо с "${rule.target_option_slug}"`);
        }
        break;
      case 'includes':
        // Авто-добавить target
        if (!targetSelected) {
          resolvedSelection.set(rule.target_option_slug, 1);
          warnings.push(`Автоматически добавлено: "${allOptions.get(rule.target_option_slug)?.name || rule.target_option_slug}"`);
        }
        break;
      case 'price_override':
        // Когда source выбран — переопределить цену target
        if (targetSelected && rule.override_price != null) {
          priceOverrides.set(rule.target_option_slug, rule.override_price);
        }
        break;
    }
  }

  // Рассчитать цену
  const baseItems: PriceBreakdownItem[] = [];
  const productIds: string[] = [];

  for (const [slug, quantity] of resolvedSelection) {
    const option = allOptions.get(slug);
    if (!option) continue;

    // price_override из правил имеет приоритет
    const overridePrice = priceOverrides.get(slug);
    const unitPrice = overridePrice != null ? overridePrice : resolveOptionPrice(option, channel, isReturning);
    const nextUnitPrice = overridePrice != null ? overridePrice : resolveNextUnitPrice(option, channel);

    // Прогрессивное ценообразование: 1-я единица по unitPrice, 2+ по nextUnitPrice
    let subtotal: number;
    if (quantity === 1) {
      subtotal = unitPrice;
    } else {
      subtotal = unitPrice + nextUnitPrice * (quantity - 1);
    }

    // Потолок цены: price_max ограничивает итог по опции
    if (option.price_max != null && subtotal > option.price_max) {
      subtotal = option.price_max;
    }

    // Пропускаем опции с нулевой ценой (вроде «Обычная скорость»)
    if (subtotal === 0) continue;

    baseItems.push({
      option_slug: slug,
      name: option.name,
      unit_price: unitPrice,
      quantity,
      subtotal,
    });

    if (option.product_id) productIds.push(option.product_id);
  }

  let subtotal = baseItems.reduce((sum, item) => sum + item.subtotal, 0);

  // Промокод
  let promoDiscount: PromoDiscount | null = null;
  if (promoCode) {
    const promo = await db.queryOne<PromotionPriceLookupRow>(
      `SELECT id, title, discount_percent, discount_amount, usage_limit, usage_count
       FROM promotions
       WHERE UPPER(promo_code) = $1
         AND is_active = true
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY CASE WHEN service_slug = $2 THEN 0 WHEN service_slug IS NULL THEN 1 ELSE 2 END
       LIMIT 1`,
      [promoCode.trim().toUpperCase(), categorySlug]
    );

    if (promo) {
      if (promo.usage_limit && (promo.usage_count ?? 0) >= promo.usage_limit) {
        warnings.push('Промокод больше не действует');
      } else {
        let amount = 0;
        if (promo.discount_percent) {
          amount = Math.round(subtotal * promo.discount_percent / 100);
        } else if (promo.discount_amount) {
          amount = Math.min(parseFloat(promo.discount_amount), subtotal);
        }
        if (amount > 0) {
          promoDiscount = {
            code: promoCode.trim().toUpperCase(),
            title: promo.title,
            amount,
            percent: promo.discount_percent,
          };
        }
      }
    } else {
      // Fallback: партнёрские промокоды
      const partnerDiscount = await getPartnerPromoDiscount(promoCode.trim().toUpperCase());
      if (partnerDiscount && partnerDiscount.discount_percent > 0) {
        const amount = Math.round(subtotal * partnerDiscount.discount_percent / 100);
        promoDiscount = {
          code: promoCode.trim().toUpperCase(),
          title: `Скидка по промокоду партнёра`,
          amount,
          percent: partnerDiscount.discount_percent,
        };
      } else {
        warnings.push('Промокод не найден');
      }
    }
  }

  // Server-side loyalty balance validation
  if (loyaltyPointsToUse && loyaltyPointsToUse > 0 && params.loyaltyProfileId) {
    const profile = await findProfile({ profileId: params.loyaltyProfileId });
    if (!profile || profile.points < loyaltyPointsToUse) {
      loyaltyPointsToUse = profile ? profile.points : 0;
    }
  }

  // Лояльность: 1 бонус = LOYALTY_XP_TO_RUB ₽, максимум 15% от суммы после промокода
  let loyaltyDiscount: LoyaltyDiscount | null = null;
  if (loyaltyPointsToUse && loyaltyPointsToUse > 0) {
    const rublesValue = Math.floor(loyaltyPointsToUse * LOYALTY_XP_TO_RUB);
    const maxDiscount = Math.floor((subtotal - (promoDiscount?.amount || 0)) * LOYALTY_MAX_DISCOUNT_RATIO);
    const amount = Math.min(rublesValue, maxDiscount);
    if (amount > 0) {
      loyaltyDiscount = {
        points_used: Math.min(loyaltyPointsToUse, loyaltyPointsRequiredForRubles(amount)),
        amount,
      };
    }
  }

  const totalBeforeMinimum = Math.max(0, subtotal - (promoDiscount?.amount || 0) - (loyaltyDiscount?.amount || 0));
  const total = roundPricingMoney(totalBeforeMinimum + minimumCheckSurchargeForTotal(totalBeforeMinimum));
  const savings = Math.max(0, subtotal - total);

  return {
    breakdown: {
      base_items: baseItems,
      subtotal,
      promo_discount: promoDiscount,
      loyalty_discount: loyaltyDiscount,
      total,
      savings,
    },
    product_ids: productIds,
    validation: {
      valid: errors.length === 0,
      warnings,
      errors,
    },
  };
}

// ============================================================================
// Валидация выбора (лёгкий endpoint)
// ============================================================================

export async function validateSelection(params: {
  categorySlug: string;
  selectedOptions: string[]; // только slug'и
}): Promise<ValidationResult> {
  const category = await getCategoryBySlug(params.categorySlug);
  if (!category) throw new AppError(404, `Категория "${params.categorySlug}" не найдена`);

  const selected = new Set(params.selectedOptions);
  const available: Record<string, boolean> = {};
  const autoSelected: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  // Все опции
  const allOptions = new Map<string, ServiceOption>();
  for (const g of category.optionGroups) {
    for (const o of g.options) {
      allOptions.set(o.slug, o);
      available[o.slug] = true; // по умолчанию доступно
    }
  }

  // Применить правила
  for (const rule of category.rules) {
    const sourceSelected = selected.has(rule.source_option_slug);
    if (!sourceSelected) continue;

    switch (rule.rule_type) {
      case 'excludes':
        available[rule.target_option_slug] = false;
        if (selected.has(rule.target_option_slug)) {
          errors.push(rule.description || `"${rule.source_option_slug}" несовместимо с "${rule.target_option_slug}"`);
        }
        break;
      case 'includes':
        if (!selected.has(rule.target_option_slug)) {
          autoSelected.push(rule.target_option_slug);
        }
        break;
      case 'requires':
        // Проверяем мягко: target или альтернатива из группы
        break;
      case 'price_override':
        // Информационно: цена будет переопределена при расчёте
        break;
    }
  }

  // Проверить required-группы + min/max selections
  for (const g of category.optionGroups) {
    const selectedCount = g.options.filter(o => selected.has(o.slug)).length;

    if (g.is_required && selectedCount === 0) {
      errors.push(`Обязательная группа "${g.name}" не выбрана`);
    }

    if (selectedCount > 0) {
      if (g.min_selections > 0 && selectedCount < g.min_selections) {
        errors.push(`Группа "${g.name}": выбрано ${selectedCount}, минимум ${g.min_selections}`);
      }
      if (g.max_selections > 0 && selectedCount > g.max_selections) {
        errors.push(`Группа "${g.name}": выбрано ${selectedCount}, максимум ${g.max_selections}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    available_options: available,
    auto_selected: autoSelected,
    warnings,
    errors,
  };
}

// ============================================================================
// Совместимость: генерация BotButton[] для чат-бота
// ============================================================================

export interface BotButtonCompat {
  id: string;
  label: string;
  icon: string;
  value: string;
  color: string;
  data?: JsonObject;
}

/**
 * Генерирует кнопки для чат-бота из processing-level группы.
 * Совместимо с текущим `buildServiceOptions()` из service-pricing.ts.
 */
export async function buildServiceOptionsFromDB(isReturning = false): Promise<BotButtonCompat[]> {
  const category = await getCategoryBySlug('photo-docs');
  if (!category) return [];

  const processingGroup = category.optionGroups.find(g => g.slug === 'processing-level');
  if (!processingGroup) return [];

  return processingGroup.options.map(opt => {
    const fp = resolveOptionPrice(opt, 'online', isReturning);
    const np = resolveNextUnitPrice(opt, 'online');
    const priceLabel = fp < np ? `${fp}₽ (первое фото!)` : `${fp}₽`;

    return {
      id: opt.slug === 'basic' ? 'no_processing'
        : opt.slug === 'retouch' ? 'with_processing'
        : opt.slug === 'vip' ? 'vip'
        : opt.slug,
      label: `${opt.name} — ${priceLabel}`,
      icon: opt.icon || 'photo_camera',
      value: opt.name,
      color: opt.color || '#667eea',
      data: { firstPrice: fp, nextPrice: np },
    };
  });
}

/**
 * Генерирует кнопки для чат-бота для ЛЮБОЙ группы опций (не только processing-level).
 * Используется в multi-step option flow: processing-level → speed → extras.
 */
export async function buildOptionGroupButtons(
  categorySlug: string,
  groupSlug: string,
  selectedSlugs: string[] = [],
  excludedSlugs: string[] = [],
  isReturning = false,
  channel: PriceChannel = 'electronic',
): Promise<BotButtonCompat[]> {
  const category = await getCategoryBySlug(categorySlug);
  if (!category) return [];

  const group = category.optionGroups.find(g => g.slug === groupSlug);
  if (!group) return [];

  const selectedSet = new Set(selectedSlugs);
  const excludedSet = new Set(excludedSlugs);

  return group.options
    .filter(opt => !excludedSet.has(opt.slug))
    .map(opt => {
      const price = resolveOptionPrice(opt, channel, isReturning);
      const nextPrice = resolveNextUnitPrice(opt, channel);
      const isSelected = selectedSet.has(opt.slug);

      if (group.selection_type === 'multi') {
        const prefix = isSelected ? '✓ ' : '○ ';
        const priceLabel = price > 0 ? ` — +${price}₽` : ' — включено';
        return {
          id: `option_${groupSlug}_toggle_${opt.slug}`,
          label: `${prefix}${opt.name}${priceLabel}`,
          icon: opt.icon || 'add_circle',
          value: `option_${groupSlug}_toggle_${opt.slug}`,
          color: isSelected ? '#22c55e' : (opt.color || '#667eea'),
          data: { selected: isSelected, price, slug: opt.slug, group: groupSlug },
        };
      } else {
        // Single-select: radio-style
        const priceLabel = price < nextPrice
          ? ` — ${price}₽ (первое фото!)`
          : price > 0 ? ` — ${price}₽` : ' — включено';
        return {
          id: `option_${groupSlug}_${opt.slug}`,
          label: `${opt.name}${priceLabel}`,
          icon: opt.icon || 'radio_button_unchecked',
          value: `option_${groupSlug}_${opt.slug}`,
          color: opt.color || '#667eea',
          data: { price, nextPrice, slug: opt.slug, group: groupSlug },
        };
      }
    });
}

/**
 * Строит текст карточек фич для группы опций.
 * Показывается в чате перед кнопками выбора, чтобы клиент понимал разницу.
 */
export function buildFeatureCardsText(
  options: ServiceOption[],
  excludedSlugs: string[],
  channel: PriceChannel,
  isReturning: boolean,
  selectionType: 'single' | 'multi',
): string {
  const iconMap: Record<string, string> = {
    photo_camera: '📷',
    auto_fix_high: '✨',
    diamond: '💎',
    military_tech: '🎖',
    content_cut: '✂️',
    folder_copy: '📁',
    local_shipping: '🚚',
  };

  const excludedSet = new Set(excludedSlugs);
  const cards = options
    .filter(opt => !excludedSet.has(opt.slug))
    .map(opt => {
      const price = resolveOptionPrice(opt, channel, isReturning);
      const emoji = (opt.icon && iconMap[opt.icon]) ? iconMap[opt.icon] : '•';
      const priceStr = selectionType === 'multi' ? `+${price}₽` : `${price}₽`;
      const popularTag = opt.popular ? ' ⭐ Хит' : '';

      const lines: string[] = [];
      lines.push(`${emoji} **${opt.name}** — ${priceStr}${popularTag}`);
      if (opt.description) lines.push(opt.description);
      for (const feature of opt.features) {
        lines.push(`  • ${feature}`);
      }
      return lines.join('\n');
    });

  return cards.join('\n\n');
}

/**
 * Рассчитать итоговую цену из карты выбранных опций (group_slug → [option_slugs]).
 * Поддерживает photoCount для per-photo ценообразования (processing-level).
 */
export async function calculateTotalForSelectedOptions(params: {
  categorySlug: string;
  selectedOptions: Record<string, string[]>;
  isReturning?: boolean;
  deliveryMethod?: DeliveryMethodParam;
  photoCount?: number;
}): Promise<{ total: number; breakdown: string; base_items: PriceBreakdownItem[] }> {
  const {
    categorySlug, selectedOptions, isReturning = false,
    deliveryMethod = 'electronic', photoCount = 1,
  } = params;

  // Flatten to SelectedOption[]
  const flatOptions: SelectedOption[] = [];
  for (const [groupSlug, slugs] of Object.entries(selectedOptions)) {
    for (const slug of slugs) {
      // processing-level: per-photo (quantity = photoCount), всё остальное — flat (quantity = 1)
      const qty = (groupSlug === 'processing-level' && photoCount > 1) ? photoCount : 1;
      flatOptions.push({ option_slug: slug, quantity: qty });
    }
  }

  if (flatOptions.length === 0) return { total: 0, breakdown: '**0₽**', base_items: [] };

  const result = await calculatePrice({
    categorySlug,
    selectedOptions: flatOptions,
    deliveryMethod,
    isReturning,
  });

  const parts = result.breakdown.base_items.map(item =>
    item.quantity > 1
      ? `${item.name} ${item.unit_price}₽ × ${item.quantity} = ${item.subtotal}₽`
      : `${item.name} — ${item.subtotal}₽`
  );
  const breakdown = parts.length > 1
    ? parts.join(' + ') + ` = **${result.breakdown.total}₽**`
    : parts.length === 1
      ? `**${result.breakdown.total}₽**`
      : '**0₽**';

  return { total: result.breakdown.total, breakdown, base_items: result.breakdown.base_items };
}

/**
 * Получить цену тарифа — совместимость с getServicePrice().
 * Принимает name тарифа (например, "С обработкой").
 */
export async function getServicePriceFromDB(
  tariffName: string,
  isReturning: boolean,
  channel: PriceChannel = 'electronic',
): Promise<{ firstPrice: number; nextPrice: number }> {
  const category = await getCategoryBySlug('photo-docs');
  if (!category) return { firstPrice: 0, nextPrice: 0 };

  const processingGroup = category.optionGroups.find(g => g.slug === 'processing-level');
  if (!processingGroup) return { firstPrice: 0, nextPrice: 0 };

  // Поиск по name (value в старом формате)
  const option = processingGroup.options.find(o => o.name === tariffName)
    || processingGroup.options.find(o => tariffName.startsWith(o.name));

  if (!option) {
    // Fallback: извлечь цену из строки (старый формат "С обработкой (590₽)")
    const match = tariffName.match(/(\d+)₽/);
    const p = match ? parseInt(match[1], 10) : 0;
    return { firstPrice: p, nextPrice: p };
  }

  const firstPrice = resolveOptionPrice(option, channel, isReturning);
  const nextPrice = resolveNextUnitPrice(option, channel);

  return { firstPrice, nextPrice };
}

// ============================================================================
// Price Waterfall — полный расчёт с дегрессией, подпиской, volume, промо, лояльностью, партнёром
// ============================================================================

export interface WaterfallItemResult {
  serviceOptionId: string;
  slug: string;
  name: string;
  basePrice: number;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  priceAdjustmentLabel: string | null;
  priceAdjustmentNotice: string | null;
  priceAdjustmentAmount: number;
  discountApplied: 'degressive' | 'category_degressive' | 'subscription' | 'volume' | 'cross_category' | 'student' | 'student_id_photo_promo' | 'none';
  discountAmount: number;
  discountLabel: string | null;
  studentDiscountBenefit: StudentDiscountBenefitType | null;
  studentDiscountUnits: number;
  /** Порядковый номер в категории при category-level дегрессии (1-based), null если не применимо */
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

export interface WaterfallStep {
  step: string;
  description: string;
  amount: number;
  runningTotal: number;
}

function roundPricingMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function minimumCheckSurchargeForTotal(totalBeforeMinimum: number): number {
  const total = roundPricingMoney(Math.max(0, totalBeforeMinimum));
  if (total <= 0 || total >= MINIMUM_CHECK_TOTAL) return 0;
  return roundPricingMoney(MINIMUM_CHECK_TOTAL - total);
}

export function applyMinimumCheckStep(runningTotal: number, waterfall: WaterfallStep[]): number {
  const totalBeforeMinimum = roundPricingMoney(Math.max(0, runningTotal));
  const surcharge = minimumCheckSurchargeForTotal(totalBeforeMinimum);
  if (surcharge <= 0) return totalBeforeMinimum;

  waterfall.push({
    step: MINIMUM_CHECK_WATERFALL_STEP,
    description: `Минимальный чек ${MINIMUM_CHECK_TOTAL}₽`,
    amount: surcharge,
    runningTotal: MINIMUM_CHECK_TOTAL,
  });
  return MINIMUM_CHECK_TOTAL;
}

export function minimumCheckSurchargeFromWaterfall(waterfall: readonly WaterfallStep[]): number {
  const step = waterfall.find(s => s.step === MINIMUM_CHECK_WATERFALL_STEP && s.amount > 0);
  return step ? roundPricingMoney(step.amount) : 0;
}

export interface DetectedComboHint {
  slug: string;
  name: string;
  combo_price: number;
  original_total: number | null;
  savings_label: string | null;
  /** All items present in current selection */
  fully_matched: boolean;
  missing_option_slugs: string[];
}

export interface StudentDiscountWaterfallSummary {
  entitlementId: string;
  userId: string;
  amount: number;
  printSheets: number;
  bindingUses: number;
  expiresAt: string;
}

export interface PriceWaterfallResult {
  items: WaterfallItemResult[];
  subtotal: number;
  waterfall: WaterfallStep[];
  /** true если у клиента есть завершённые заказы (повторный клиент) */
  isReturning: boolean;
  subscriberDiscount: { percent: number; amount: number } | null;
  accountDiscount: AccountDiscountSummary | null;
  studentDiscount: StudentDiscountWaterfallSummary | null;
  loyaltyDiscount: LoyaltyDiscount | null;
  promoDiscount: PromoDiscount | null;
  partnerDiscount: { percent: number; amount: number } | null;
  priceAdjustments: PriceAdjustmentSummary[];
  /** Промокод передан, но заблокирован degressive скидкой */
  promoBlocked: boolean;
  promoBlockedReason: 'degressive_discount_applied' | 'student_discount_applied' | null;
  total: number;
  savings: number;
  /** Combo packages that match or partially match selected options (hint only, not auto-applied) */
  detectedCombos: DetectedComboHint[];
  /**
   * Образовательная льгота: фактически покрытые лимитом единицы (документы/фото),
   * к которым применена account-скидка. Используется финализатором чека для списания
   * rolling-30 лимита. null/undefined — если education-льгота не применялась.
   */
  educationVolumeConsumed?: {
    entitlementId: string;
    userId: string;
    documents: number;
    photos: number;
  } | null;
  /**
   * Акция «Фото на студенческий 4×200»: пакет применён к позиции. Используется
   * финализатором чека POS для одноразового списания на образовательный аккаунт.
   * null/undefined — если акция не применялась.
   */
  studentIdPhotoPromoConsumed?: {
    studentAccountId: string;
    userId: string;
    periodKey: string;
    units: number;
    unitPrice: number;
    discountAmount: number;
  } | null;
}

interface AccountDiscountCandidate {
  itemIndex: number;
  rule: AccountDiscountRule;
}

function describeAccountDiscount(
  profile: AccountDiscountProfile,
  lines: readonly AccountDiscountLineSummary[],
): string {
  const parts: string[] = [];
  if (lines.some(line => line.kind === 'document_print')) {
    parts.push(`${profile.documentPrintDiscountPercent}% на документы А4`);
  }
  if (lines.some(line => line.kind === 'photo_print')) {
    parts.push(`${profile.photoPrintDiscountPercent}% на фотопечать до А4`);
  }

  return parts.length > 0
    ? `${profile.label}: ${parts.join(', ')}`
    : `${profile.label}: скидка ${profile.discountPercent}%`;
}

function normalizeLoyaltyRuleText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function isA3PhotoPrintLoyaltyExcluded(target: {
  slug: string | null;
  name: string | null;
  categorySlug?: string | null;
  groupSlug?: string | null;
}): boolean {
  const slug = normalizeLoyaltyRuleText(target.slug);
  const name = normalizeLoyaltyRuleText(target.name);
  const categorySlug = normalizeLoyaltyRuleText(target.categorySlug);
  const groupSlug = normalizeLoyaltyRuleText(target.groupSlug);
  const combined = [slug, name, categorySlug, groupSlug].join(' ');

  const isPhotoScope = categorySlug === 'photo-print-format'
    || categorySlug === 'photo-print'
    || groupSlug === 'photo-formats'
    || slug.startsWith('km-фото-')
    || slug.startsWith('photo-')
    || combined.includes('фото')
    || combined.includes('photo');

  const hasA3Format = /(^|[^a-zа-я0-9])(a3|а3)([^a-zа-я0-9]|$)/i.test(combined)
    || /(^|[^0-9])(29[,.]?7|30)\s*[xх]\s*(42|40)([^0-9]|$)/i.test(combined);

  return isPhotoScope && hasA3Format;
}

export interface PriceWaterfallInput {
  items: Array<{
    serviceOptionId: string;
    quantity: number;
    pricingGroupKey?: string | null;
    printFillPercent?: number | string | null;
  }>;
  customerId?: string;
  customerPhone?: string;
  customerEmail?: string;
  channel: 'pos' | 'online' | 'crm';
  promoCode?: string;
  loyaltyPointsToUse?: number;
  loyaltyProfileId?: string;
  /** Применять volume-скидки за объём. По умолчанию true для online/crm, false для pos */
  applyVolumeDiscount?: boolean;
}

/**
 * Volume modifiers из price_modifiers таблицы.
 * modifier_type='volume', conditions содержит min_quantity порог.
 */
export interface VolumeModifierRow {
  id: string;
  name: string;
  service_option_id: string | null;
  service_category_id: string | null;
  modifier_action: string;
  modifier_value: string;
  conditions: JsonObject;
  priority: number;
}

export async function loadVolumeModifiers(): Promise<VolumeModifierRow[]> {
  return db.query<VolumeModifierRow>(
    `SELECT id, name, service_option_id, service_category_id,
            modifier_action, modifier_value, conditions, priority
     FROM price_modifiers
     WHERE is_active = true
       AND modifier_type = 'volume'
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())
     ORDER BY priority DESC`
  );
}

export interface PriceAdjustmentSummary {
  id: string;
  name: string;
  label: string;
  customerNotice: string | null;
  multiplier: number | null;
  amount: number;
}

type PriceModifierAction = 'multiply' | 'add' | 'subtract' | 'override';

interface ActivePriceModifierRow {
  id: string;
  name: string;
  service_option_id: string | null;
  service_category_id: string | null;
  modifier_action: string;
  modifier_value: string;
  conditions: unknown;
  priority: number;
}

interface ActivePriceModifier {
  id: string;
  name: string;
  serviceOptionId: string | null;
  serviceCategoryId: string | null;
  action: PriceModifierAction;
  value: number;
  label: string;
  customerNotice: string | null;
  excludeCategorySlugs: Set<string>;
  excludeGroupSlugs: Set<string>;
  excludeOptionSlugs: Set<string>;
  excludeNameIncludes: string[];
  priority: number;
}

interface PriceModifierContext {
  optionId: string;
  optionSlug: string;
  optionName: string;
  categoryId: string | null;
  categorySlug: string | null;
  groupSlug: string | null;
}

interface AppliedPriceModifier {
  modifier: ActivePriceModifier;
  before: number;
  after: number;
}

interface PriceModifierApplication {
  price: number;
  applied: AppliedPriceModifier[];
}

function roundPrice(value: number): number {
  return Math.max(0, Math.round(value));
}

function roundPriceDelta(value: number): number {
  return Math.round(value);
}

function normalizeJsonObject(value: unknown): JsonObject {
  if (isJsonObject(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function jsonStringField(source: JsonObject, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function jsonStringArray(source: JsonObject, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function parsePriceModifierAction(value: string): PriceModifierAction | null {
  if (value === 'multiply' || value === 'add' || value === 'subtract' || value === 'override') {
    return value;
  }
  return null;
}

/**
 * DB-level price adjustments for temporary holiday rates.
 * Only conditions.type='holiday_rate' is consumed here, so old seasonal rules stay inert.
 */
async function loadActivePriceModifiers(): Promise<ActivePriceModifier[]> {
  const rows = await db.query<ActivePriceModifierRow>(
    `SELECT id, name, service_option_id, service_category_id,
            modifier_action, modifier_value, COALESCE(conditions, '{}'::jsonb) AS conditions,
            COALESCE(priority, 0) AS priority
     FROM price_modifiers
     WHERE is_active = true
       AND modifier_type = 'seasonal'
       AND COALESCE(conditions->>'type', '') = 'holiday_rate'
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())
     ORDER BY priority DESC, created_at DESC`,
  );

  return rows.flatMap((row): ActivePriceModifier[] => {
    const action = parsePriceModifierAction(row.modifier_action);
    const value = Number(row.modifier_value);
    if (!action || !Number.isFinite(value)) return [];

    const conditions = normalizeJsonObject(row.conditions);
    return [{
      id: row.id,
      name: row.name,
      serviceOptionId: row.service_option_id,
      serviceCategoryId: row.service_category_id,
      action,
      value,
      label: jsonStringField(conditions, 'label') ?? row.name,
      customerNotice: jsonStringField(conditions, 'customer_notice'),
      excludeCategorySlugs: new Set(jsonStringArray(conditions, 'exclude_category_slugs')),
      excludeGroupSlugs: new Set(jsonStringArray(conditions, 'exclude_group_slugs')),
      excludeOptionSlugs: new Set(jsonStringArray(conditions, 'exclude_option_slugs')),
      excludeNameIncludes: jsonStringArray(conditions, 'exclude_name_contains')
        .map((item) => item.toLocaleLowerCase('ru-RU')),
      priority: row.priority,
    }];
  });
}

function isPriceModifierEligible(modifier: ActivePriceModifier, context: PriceModifierContext): boolean {
  if (modifier.serviceOptionId && modifier.serviceOptionId !== context.optionId) return false;
  if (modifier.serviceCategoryId && modifier.serviceCategoryId !== context.categoryId) return false;
  if (context.categorySlug && modifier.excludeCategorySlugs.has(context.categorySlug)) return false;
  if (context.groupSlug && modifier.excludeGroupSlugs.has(context.groupSlug)) return false;
  if (modifier.excludeOptionSlugs.has(context.optionSlug)) return false;

  const normalizedName = context.optionName.toLocaleLowerCase('ru-RU');
  if (modifier.excludeNameIncludes.some((part) => normalizedName.includes(part))) return false;

  return true;
}

function applyPriceModifierAction(price: number, modifier: ActivePriceModifier): number {
  switch (modifier.action) {
    case 'multiply':
      return roundPrice(price * modifier.value);
    case 'add':
      return roundPrice(price + modifier.value);
    case 'subtract':
      return roundPrice(price - modifier.value);
    case 'override':
      return roundPrice(modifier.value);
  }
}

function priceModifierInput(price: number, modifier: ActivePriceModifier): number {
  if (modifier.action === 'multiply') {
    return roundPrice(price);
  }
  return price;
}

function applyActivePriceModifiers(
  price: number,
  context: PriceModifierContext,
  modifiers: readonly ActivePriceModifier[],
): PriceModifierApplication {
  if (modifiers.length === 0) return { price, applied: [] };

  let current = price;
  const applied: AppliedPriceModifier[] = [];
  for (const modifier of modifiers) {
    if (!isPriceModifierEligible(modifier, context)) continue;
    const input = priceModifierInput(current, modifier);
    const next = applyPriceModifierAction(input, modifier);
    if (next === input) continue;
    applied.push({ modifier, before: input, after: next });
    current = next;
  }

  return { price: current, applied };
}

function applyModifierToNullablePrice(
  price: number | null,
  context: PriceModifierContext,
  modifiers: readonly ActivePriceModifier[],
): number | null {
  if (price == null) return null;
  return applyActivePriceModifiers(price, context, modifiers).price;
}

async function applyActivePriceModifiersToCategories(categories: PricingCategory[]): Promise<PricingCategory[]> {
  const modifiers = await loadActivePriceModifiers();
  if (modifiers.length === 0) return categories;

  return categories.map((category) => ({
    ...category,
    optionGroups: category.optionGroups.map((group) => ({
      ...group,
      options: group.options.map((option) => {
        const context: PriceModifierContext = {
          optionId: option.id,
          optionSlug: option.slug,
          optionName: option.name,
          categoryId: category.id,
          categorySlug: category.slug,
          groupSlug: group.slug,
        };
        return {
          ...option,
          base_price: applyActivePriceModifiers(option.base_price, context, modifiers).price,
          price_online: applyModifierToNullablePrice(option.price_online, context, modifiers),
          price_studio: applyModifierToNullablePrice(option.price_studio, context, modifiers),
          price_next_unit: applyModifierToNullablePrice(option.price_next_unit, context, modifiers),
          price_max: applyModifierToNullablePrice(option.price_max, context, modifiers),
          promo_first_price: applyModifierToNullablePrice(option.promo_first_price, context, modifiers),
        };
      }),
    })),
  }));
}

function uniqueAppliedModifierLabels(applied: readonly AppliedPriceModifier[]): string[] {
  const labels: string[] = [];
  for (const application of applied) {
    const label = application.modifier.label;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

function uniqueAppliedModifierNotices(applied: readonly AppliedPriceModifier[]): string[] {
  const notices: string[] = [];
  for (const application of applied) {
    const notice = application.modifier.customerNotice ?? application.modifier.label;
    if (!notices.includes(notice)) notices.push(notice);
  }
  return notices;
}

/**
 * Находит лучший volume modifier для данной опции и количества.
 * Возвращает множитель (modifier_value) или null.
 */
function findBestVolumeModifier(
  modifiers: VolumeModifierRow[],
  optionId: string,
  categoryId: string | null,
  quantity: number,
  totalDistinctServices: number,
): VolumeModifierRow | null {
  let best: VolumeModifierRow | null = null;
  let bestThreshold = 0;

  for (const mod of modifiers) {
    // Scope: option-level > category-level > global
    const matchesOption = mod.service_option_id === optionId;
    const matchesCategory = !mod.service_option_id && mod.service_category_id && mod.service_category_id === categoryId;
    const matchesGlobal = !mod.service_option_id && !mod.service_category_id;

    if (!matchesOption && !matchesCategory && !matchesGlobal) continue;

    // min_services проверяется по числу РАЗНЫХ услуг в заказе, а не по qty одной позиции
    const minServices = mod.conditions['min_services'] as number | undefined;
    if (minServices != null) {
      if (totalDistinctServices < minServices) continue;
    }

    const minQty = (mod.conditions['min_qty'] as number | undefined)
      ?? (mod.conditions['min_quantity'] as number | undefined)
      ?? 1;

    if (minServices == null && quantity < minQty) continue;

    const maxQty = mod.conditions['max_qty'] as number | undefined;
    if (maxQty != null && quantity > maxQty) continue;

    // Берём наибольший подходящий порог (option-level приоритетнее)
    if (matchesOption && minQty >= bestThreshold) {
      best = mod;
      bestThreshold = minQty;
    } else if (!best?.service_option_id && matchesCategory && minQty >= bestThreshold) {
      best = mod;
      bestThreshold = minQty;
    } else if (!best?.service_option_id && !best?.service_category_id && matchesGlobal && minQty >= bestThreshold) {
      best = mod;
      bestThreshold = minQty;
    }
  }

  return best;
}

function categoryDegressiveScopeKey(
  categoryId: string,
  pricingGroupKey?: string | null,
): string {
  const normalized = typeof pricingGroupKey === 'string' ? pricingGroupKey.trim() : '';
  return normalized ? `${categoryId}:${normalized}` : categoryId;
}

/**
 * Проверяет, является ли клиент повторным (есть хотя бы один оплаченный заказ).
 * Ищет по phone, email или userId — любого достаточно.
 */
async function checkIsReturningCustomer(params: {
  phone?: string;
  email?: string;
  userId?: string;
}): Promise<boolean> {
  const { phone, email, userId } = params;
  if (!phone && !email && !userId) return false;

  // photo_print_orders — основная таблица заказов с contact_phone/contact_email
  if (phone || email) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (phone) {
      conditions.push(`contact_phone = $${idx++}`);
      values.push(phone);
    }
    if (email) {
      conditions.push(`contact_email = $${idx++}`);
      values.push(email);
    }
    const result = await db.queryOne<ExistsResult>(
      `SELECT EXISTS(
        SELECT 1 FROM photo_print_orders
        WHERE (${conditions.join(' OR ')})
          AND status NOT IN ('cancelled', 'new')
          AND payment_status = 'paid'
      ) AS has`,
      values,
    );
    if (result?.has) return true;
  }

  // pos_receipts — POS заказы с customer_phone
  if (phone) {
    const posResult = await db.queryOne<ExistsResult>(
      `SELECT EXISTS(
        SELECT 1 FROM pos_receipts
        WHERE customer_phone = $1
          AND is_refund = false
      ) AS has`,
      [phone],
    );
    if (posResult?.has) return true;
  }

  // orders — legacy таблица с client_id
  if (userId) {
    const ordersResult = await db.queryOne<ExistsResult>(
      `SELECT EXISTS(
        SELECT 1 FROM orders
        WHERE client_id = $1
          AND status = 'completed'
      ) AS has`,
      [userId],
    );
    if (ordersResult?.has) return true;
  }

  return false;
}

/**
 * Price Waterfall — полный расчёт цены.
 *
 * Порядок:
 * 1. Базовая цена (base_price / price_studio / price_online по каналу)
 * 2. Дегрессия (price_next_unit) ИЛИ подписка ИЛИ volume modifier — лучшая из трёх, НЕ совмещаются
 * 3. Скидка типа аккаунта: personal < business < education
 * 4. Бонусы лояльности (не более 15% от разрешённых позиций, не совмещаются со скидкой аккаунта)
 * 5. Промокод (НЕ суммируется с дегрессией)
 * 6. Партнёрская скидка (последняя, от итого)
 */
export async function calculatePriceWaterfall(input: PriceWaterfallInput): Promise<PriceWaterfallResult> {
  const waterfall: WaterfallStep[] = [];

  // Нормализуем channel → PriceChannel
  const priceChannel: PriceChannel = input.channel === 'pos' ? 'pickup'
    : input.channel === 'crm' ? 'pickup'
    : 'electronic';

  // --- Шаг 0: загрузить опции по ID ---
  const optionIds = input.items.map(i => i.serviceOptionId);
  if (optionIds.length === 0) {
    return {
      items: [], subtotal: 0, waterfall: [], isReturning: false,
      subscriberDiscount: null, accountDiscount: null, studentDiscount: null, loyaltyDiscount: null,
      promoDiscount: null, partnerDiscount: null,
      priceAdjustments: [],
      promoBlocked: false, promoBlockedReason: null,
      total: 0, savings: 0, detectedCombos: [],
    };
  }

  // --- Шаг 0a: определить, повторный ли клиент (для promo_first_price) ---
  const isReturning = await checkIsReturningCustomer({
    phone: input.customerPhone,
    email: input.customerEmail,
    userId: input.customerId,
  });

  const optionRows = await db.query<WaterfallOptionRow>(
    `SELECT so.id, so.slug, so.name,
            so.base_price, so.price_online, so.price_studio,
            so.price_next_unit, so.price_max, so.promo_first_price,
            so.option_group_id, so.product_id,
            og.service_category_id AS category_id,
            og.slug AS group_slug,
            sc.slug AS category_slug
     FROM service_options so
     JOIN option_groups og ON so.option_group_id = og.id
     JOIN service_categories sc ON og.service_category_id = sc.id
     WHERE so.id = ANY($1) AND so.is_active = true`,
    [optionIds]
  );

  const optionMap = new Map(optionRows.map(o => [o.id as string, o]));

  // --- Шаг 0b: проверка подписки ---
  let activeSubscription: { plan_id: string | null; subscriber_discount_percent: number; coveredProductIds: Set<string> } | null = null;

  async function loadSubscriptionWithProducts(planId: string): Promise<typeof activeSubscription> {
    const plan = await db.queryOne<Pick<SubscriptionPlans, 'subscriber_discount_percent'>>(
      `SELECT subscriber_discount_percent FROM subscription_plans WHERE id = $1`,
      [planId]
    );
    const planItems = await db.query<Pick<SubscriptionPlanItems, 'product_id'>>(
      `SELECT product_id FROM subscription_plan_items WHERE plan_id = $1`,
      [planId]
    );
    return {
      plan_id: planId,
      subscriber_discount_percent: plan ? parseFloat(String(plan.subscriber_discount_percent)) : 0,
      coveredProductIds: new Set(planItems.map(i => String(i.product_id))),
    };
  }

  if (input.customerPhone) {
    const sub = await checkSubscription(input.customerPhone);
    if (sub && sub.plan_id) {
      activeSubscription = await loadSubscriptionWithProducts(String(sub.plan_id));
    }
  } else if (input.customerId) {
    const sub = await checkSubscriptionByUserId(input.customerId);
    if (sub?.plan_id) {
      activeSubscription = await loadSubscriptionWithProducts(String(sub.plan_id));
    }
  }

  const accountProfile = await resolveAccountDiscountProfile({
    userId: input.customerId,
    phone: input.customerPhone,
  });

  // --- Шаг 0c: загрузить volume modifiers ---
  // Volume-скидки применяются ТОЛЬКО по явному запросу оператора (applyVolumeDiscount=true).
  // Для online клиентов — всегда (публичный сайт показывает скидки).
  const shouldApplyVolume = input.applyVolumeDiscount
    ?? (input.channel === 'online');
  const volumeModifiers = shouldApplyVolume ? await loadVolumeModifiers() : [];
  const activePriceModifiers = await loadActivePriceModifiers();

  // --- Шаг 0d: загрузить cross-category price_override правила ---
  const crossCategoryOverrides = new Map<string, number>();

  // --- Шаг 0e: загрузить degressive config по категориям ---
  const categoryIds = [...new Set(optionRows.map(o => o.category_id as string))];
  const degressiveConfigs = new Map<string, DegressiveConfig>();
  if (categoryIds.length > 0) {
    const catRows = await db.query<Pick<ServiceCategoryRow, 'id' | 'metadata'>>(
      `SELECT id, COALESCE(metadata, '{}'::jsonb) AS metadata
       FROM service_categories WHERE id = ANY($1)`,
      [categoryIds]
    );
    for (const row of catRows) {
      const config = parseDegressive(row.metadata);
      if (config) degressiveConfigs.set(row.id as string, config);
    }
  }

  // Загрузка cross-category price_override правил
  // source_category_id != NULL → если любая опция из source-категории в заказе,
  // target-опция получает override_price
  if (categoryIds.length > 1) {
    interface CrossRule { target_option_id: string; override_price: string; source_category_id: string }
    const crossRules = await db.query<CrossRule>(
      `SELECT target_option_id, override_price, source_category_id
       FROM option_rules
       WHERE rule_type = 'price_override'
         AND source_category_id IS NOT NULL
         AND is_active = true
         AND override_price IS NOT NULL`,
    );
    for (const rule of crossRules) {
      const sourcePresent = optionRows.some(
        o => (o.category_id as string) === rule.source_category_id,
      );
      if (sourcePresent) {
        crossCategoryOverrides.set(rule.target_option_id, parseFloat(rule.override_price));
      }
    }
  }

  // --- Шаг 1: Базовая цена + лучшая скидка (дегрессия / volume / подписка) ---

  // Сначала подсчитаем суммарное qty по каждой категории для category-level дегрессии
  // Считаем ТОЛЬКО опции из degressive_groups (по умолчанию — 'document-type')
  const categoryTotalQty = new Map<string, number>();
  for (const inputItem of input.items) {
    const opt = optionMap.get(inputItem.serviceOptionId);
    if (!opt) continue;
    const catId = opt.category_id as string;
    const degConfig = degressiveConfigs.get(catId);
    // Только опции из degressive_groups участвуют в подсчёте рангов
    if (!degConfig || !degConfig.degressive_groups.includes(opt.group_slug)) continue;
    const qty = Math.max(1, inputItem.quantity || 1);
    const scopeKey = categoryDegressiveScopeKey(catId, inputItem.pricingGroupKey);
    categoryTotalQty.set(scopeKey, (categoryTotalQty.get(scopeKey) || 0) + qty);
  }

  // Счётчик текущего ранга внутри категории (для category-level дегрессии)
  const categoryRankCounter = new Map<string, number>();

  const activeStudentDiscount = await getActiveStudentDiscount({
    userId: input.customerId,
    customerPhone: input.customerPhone,
  });
  const studentState: StudentDiscountPricingState | null = activeStudentDiscount ? {
    entitlementId: activeStudentDiscount.id,
    userId: activeStudentDiscount.user_id,
    printSheetsRemaining: activeStudentDiscount.summary.print_sheets_remaining,
    bindingRemaining: activeStudentDiscount.summary.binding_remaining,
    photosRemaining: activeStudentDiscount.summary.photo_remaining,
  } : null;
  let studentDiscountAmount = 0;
  let studentPrintSheets = 0;
  let studentBindingUses = 0;

  // Акция «Фото на студенческий 4×200»: одноразовый пакет на подтверждённом
  // образовательном аккаунте (без требования подписки). Применяется максимум к одной
  // позиции в корзине; промо-цена включается только при количестве = размеру пакета.
  const studentIdPhotoPromoState: StudentIdPhotoPromoState | null = await getStudentIdPhotoPromoState({
    userId: input.customerId,
    customerPhone: input.customerPhone,
  });
  let studentIdPhotoPromoConsumed: PriceWaterfallResult['studentIdPhotoPromoConsumed'] = null;

  const items: WaterfallItemResult[] = [];
  const accountDiscountCandidates: AccountDiscountCandidate[] = [];
  let loyaltyEligibleTotal = 0;
  const priceAdjustmentTotals = new Map<string, PriceAdjustmentSummary>();

  for (const inputItem of input.items) {
    const opt = optionMap.get(inputItem.serviceOptionId);
    if (!opt) continue;

    const quantity = Math.max(1, inputItem.quantity || 1);
    const channelPrice = resolveChannelPrice(opt, priceChannel);
    // Промо «первый заказ»: новые клиенты получают promo_first_price вместо channelPrice
    const promoFirst = opt.promo_first_price ? parseFloat(opt.promo_first_price) : null;
    const effectiveChannelPrice = (!isReturning && promoFirst != null) ? promoFirst : channelPrice;
    const crossOverride = crossCategoryOverrides.get(opt.id as string);
    const catId = opt.category_id as string;
    const priceModifierContext: PriceModifierContext = {
      optionId: opt.id as string,
      optionSlug: opt.slug,
      optionName: opt.name,
      categoryId: catId,
      categorySlug: opt.category_slug ?? null,
      groupSlug: opt.group_slug,
    };
    const basePriceBeforeModifiers = crossOverride != null ? crossOverride : effectiveChannelPrice;
    const basePriceResult = applyActivePriceModifiers(
      basePriceBeforeModifiers,
      priceModifierContext,
      activePriceModifiers,
    );
    const basePrice = basePriceResult.price;
    const degConfig = degressiveConfigs.get(catId);

    // Вариант A: Category-level дегрессия (из metadata.degressive)
    // Дегрессия применяется ТОЛЬКО к опциям из degressive_groups (по умолчанию — document-type)
    const isDegressiveEligible = degConfig?.degressive_groups.includes(opt.group_slug) ?? false;
    let categoryDegressiveTotal: number | null = null;
    const categoryDegressiveUnits: Array<{ rank: number; price: number }> = [];
    const categoryScopeKey = categoryDegressiveScopeKey(catId, inputItem.pricingGroupKey);
    if (isDegressiveEligible && degConfig && (categoryTotalQty.get(categoryScopeKey) ?? 0) > 1) {
      let currentRank = categoryRankCounter.get(categoryScopeKey) || 0;
      let total = 0;
      for (let i = 0; i < quantity; i++) {
        currentRank++;
        // P(n) = max(effectiveMin, basePrice - effectiveStep * (n-1))
        // degConfig.step/min_price привязаны к degConfig.reference_base.
        // Для опций с другой base_price пересчитываем пропорционально.
        const refBase = degConfig.reference_base || basePrice;
        const ratio = refBase > 0 ? basePrice / refBase : 1;
        const effectiveStep = Math.round(degConfig.step * ratio);
        const effectiveMin = Math.round(degConfig.min_price * ratio);

        const unitPrice = Math.max(effectiveMin, basePrice - effectiveStep * (currentRank - 1));
        total += unitPrice;
        categoryDegressiveUnits.push({ rank: currentRank, price: unitPrice });
      }
      categoryRankCounter.set(categoryScopeKey, currentRank);
      categoryDegressiveTotal = total;
    }

    // Вариант B: Per-item дегрессивная цена (price_next_unit) — fallback
    let degressiveTotal: number | null = null;
    const nextUnitRaw = opt.price_next_unit ? parseFloat(opt.price_next_unit) : null;
    const nextUnit = nextUnitRaw != null
      ? applyActivePriceModifiers(nextUnitRaw, priceModifierContext, activePriceModifiers).price
      : null;
    if (nextUnit != null && quantity > 1) {
      degressiveTotal = basePrice + nextUnit * (quantity - 1);
    }

    // Вариант C: Volume modifier (из price_modifiers)
    let volumeTotal: number | null = null;
    const volumeMod = findBestVolumeModifier(
      volumeModifiers, opt.id, catId, quantity, input.items.length
    );
    if (volumeMod) {
      const modValue = parseFloat(volumeMod.modifier_value);
      switch (volumeMod.modifier_action) {
        case 'multiply':
          volumeTotal = Math.round(basePrice * modValue * quantity);
          break;
        case 'subtract':
          volumeTotal = Math.max(0, (basePrice - modValue)) * quantity;
          break;
        case 'override':
          volumeTotal = modValue * quantity;
          break;
        default:
          volumeTotal = basePrice * quantity;
      }
    }

    const accountItemDiscount = resolveAccountItemDiscount(accountProfile, {
      slug: opt.slug,
      name: opt.name,
      categorySlug: opt.category_slug ?? null,
      groupSlug: opt.group_slug,
    });

    // Вариант D: Подписка (только для продуктов из плана подписки)
    // Если скидка аккаунта активна на этой же позиции, не складываем поверх нее
    // отдельный процент подписчика: заявленная цена аккаунта должна быть итоговой.
    let subscriptionTotal: number | null = null;
    if (activeSubscription && !accountItemDiscount && activeSubscription.subscriber_discount_percent > 0) {
      const productId = opt.product_id ? String(opt.product_id) : null;
      const isCoveredBySubscription = productId && activeSubscription.coveredProductIds.has(productId);
      if (isCoveredBySubscription) {
        const discountedUnit = Math.round(basePrice * (1 - activeSubscription.subscriber_discount_percent / 100));
        subscriptionTotal = discountedUnit * quantity;
      }
    }

    // Вариант E: студенческая цена аккаунта по специальной ссылке (не flyer promo code)
    const studentPricing = calculateStudentDiscountForItem({
      state: studentState,
      slug: opt.slug,
      name: opt.name,
      basePrice,
      quantity,
      printFillPercent: inputItem.printFillPercent,
    });
    const activeStudentPricing = studentPricing
      && (accountProfile.accountType !== 'education' || !isStudentPrintDiscountBenefit(studentPricing.benefitType))
      ? studentPricing
      : null;

    // Вариант F: акция «Фото на студенческий 4×200» (одноразовый пакет, не более одной
    // позиции в корзине). Промо-цена включается только при количестве = размеру пакета.
    const studentIdPhotoPromoPricing: StudentIdPhotoPromoPricing | null = studentIdPhotoPromoState && !studentIdPhotoPromoConsumed
      ? calculateStudentIdPhotoPromoForItem({
          state: studentIdPhotoPromoState,
          slug: opt.slug,
          name: opt.name,
          basePrice,
          quantity,
        })
      : null;

    // Выбрать лучший вариант (минимальная цена)
    const plainTotal = basePrice * quantity;
    const candidates: Array<{ total: number; type: WaterfallItemResult['discountApplied'] }> = [
      { total: plainTotal, type: 'none' },
    ];
    if (categoryDegressiveTotal != null) candidates.push({ total: categoryDegressiveTotal, type: 'category_degressive' });
    if (degressiveTotal != null) candidates.push({ total: degressiveTotal, type: 'degressive' });
    if (volumeTotal != null) candidates.push({ total: volumeTotal, type: 'volume' });
    if (subscriptionTotal != null) candidates.push({ total: subscriptionTotal, type: 'subscription' });
    if (activeStudentPricing) candidates.push({ total: activeStudentPricing.total, type: 'student' });
    if (studentIdPhotoPromoPricing) candidates.push({ total: studentIdPhotoPromoPricing.total, type: 'student_id_photo_promo' });

    candidates.sort((a, b) => a.total - b.total);
    const best = candidates[0]!;

    // price_max ограничение
    let finalItemPrice = best.total;
    const priceMaxRaw = opt.price_max ? parseFloat(opt.price_max) : null;
    const priceMax = priceMaxRaw != null
      ? applyActivePriceModifiers(priceMaxRaw, priceModifierContext, activePriceModifiers).price
      : null;
    if (priceMax != null && finalItemPrice > priceMax) {
      finalItemPrice = priceMax;
    }

    const unitPrice = quantity > 0 ? Math.round(finalItemPrice / quantity) : basePrice;
    const originalTotal = basePrice * quantity;
    const discountAmount = originalTotal - finalItemPrice;

    // Определяем categoryRank и discountLabel
    let categoryRank: number | null = null;
    let discountLabel: string | null = null;
    if (best.type === 'student' && activeStudentPricing) {
      discountLabel = activeStudentPricing.label;
    } else if (best.type === 'student_id_photo_promo' && studentIdPhotoPromoPricing) {
      discountLabel = studentIdPhotoPromoPricing.label;
    } else if (crossOverride != null && crossOverride < channelPrice) {
      discountLabel = `Комбо-скидка: ${channelPrice}→${crossOverride}₽`;
    }
    if (best.type === 'volume' && volumeMod) {
      const pct = volumeMod.modifier_action === 'multiply'
        ? Math.round((1 - parseFloat(volumeMod.modifier_value)) * 100)
        : 0;
      if (pct > 0) discountLabel = `Объём: −${pct}%`;
    }
    if (categoryDegressiveUnits.length > 0) {
      // Всегда устанавливаем categoryRank для категорий с дегрессией
      categoryRank = categoryDegressiveUnits[0]!.rank;
      if (best.type === 'category_degressive') {
        if (categoryRank === 1) {
          discountLabel = null; // 1-й комплект — без скидки
        } else if (quantity === 1) {
          const saving = basePrice - categoryDegressiveUnits[0]!.price;
          discountLabel = saving > 0 ? `${categoryRank}-й комплект: экономия ${saving}₽` : null;
        } else {
          const totalSaving = plainTotal - finalItemPrice;
          discountLabel = totalSaving > 0 ? `${categoryRank}–${categoryDegressiveUnits[categoryDegressiveUnits.length - 1]!.rank}-й комплекты: экономия ${totalSaving}₽` : null;
        }
      }
    }

    // F122: volume threshold hint — подсказка о следующем пороге скидки
    let volumeHint: string | null = null;
    const nextTiers = volumeModifiers
      .filter(mod => {
        if (mod.service_option_id && mod.service_option_id === (opt.id as string)) return true;
        if (!mod.service_option_id && mod.service_category_id && mod.service_category_id === catId) return true;
        if (!mod.service_option_id && !mod.service_category_id) return true;
        return false;
      })
      .map(mod => {
        const minQty = (mod.conditions['min_qty'] as number | undefined)
          ?? (mod.conditions['min_quantity'] as number | undefined)
          ?? 1;
        const modValue = parseFloat(mod.modifier_value);
        const pct = mod.modifier_action === 'multiply' ? Math.round((1 - modValue) * 100) : 0;
        return { minQty, pct };
      })
      .filter(t => t.minQty > quantity && t.pct > 0)
      .sort((a, b) => a.minQty - b.minQty);
    let nextThreshold: WaterfallItemResult['nextThreshold'] = null;
    if (nextTiers.length > 0) {
      const next = nextTiers[0]!;
      const rem = next.minQty - quantity;
      volumeHint = `ещё ${rem} шт и скидка ${next.pct}%!`;
      nextThreshold = {
        nextQuantity: next.minQty,
        remainingToNext: rem,
        nextDiscountPercent: next.pct,
      };
    }

    const appliedDiscountType: WaterfallItemResult['discountApplied'] = best.type === 'student'
      ? 'student'
      : best.type === 'student_id_photo_promo'
        ? 'student_id_photo_promo'
        : crossOverride != null ? 'cross_category' : best.type;
    const studentDiscountBenefit = best.type === 'student' && activeStudentPricing
      ? activeStudentPricing.benefitType
      : null;
    const studentDiscountUnits = best.type === 'student' && activeStudentPricing
      ? activeStudentPricing.units
      : 0;

    if (activeStudentPricing && best.type === 'student') {
      studentDiscountAmount += Math.max(0, discountAmount);
      if (isStudentPrintDiscountBenefit(activeStudentPricing.benefitType)) {
        studentPrintSheets += activeStudentPricing.units;
      } else {
        studentBindingUses += activeStudentPricing.units;
      }
      applyStudentDiscountUsageToState(studentState, activeStudentPricing);
    }

    if (studentIdPhotoPromoPricing && best.type === 'student_id_photo_promo' && studentIdPhotoPromoState) {
      studentIdPhotoPromoConsumed = {
        studentAccountId: studentIdPhotoPromoState.studentAccountId,
        userId: studentIdPhotoPromoState.userId,
        periodKey: studentIdPhotoPromoState.periodKey,
        units: studentIdPhotoPromoPricing.units,
        unitPrice: studentIdPhotoPromoPricing.unitPrice,
        // Берём скидку из самого правила акции (устойчиво к price_max-клампу finalItemPrice).
        discountAmount: Math.max(0, studentIdPhotoPromoPricing.discountAmount),
      };
    }

    const priceAdjustmentLabels = uniqueAppliedModifierLabels(basePriceResult.applied);
    const priceAdjustmentLabel = priceAdjustmentLabels.length > 0 ? priceAdjustmentLabels.join('; ') : null;
    const priceAdjustmentNotices = uniqueAppliedModifierNotices(basePriceResult.applied);
    const priceAdjustmentNotice = priceAdjustmentNotices.length > 0 ? priceAdjustmentNotices.join('; ') : null;
    let priceAdjustmentAmount = 0;
    for (const application of basePriceResult.applied) {
      const amount = roundPriceDelta((application.after - application.before) * quantity);
      if (amount === 0) continue;
      priceAdjustmentAmount += amount;
      const existing = priceAdjustmentTotals.get(application.modifier.id);
      priceAdjustmentTotals.set(application.modifier.id, {
        id: application.modifier.id,
        name: application.modifier.name,
        label: application.modifier.label,
        customerNotice: application.modifier.customerNotice,
        multiplier: application.modifier.action === 'multiply' ? application.modifier.value : null,
        amount: (existing?.amount ?? 0) + amount,
      });
    }

    const itemIndex = items.length;
    if (finalItemPrice > 0 && !isA3PhotoPrintLoyaltyExcluded({
      slug: opt.slug,
      name: opt.name,
      categorySlug: opt.category_slug,
      groupSlug: opt.group_slug,
    })) {
      loyaltyEligibleTotal += finalItemPrice;
    }
    items.push({
      serviceOptionId: opt.id,
      slug: opt.slug,
      name: opt.name,
      basePrice: channelPrice, // original price (before cross-category override)
      quantity,
      unitPrice,
      subtotal: finalItemPrice,
      priceAdjustmentLabel,
      priceAdjustmentNotice,
      priceAdjustmentAmount,
      discountApplied: appliedDiscountType,
      discountAmount: Math.max(0, discountAmount),
      discountLabel,
      studentDiscountBenefit,
      studentDiscountUnits,
      categoryRank,
      finalPrice: finalItemPrice,
      volumeHint,
      nextThreshold,
    });
    if (accountItemDiscount) {
      accountDiscountCandidates.push({
        itemIndex,
        rule: accountItemDiscount,
      });
    }
  }

  let subtotal = items.reduce((sum, i) => sum + i.finalPrice, 0);

  const baseDesc = isReturning
    ? 'Базовая цена (с дегрессией/volume/подпиской на уровне позиций)'
    : 'Базовая цена (с промо «первый заказ», дегрессией/volume/подпиской)';
  waterfall.push({
    step: 'base',
    description: baseDesc,
    amount: subtotal,
    runningTotal: subtotal,
  });

  let runningTotal = subtotal;

  const studentDiscount: StudentDiscountWaterfallSummary | null = activeStudentDiscount && studentDiscountAmount > 0 ? {
    entitlementId: activeStudentDiscount.id,
    userId: activeStudentDiscount.user_id,
    amount: Math.round(studentDiscountAmount),
    printSheets: studentPrintSheets,
    bindingUses: studentBindingUses,
    expiresAt: activeStudentDiscount.summary.expires_at,
  } : null;

  const subscriberItemDiscountAmount = items
    .filter(i => i.discountApplied === 'subscription')
    .reduce((sum, i) => sum + i.discountAmount, 0);
  const subscriberDiscount: { percent: number; amount: number } | null =
    activeSubscription && activeSubscription.subscriber_discount_percent > 0 && subscriberItemDiscountAmount > 0
      ? {
          percent: activeSubscription.subscriber_discount_percent,
          amount: Math.round(subscriberItemDiscountAmount),
        }
      : null;

  // --- Шаг 3: скидка типа аккаунта ---
  // Для education-аккаунта (studentState != null) объём льготных единиц ограничен
  // rolling-30 лимитом: документы (docsRemaining) и фото (photosRemaining). Сверх лимита —
  // обычная цена (мягкое превышение D3). Для personal/business studentState == null →
  // кап не применяется, поведение прежнее.
  let accountDiscount: PriceWaterfallResult['accountDiscount'] = null;
  const accountDiscountLines: AccountDiscountLineSummary[] = [];
  let accountDiscountEligibleTotal = 0;
  // Education-аккаунт ВСЕГДА капится rolling-30 лимитом. Если studentState отсутствует
  // (нет провижна льготы/просроченная запись), остаток = 0 → скидка НЕ применяется. Это
  // защита от «бесконечной» education-скидки (напр. подтверждённый без подписки или
  // экс-подписчик со «застрявшей» записью). Для personal/business кап не действует —
  // остаток ∞, поведение прежнее.
  const isEducationAccount = accountProfile.accountType === 'education';
  let eduDocsRemaining = studentState
    ? Math.max(0, Math.floor(studentState.printSheetsRemaining))
    : (isEducationAccount ? 0 : Number.POSITIVE_INFINITY);
  let eduPhotosRemaining = studentState
    ? Math.max(0, Math.floor(studentState.photosRemaining))
    : (isEducationAccount ? 0 : Number.POSITIVE_INFINITY);
  let eduDocsConsumed = 0;
  let eduPhotosConsumed = 0;
  for (const candidate of accountDiscountCandidates) {
    const item = items[candidate.itemIndex];
    if (!item || item.finalPrice <= 0 || candidate.rule.percent <= 0) continue;

    const qty = Math.max(1, item.quantity);
    // Сколько единиц позиции под льготой с учётом остатка лимита (только education).
    let coveredUnits = qty;
    if (isEducationAccount) {
      if (candidate.rule.kind === 'photo_print') {
        coveredUnits = Math.max(0, Math.min(qty, eduPhotosRemaining));
      } else if (candidate.rule.kind === 'document_print') {
        coveredUnits = Math.max(0, Math.min(qty, eduDocsRemaining));
      }
    }
    if (coveredUnits <= 0) continue;

    const coveredTotal = coveredUnits === qty ? item.finalPrice : (item.finalPrice * coveredUnits) / qty;
    const discountedCoveredTotal = Math.max(0, Math.round(coveredTotal * (1 - candidate.rule.percent / 100)));
    const amount = Math.min(coveredTotal, coveredTotal - discountedCoveredTotal);
    if (amount <= 0) continue;

    if (isEducationAccount) {
      if (candidate.rule.kind === 'photo_print') {
        eduPhotosRemaining -= coveredUnits;
        eduPhotosConsumed += coveredUnits;
      } else if (candidate.rule.kind === 'document_print') {
        eduDocsRemaining -= coveredUnits;
        eduDocsConsumed += coveredUnits;
      }
    }

    accountDiscountEligibleTotal += coveredTotal;
    accountDiscountLines.push({
      serviceOptionId: item.serviceOptionId,
      name: item.name,
      kind: candidate.rule.kind,
      label: candidate.rule.label,
      percent: candidate.rule.percent,
      amount,
      quantity: item.quantity,
    });
  }
  const accountDiscountAmount = accountDiscountLines.reduce((sum, line) => sum + line.amount, 0);
  if (accountDiscountAmount > 0 && runningTotal > 0) {
    const amount = Math.min(runningTotal, accountDiscountAmount);
    if (amount > 0) {
      const description = describeAccountDiscount(accountProfile, accountDiscountLines);
      accountDiscount = {
        accountType: accountProfile.accountType,
        label: accountProfile.label,
        source: accountProfile.source,
        percent: accountDiscountEligibleTotal > 0
          ? Math.round(accountDiscountAmount / accountDiscountEligibleTotal * 100)
          : accountProfile.discountPercent,
        amount,
        description,
        lines: accountDiscountLines,
      };
      runningTotal -= amount;
      waterfall.push({
        step: 'account_discount',
        description,
        amount: -amount,
        runningTotal,
      });
    }
  }

  // --- Шаг 4: Лояльность (максимум 15%, кроме A3 фотопечати; не суммируется со скидкой аккаунта) ---
  let loyaltyDiscount: LoyaltyDiscount | null = null;
  let loyaltyPointsToUse = input.loyaltyPointsToUse ?? 0;
  const accountDiscountBlocksLoyalty = (accountDiscount?.amount ?? 0) > 0;

  if (loyaltyPointsToUse > 0 && !accountDiscountBlocksLoyalty && input.loyaltyProfileId) {
    const profile = await findProfile({ profileId: input.loyaltyProfileId });
    if (!profile || profile.points < loyaltyPointsToUse) {
      loyaltyPointsToUse = profile ? profile.points : 0;
    }
  }

  if (loyaltyPointsToUse > 0 && !accountDiscountBlocksLoyalty && loyaltyEligibleTotal > 0) {
    const rublesValue = Math.floor(loyaltyPointsToUse * LOYALTY_XP_TO_RUB);
    const maxLoyaltyDiscount = Math.floor(loyaltyEligibleTotal * LOYALTY_MAX_DISCOUNT_RATIO);
    const amount = Math.min(rublesValue, maxLoyaltyDiscount, runningTotal);
    if (amount > 0) {
      const pointsUsed = Math.min(loyaltyPointsToUse, loyaltyPointsRequiredForRubles(amount));
      loyaltyDiscount = { points_used: pointsUsed, amount };
      runningTotal -= amount;
      waterfall.push({
        step: 'loyalty',
        description: `Бонусы лояльности: ${pointsUsed} = ${amount}₽ (макс 15%)`,
        amount: -amount,
        runningTotal,
      });
    }
  }

  // --- Шаг 5: Промокод (НЕ суммируется с дегрессией) ---
  let promoDiscount: PromoDiscount | null = null;
  const hasDegressive = items.some(i => i.discountApplied === 'degressive' || i.discountApplied === 'category_degressive');
  const hasStudentDiscount = !!studentDiscount && studentDiscount.amount > 0;
  const hasStudentIdPhotoPromo = items.some(i => i.discountApplied === 'student_id_photo_promo');
  const promoBlocked = !!(input.promoCode && (hasDegressive || hasStudentDiscount || hasStudentIdPhotoPromo));

  if (input.promoCode && !hasDegressive && !hasStudentDiscount && !hasStudentIdPhotoPromo) {
    const promoCode = input.promoCode.trim().toUpperCase();
    const promoRows = await db.query<PromotionWaterfallLookupRow>(
      `SELECT id, title, discount_percent, discount_amount, usage_limit, usage_count, service_slug
       FROM promotions
       WHERE UPPER(promo_code) = $1
         AND is_active = true
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at >= NOW())`,
      [promoCode]
    );

    // Выбрать лучший match: сначала per-service (если в корзине есть позиции из этой категории),
    // затем generic (service_slug IS NULL), затем любой
    const cartCategorySlugs = new Set<string>();
    for (const row of optionRows) {
      if (row.category_slug) {
        cartCategorySlugs.add(row.category_slug);
      }
    }
    const promo = promoRows.find(p => p.service_slug && cartCategorySlugs.has(p.service_slug))
      || promoRows.find(p => !p.service_slug)
      || promoRows[0] || null;

    if (promo && (!promo.usage_limit || (promo.usage_count ?? 0) < promo.usage_limit)) {
      let amount = 0;
      if (promo.discount_percent) {
        amount = Math.round(runningTotal * promo.discount_percent / 100);
      } else if (promo.discount_amount) {
        amount = Math.min(parseFloat(promo.discount_amount), runningTotal);
      }
      if (amount > 0) {
        promoDiscount = { code: promoCode, title: promo.title, amount, percent: promo.discount_percent };
        runningTotal -= amount;
        waterfall.push({
          step: 'promo',
          description: `Промокод ${promoCode}: -${amount}₽`,
          amount: -amount,
          runningTotal,
        });
      }
    }
  }

  // --- Шаг 6: Партнёрская скидка (fallback от промокода) ---
  let partnerDiscount: { percent: number; amount: number } | null = null;
  if (input.promoCode && !promoDiscount && !promoBlocked) {
    const partnerPromo = await getPartnerPromoDiscount(input.promoCode.trim().toUpperCase());
    if (partnerPromo && partnerPromo.discount_percent > 0) {
      const amount = Math.round(runningTotal * partnerPromo.discount_percent / 100);
      if (amount > 0) {
        partnerDiscount = { percent: partnerPromo.discount_percent, amount };
        runningTotal -= amount;
        waterfall.push({
          step: 'partner',
          description: `Партнёрская скидка ${partnerPromo.discount_percent}%: -${amount}₽`,
          amount: -amount,
          runningTotal,
        });
      }
    }
  }

  runningTotal = applyMinimumCheckStep(runningTotal, waterfall);
  const total = runningTotal;
  const lineItemSavings = items.reduce((sum, item) => sum + item.discountAmount, 0);
  const savings = Math.max(0, roundPricingMoney(lineItemSavings + (subtotal - total)));

  // --- Combo detection (hint only, not auto-applied) ---
  const detectedCombos = await detectComboHints(optionIds);

  return {
    items,
    subtotal,
    waterfall,
    isReturning,
    subscriberDiscount,
    accountDiscount,
    studentDiscount,
    loyaltyDiscount,
    promoDiscount,
    partnerDiscount,
    priceAdjustments: Array.from(priceAdjustmentTotals.values()),
    promoBlocked,
    promoBlockedReason: promoBlocked
      ? ((hasStudentDiscount || hasStudentIdPhotoPromo) ? 'student_discount_applied' as const : 'degressive_discount_applied' as const)
      : null,
    total,
    savings,
    detectedCombos,
    educationVolumeConsumed: studentState && (eduDocsConsumed > 0 || eduPhotosConsumed > 0)
      ? {
          entitlementId: studentState.entitlementId,
          userId: studentState.userId,
          documents: eduDocsConsumed,
          photos: eduPhotosConsumed,
        }
      : null,
    studentIdPhotoPromoConsumed,
  };
}

/** Вспомогательная: выбирает цену по каналу из raw DB row */
function resolveChannelPrice(
  opt: { base_price: string; price_online: string | null; price_studio: string | null },
  channel: PriceChannel,
): number {
  const normalized = normalizePriceChannel(channel);
  if (normalized === 'studio' && opt.price_studio) return parseFloat(opt.price_studio);
  if (normalized === 'online' && opt.price_online) return parseFloat(opt.price_online);
  return parseFloat(opt.base_price);
}

/**
 * Resolve category slug + selected option slugs → waterfall items (serviceOptionId + quantity).
 * Bridge between slug-based chat flow and UUID-based calculatePriceWaterfall.
 */
export async function resolveSlugsToWaterfallItems(params: {
  categorySlug: string;
  selectedOptions: Record<string, string[]>;
  photoCount?: number;
}): Promise<Array<{ serviceOptionId: string; quantity: number }>> {
  const { categorySlug, selectedOptions, photoCount = 1 } = params;
  const category = await getCategoryBySlug(categorySlug);
  if (!category) return [];

  const items: Array<{ serviceOptionId: string; quantity: number }> = [];
  for (const [groupSlug, slugs] of Object.entries(selectedOptions)) {
    if (!Array.isArray(slugs)) continue;
    const group = category.optionGroups.find(g => g.slug === groupSlug);
    if (!group) continue;

    for (const slug of slugs) {
      const option = group.options.find(o => o.slug === slug);
      if (!option) continue;
      // processing-level: per-photo (quantity = photoCount), everything else — 1
      const qty = (groupSlug === 'processing-level' && photoCount > 1) ? photoCount : 1;
      items.push({ serviceOptionId: option.id, quantity: qty });
    }
  }
  return items;
}

/**
 * Get next volume discount threshold hints for a given option/category and current quantity.
 * Returns the next tier the customer can reach by adding more items.
 */
export interface VolumeThresholdHint {
  nextTierMinQty: number;
  remaining: number;
  discountPercent: number;
  modifierAction: string;
  modifierValue: number;
  label: string;
}

export async function getVolumeThresholdHints(params: {
  serviceOptionId?: string;
  serviceCategoryId?: string;
  currentQty: number;
}): Promise<VolumeThresholdHint | null> {
  const { serviceOptionId, serviceCategoryId, currentQty } = params;
  const modifiers = await loadVolumeModifiers();

  // Filter modifiers relevant to this option/category
  const relevant = modifiers.filter(mod => {
    if (mod.service_option_id && mod.service_option_id === serviceOptionId) return true;
    if (!mod.service_option_id && mod.service_category_id && mod.service_category_id === serviceCategoryId) return true;
    if (!mod.service_option_id && !mod.service_category_id) return true;
    return false;
  });

  // Find the next tier (min_qty > currentQty, sorted ascending)
  const tiers = relevant
    .map(mod => {
      const minQty = (mod.conditions['min_qty'] as number | undefined)
        ?? (mod.conditions['min_quantity'] as number | undefined)
        ?? 1;
      const modValue = parseFloat(mod.modifier_value);
      const discountPercent = mod.modifier_action === 'multiply'
        ? Math.round((1 - modValue) * 100)
        : 0;
      return { mod, minQty, modValue, discountPercent };
    })
    .filter(t => t.minQty > currentQty && t.discountPercent > 0)
    .sort((a, b) => a.minQty - b.minQty);

  if (tiers.length === 0) return null;

  const next = tiers[0]!;
  const remaining = next.minQty - currentQty;

  return {
    nextTierMinQty: next.minQty,
    remaining,
    discountPercent: next.discountPercent,
    modifierAction: next.mod.modifier_action,
    modifierValue: next.modValue,
    label: `ещё ${remaining} шт и скидка ${next.discountPercent}%!`,
  };
}

/** Detect combo packages that match or partially match selected option IDs */
async function detectComboHints(optionIds: string[]): Promise<DetectedComboHint[]> {
  if (optionIds.length === 0) return [];

  interface ComboHintRow {
    slug: string;
    name: string;
    combo_price: string;
    original_total: string | null;
    savings_label: string | null;
    total_items: string;
    matched_items: string;
    missing_option_slugs: string[] | null;
  }

  const rows = await db.query<ComboHintRow>(
    `SELECT cp.slug, cp.name, cp.combo_price, cp.original_total, cp.savings_label,
            COUNT(cpi.id) AS total_items,
            COUNT(cpi.id) FILTER (WHERE cpi.service_option_id = ANY($1)) AS matched_items,
            ARRAY_AGG(so.slug) FILTER (WHERE cpi.service_option_id != ALL($1)) AS missing_option_slugs
     FROM combo_packages cp
     JOIN combo_package_items cpi ON cpi.combo_package_id = cp.id
     JOIN service_options so ON cpi.service_option_id = so.id
     WHERE cp.is_active = true
     GROUP BY cp.id, cp.slug, cp.name, cp.combo_price, cp.original_total, cp.savings_label
     HAVING COUNT(cpi.id) FILTER (WHERE cpi.service_option_id = ANY($1)) > 0
     ORDER BY COUNT(cpi.id) FILTER (WHERE cpi.service_option_id = ANY($1)) DESC`,
    [optionIds],
  );

  return rows.map(r => ({
    slug: r.slug,
    name: r.name,
    combo_price: parseFloat(r.combo_price),
    original_total: r.original_total ? parseFloat(r.original_total) : null,
    savings_label: r.savings_label,
    fully_matched: parseInt(r.matched_items) === parseInt(r.total_items),
    missing_option_slugs: r.missing_option_slugs || [],
  }));
}

/**
 * Feature-Level Pricing — recalc unit_price на основе disabled_features
 * (migration 126 service_option_features).
 *
 * Возвращает server-trusted цену для сравнения с клиентской в /crm-create
 * и PATCH /items. Если для option нет feature-rows (legacy), `hasFeatures = false` —
 * caller должен оставить старую клиентскую цену (fallback на legacy behavior).
 */
export interface FeatureLevelUnitPriceResult {
  /** Sum of enabled features; 0 если hasFeatures=false. */
  unitPrice: number;
  /** Имена из disabled_features, не найденные в service_option_features. */
  unknownFeatures: string[];
  /** Все features option'а сняты → невалидное состояние (ProcessingMax − 7 features). */
  allDisabled: boolean;
  /** Есть ли вообще feature-level rows для этого option (false = legacy). */
  hasFeatures: boolean;
}

export async function calculateFeatureLevelUnitPrice(params: {
  serviceOptionId: string;
  disabledFeatures?: string[];
}): Promise<FeatureLevelUnitPriceResult> {
  const { serviceOptionId, disabledFeatures = [] } = params;

  const rows = await db.query<Pick<ServiceOptionFeatureRow, 'name' | 'price'>>(
    `SELECT name, price
     FROM service_option_features
     WHERE service_option_id = $1 AND is_active = true`,
    [serviceOptionId],
  );

  if (rows.length === 0) {
    return { unitPrice: 0, unknownFeatures: [], allDisabled: false, hasFeatures: false };
  }

  const activeNames = new Set(rows.map(r => r.name));
  const unknownFeatures = disabledFeatures.filter(n => !activeNames.has(n));
  const disabledSet = new Set(disabledFeatures.filter(n => activeNames.has(n)));

  const unitPrice = rows
    .filter(r => !disabledSet.has(r.name))
    .reduce((sum, r) => sum + parseFloat(r.price), 0);

  return {
    unitPrice: Math.round(unitPrice * 100) / 100,
    unknownFeatures,
    allDisabled: disabledSet.size >= rows.length,
    hasFeatures: true,
  };
}
