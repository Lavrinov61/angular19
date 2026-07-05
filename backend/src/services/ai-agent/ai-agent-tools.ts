/**
 * Tool-registry + executor для AI-чат-агента.
 *   - Этап 1 (suggest) / Этап 2 (bot): read-инструменты.
 *   - Этап 3 (оформление): write-draft инструменты (черновик заказа/подписки) +
 *     request_payment_link (ссылка на оплату). Включаются ТОЛЬКО за флагом
 *     config.ai.orderingEnabled (default false): при выключенном флаге реестр
 *     отдаёт ровно поведение Этапа 2 (write-draft tools не в декларациях и не
 *     исполняются).
 *
 * ⛔ ГЛАВНЫЙ ПРИНЦИП БЕЗОПАСНОСТИ ДЕНЕГ (Этап 3):
 *   Бот деньги НЕ трогает. Он (1) формирует ЧЕРНОВИК (pending), (2) генерит
 *   ССЫЛКУ на оплату (generateChatPaymentUrl), (3) отдаёт её клиенту текстом.
 *   Платит клиент сам. Сумму считает ТОЛЬКО сервер (пересчёт из калькулятора /
 *   из плана / перечитыванием заказа), сумма из аргументов модели игнорируется
 *   полностью. Прямых платежей / активации рекуррента / record-payment в реестре
 *   нет в принципе (hard-deny), и appear-as-tool они не могут.
 *
 * Архитектурный инвариант безопасности:
 *   - executeTool: единственная точка входа. Неизвестное имя -> 'denied'.
 *     'read' исполняется всегда; 'write_draft'/'confirm_required' исполняются
 *     ТОЛЬКО при orderingEnabled (иначе 'denied'); 'forbidden' -> 'denied'.
 *   - rawArgs от модели проходят JSON.parse -> zodSchema.safeParse. Любой провал
 *     даёт outcome 'rejected_schema' (handler не вызывается).
 *   - Персональные идентификаторы (телефон, контакт) берутся ИЗ ctx, а не из
 *     аргументов модели: модель не может расширить скоуп на чужие данные.
 *   - Идемпотентность write-draft/confirm: idempotency_key =
 *     sha256(conversationId + action_type + canonical(validated_args)).
 *     Повторный ход с теми же аргументами возвращает уже созданный черновик/
 *     ссылку (реестр ai_agent_confirmations + advisory-lock), дублей нет.
 *   - Порог: серверная сумма > config.ai.maxAutoOrder -> НЕ оформляем,
 *     возвращаем { escalate:true, reason:'amount_over_threshold' }.
 *
 * Тонкие обёртки над реальными сервисами (НЕ менять сами сервисы):
 *   pricing-engine.service.ts, subscription.service.ts, student-discount.service.ts,
 *   chat-order.service.ts (handleFinalizeOrder), payment-link.service.ts.
 */

import crypto from 'crypto';
import { z, type ZodType } from 'zod';
import db from '../../database/db.js';
import { config } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  getCategories,
  getCategoryBySlug,
  calculatePrice,
  validateSelection,
  type DeliveryMethodParam,
} from '../pricing-engine.service.js';
import {
  checkSubscription,
  checkSubscriptionByUserId,
  getPlanById,
  initSubscription,
} from '../subscription.service.js';
import { getStudentDiscountForPhone } from '../student-discount.service.js';
import { handleFinalizeOrder } from '../../routes/chat/chat-order.service.js';
import { generateChatPaymentUrl } from '../payment-link.service.js';
import { getStudiosEffectiveStatus, STUDIO_SHORT_LABELS } from '../studio-status.service.js';
import { mergeMetadata, removeMetadataKeys } from '../../routes/chat/conversation-adapter.js';
import type { ChannelType } from '../connectors/core/types.js';
import type { ToolDef } from '../ai-providers/provider.interface.js';

const log = createLogger('ai-agent-tools');

// ============================================================================
// Контракт
// ============================================================================

export type RiskClass = 'read' | 'write_draft' | 'confirm_required' | 'forbidden';

export interface ToolContext {
  conversationId: string;
  contactId: string | null;
  userId: string | null;
  phone: string | null;
  /**
   * Канал диалога. Опционален: если не задан, резолвится из conversations по
   * conversationId. Нужен только для verified-identity-гейта персональных
   * tools (крипто-доверенный webhook vs слабый канал). Расширение контракта
   * аддитивное, getToolDeclarations/executeTool сигнатуры не меняются.
   */
  channel?: ChannelType | null;
  /**
   * Сильная внешняя проверка личности вне мессенджер-каналов. Используется для
   * PSTN-звонка: backend получил подписанный Voximplant webhook, а телефонный
   * номер берётся из самого звонка, не из аргументов модели.
   */
  trustedIdentity?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  riskClass: RiskClass;
  zodSchema: ZodType;
  /** JSON Schema для function-calling. Задаётся рядом с zodSchema (без авто-конверсии). */
  jsonSchema: object;
  handler: (args: unknown, ctx: ToolContext) => Promise<unknown>;
}

export type ToolOutcome = 'executed' | 'rejected_schema' | 'rejected_policy' | 'error' | 'denied';

export interface ToolExecutionResult {
  outcome: ToolOutcome;
  result?: unknown;
  validatedArgs?: unknown;
  rejectedReason?: string;
}

// ============================================================================
// Хелперы
// ============================================================================

/** Единый ответ «заказ не найден»: одинаков для чужого, несуществующего и без скоупа. */
const ORDER_NOT_FOUND = { found: false as const } satisfies { found: false };

function normalizePhoneTail(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const tail = phone.replace(/\D/g, '').slice(-10);
  return tail.length === 10 ? tail : null;
}

const deliveryMethodSchema = z.enum(['electronic', 'pickup', 'postal']);

// ============================================================================
// Verified-identity (гейт персональных tools)
// ============================================================================

/** Единый ответ персональных tools, когда identity не подтверждена. */
const NEED_VERIFICATION = { need_verification: true as const } satisfies { need_verification: true };

/**
 * Каналы с криптографически доверенным webhook отправителя:
 *   - telegram: secret-заголовок;
 *   - whatsapp/instagram: HMAC x-hub-signature-256.
 * Для них факт «сообщение пришло от этого external_user_id» доказан транспортом,
 * поэтому привязанная контакту identity надёжна сама по себе.
 * Слабые каналы (vk/max: secret в body, allow при отсутствии; email: poller; web:
 * анонимный visitor) НЕ доверенные: персональные ПДн отдаём только при явной
 * верификации контакта (channel_users.verified_at).
 */
const TRUSTED_WEBHOOK_CHANNELS: ReadonlySet<ChannelType> = new Set<ChannelType>([
  'telegram',
  'whatsapp',
  'instagram',
]);

/** Все известные каналы (для нормализации произвольной строки в ChannelType). */
const KNOWN_CHANNELS: ReadonlySet<ChannelType> = new Set<ChannelType>([
  'telegram',
  'vk',
  'whatsapp',
  'instagram',
  'max',
  'email',
  'web',
]);

/**
 * Нормализует произвольную строку канала (например RunAgentParams.channel: string)
 * в ChannelType. Неизвестное/пустое -> null (трактуется как недоверенный канал в
 * resolveIdentity/shouldGateIdentity, fail-closed). Используется orchestrator-ом
 * для проброса канала текущего сообщения в ToolContext без слепого каста.
 */
export function normalizeChannel(value: string | null | undefined): ChannelType | null {
  if (value && KNOWN_CHANNELS.has(value as ChannelType)) return value as ChannelType;
  return null;
}

/**
 * Идентичность, перечитанная из БД по ctx.contactId (НЕ из ctx.phone/ctx.userId,
 * которые могут быть неверифицированным visitor_phone от слабого канала).
 *   - verified: есть ли у контакта запись channel_users с verified_at IS NOT NULL
 *     ИМЕННО для канала текущего сообщения (channel = ctx.channel). Верификация
 *     на ЧУЖОМ канале того же контакта НЕ считается: иначе verified-telegram
 *     открывал бы выдачу ПДн в разговоре по max/vk/email того же contact_id
 *     (кросс-канальная утечка: слабый канал склеивает контакт по shared-телефону
 *     без верификации, см. shouldGateIdentity).
 *   - phone/userId: берутся из верифицированной записи ТЕКУЩЕГО канала
 *     (приоритет), иначе из самого контакта (для крипто-каналов, где контакт
 *     достоверен и без явной отметки verified_at).
 */
interface ResolvedIdentity {
  verified: boolean;
  phone: string | null;
  userId: string | null;
}

interface IdentityRow {
  contact_phone: string | null;
  contact_user_id: string | null;
  verified_phone: string | null;
  verified_user_id: string | null;
  verified: boolean;
}

async function resolveIdentity(ctx: ToolContext, channel: ChannelType | null): Promise<ResolvedIdentity> {
  if (!ctx.contactId) {
    return { verified: false, phone: null, userId: null };
  }

  // Один проход: телефон/аккаунт самого контакта + (если есть) данные из
  // верифицированной записи channel_users этого контакта НА КАНАЛЕ ТЕКУЩЕГО
  // сообщения. Верифицированная запись приоритетна как источник phone/userId.
  // Канал передаётся параметром ($2): NULL/неизвестный канал -> verified-запись
  // не подбирается (verified=false), решение остаётся за shouldGateIdentity.
  const row = await db.queryOne<IdentityRow>(
    `SELECT
        c.phone AS contact_phone,
        c.user_id::text AS contact_user_id,
        cu.phone AS verified_phone,
        cu.user_id::text AS verified_user_id,
        (cu.id IS NOT NULL) AS verified
       FROM contacts c
       LEFT JOIN LATERAL (
         SELECT cu.id, cu.phone, cu.user_id
           FROM channel_users cu
          WHERE cu.contact_id = c.id
            AND cu.verified_at IS NOT NULL
            AND cu.channel = $2
          ORDER BY cu.verified_at DESC
          LIMIT 1
       ) cu ON true
      WHERE c.id = $1
        AND c.deleted_at IS NULL
      LIMIT 1`,
    [ctx.contactId, channel],
  );

  if (!row) {
    return { verified: false, phone: null, userId: null };
  }

  return {
    verified: row.verified,
    phone: row.verified_phone ?? row.contact_phone,
    userId: row.verified_user_id ?? row.contact_user_id,
  };
}

/**
 * Канал диалога: из ctx.channel, иначе из conversations по conversationId.
 * null -> трактуем как недоверенный (fail-closed).
 */
async function resolveChannel(ctx: ToolContext): Promise<ChannelType | null> {
  if (ctx.channel) return ctx.channel;
  const row = await db.queryOne<{ channel: ChannelType }>(
    `SELECT channel FROM conversations WHERE id = $1 LIMIT 1`,
    [ctx.conversationId],
  );
  return row?.channel ?? null;
}

/**
 * Нужно ли блокировать выдачу ПДн (need_verification).
 * Решение принимается по каналу ТЕКУЩЕГО сообщения (не по любому каналу контакта):
 *   - identity.verified -> есть verified channel_users ИМЕННО на этом канале
 *     (resolveIdentity уже отфильтровал по каналу) -> пускаем;
 *   - иначе пускаем только на крипто-доверенном webhook-канале (привязка
 *     контакта доказана транспортом);
 *   - слабый/неизвестный канал без верификации на нём -> блокируем.
 * Канал резолвится один раз в caller и прокидывается и сюда, и в resolveIdentity.
 */
function shouldGateIdentity(identity: ResolvedIdentity, channel: ChannelType | null, trustedIdentity = false): boolean {
  if (trustedIdentity) return false;
  // Верифицирован на текущем канале -> пускаем.
  if (identity.verified) return false;
  // Иначе пускаем только на крипто-доверенном webhook-канале.
  return !(channel && TRUSTED_WEBHOOK_CHANNELS.has(channel));
}

/**
 * Единая точка для персональных tools: резолвит канал текущего сообщения один
 * раз, перечитывает идентичность с учётом канала и решает, гейтить ли выдачу ПДн.
 */
async function resolveIdentityWithGate(
  ctx: ToolContext,
): Promise<{ identity: ResolvedIdentity; gated: boolean }> {
  const channel = await resolveChannel(ctx);
  const identity = await resolveIdentity(ctx, channel);
  return { identity, gated: shouldGateIdentity(identity, channel, ctx.trustedIdentity === true) };
}

// ============================================================================
// Read-инструменты Этапа 1
// ============================================================================

// --- get_service_catalog ---------------------------------------------------
const getServiceCatalogSchema = z
  .object({
    categorySlug: z.preprocess(
      value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(1).max(120).optional(),
    ),
    query: z.preprocess(
      value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(1).max(120).optional(),
    ),
  })
  .strict();

const getServiceCatalogJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    categorySlug: {
      type: 'string',
      description: 'Опционально: slug категории для одной услуги. Без него возвращается весь каталог.',
    },
    query: {
      type: 'string',
      description: 'Опционально: человеческий поисковый запрос по услуге, например визитки, макет, business cards.',
    },
  },
};

function normalizeCatalogTerm(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^a-zа-я0-9]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactCatalogTerm(value: string): string {
  return normalizeCatalogTerm(value).replace(/\s+/g, '');
}

function categorySearchText(category: Awaited<ReturnType<typeof getCategories>>[number]): string {
  const parts = [
    category.slug,
    category.name,
    category.description ?? '',
    ...(category.ai_aliases ?? []),
  ];

  for (const group of category.optionGroups) {
    parts.push(group.slug, group.name, group.description ?? '');
    for (const option of group.options) {
      parts.push(option.slug, option.name, option.description ?? '', ...(option.features ?? []));
    }
  }

  return parts.join(' ');
}

function matchesCatalogQuery(
  category: Awaited<ReturnType<typeof getCategories>>[number],
  query: string,
): boolean {
  const normalizedQuery = normalizeCatalogTerm(query);
  const compactQuery = compactCatalogTerm(query);
  if (!normalizedQuery) return false;

  const normalizedText = normalizeCatalogTerm(categorySearchText(category));
  const compactText = compactCatalogTerm(categorySearchText(category));

  return normalizedText.includes(normalizedQuery)
    || compactText.includes(compactQuery)
    || (category.ai_aliases ?? []).some(alias => compactCatalogTerm(alias) === compactQuery);
}

async function resolveCatalogCategories(
  categorySlug: string | undefined,
  query: string | undefined,
): Promise<Awaited<ReturnType<typeof getCategories>>> {
  const search = categorySlug ?? query;
  if (!search) return getCategories();

  const exact = categorySlug ? await getCategoryBySlug(categorySlug) : null;
  if (exact) return [exact];

  const categories = await getCategories();
  const matches = categories.filter(category => matchesCatalogQuery(category, search));
  return matches.length > 0 ? matches : categories;
}

type CatalogCategory = Awaited<ReturnType<typeof getCategories>>[number];
type CatalogOptionGroup = CatalogCategory['optionGroups'][number];
type CatalogServiceOption = CatalogOptionGroup['options'][number];
type CatalogPricingRole = 'base_service' | 'addon' | 'optional_print' | 'unknown';
type CatalogPriceBehavior =
  | 'base_price_starts_total'
  | 'price_adds_to_base_total'
  | 'optional_price_adds_to_base_total'
  | 'use_calculate_price_for_total';

interface CatalogPricingExample {
  label: string;
  selected_options: string[];
  formula: string;
  total: number;
}

interface CatalogPricingGuidance {
  model: 'base_service_plus_addons';
  total_price_source: 'calculate_price';
  total_requires_calculate_price: true;
  rules: string[];
  included: string[];
  examples: CatalogPricingExample[];
}

function inferCatalogGroupPricingRole(
  category: CatalogCategory,
  group: CatalogOptionGroup,
): CatalogPricingRole {
  if (group.slug === 'processing-level' || group.slug === 'speed' || group.slug === 'extras') {
    return 'addon';
  }
  if (category.slug === 'portrait' && group.slug === 'portrait-format') {
    return 'optional_print';
  }
  if (category.slug === 'photo-docs' && group.slug === 'document-type') {
    return 'base_service';
  }
  if (category.slug === 'portrait' && group.slug === 'portrait-processing') {
    return 'base_service';
  }
  if (group.is_required) {
    return 'base_service';
  }
  return 'unknown';
}

function priceBehaviorForRole(role: CatalogPricingRole): CatalogPriceBehavior {
  if (role === 'base_service') return 'base_price_starts_total';
  if (role === 'addon') return 'price_adds_to_base_total';
  if (role === 'optional_print') return 'optional_price_adds_to_base_total';
  return 'use_calculate_price_for_total';
}

function pricingNoteForRole(role: CatalogPricingRole): string {
  if (role === 'base_service') {
    return 'Базовая услуга; с неё начинается итоговая цена.';
  }
  if (role === 'addon') {
    return 'Доплата к базовой услуге; не самостоятельная итоговая цена.';
  }
  if (role === 'optional_print') {
    return 'Опциональная печать; прибавляется к базовой услуге при выборе.';
  }
  return 'Для точного смысла и итога используй calculate_price.';
}

function findCatalogOption(
  category: CatalogCategory,
  optionSlug: string,
): CatalogServiceOption | null {
  for (const group of category.optionGroups) {
    const option = group.options.find(candidate => candidate.slug === optionSlug);
    if (option) return option;
  }
  return null;
}

function buildCatalogPricingExample(
  category: CatalogCategory,
  label: string,
  optionSlugs: string[],
): CatalogPricingExample | null {
  const options: CatalogServiceOption[] = [];
  for (const slug of optionSlugs) {
    const option = findCatalogOption(category, slug);
    if (!option) return null;
    options.push(option);
  }

  const prices = options.map(option => option.base_price);
  return {
    label,
    selected_options: optionSlugs,
    formula: prices.map(price => String(price)).join(' + '),
    total: prices.reduce((sum, price) => sum + price, 0),
  };
}

function categoryIncludedFacts(category: CatalogCategory): string[] {
  if (category.slug === 'photo-docs') {
    return [
      'бесплатная фотосессия',
      'выбор подходящего кадра',
      'кадрирование под документ',
      'электронный вид фотографии',
      'печать комплекта по желанию',
    ];
  }
  if (category.slug === 'portrait') {
    return [
      'бесплатная фотосессия',
      'выбор понравившегося кадра',
      'кадрирование',
      'электронный вид фотографии',
      'печать по желанию',
    ];
  }
  return [];
}

function categoryPricingExamples(category: CatalogCategory): CatalogPricingExample[] {
  const examples: CatalogPricingExample[] = [];
  if (category.slug === 'photo-docs') {
    const passportExtended = buildCatalogPricingExample(
      category,
      'Паспорт РФ с расширенной обработкой',
      ['passport-rf', 'processing-extended'],
    );
    if (passportExtended) examples.push(passportExtended);
  }
  if (category.slug === 'portrait') {
    const portraitExtended = buildCatalogPricingExample(
      category,
      'Портрет с расширенной обработкой',
      ['portrait-photo', 'processing-extended'],
    );
    if (portraitExtended) examples.push(portraitExtended);
  }
  return examples;
}

function buildCategoryPricingGuidance(category: CatalogCategory): CatalogPricingGuidance {
  return {
    model: 'base_service_plus_addons',
    total_price_source: 'calculate_price',
    total_requires_calculate_price: true,
    rules: [
      'Итоговая цена складывается из базовой услуги и выбранных доплат.',
      'Ретушь, обработка, срочность и дополнительные услуги прибавляются к базовой услуге; цена такой опции не является итоговой ценой.',
      'Точную итоговую сумму возвращает calculate_price по выбранным option_slug.',
    ],
    included: categoryIncludedFacts(category),
    examples: categoryPricingExamples(category),
  };
}

/**
 * Возвращает облегчённый снимок каталога: категории, группы опций и опции с
 * витринными ценами. Тяжёлые служебные поля (правила, degressive, product_id)
 * отбрасываются, чтобы не раздувать контекст модели.
 */
async function handleGetServiceCatalog(args: unknown): Promise<unknown> {
  const { categorySlug, query } = getServiceCatalogSchema.parse(args);
  const categories = await resolveCatalogCategories(categorySlug, query);

  return {
    categories: categories.map(cat => ({
      slug: cat.slug,
      name: cat.name,
      description: cat.description,
      aliases: cat.ai_aliases,
      price_range: cat.price_range,
      valid_delivery_methods: cat.valid_delivery_methods,
      pricing_guidance: buildCategoryPricingGuidance(cat),
      option_groups: cat.optionGroups.map(group => {
        const pricingRole = inferCatalogGroupPricingRole(cat, group);
        const priceBehavior = priceBehaviorForRole(pricingRole);
        const pricingNote = pricingNoteForRole(pricingRole);
        return {
          slug: group.slug,
          name: group.name,
          description: group.description,
          selection_type: group.selection_type,
          is_required: group.is_required,
          pricing_role: pricingRole,
          price_behavior: priceBehavior,
          pricing_note: pricingNote,
          options: group.options.map(opt => ({
            slug: opt.slug,
            name: opt.name,
            description: opt.description,
            base_price: opt.base_price,
            price_online: opt.price_online,
            price_studio: opt.price_studio,
            features: opt.features,
            popular: opt.popular,
            pricing_role: pricingRole,
            price_behavior: priceBehavior,
            pricing_note: pricingNote,
          })),
        };
      }),
    })),
  };
}

// --- calculate_price -------------------------------------------------------
const calculatePriceSchema = z
  .object({
    categorySlug: z.string().min(1).max(120),
    selectedOptions: z
      .array(
        z
          .object({
            option_slug: z.string().min(1).max(120),
            quantity: z.number().int().min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    deliveryMethod: deliveryMethodSchema.optional(),
    isReturning: z.boolean().optional(),
    promoCode: z.string().max(64).optional(),
  })
  .strict();

const calculatePriceJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['categorySlug', 'selectedOptions'],
  properties: {
    categorySlug: { type: 'string', description: 'Slug категории услуги (из get_service_catalog).' },
    selectedOptions: {
      type: 'array',
      description: 'Выбранные опции с количеством.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['option_slug', 'quantity'],
        properties: {
          option_slug: { type: 'string' },
          quantity: { type: 'integer', minimum: 1 },
        },
      },
    },
    deliveryMethod: {
      type: 'string',
      enum: ['electronic', 'pickup', 'postal'],
      description: 'Способ получения. По умолчанию electronic.',
    },
    isReturning: { type: 'boolean', description: 'Повторный клиент (влияет на промо первого заказа).' },
    promoCode: { type: 'string', description: 'Промокод, если назвал клиент.' },
  },
};

/**
 * Расчёт цены через pricing-engine. loyaltyPointsToUse/loyaltyProfileId НЕ
 * прокидываются: списание бонусов это денежный путь, агент его не инициирует.
 */
async function handleCalculatePrice(args: unknown): Promise<unknown> {
  const parsed = calculatePriceSchema.parse(args);
  const result = await calculatePrice({
    categorySlug: parsed.categorySlug,
    selectedOptions: parsed.selectedOptions,
    deliveryMethod: parsed.deliveryMethod as DeliveryMethodParam | undefined,
    isReturning: parsed.isReturning,
    promoCode: parsed.promoCode,
  });
  return result;
}

// --- validate_selection ----------------------------------------------------
const validateSelectionSchema = z
  .object({
    categorySlug: z.string().min(1).max(120),
    selectedOptions: z.array(z.string().min(1).max(120)).max(50),
  })
  .strict();

const validateSelectionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['categorySlug', 'selectedOptions'],
  properties: {
    categorySlug: { type: 'string', description: 'Slug категории услуги.' },
    selectedOptions: {
      type: 'array',
      description: 'Slug-и выбранных опций для проверки совместимости.',
      items: { type: 'string' },
    },
  },
};

async function handleValidateSelection(args: unknown): Promise<unknown> {
  const parsed = validateSelectionSchema.parse(args);
  return validateSelection({
    categorySlug: parsed.categorySlug,
    selectedOptions: parsed.selectedOptions,
  });
}

// --- check_subscription ----------------------------------------------------
// Аргументов нет: личность перечитывается из БД по ctx.contactId (userId
// приоритетнее phone), модель не может запросить чужую подписку по номеру.
// На слабом/неверифицированном канале возвращает need_verification (ПДн не
// раскрываются, пока контакт не подтверждён).
const checkSubscriptionSchema = z.object({}).strict();

const checkSubscriptionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
  description: 'Проверяет активную подписку текущего клиента. Аргументы не нужны.',
};

async function handleCheckSubscription(_args: unknown, ctx: ToolContext): Promise<unknown> {
  // Identity перечитываем из БД по contactId с учётом канала текущего сообщения
  // (ctx.phone/ctx.userId не доверяем: на слабом канале это может быть
  // неверифицированный visitor_phone; verified на ЧУЖОМ канале не открывает ПДн).
  const { identity, gated } = await resolveIdentityWithGate(ctx);
  if (gated) return NEED_VERIFICATION;

  let sub = null;
  if (identity.userId) {
    sub = await checkSubscriptionByUserId(identity.userId);
  }
  if (!sub && identity.phone) {
    sub = await checkSubscription(identity.phone);
  }

  if (!sub) return { active: false as const };
  return {
    active: true as const,
    plan_name: sub.plan_name ?? null,
    plan_category: sub.plan_category ?? null,
    status: sub.status,
    monthly_price: sub.monthly_price,
    current_period_end: sub.current_period_end,
  };
}

// --- get_student_discount --------------------------------------------------
// Телефон перечитывается из БД по ctx.contactId (любой phone в аргументах
// модели игнорируется: схема .strict() его отвергнет, handler его не читает).
// На слабом/неверифицированном канале возвращает need_verification.
const getStudentDiscountSchema = z.object({}).strict();

const getStudentDiscountJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
  description:
    'Проверяет образовательную льготу текущего клиента по его телефону. Аргументы не нужны.',
};

async function handleGetStudentDiscount(_args: unknown, ctx: ToolContext): Promise<unknown> {
  // Телефон перечитываем из БД по contactId с учётом канала текущего сообщения
  // (ctx.phone не доверяем). На слабом неверифицированном канале (в т.ч. если
  // verified есть только на ЧУЖОМ канале) не раскрываем льготу.
  const { identity, gated } = await resolveIdentityWithGate(ctx);
  if (gated) return NEED_VERIFICATION;

  if (!identity.phone) return { eligible: false as const };

  const summary = await getStudentDiscountForPhone(identity.phone);
  if (!summary || summary.status !== 'active') return { eligible: false as const };

  return {
    eligible: true as const,
    status: summary.status,
    expires_at: summary.expires_at,
    print_sheets_remaining: summary.print_sheets_remaining,
    print_sheet_price: summary.print_sheet_price,
    photo_remaining: summary.photo_remaining,
    binding_remaining: summary.binding_remaining,
  };
}

// --- get_order_status ------------------------------------------------------
// Скоуп строго по ctx.contactId. Заказы (photo_print_orders) не привязаны к
// contacts.id напрямую, поэтому контакт резолвится в свой телефон ИЗ БД, и
// заказ ищется по нормализованному телефону контакта (last-10). Телефон из
// аргументов модели НЕ участвует. Чужой/несуществующий заказ -> единое
// "не найдено" (found:false), без утечки факта существования.
const getOrderStatusSchema = z
  .object({
    orderId: z.string().min(1).max(50),
  })
  .strict();

const getOrderStatusJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['orderId'],
  properties: {
    orderId: { type: 'string', description: 'Номер заказа печати (order_id), который назвал клиент.' },
  },
};

interface OrderStatusRow {
  order_id: string;
  status: string;
  payment_status: string;
  total_price: string | null;
  created_at: string;
  estimated_ready_at: string | null;
}

interface PossibleUnlinkedPosPaymentRow {
  receipt_count: number;
  total_paid: string;
  latest_receipt_at: string | null;
}

async function findPossibleUnlinkedPosPayment(
  order: OrderStatusRow,
  phoneTail: string,
): Promise<PossibleUnlinkedPosPaymentRow | null> {
  if (order.payment_status === 'paid') return null;

  const orderTotal = Number(order.total_price ?? 0);
  if (!Number.isFinite(orderTotal) || orderTotal <= 0) return null;

  return db.queryOne<PossibleUnlinkedPosPaymentRow>(
    `SELECT
        COUNT(*)::int AS receipt_count,
        COALESCE(SUM(pr.total), 0)::numeric(12, 2)::text AS total_paid,
        MAX(pr.created_at)::text AS latest_receipt_at
       FROM pos_receipts pr
      WHERE pr.print_order_id IS NULL
        AND COALESCE(pr.is_refund, false) = false
        AND pr.voided_at IS NULL
        AND pr.total > 0
        AND RIGHT(regexp_replace(COALESCE(pr.customer_phone, ''), '\\D', '', 'g'), 10) = $1
        AND pr.created_at BETWEEN $2::timestamptz - INTERVAL '12 hours'
                              AND $2::timestamptz + INTERVAL '3 days'
        AND EXISTS (
          SELECT 1
            FROM pos_receipt_payments pp
           WHERE pp.receipt_id = pr.id
             AND COALESCE(pp.amount, 0) > 0
        )
     HAVING COALESCE(SUM(pr.total), 0) >= $3::numeric`,
    [phoneTail, order.created_at, orderTotal],
  );
}

async function handleGetOrderStatus(args: unknown, ctx: ToolContext): Promise<unknown> {
  const { orderId } = getOrderStatusSchema.parse(args);

  if (!ctx.contactId) return ORDER_NOT_FOUND;

  // Телефон владельца контакта берём из БД по contactId (скоуп строго по контакту).
  const contact = await db.queryOne<{ phone: string | null }>(
    `SELECT phone FROM contacts WHERE id = $1 LIMIT 1`,
    [ctx.contactId],
  );
  const tail = normalizePhoneTail(contact?.phone);
  if (!tail) return ORDER_NOT_FOUND;

  // Заказ выдаём ТОЛЬКО если его contact_phone совпадает с телефоном контакта.
  const order = await db.queryOne<OrderStatusRow>(
    `SELECT order_id, status, payment_status, total_price, created_at, estimated_ready_at
       FROM photo_print_orders
      WHERE order_id = $1
        AND RIGHT(regexp_replace(COALESCE(contact_phone, ''), '\\D', '', 'g'), 10) = $2
      LIMIT 1`,
    [orderId, tail],
  );
  if (!order) return ORDER_NOT_FOUND;

  const possiblePayment = await findPossibleUnlinkedPosPayment(order, tail);
  const baseStatus = {
    found: true as const,
    order_id: order.order_id,
    status: order.status,
    payment_status: order.payment_status,
    total_price: order.total_price,
    created_at: order.created_at,
    estimated_ready_at: order.estimated_ready_at,
  };

  if (possiblePayment && possiblePayment.receipt_count > 0) {
    return {
      ...baseStatus,
      effective_payment_status: 'requires_operator_check' as const,
      payment_attention_required: true as const,
      possible_unlinked_pos_payment: {
        receipt_count: possiblePayment.receipt_count,
        total_paid: possiblePayment.total_paid,
        latest_receipt_at: possiblePayment.latest_receipt_at,
      },
      escalate: true as const,
      reason: 'payment_requires_operator_check',
      message:
        'В заказе оплата ещё не привязана, но в POS есть непривязанный оплаченный чек этого клиента. Не просите оплатить повторно, передайте оператору проверку оплаты.',
    };
  }

  return {
    ...baseStatus,
  };
}

// --- get_my_bookings -------------------------------------------------------
// Ближайшие записи (онлайн-запись на съёмку/услугу) текущего клиента. Скоуп
// строго по ctx.contactId: контакт резолвится в свой user_id и телефон ИЗ БД.
// Записи ищутся по client_id = user_id контакта (надёжно, нельзя подделать
// вводом чужого телефона) ИЛИ по нормализованному телефону контакта (как
// get_order_status). Аргументы модели в скоуп НЕ входят. Возвращаем только
// сегодняшние и будущие активные записи. Ничего нет -> { bookings: [] }.
const getMyBookingsSchema = z.object({}).strict();

const getMyBookingsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
  description: 'Ближайшие онлайн-записи текущего клиента (услуга, дата/время, студия, статус). Аргументы не нужны.',
};

interface BookingContactScopeRow {
  user_id: string | null;
  phone: string | null;
}

interface MyBookingRow {
  status: string;
  service_name: string | null;
  start_time: string;
  start_local: string;
  studio_name: string | null;
  studio_address: string | null;
}

async function handleGetMyBookings(_args: unknown, ctx: ToolContext): Promise<unknown> {
  if (!ctx.contactId) return { bookings: [] };

  const contact = await db.queryOne<BookingContactScopeRow>(
    `SELECT user_id::text AS user_id, phone FROM contacts WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [ctx.contactId],
  );
  const userId = contact?.user_id ?? null;
  const tail = normalizePhoneTail(contact?.phone);
  if (!userId && !tail) return { bookings: [] };

  // Окно «с начала сегодняшнего дня по Москве и дальше» — клиента интересует
  // активная/предстоящая запись. Прошедшие/отменённые не показываем.
  const rows = await db.query<MyBookingRow>(
    `SELECT b.status, b.service_name, b.start_time,
            to_char(b.start_time AT TIME ZONE 'Europe/Moscow', 'DD.MM HH24:MI') AS start_local,
            s.name AS studio_name, s.address AS studio_address
       FROM bookings b
       LEFT JOIN studios s ON s.id = b.studio_id
      WHERE (
              ($1::uuid IS NOT NULL AND b.client_id = $1::uuid)
              OR ($2::text IS NOT NULL AND RIGHT(regexp_replace(COALESCE(b.client_phone, ''), '\\D', '', 'g'), 10) = $2::text)
            )
        AND b.status NOT IN ('cancelled', 'no_show', 'completed')
        AND b.start_time >= (date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow')) AT TIME ZONE 'Europe/Moscow'
      ORDER BY b.start_time ASC
      LIMIT 5`,
    [userId, tail],
  );

  return {
    bookings: rows.map(b => ({
      service_name: b.service_name,
      start_time: b.start_time,
      start_local: b.start_local, // 'DD.MM HH:MM' по Москве — готово к показу
      status: b.status,
      studio_name: b.studio_name,
      studio_address: b.studio_address,
    })),
  };
}

// --- list_pickup_points ----------------------------------------------------
const listPickupPointsSchema = z.object({}).strict();

const listPickupPointsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
  description: 'Список точек самовывоза фотостудии. Аргументы не нужны.',
};

async function handleListPickupPoints(): Promise<unknown> {
  // Источник истины — эффективный статус студий на сегодня: временно закрытую
  // точку клиенту не предлагаем (она вернётся сама в день после status_until).
  const studios = await getStudiosEffectiveStatus();
  const known = studios.filter(s => s.location_code && STUDIO_SHORT_LABELS[s.location_code]);
  const open = known.filter(s => s.status === 'open');
  const closed = known.filter(s => s.status !== 'open');

  const pickup_points = open.map(s => {
    const label = s.location_code ? STUDIO_SHORT_LABELS[s.location_code] : s.name;
    return { name: label, address: label, hours: 'Пн-Вс 09:00-19:30' };
  });

  return {
    pickup_points,
    // Подсказка модели о временно закрытых точках, чтобы она не звала туда клиента
    // и могла внятно объяснить, когда точка снова откроется.
    ...(closed.length > 0
      ? {
          temporarily_closed: closed.map(s => ({
            name: s.location_code ? STUDIO_SHORT_LABELS[s.location_code] : s.name,
            note: s.status_message ?? 'Временно закрыта.',
          })),
        }
      : {}),
  };
}

// --- handoff_to_operator ---------------------------------------------------
const handoffToOperatorSchema = z
  .object({
    reason: z.string().min(1).max(120),
    message: z.string().min(1).max(300).optional(),
  })
  .strict();

const handoffToOperatorJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reason'],
  properties: {
    reason: {
      type: 'string',
      description: 'Короткая техническая причина передачи живому человеку: complaint, payment, refund, custom_service, needs_human. НЕ для типовых вопросов о ценах, адресе, часах: на них отвечай сам по каталогу.',
    },
    message: {
      type: 'string',
      description: 'Короткая фраза клиенту о подключении сотрудника.',
    },
  },
};

async function handleHandoffToOperator(args: unknown): Promise<unknown> {
  const parsed = handoffToOperatorSchema.parse(args);
  return escalate(
    parsed.reason,
    parsed.message ?? 'Подключу сотрудника, он уточнит детали.',
  );
}

// ============================================================================
// Этап 3: оформление (write-draft) + ссылка на оплату (confirm_required)
// ============================================================================
//
// Все инструменты этого раздела включаются ТОЛЬКО при config.ai.orderingEnabled.
// Сумму считает сервер; аргументы модели для денег не используются.

/** Единые точки студии (label обязан совпасть с production в chat-order.service). */
const STUDIO_LABELS = {
  soborny: 'Соборный 21',
} as const;
type StudioKey = keyof typeof STUDIO_LABELS;

/** Сопоставление ключа студии модели с location_code в таблице studios. */
const STUDIO_LOCATION_BY_KEY: Record<StudioKey, string> = {
  soborny: 'soborny',
};

/** Эскалация на оператора: бот сам не оформляет, передаёт человеку. */
interface EscalateResult {
  escalate: true;
  reason: string;
  message?: string;
  /** Собранный ботом контекст пожелания (что/когда) — для оператора. */
  details?: Record<string, unknown>;
}
function escalate(
  reason: string,
  message?: string,
  details?: Record<string, unknown>,
): EscalateResult {
  const hasDetails = details && Object.keys(details).length > 0;
  return {
    escalate: true as const,
    reason,
    ...(message ? { message } : {}),
    ...(hasDetails ? { details } : {}),
  };
}

/**
 * Канонизация validated-args в детерминированную строку для idempotency_key.
 * Ключи объектов сортируются рекурсивно, чтобы порядок полей от модели не менял
 * хеш. Массивы порядок сохраняют (он семантически значим для опций).
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

/**
 * idempotency_key = sha256(conversationId + action_type + canonical(validatedArgs)).
 * hex (64 символа) кладётся в ai_agent_confirmations.confirm_token (varchar 64).
 */
function buildIdempotencyKey(
  conversationId: string,
  actionType: string,
  validatedArgs: unknown,
): string {
  return crypto
    .createHash('sha256')
    .update(`${conversationId} ${actionType} ${canonicalize(validatedArgs)}`)
    .digest('hex');
}

/** Содержимое draft_payload, которое мы храним в реестре подтверждений. */
interface ConfirmationDraftPayload {
  draft_ref: string;
  kind: ConfirmationActionType;
  validated_args: unknown;
  description: string;
  /** Для payment_link: ссылка, выданная клиенту (server-recompute суммы). */
  payment_url?: string;
}

type ConfirmationActionType =
  | 'print_order_draft'
  | 'subscription_draft'
  | 'request_payment_link';

interface ConfirmationRow {
  id: string;
  action_type: string;
  draft_payload: ConfirmationDraftPayload | null;
  quoted_total: number | null;
  status: string;
  confirm_token: string | null;
  expires_at: string | null;
}

const CONFIRMATION_TTL_MS = 1000 * 60 * 60 * 24; // 24ч, как у payment-ссылки

/**
 * Идемпотентная запись черновика/ссылки в ai_agent_confirmations.
 *
 * В одной транзакции:
 *   1) pg_advisory_xact_lock(hashtext(key)) сериализует параллельные ходы с тем
 *      же idempotency_key (защита от гонки: схема не имеет UNIQUE на confirm_token);
 *   2) SELECT по (conversation_id, confirm_token): если запись уже есть -> это
 *      повтор, возвращаем существующую (модель/ретрай не плодят черновик);
 *   3) иначе INSERT новой записи (status 'pending').
 *
 * produce() вызывается ТОЛЬКО при первом проходе (внутри лока, после того как
 * мы убедились, что записи ещё нет), чтобы side-effect создания заказа/подписки
 * тоже не повторялся. Возвращает draft_ref + payload + quoted_total.
 */
async function upsertConfirmation(
  ctx: ToolContext,
  actionType: ConfirmationActionType,
  idempotencyKey: string,
  produce: () => Promise<{ payload: ConfirmationDraftPayload; quotedTotal: number }>,
): Promise<{ reused: boolean; row: ConfirmationRow }> {
  return db.transaction(async client => {
    // Лок по 64-битному хешу ключа: одинаковые ключи идут строго последовательно.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [idempotencyKey]);

    const existing = await client.query<ConfirmationRow>(
      `SELECT id, action_type, draft_payload, quoted_total, status, confirm_token, expires_at
         FROM ai_agent_confirmations
        WHERE conversation_id = $1 AND confirm_token = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [ctx.conversationId, idempotencyKey],
    );
    if (existing.rows[0]) {
      return { reused: true, row: existing.rows[0] };
    }

    const { payload, quotedTotal } = await produce();
    const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS).toISOString();
    const inserted = await client.query<ConfirmationRow>(
      `INSERT INTO ai_agent_confirmations
         (conversation_id, action_type, draft_payload, quoted_total, status, confirm_token, expires_at)
       VALUES ($1, $2, $3::jsonb, $4, 'pending', $5, $6)
       RETURNING id, action_type, draft_payload, quoted_total, status, confirm_token, expires_at`,
      [
        ctx.conversationId,
        actionType,
        JSON.stringify(payload),
        quotedTotal,
        idempotencyKey,
        expiresAt,
      ],
    );
    return { reused: false, row: inserted.rows[0] };
  });
}

/** Округление рублей до целого для quoted_total (колонка integer). */
function toQuotedTotal(amount: number): number {
  return Math.round(amount);
}

// --- create_print_order_draft ----------------------------------------------
// Черновик заказа печати. Сумму считает СЕРВЕР (calculatePrice по тем же опциям),
// сумма из аргументов модели не передаётся. Для самовывоза ТОЧКА студии
// обязательна (без неё reject). Кладёт pendingOrder в conversations.metadata и
// зовёт реальный handleFinalizeOrder -> photo_print_orders (pending_payment).
const createPrintOrderDraftSchema = z
  .object({
    categorySlug: z.string().min(1).max(120),
    selectedOptions: z
      .array(
        z
          .object({
            option_slug: z.string().min(1).max(120),
            quantity: z.number().int().min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    deliveryMethod: deliveryMethodSchema,
    /** Точка студии (для pickup обязательна). */
    studio: z.enum(['soborny']).optional(),
    promoCode: z.string().max(64).optional(),
  })
  .strict();

const createPrintOrderDraftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['categorySlug', 'selectedOptions', 'deliveryMethod'],
  properties: {
    categorySlug: { type: 'string', description: 'Slug категории услуги (из get_service_catalog).' },
    selectedOptions: {
      type: 'array',
      description: 'Выбранные опции с количеством (как в calculate_price).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['option_slug', 'quantity'],
        properties: {
          option_slug: { type: 'string' },
          quantity: { type: 'integer', minimum: 1 },
        },
      },
    },
    deliveryMethod: {
      type: 'string',
      enum: ['electronic', 'pickup', 'postal'],
      description: 'Способ получения. Для pickup обязательно укажи studio.',
    },
    studio: {
      type: 'string',
      enum: ['soborny'],
      description: 'Точка студии для самовывоза: soborny (Соборный 21).',
    },
    promoCode: { type: 'string', description: 'Промокод, если назвал клиент.' },
  },
};

interface PrintDraftArgs {
  categorySlug: string;
  selectedOptions: { option_slug: string; quantity: number }[];
  deliveryMethod: 'electronic' | 'pickup' | 'postal';
  studio?: StudioKey;
  promoCode?: string;
}

/**
 * Резолвит телефон владельца контакта из БД (как read-tools): источник истины —
 * contacts.phone по ctx.contactId, НЕ ctx.phone (на слабом канале это может быть
 * неверифицированный visitor_phone). Нужен, чтобы handleFinalizeOrder не уводил
 * бота в ветку «спросить телефон» и заказ реально создался.
 */
async function resolveContactPhone(ctx: ToolContext): Promise<string | null> {
  if (!ctx.contactId) return null;
  const row = await db.queryOne<{ phone: string | null }>(
    `SELECT phone FROM contacts WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [ctx.contactId],
  );
  return row?.phone ?? null;
}

async function handleCreatePrintOrderDraft(args: unknown, ctx: ToolContext): Promise<unknown> {
  const parsed = createPrintOrderDraftSchema.parse(args) as PrintDraftArgs;

  // Точка студии обязательна для самовывоза.
  if (parsed.deliveryMethod === 'pickup' && !parsed.studio) {
    return {
      ok: false as const,
      need: 'studio',
      message: 'Для самовывоза нужно выбрать точку студии: Соборный 21.',
    };
  }

  // Самовывоз во временно закрытую точку не оформляем: предлагаем выбрать другую.
  const studioKey = parsed.studio;
  if (parsed.deliveryMethod === 'pickup' && studioKey) {
    const studios = await getStudiosEffectiveStatus();
    const target = studios.find(s => s.location_code === STUDIO_LOCATION_BY_KEY[studioKey]);
    if (target && target.status !== 'open') {
      return {
        ok: false as const,
        reason: 'studio_closed',
        need: 'studio',
        message: `${STUDIO_LABELS[studioKey]} временно закрыта${target.status_message ? `: ${target.status_message}` : ''}. Предложи клиенту другую точку.`,
      };
    }
  }

  // СЕРВЕРНЫЙ расчёт суммы по тем же опциям. Сумма из аргументов модели не
  // участвует вовсе. loyalty не прокидываем (списание бонусов — денежный путь).
  const priced = await calculatePrice({
    categorySlug: parsed.categorySlug,
    selectedOptions: parsed.selectedOptions,
    deliveryMethod: parsed.deliveryMethod as DeliveryMethodParam,
    promoCode: parsed.promoCode,
  });

  if (!priced.validation.valid) {
    return {
      ok: false as const,
      reason: 'invalid_selection',
      errors: priced.validation.errors,
      message: 'Состав заказа некорректен, уточните опции.',
    };
  }

  const serverTotal = priced.breakdown.total;
  if (serverTotal <= 0) {
    return { ok: false as const, reason: 'zero_total', message: 'Сумма заказа не определена.' };
  }

  // Порог авто-оформления: дороже -> на оператора, бот сам не оформляет.
  if (serverTotal > config.ai.maxAutoOrder) {
    return escalate(
      'amount_over_threshold',
      'Сумма крупная, подключу сотрудника для оформления.',
    );
  }

  const category = await getCategoryBySlug(parsed.categorySlug);
  const serviceLabel = category?.name ?? parsed.categorySlug;
  const studioLabel = parsed.studio ? STUDIO_LABELS[parsed.studio] : null;

  // Idempotency по канонизированным аргументам (включая студию/доставку).
  const idempotencyKey = buildIdempotencyKey(ctx.conversationId, 'print_order_draft', parsed);

  const { reused, row } = await upsertConfirmation(
    ctx,
    'print_order_draft',
    idempotencyKey,
    async () => {
      // pendingOrder в metadata — формат ChatOrderData, который читает
      // handleFinalizeOrder. price = СЕРВЕРНАЯ сумма.
      const selectedOptionsMap: Record<string, string[]> = {};
      for (const opt of parsed.selectedOptions) {
        selectedOptionsMap[opt.option_slug] = [opt.option_slug];
      }
      const pendingOrder = {
        categorySlug: parsed.categorySlug,
        delivery_method: parsed.deliveryMethod,
        price: serverTotal,
        service: serviceLabel,
        tariff: serviceLabel,
        selectedOptions: selectedOptionsMap,
      };
      await mergeMetadata(ctx.conversationId, { pendingOrder, phoneAsked: true });

      // Телефон контакта из БД — чтобы финализация не ушла в «ask phone».
      const visitorPhone = await resolveContactPhone(ctx);
      const delivery =
        parsed.deliveryMethod === 'pickup' && studioLabel
          ? { pickup: studioLabel, production: studioLabel }
          : { pickup: 'Электронный вид (без печати)', production: 'Онлайн' };

      await handleFinalizeOrder(ctx.conversationId, delivery, {
        metadata: { pendingOrder, phoneAsked: true },
        visitor_phone: visitorPhone,
      });

      // order_id детерминирован: handleFinalizeOrder пишет orderNumber в
      // conversations.metadata, а order_id = chat-{sessionId}-{orderNumber}
      // (chat-order.service). Берём ТОЧНО свой заказ по этому номеру, а НЕ
      // «последний pending_payment сессии» — иначе при двух near-concurrent
      // черновиках в одном диалоге draft_ref мог указать на чужой состав.
      const metaRow = await db.queryOne<{ order_number: number | string | null }>(
        `SELECT metadata->>'orderNumber' AS order_number FROM conversations WHERE id = $1`,
        [ctx.conversationId],
      );
      const orderNumber = metaRow?.order_number != null ? String(metaRow.order_number) : null;
      const draftRef = orderNumber
        ? `chat-${ctx.conversationId}-${orderNumber}`
        : `chat-${ctx.conversationId}`;

      // Осадок оформления больше не нужен: pendingOrder/pendingDelivery/phoneAsked
      // в metadata читают web-чат-обработчики (кнопки/загрузка фото) и могли бы
      // повторно провести заказ из залежавшегося состояния. Чистим после
      // успешного создания.
      await removeMetadataKeys(ctx.conversationId, ['pendingOrder', 'pendingDelivery', 'phoneAsked']);

      const payload: ConfirmationDraftPayload = {
        draft_ref: draftRef,
        kind: 'print_order_draft',
        validated_args: parsed,
        description: `Заказ: ${serviceLabel}${studioLabel ? ` (${studioLabel})` : ''}`,
      };
      return { payload, quotedTotal: toQuotedTotal(serverTotal) };
    },
  );

  const payload = row.draft_payload;
  return {
    ok: true as const,
    draft_ref: payload?.draft_ref ?? null,
    total: row.quoted_total,
    currency: 'RUB',
    service: serviceLabel,
    studio: studioLabel,
    delivery_method: parsed.deliveryMethod,
    already_created: reused,
    // Разбивку отдаём для точности озвучивания, но «итог» — это total из сервера.
    breakdown: priced.breakdown.base_items,
  };
}

// --- create_subscription_draft ----------------------------------------------
// Черновик подписки (pending). monthly_price берётся ИЗ ПЛАНА (server), не из
// модели. verified-identity ОБЯЗАТЕЛЬНА (как у персональных read-tools): на
// слабом/неверифицированном канале -> need_verification. Регулярное списание
// бот сам не активирует (это webhook после оплаты).
const createSubscriptionDraftSchema = z
  .object({
    plan_id: z.string().uuid(),
  })
  .strict();

const createSubscriptionDraftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['plan_id'],
  properties: {
    plan_id: { type: 'string', description: 'UUID тарифа подписки (из каталога планов).' },
  },
};

async function handleCreateSubscriptionDraft(args: unknown, ctx: ToolContext): Promise<unknown> {
  const parsed = createSubscriptionDraftSchema.parse(args);

  // Identity из БД с учётом канала текущего сообщения (как check_subscription).
  const { identity, gated } = await resolveIdentityWithGate(ctx);
  if (gated) return NEED_VERIFICATION;
  if (!identity.phone) {
    return {
      ok: false as const,
      reason: 'no_phone',
      message: 'Для оформления подписки нужен подтверждённый телефон клиента.',
    };
  }

  // План — источник цены. Берём monthly_price = base_price (или min_price, если
  // base нет), НЕ из аргументов модели.
  const plan = await getPlanById(parsed.plan_id);
  if (!plan || !plan.is_active) {
    return { ok: false as const, reason: 'plan_not_found', message: 'Тариф не найден или не активен.' };
  }
  const monthlyPrice = plan.base_price ?? plan.min_price ?? 0;
  if (monthlyPrice <= 0) {
    return { ok: false as const, reason: 'zero_price', message: 'Цена тарифа не определена.' };
  }

  // Порог авто-оформления.
  if (monthlyPrice > config.ai.maxAutoOrder) {
    return escalate('amount_over_threshold', 'Сумма крупная, подключу сотрудника.');
  }

  const idempotencyKey = buildIdempotencyKey(ctx.conversationId, 'subscription_draft', {
    plan_id: parsed.plan_id,
    // Привязываем к личности, чтобы один и тот же план для разных клиентов в
    // одном диалоге (теоретически) не схлопывался в один черновик.
    phone: identity.phone,
  });

  const { reused, row } = await upsertConfirmation(
    ctx,
    'subscription_draft',
    idempotencyKey,
    async () => {
      const sub = await initSubscription({
        user_id: identity.userId ?? undefined,
        phone: identity.phone as string,
        plan_id: plan.id,
        monthly_price: monthlyPrice, // из плана, не из модели
      });
      const payload: ConfirmationDraftPayload = {
        draft_ref: sub.id,
        kind: 'subscription_draft',
        validated_args: { plan_id: parsed.plan_id },
        description: `Подписка: ${plan.name}`,
      };
      return { payload, quotedTotal: toQuotedTotal(monthlyPrice) };
    },
  );

  const payload = row.draft_payload;
  return {
    ok: true as const,
    draft_ref: payload?.draft_ref ?? null,
    plan_name: plan.name,
    plan_category: plan.category,
    monthly_price: row.quoted_total,
    currency: 'RUB',
    billing_period: plan.billing_period,
    already_created: reused,
    note: 'Регулярное списание активируется после оплаты, бот его сам не включает.',
  };
}

// --- create_booking_draft / create_retouch_draft ---------------------------
// Готового «черновик pending -> оплата -> webhook активирует» сервиса для записи
// и ретуши НЕТ: booking-autonomous.createBooking сразу пишет status 'confirmed'
// и шлёт уведомление клиенту; retouch.createRetouchTask запускает работу и
// авто-назначает ретушёра, суммы там нет. Создавать эти необратимые side-effect
// из бота противоречит принципу «бот только готовит черновик».
//
// Решение (вариант A, подтверждён координатором): эти инструменты ЭСКАЛИРУЮТ на
// оператора (human-on-the-loop). Бот доводит клиента до записи/ретуши и собирает
// пожелание (что/когда/уровень), а финал спорного делает человек: запись требует
// проверки слота/времени, retouch-задача = запуск производства (необратимо).
// Собранный контекст уходит оператору в details escalate-результата (и в
// ai_agent_tool_calls.validated_args, которые пишет оркестратор).
//
// ВАЖНО: оплачиваемая ретушь как УСЛУГА из каталога (та, что идёт через
// photo_print_orders) оформляется и оплачивается обычным печать-путём
// create_print_order_draft + request_payment_link. create_retouch_draft здесь —
// это ТОЛЬКО запуск производственной work_task, он остаётся за оператором/
// после-оплаты, поэтому escalate (не INSERT).
const createBookingDraftSchema = z
  .object({
    serviceName: z.string().min(1).max(200).optional(),
    date: z.string().min(1).max(20).optional(),
    time: z.string().min(1).max(10).optional(),
  })
  .strict();

const createBookingDraftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    serviceName: { type: 'string', description: 'Желаемая услуга/съёмка.' },
    date: { type: 'string', description: 'Желаемая дата YYYY-MM-DD.' },
    time: { type: 'string', description: 'Желаемое время HH:MM.' },
  },
  description: 'Передаёт запрос на запись оператору (бот запись сам не подтверждает).',
};

async function handleCreateBookingDraft(args: unknown): Promise<unknown> {
  // Пожелание клиента (что/когда) передаём оператору с контекстом.
  const parsed = createBookingDraftSchema.parse(args);
  return escalate(
    'booking_requires_operator',
    'Запись оформит сотрудник, я передам ваш запрос.',
    parsed,
  );
}

const createRetouchDraftSchema = z
  .object({
    retouchLevel: z.string().min(1).max(120).optional(),
  })
  .strict();

const createRetouchDraftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    retouchLevel: { type: 'string', description: 'Желаемый уровень ретуши, если назвал клиент.' },
  },
  description: 'Передаёт запрос на ретушь оператору (бот задачу ретушёру сам не запускает).',
};

async function handleCreateRetouchDraft(args: unknown): Promise<unknown> {
  // Пожелание клиента (уровень ретуши) передаём оператору с контекстом.
  const parsed = createRetouchDraftSchema.parse(args);
  return escalate(
    'retouch_requires_operator',
    'Ретушь оформит сотрудник, я передам ваш запрос.',
    parsed,
  );
}

// --- request_payment_link ----------------------------------------------------
// Генерирует ссылку на оплату для УЖЕ созданного черновика. Сумма берётся ТОЛЬКО
// перечитыванием с сервера (заказ из photo_print_orders / подписка по плану),
// аргументы модели на сумму не влияют. Записывает выданную ссылку в
// ai_agent_confirmations (идемпотентно). Бот деньги НЕ списывает: ссылку
// открывает и платит клиент сам.
const requestPaymentLinkSchema = z
  .object({
    draft_ref: z.string().min(1).max(200),
  })
  .strict();

const requestPaymentLinkJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['draft_ref'],
  properties: {
    draft_ref: { type: 'string', description: 'Идентификатор черновика (draft_ref из create_*_draft).' },
  },
};

interface PrintOrderRecomputeRow {
  order_id: string;
  total_price: string | null;
  payment_status: string;
  status: string;
  chat_session_id: string | null;
}

interface SubscriptionRecomputeRow {
  id: string;
  monthly_price: string | number;
  status: string;
  plan_name: string | null;
}

/**
 * Находит черновик по draft_ref среди подтверждений ЭТОГО диалога и перечитывает
 * его серверную сумму из первоисточника (заказ/подписка). Возвращает данные для
 * генерации ссылки или причину отказа. Сумма НИКОГДА не берётся из аргументов.
 */
async function recomputeDraftForPayment(
  ctx: ToolContext,
  draftRef: string,
): Promise<
  | { ok: true; orderId: string; amount: number; description: string; actionType: ConfirmationActionType }
  | { ok: false; reason: string; message: string }
> {
  // Черновик должен принадлежать этому диалогу (скоуп по conversation_id).
  const draft = await db.queryOne<ConfirmationRow>(
    `SELECT id, action_type, draft_payload, quoted_total, status, confirm_token, expires_at
       FROM ai_agent_confirmations
      WHERE conversation_id = $1
        AND draft_payload->>'draft_ref' = $2
        AND action_type IN ('print_order_draft', 'subscription_draft')
      ORDER BY created_at DESC
      LIMIT 1`,
    [ctx.conversationId, draftRef],
  );
  if (!draft) {
    return { ok: false, reason: 'draft_not_found', message: 'Черновик заказа не найден.' };
  }

  const desc = draft.draft_payload?.description ?? 'Заказ «Своё Фото»';

  if (draft.action_type === 'print_order_draft') {
    const order = await db.queryOne<PrintOrderRecomputeRow>(
      `SELECT order_id, total_price, payment_status, status, chat_session_id
         FROM photo_print_orders
        WHERE order_id = $1 AND chat_session_id = $2
        LIMIT 1`,
      [draftRef, ctx.conversationId],
    );
    if (!order) {
      return { ok: false, reason: 'order_not_found', message: 'Заказ не найден.' };
    }
    if (order.payment_status === 'paid') {
      return { ok: false, reason: 'already_paid', message: 'Этот заказ уже оплачен.' };
    }
    const amount = order.total_price != null ? Number(order.total_price) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, reason: 'zero_total', message: 'Сумма заказа не определена.' };
    }
    return { ok: true, orderId: order.order_id, amount, description: desc, actionType: 'print_order_draft' };
  }

  // subscription_draft: сумма = monthly_price из user_subscriptions (server).
  const sub = await db.queryOne<SubscriptionRecomputeRow>(
    `SELECT us.id, us.monthly_price, us.status, sp.name AS plan_name
       FROM user_subscriptions us
       LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
      WHERE us.id::text = $1
      LIMIT 1`,
    [draftRef],
  );
  if (!sub) {
    return { ok: false, reason: 'subscription_not_found', message: 'Подписка не найдена.' };
  }
  if (sub.status !== 'pending') {
    return { ok: false, reason: 'not_pending', message: 'Подписка уже не в состоянии черновика.' };
  }
  const amount = Number(sub.monthly_price);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'zero_total', message: 'Сумма подписки не определена.' };
  }
  // InvoiceId оплаты ОБЯЗАН нести префикс SUB-: только так платёжный webhook
  // распознаёт подписку. /check (payments.routes.ts: ветка InvoiceId.startsWith('SUB-'))
  // и /pay (Branch 2, isSubByPrefix) делают replace('SUB-','') и валидируют
  // подписку по id. Без префикса голый UUID уходит в ветку photo_print_orders /
  // orders, там не находится -> code 10 (оплатить нельзя). draft_ref в реестре
  // остаётся сырым UUID (лукап выше по us.id::text), префикс — только в orderId
  // ссылки.
  return {
    ok: true,
    orderId: `SUB-${sub.id}`,
    amount,
    description: sub.plan_name ? `Подписка: ${sub.plan_name}` : desc,
    actionType: 'subscription_draft',
  };
}

async function handleRequestPaymentLink(args: unknown, ctx: ToolContext): Promise<unknown> {
  const { draft_ref } = requestPaymentLinkSchema.parse(args);

  const recomputed = await recomputeDraftForPayment(ctx, draft_ref);
  if (!recomputed.ok) {
    return { ok: false as const, reason: recomputed.reason, message: recomputed.message };
  }

  // Порог: даже на этапе ссылки крупную сумму не проводим автоматически.
  if (recomputed.amount > config.ai.maxAutoOrder) {
    return escalate('amount_over_threshold', 'Сумма крупная, подключу сотрудника.');
  }

  // Idempotency ссылки: по draft_ref (одна ссылка на черновик).
  const idempotencyKey = buildIdempotencyKey(ctx.conversationId, 'request_payment_link', {
    draft_ref,
  });

  const { row } = await upsertConfirmation(
    ctx,
    'request_payment_link',
    idempotencyKey,
    async () => {
      // ЕДИНСТВЕННЫЙ путь бота к оплате. Сумма — server-recompute, НЕ из модели.
      const url = generateChatPaymentUrl(
        recomputed.orderId,
        recomputed.amount,
        recomputed.description,
      );
      if (!url) {
        // paymentSecret не сконфигурирован: ссылку не выдать. Бросаем — попадёт
        // в outcome 'error', бот не соврёт про несуществующую ссылку.
        throw new Error('payment link not configured');
      }
      const payload: ConfirmationDraftPayload = {
        draft_ref,
        kind: 'request_payment_link',
        validated_args: { draft_ref },
        description: recomputed.description,
        payment_url: url,
      };
      return { payload, quotedTotal: toQuotedTotal(recomputed.amount) };
    },
  );

  const payload = row.draft_payload;
  return {
    ok: true as const,
    payment_url: payload?.payment_url ?? null,
    amount: row.quoted_total,
    currency: 'RUB',
    description: recomputed.description,
    expires_at: row.expires_at,
  };
}

// ============================================================================
// Реестр
// ============================================================================

const TOOLS: readonly AgentTool[] = [
  {
    name: 'get_service_catalog',
    description:
      'Возвращает каталог услуг фотостудии: категории, группы опций, цены и pricing_guidance. Каталог не является итоговым расчётом: для точной суммы используй calculate_price.',
    riskClass: 'read',
    zodSchema: getServiceCatalogSchema,
    jsonSchema: getServiceCatalogJsonSchema,
    handler: handleGetServiceCatalog,
  },
  {
    name: 'calculate_price',
    description:
      'Единственный источник итоговой цены по выбранным опциям категории (с учётом промокода, способа получения, повторного клиента). Возвращает разбивку и итог.',
    riskClass: 'read',
    zodSchema: calculatePriceSchema,
    jsonSchema: calculatePriceJsonSchema,
    handler: handleCalculatePrice,
  },
  {
    name: 'validate_selection',
    description:
      'Проверяет совместимость выбранных опций: какие доступны, что добавится автоматически, ошибки и предупреждения. Цены не считает.',
    riskClass: 'read',
    zodSchema: validateSelectionSchema,
    jsonSchema: validateSelectionJsonSchema,
    handler: handleValidateSelection,
  },
  {
    name: 'check_subscription',
    description:
      'Проверяет активную подписку текущего клиента (по его аккаунту или телефону из контекста). Аргументы не нужны.',
    riskClass: 'read',
    zodSchema: checkSubscriptionSchema,
    jsonSchema: checkSubscriptionJsonSchema,
    handler: handleCheckSubscription,
  },
  {
    name: 'get_student_discount',
    description:
      'Проверяет образовательную льготу текущего клиента по его телефону из контекста (остаток листов, цена листа, остаток фото). Аргументы не нужны.',
    riskClass: 'read',
    zodSchema: getStudentDiscountSchema,
    jsonSchema: getStudentDiscountJsonSchema,
    handler: handleGetStudentDiscount,
  },
  {
    name: 'get_order_status',
    description:
      'Возвращает статус заказа печати по его номеру, но только если заказ принадлежит текущему клиенту. Чужой или несуществующий заказ возвращает found:false.',
    riskClass: 'read',
    zodSchema: getOrderStatusSchema,
    jsonSchema: getOrderStatusJsonSchema,
    handler: handleGetOrderStatus,
  },
  {
    name: 'get_my_bookings',
    description:
      'Возвращает ближайшие онлайн-записи текущего клиента (на съёмку/услугу): услугу, дату и время по Москве, студию (куда) и статус. Скоуп строго по текущему клиенту, аргументы не нужны. Если записей нет — bookings пустой.',
    riskClass: 'read',
    zodSchema: getMyBookingsSchema,
    jsonSchema: getMyBookingsJsonSchema,
    handler: handleGetMyBookings,
  },
  {
    name: 'list_pickup_points',
    description: 'Список точек самовывоза фотостудии с адресами и часами работы. Аргументы не нужны.',
    riskClass: 'read',
    zodSchema: listPickupPointsSchema,
    jsonSchema: listPickupPointsJsonSchema,
    handler: handleListPickupPoints,
  },
  {
    name: 'handoff_to_operator',
    description:
      'Передаёт диалог сотруднику, когда услуга, цена или условие не подтверждены инструментами, запрос индивидуальный, клиент просит то, чего нет в точном каталоге, или нельзя уверенно ответить. Не отрицай услугу клиенту.',
    riskClass: 'read',
    zodSchema: handoffToOperatorSchema,
    jsonSchema: handoffToOperatorJsonSchema,
    handler: handleHandoffToOperator,
  },

  // --- Этап 3: write-draft + ссылка на оплату (только при orderingEnabled) ---
  {
    name: 'create_print_order_draft',
    description:
      'Создаёт черновик заказа печати (статус ожидает оплаты) по выбранным опциям. Сумму считает сервер. Для самовывоза обязательно укажи точку студии. Возвращает draft_ref и итоговую сумму.',
    riskClass: 'write_draft',
    zodSchema: createPrintOrderDraftSchema,
    jsonSchema: createPrintOrderDraftJsonSchema,
    handler: handleCreatePrintOrderDraft,
  },
  {
    name: 'create_subscription_draft',
    description:
      'Создаёт черновик подписки (статус ожидает оплаты) на указанный тариф для текущего клиента. Ежемесячная цена берётся из тарифа. Нужен подтверждённый телефон клиента. Регулярное списание бот сам не включает.',
    riskClass: 'write_draft',
    zodSchema: createSubscriptionDraftSchema,
    jsonSchema: createSubscriptionDraftJsonSchema,
    handler: handleCreateSubscriptionDraft,
  },
  {
    name: 'create_booking_draft',
    description:
      'Передаёт запрос клиента на запись (фотосъёмку) сотруднику. Бот запись сам не подтверждает: финальное оформление делает человек.',
    riskClass: 'write_draft',
    zodSchema: createBookingDraftSchema,
    jsonSchema: createBookingDraftJsonSchema,
    handler: handleCreateBookingDraft,
  },
  {
    name: 'create_retouch_draft',
    description:
      'Передаёт запрос клиента на ретушь сотруднику. Бот задачу ретушёру сам не запускает: финальное оформление делает человек.',
    riskClass: 'write_draft',
    zodSchema: createRetouchDraftSchema,
    jsonSchema: createRetouchDraftJsonSchema,
    handler: handleCreateRetouchDraft,
  },
  {
    name: 'request_payment_link',
    description:
      'Генерирует ссылку на оплату для уже созданного черновика (draft_ref). Сумму сервер перечитывает из заказа. Ссылку открывает и оплачивает клиент сам. Перед вызовом подтверди клиенту состав и сумму.',
    riskClass: 'confirm_required',
    zodSchema: requestPaymentLinkSchema,
    jsonSchema: requestPaymentLinkJsonSchema,
    handler: handleRequestPaymentLink,
  },
];

const TOOL_BY_NAME: ReadonlyMap<string, AgentTool> = new Map(TOOLS.map(t => [t.name, t]));

// ============================================================================
// Публичный API
// ============================================================================

/** Классы, доступные для исполнения/декларации при включённом оформлении. */
const ORDERING_RISK_CLASSES: ReadonlySet<RiskClass> = new Set<RiskClass>([
  'write_draft',
  'confirm_required',
]);

/**
 * Можно ли отдавать/исполнять инструмент данного класса.
 *   - 'read' — всегда (Этап 1-2);
 *   - 'write_draft' / 'confirm_required' — только при config.ai.orderingEnabled
 *     (Этап 3, отдельный флаг AI_AGENT_ORDERING_ENABLED, default false);
 *   - 'forbidden' и всё прочее — никогда.
 * Денежных tools (прямой платёж, активация рекуррента, record-payment) в реестре
 * нет в принципе: оформление = ЧЕРНОВИК + ссылка, деньги бот не трогает.
 */
function isToolEnabled(riskClass: RiskClass): boolean {
  if (riskClass === 'read') return true;
  if (ORDERING_RISK_CLASSES.has(riskClass)) return config.ai.orderingEnabled === true;
  return false;
}

/**
 * Декларации инструментов для function-calling.
 *   - read-инструменты отдаём всегда (Этап 1-2);
 *   - write-draft и request_payment_link (Этап 3) — ТОЛЬКО при
 *     config.ai.orderingEnabled. При выключенном флаге поведение = Этап 2
 *     (модель даже не видит инструментов оформления).
 * Сигнатура без аргументов сохранена: флаг читается из config внутри.
 */
export function getToolDeclarations(): ToolDef[] {
  return TOOLS.filter(tool => isToolEnabled(tool.riskClass)).map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema,
    },
  }));
}

/**
 * Класс риска инструмента по имени из реестра — для честного аудита
 * (ai_agent_tool_calls.risk_class). Неизвестное имя -> 'forbidden' (как и
 * трактует его executeTool: denied). Нужно оркестратору, чтобы успешный
 * create_print_order_draft / request_payment_link не записывался как 'read'.
 */
export function getToolRiskClass(name: string): RiskClass {
  return TOOL_BY_NAME.get(name)?.riskClass ?? 'forbidden';
}

/**
 * Единственная точка исполнения tool-вызова от модели.
 *  - неизвестное имя -> 'denied' (handler НЕ вызывается);
 *  - write-draft/confirm при ВЫКЛЮЧЕННОМ оформлении -> 'denied' (даже если модель
 *    как-то вызвала инструмент, которого нет в её декларациях);
 *  - 'forbidden' -> 'denied';
 *  - битый JSON или провал zod-валидации -> 'rejected_schema';
 *  - исключение внутри handler -> 'error';
 *  - успех -> 'executed' с result и validatedArgs.
 */
export async function executeTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  const tool = TOOL_BY_NAME.get(name);

  // HARD-DENY: неизвестный инструмент, запрещённый класс, либо оформление
  // выключено (write-draft/confirm недоступны без флага orderingEnabled).
  if (!tool || !isToolEnabled(tool.riskClass)) {
    log.warn('Tool denied by registry', {
      name,
      known: Boolean(tool),
      riskClass: tool?.riskClass,
      orderingEnabled: config.ai.orderingEnabled,
    });
    return { outcome: 'denied', rejectedReason: `Инструмент "${name}" недоступен` };
  }

  // Парсинг + валидация аргументов модели.
  let parsedJson: unknown;
  try {
    parsedJson = rawArgs && rawArgs.trim() !== '' ? JSON.parse(rawArgs) : {};
  } catch {
    return { outcome: 'rejected_schema', rejectedReason: 'Аргументы не являются валидным JSON' };
  }

  const validation = tool.zodSchema.safeParse(parsedJson);
  if (!validation.success) {
    return {
      outcome: 'rejected_schema',
      rejectedReason: validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }

  // Исполнение тонкой обёртки.
  try {
    const result = await tool.handler(validation.data, ctx);
    return { outcome: 'executed', result, validatedArgs: validation.data };
  } catch (error: unknown) {
    log.error('Tool handler failed', { name, error: String(error) });
    return { outcome: 'error', validatedArgs: validation.data, rejectedReason: String(error) };
  }
}
