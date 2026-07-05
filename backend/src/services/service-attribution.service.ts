/**
 * Service Attribution Service — запись и пересчёт «какую услугу заказывал клиент».
 *
 * Слой над таблицей `client_service_attributions` (источник истины, провенанс,
 * мультиуслуга) и денорм-кэшем на `contacts.primary_service_*`. Команда
 * mapping-telegram-services, slice S3.
 *
 * Экспорты:
 *   - recordAttribution(input)      — идемпотентный upsert одной атрибуции
 *     (ON CONFLICT по ux_csa_source_service) + best-effort пересчёт кэша.
 *   - refreshPrimaryService(id)     — пересчёт contacts.primary_service_* по
 *     детерминированному правилу приоритета (P0-4).
 *   - attributeOrder(orderId)       — best-effort атрибуция заказа из чата
 *     (резолв contact через chat_session_id → conversations, P1-1).
 *   - reconcileAttributions(opts)   — батч-бэкфилл исторических данных (вызывает S4).
 *
 * Нормализация услуг — ТОЛЬКО через `service-inference.ts` (НЕ дублируем regex;
 * V8 \b не работает на кириллице — S2 это уже решил).
 *
 * Все write-хуки — best-effort (try/catch + log.warn), падение НЕ должно
 * откатывать заказ/чек у вызывающего (идиома `.catch(log.warn)` из contact.service).
 * refreshPrimaryService вызывается ОТДЕЛЬНО от INSERT записи (не в одной транзакции).
 */

import { pool } from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import {
  CATEGORY_PRIORITY,
  classifyServiceText,
  isAddonSlug,
  normalizeProductName,
  normalizeServiceOption,
  type ServiceMatch,
} from './service-inference.js';

const log = createLogger('service-attribution');

/** Денорм-кэш-значения для контакта без единой атрибуции (Tier3, P0-1). */
const SENTINEL_SLUG = 'not_determined';
const SENTINEL_LABEL = 'Обращение без заказа';

/** Порог уверенности для онлайн/бэкфилл text-inference (Review responses P1-6). */
const INFERENCE_CONFIDENCE_THRESHOLD = 0.6;

/** method, валидный по CHECK client_service_attributions.method (без 'none'). */
export type AttributionMethod =
  | 'order'
  | 'receipt'
  | 'subscription'
  | 'booking'
  | 'conversation'
  | 'text_inference'
  | 'manual';

export type AttributionTier = 'fact' | 'inferred';

export interface AttributionInput {
  contactId: string;
  /** Канал атрибуции ('telegram'|'vk'|'max'|'whatsapp'|'web'|'email'). */
  channel: string;
  /** Нормализованный slug услуги (из service-inference). */
  serviceSlug: string;
  /** Грубая категория (= slug основной услуги) или null. */
  serviceCategory?: string | null;
  /** Исходный free-text (аудит); усекается до 255. */
  serviceLabel?: string | null;
  method: AttributionMethod;
  tier: AttributionTier;
  /** 0..1; для fact = 1.0, для inferred = 0.4..0.8. */
  confidence?: number;
  /** Таблица-источник (для идемпотентного ключа). */
  sourceTable: string;
  /** id записи-источника. ОБЯЗАТЕЛЕН — sentinel строкой не пишется (P0-1). */
  sourceId: string;
  /** Когда услуга определена (для fact = created_at заказа/чека). */
  determinedAt?: Date | string | null;
}

export interface ReconcileOptions {
  /** Ограничить обработку записями не старше этой метки (для инкрементального прогона). */
  sinceTs?: Date;
  /** Размер батча для тяжёлых шагов (inference). По умолчанию 300. */
  batchSize?: number;
}

export interface ReconcileResult {
  scanned: number;
  inserted: number;
  contactsTouched: number;
}

/** Усечь free-text до лимита колонки service_label (varchar 255). */
function truncateLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const t = label.trim();
  if (!t) return null;
  return t.length > 255 ? t.slice(0, 255) : t;
}

/**
 * Идемпотентный upsert одной атрибуции.
 *
 * Ключ конфликта — partial unique `ux_csa_source_service (source_table, source_id,
 * service_slug) WHERE source_id IS NOT NULL` (P0-1). Повтор того же источника+услуги
 * обновляет существующую строку (updated_at=now()), а НЕ плодит дубли.
 *
 * Требует sourceId — sentinel строкой в таблицу НЕ пишется (живёт только в кэше).
 * После upsert — best-effort пересчёт денорм-кэша контакта (вне транзакции записи).
 */
export async function recordAttribution(input: AttributionInput): Promise<void> {
  if (!input.sourceId) {
    // sentinel/без провенанса строкой не пишем (P0-1) — это known-design, не ошибка.
    log.warn('recordAttribution skipped: sourceId is required', {
      contactId: input.contactId,
      serviceSlug: input.serviceSlug,
      method: input.method,
    });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO client_service_attributions
         (contact_id, channel, service_slug, service_label, service_category,
          method, tier, confidence, source_table, source_id, determined_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, now()))
       ON CONFLICT (source_table, source_id, service_slug) WHERE source_id IS NOT NULL
       DO UPDATE SET
         contact_id       = EXCLUDED.contact_id,
         channel          = EXCLUDED.channel,
         service_label    = EXCLUDED.service_label,
         service_category = EXCLUDED.service_category,
         method           = EXCLUDED.method,
         tier             = EXCLUDED.tier,
         confidence       = EXCLUDED.confidence,
         determined_at    = EXCLUDED.determined_at,
         updated_at       = now()`,
      [
        input.contactId,
        input.channel,
        input.serviceSlug,
        truncateLabel(input.serviceLabel),
        input.serviceCategory ?? null,
        input.method,
        input.tier,
        input.confidence ?? (input.tier === 'fact' ? 1.0 : 0.6),
        input.sourceTable,
        input.sourceId,
        input.determinedAt instanceof Date
          ? input.determinedAt.toISOString()
          : input.determinedAt ?? null,
      ],
    );
  } catch (err) {
    log.warn('recordAttribution insert failed', {
      contactId: input.contactId,
      serviceSlug: input.serviceSlug,
      sourceTable: input.sourceTable,
      sourceId: input.sourceId,
      error: String(err),
    });
    return;
  }

  // Пересчёт кэша — отдельно от INSERT (best-effort, P2-nit).
  await refreshPrimaryService(input.contactId).catch((err) =>
    log.warn('refreshPrimaryService after recordAttribution failed', {
      contactId: input.contactId,
      error: String(err),
    }),
  );
}

/**
 * `VALUES`-фрагмент `(category, priority)` из CATEGORY_PRIORITY для джойна в SQL.
 * Делает приоритет категории детерминированным на стороне БД, не завися от того,
 * попала ли категория в map (несовпавшее → COALESCE на максимальный ранг).
 */
const CATEGORY_PRIORITY_VALUES = Object.entries(CATEGORY_PRIORITY)
  .map(([cat, prio]) => `('${cat}', ${prio})`)
  .join(', ');

/** Ранг tier для кэша: fact бьёт inferred (none в таблицу не пишется). */
const TIER_RANK_SQL = `CASE a.tier WHEN 'fact' THEN 0 WHEN 'inferred' THEN 1 ELSE 2 END`;

/**
 * Пересчёт денорм-кэша contacts.primary_service_* по детерминированному правилу
 * приоритета (P0-4):
 *   1. tier_rank ASC      — fact(0) > inferred(1);
 *   2. category_priority ASC — основная услуга бьёт доп (document_photo=1…retouch=8);
 *   3. determined_at DESC — позднейшая запись;
 *   4. service_slug ASC   — финальный тай-брейкер (стабильность).
 *
 * Если у контакта нет ни одной атрибуции → кэш = sentinel
 * ('not_determined', tier='none', label='Обращение без заказа').
 */
export async function refreshPrimaryService(contactId: string): Promise<void> {
  await pool.query(
    `WITH cat_priority(category, priority) AS (VALUES ${CATEGORY_PRIORITY_VALUES}),
     chosen AS (
       SELECT a.service_slug, a.service_label, a.tier
       FROM client_service_attributions a
       LEFT JOIN cat_priority cp ON cp.category = a.service_category
       WHERE a.contact_id = $1
       ORDER BY
         ${TIER_RANK_SQL} ASC,
         COALESCE(cp.priority, 9) ASC,
         a.determined_at DESC,
         a.service_slug ASC
       LIMIT 1
     )
     UPDATE contacts c SET
       primary_service_slug     = COALESCE((SELECT service_slug FROM chosen), '${SENTINEL_SLUG}'),
       primary_service_label    = COALESCE((SELECT service_label FROM chosen), $2),
       service_attribution_tier = COALESCE((SELECT tier FROM chosen), 'none'),
       service_attributed_at    = now()
     WHERE c.id = $1`,
    [contactId, SENTINEL_LABEL],
  );
}

/** Строка заказа, нужная для attributeOrder. */
interface OrderAttributionRow {
  id: string;
  items: unknown;
  chat_session_id: string | null;
  created_at: string | null;
  contact_id: string | null;
  channel: string | null;
}

/** Нормализовать items[] заказа в список позиций для атрибуции. */
function parseOrderItems(raw: unknown): Array<Record<string, unknown>> {
  let items: unknown = raw;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      return [];
    }
  }
  return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
}

/**
 * Best-effort атрибуция заказа из чата (FC-1 / Tier1 backfill).
 *
 * Резолвит contact через `chat_session_id → conversations.contact_id` (P1-1:
 * photo_print_orders НЕ имеет contact_id). Если chat_session_id отсутствует или
 * беседа не найдена → contact недостижим → пропуск (known gap, walk-in CRM).
 *
 * Для каждой НЕ-addon позиции items пишет recordAttribution(method='order',
 * tier='fact', source_table='photo_print_orders', source_id=orderId).
 * Несколько услуг в одном заказе → несколько строк (мультиуслуга). После всех
 * записей — один refreshPrimaryService на контакт.
 *
 * НЕ в одной транзакции с INSERT заказа: падение здесь НЕ откатывает заказ.
 */
export async function attributeOrder(orderId: string): Promise<void> {
  try {
    const { rows } = await pool.query<OrderAttributionRow>(
      `SELECT o.id, o.items, o.chat_session_id, o.created_at,
              conv.contact_id, conv.channel::text AS channel
       FROM photo_print_orders o
       LEFT JOIN conversations conv ON conv.id = o.chat_session_id
       WHERE o.id = $1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) return;

    // P1-1: contact достижим только через chat_session_id → conversations.
    if (!order.contact_id) {
      // Walk-in/CRM-заказ без беседы — атрибуцию пропускаем (known gap).
      return;
    }

    const channel = order.channel || 'telegram';
    const items = parseOrderItems(order.items);

    // dedupe по service_slug в пределах заказа: ux_csa_source_service ключ
    // (source_table, source_id, service_slug) — повтор того же slug = тот же ключ.
    const seenSlugs = new Set<string>();
    let wrote = false;

    for (const item of items) {
      const match = normalizeServiceOption({
        slug: typeof item.slug === 'string' ? item.slug : null,
        service: typeof item.service === 'string' ? item.service : null,
        type: typeof item.type === 'string' ? item.type : null,
        name: typeof item.name === 'string' ? item.name : null,
        format: typeof item.format === 'string' ? item.format : null,
        paperType: typeof item.paperType === 'string' ? item.paperType : null,
      });

      const rawSlug = typeof item.slug === 'string' ? item.slug : null;
      if (isAddonSlug(rawSlug) || !match.matched) continue;
      if (seenSlugs.has(match.slug)) continue;
      seenSlugs.add(match.slug);

      const label =
        (typeof item.name === 'string' && item.name) || rawSlug || match.slug;

      // recordAttribution сам делает refresh; но в цикле это N лишних refresh.
      // Поэтому пишем INSERT напрямую и один refresh в конце.
      await upsertAttributionRow({
        contactId: order.contact_id,
        channel,
        serviceSlug: match.slug,
        serviceCategory: match.category,
        serviceLabel: label,
        method: 'order',
        tier: 'fact',
        confidence: 1.0,
        sourceTable: 'photo_print_orders',
        sourceId: order.id,
        determinedAt: order.created_at,
      });
      wrote = true;
    }

    if (wrote) {
      await refreshPrimaryService(order.contact_id);
    }
  } catch (err) {
    log.warn('attributeOrder failed', { orderId, error: String(err) });
  }
}

/**
 * Низкоуровневый upsert БЕЗ пост-refresh (для batch/циклов, где refresh делается
 * один раз в конце). recordAttribution = upsertAttributionRow + refresh.
 */
async function upsertAttributionRow(input: AttributionInput): Promise<void> {
  await pool.query(
    `INSERT INTO client_service_attributions
       (contact_id, channel, service_slug, service_label, service_category,
        method, tier, confidence, source_table, source_id, determined_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, now()))
     ON CONFLICT (source_table, source_id, service_slug) WHERE source_id IS NOT NULL
     DO UPDATE SET
       contact_id       = EXCLUDED.contact_id,
       channel          = EXCLUDED.channel,
       service_label    = EXCLUDED.service_label,
       service_category = EXCLUDED.service_category,
       method           = EXCLUDED.method,
       tier             = EXCLUDED.tier,
       confidence       = EXCLUDED.confidence,
       determined_at    = EXCLUDED.determined_at,
       updated_at       = now()`,
    [
      input.contactId,
      input.channel,
      input.serviceSlug,
      truncateLabel(input.serviceLabel),
      input.serviceCategory ?? null,
      input.method,
      input.tier,
      input.confidence ?? (input.tier === 'fact' ? 1.0 : 0.6),
      input.sourceTable,
      input.sourceId,
      input.determinedAt instanceof Date
        ? input.determinedAt.toISOString()
        : input.determinedAt ?? null,
    ],
  );
}

// ---------------------------------------------------------------------------
// Бэкфилл / реконсиляция (вызывается S4-скриптом)
// ---------------------------------------------------------------------------

/**
 * Батч-бэкфилл исторических данных → каждый TG-контакт получает заполненную
 * услугу (Tier1 факт → Tier2 inference → Tier3 sentinel-кэш). Идемпотентно
 * (ON CONFLICT), батчами с commit между шагами.
 *
 * Порядок (30-architecture §Backfill):
 *   0. orphan-fix: channel_users без contact_id → из conversations (DM).
 *   1. Tier1 orders: photo_print_orders.chat_session_id → conversations.contact_id.
 *   2. Tier1 phone-union: чеки/подписки/брони по нормализованному телефону.
 *   3. Tier2 inference: агрегат visitor-текста беседы → classifyServiceText.
 *   4. sentinel cache fill: TG-контакты без атрибуций → денорм-кэш not_determined.
 *   5. refresh: пересчёт кэша всех TG-контактов.
 */
export async function reconcileAttributions(
  opts: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const batchSize = opts.batchSize && opts.batchSize > 0 ? opts.batchSize : 300;
  const result: ReconcileResult = { scanned: 0, inserted: 0, contactsTouched: 0 };

  // Шаг 0 — orphan-fix: связать TG channel_users с contact из их DM-беседы.
  // channel_users НЕ имеет external_chat_id → матчим external_user_id с
  // conversations.external_chat_id (для DM они совпадают). Групповые чаты не чинятся.
  const orphan = await pool.query(
    `UPDATE channel_users cu
        SET contact_id = sub.contact_id
       FROM (
         SELECT DISTINCT ON (conv.external_chat_id)
                conv.external_chat_id, conv.contact_id
         FROM conversations conv
         WHERE conv.channel = 'telegram' AND conv.external_chat_id IS NOT NULL
         ORDER BY conv.external_chat_id, conv.created_at ASC
       ) sub
      WHERE cu.channel = 'telegram'
        AND cu.contact_id IS NULL
        AND cu.external_user_id = sub.external_chat_id`,
  );
  result.contactsTouched += orphan.rowCount ?? 0;

  // Шаг 1 — Tier1 orders по внутреннему ключу (chat_session_id → conversations).
  const inserted1 = await backfillTier1Orders(opts.sinceTs);
  result.inserted += inserted1.inserted;
  result.scanned += inserted1.scanned;

  // Шаг 2 — Tier1 phone-union (чеки/подписки/брони) для TG-контактов с телефоном.
  const inserted2 = await backfillTier1PhoneUnion();
  result.inserted += inserted2.inserted;
  result.scanned += inserted2.scanned;

  // Шаг 3 — Tier2 inference по агрегату visitor-текста бесед (батчами).
  const inserted3 = await backfillTier2Inference(batchSize);
  result.inserted += inserted3.inserted;
  result.scanned += inserted3.scanned;

  // Шаг 3b — Tier2 inference по ВЛОЖЕНИЯМ беседы (фото/файл в любую сторону).
  // В TG-канале «прислал документ/фото» (клиент) ИЛИ «мы отправили клиенту
  // фото/файл» (оператор) = услуга оказывалась, даже если формального заказа нет
  // и в тексте нет ключевого слова. Заполняет беседы без текстового сигнала.
  const inserted3b = await backfillAttachmentInference();
  result.inserted += inserted3b.inserted;
  result.scanned += inserted3b.scanned;

  // Шаги 4+5 — sentinel-кэш + refresh: bulk-пересчёт кэша всех TG-контактов
  // одним запросом (детерминированное правило приоритета, P0-4).
  const refreshed = await refreshAllTelegramContacts();
  result.contactsTouched += refreshed;

  return result;
}

/** Tier1: развернуть items заказов из чата и записать факт-атрибуции. */
async function backfillTier1Orders(
  sinceTs?: Date,
): Promise<{ scanned: number; inserted: number }> {
  const { rows } = await pool.query<OrderAttributionRow>(
    `SELECT o.id, o.items, o.chat_session_id, o.created_at,
            conv.contact_id, conv.channel::text AS channel
     FROM photo_print_orders o
     JOIN conversations conv ON conv.id = o.chat_session_id
     WHERE o.chat_session_id IS NOT NULL
       AND conv.channel = 'telegram'
       ${sinceTs ? 'AND o.created_at >= $1' : ''}
     ORDER BY o.created_at ASC`,
    sinceTs ? [sinceTs.toISOString()] : [],
  );

  let scanned = 0;
  let inserted = 0;
  const touched = new Set<string>();

  for (const order of rows) {
    scanned++;
    if (!order.contact_id) continue;
    const items = parseOrderItems(order.items);
    const seen = new Set<string>();
    for (const item of items) {
      const match = normalizeServiceOption({
        slug: typeof item.slug === 'string' ? item.slug : null,
        service: typeof item.service === 'string' ? item.service : null,
        type: typeof item.type === 'string' ? item.type : null,
        name: typeof item.name === 'string' ? item.name : null,
        format: typeof item.format === 'string' ? item.format : null,
        paperType: typeof item.paperType === 'string' ? item.paperType : null,
      });
      const rawSlug = typeof item.slug === 'string' ? item.slug : null;
      if (isAddonSlug(rawSlug) || !match.matched || seen.has(match.slug)) continue;
      seen.add(match.slug);
      await upsertAttributionRow({
        contactId: order.contact_id,
        channel: order.channel || 'telegram',
        serviceSlug: match.slug,
        serviceCategory: match.category,
        serviceLabel: (typeof item.name === 'string' && item.name) || rawSlug || match.slug,
        method: 'order',
        tier: 'fact',
        confidence: 1.0,
        sourceTable: 'photo_print_orders',
        sourceId: order.id,
        determinedAt: order.created_at,
      });
      inserted++;
      touched.add(order.contact_id);
    }
  }

  return { scanned, inserted };
}

/**
 * Tier1 phone-union: для TG-контактов с телефоном — заказы/чеки/подписки/брони,
 * не покрытые шагом 1, по нормализованному телефону (последние 10 цифр).
 *
 * source_id берётся от записи-источника (чек/подписка/бронь), source_table — её
 * таблица → идемпотентность по тому же ux_csa_source_service.
 */
async function backfillTier1PhoneUnion(): Promise<{ scanned: number; inserted: number }> {
  let scanned = 0;
  let inserted = 0;

  // Маппинг нормализованного телефона TG-контактов (последние 10 цифр) → contact_id.
  const { rows: tgContacts } = await pool.query<{ contact_id: string; phone10: string }>(
    `SELECT DISTINCT c.id AS contact_id,
            right(regexp_replace(c.phone, '\\D', '', 'g'), 10) AS phone10
     FROM contacts c
     JOIN channel_users cu ON cu.contact_id = c.id AND cu.channel = 'telegram'
     WHERE c.phone IS NOT NULL AND length(regexp_replace(c.phone, '\\D', '', 'g')) >= 10`,
  );
  const phoneToContact = new Map<string, string>();
  for (const r of tgContacts) if (r.phone10) phoneToContact.set(r.phone10, r.contact_id);
  if (phoneToContact.size === 0) return { scanned, inserted };

  const phones = Array.from(phoneToContact.keys());

  // --- Подписки (user_subscriptions) → услуга 'subscription' (всегда) ---
  const { rows: subs } = await pool.query<{
    id: string;
    phone10: string;
    created_at: string | null;
    plan_id: string | null;
  }>(
    `SELECT id, right(regexp_replace(phone, '\\D', '', 'g'), 10) AS phone10,
            created_at, plan_id::text AS plan_id
     FROM user_subscriptions
     WHERE phone IS NOT NULL
       AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = ANY($1::text[])`,
    [phones],
  );
  for (const s of subs) {
    scanned++;
    const contactId = phoneToContact.get(s.phone10);
    if (!contactId) continue;
    await upsertAttributionRow({
      contactId,
      channel: 'telegram',
      serviceSlug: 'subscription',
      serviceCategory: 'subscription',
      serviceLabel: 'Подписка',
      method: 'subscription',
      tier: 'fact',
      confidence: 1.0,
      sourceTable: 'user_subscriptions',
      sourceId: s.id,
      determinedAt: s.created_at,
    });
    inserted++;
  }

  // --- Брони (bookings) → услуга по service_category_slug / service_name ---
  const { rows: bookings } = await pool.query<{
    id: string;
    phone10: string;
    created_at: string | null;
    service_name: string | null;
    service_category_slug: string | null;
  }>(
    `SELECT id, right(regexp_replace(client_phone, '\\D', '', 'g'), 10) AS phone10,
            created_at, service_name, service_category_slug
     FROM bookings
     WHERE client_phone IS NOT NULL
       AND right(regexp_replace(client_phone, '\\D', '', 'g'), 10) = ANY($1::text[])`,
    [phones],
  );
  for (const b of bookings) {
    scanned++;
    const contactId = phoneToContact.get(b.phone10);
    if (!contactId) continue;
    const match = normalizeServiceOption({
      slug: b.service_category_slug,
      name: b.service_name,
    });
    // Бронь — это фотосессия; если словарь не распознал — пишем как booking/'photo_print'.
    const slug = match.matched ? match.slug : 'photo_print';
    const category = match.matched ? match.category : 'photo_print';
    await upsertAttributionRow({
      contactId,
      channel: 'telegram',
      serviceSlug: slug,
      serviceCategory: category,
      serviceLabel: b.service_name || b.service_category_slug || slug,
      method: 'booking',
      tier: 'fact',
      confidence: 1.0,
      sourceTable: 'bookings',
      sourceId: b.id,
      determinedAt: b.created_at,
    });
    inserted++;
  }

  // --- Чеки (pos_receipts + items) → услуга по product_name ---
  const { rows: receiptItems } = await pool.query<{
    receipt_id: string;
    phone10: string;
    created_at: string | null;
    product_name: string | null;
  }>(
    `SELECT pri.receipt_id,
            right(regexp_replace(pr.customer_phone, '\\D', '', 'g'), 10) AS phone10,
            pr.created_at, pri.product_name
     FROM pos_receipts pr
     JOIN pos_receipt_items pri ON pri.receipt_id = pr.id
     WHERE pr.customer_phone IS NOT NULL
       AND pr.voided_at IS NULL
       AND right(regexp_replace(pr.customer_phone, '\\D', '', 'g'), 10) = ANY($1::text[])`,
    [phones],
  );
  // dedupe (receipt_id, slug): несколько позиций чека с той же услугой = одна строка.
  const receiptSeen = new Set<string>();
  for (const ri of receiptItems) {
    scanned++;
    const contactId = phoneToContact.get(ri.phone10);
    if (!contactId) continue;
    const match = normalizeProductName(ri.product_name);
    if (!match.matched) continue;
    const dedupeKey = `${ri.receipt_id}:${match.slug}`;
    if (receiptSeen.has(dedupeKey)) continue;
    receiptSeen.add(dedupeKey);
    await upsertAttributionRow({
      contactId,
      channel: 'telegram',
      serviceSlug: match.slug,
      serviceCategory: match.category,
      serviceLabel: ri.product_name,
      method: 'receipt',
      tier: 'fact',
      confidence: 1.0,
      sourceTable: 'pos_receipts',
      sourceId: ri.receipt_id,
      determinedAt: ri.created_at,
    });
    inserted++;
  }

  return { scanned, inserted };
}

/**
 * Tier2 inference: для TG-контактов без Tier1-факта — агрегировать visitor-текст
 * беседы (string_agg в SQL, НЕ грузить все messages в Node) и классифицировать.
 * Пишем ОДНУ inferred-строку на беседу (source_id=conversation_id) на primary-slug
 * с наибольшей confidence (мультиуслуга в чате — берём сильнейший сигнал).
 *
 * Батчами по `batchSize` бесед; commit неявный (autocommit на pool.query).
 */
async function backfillTier2Inference(
  batchSize: number,
): Promise<{ scanned: number; inserted: number }> {
  let scanned = 0;
  let inserted = 0;
  let offset = 0;

  // Беседы TG, у контакта которых ещё нет ни одной fact-атрибуции.
  // Агрегируем ТОЛЬКО текстовые visitor-реплики (sender_type='visitor' И message_type='text').
  // Не-text сообщения (image/file/contact/audio/video/...) кладут в content имя вложения
  // или подпись медиа — это шум, а не услуга, исключаем (давало ложные document_photo/lamination).
  // Согласовано с FC-3: онлайн-инференс в S5 тоже берёт только text-сообщения.
  for (;;) {
    const { rows } = await pool.query<{
      conversation_id: string;
      contact_id: string;
      channel: string;
      visitor_text: string | null;
    }>(
      `SELECT conv.id AS conversation_id, conv.contact_id, conv.channel::text AS channel,
              string_agg(m.content, ' ' ORDER BY m.created_at)
                FILTER (WHERE m.sender_type = 'visitor' AND m.message_type = 'text') AS visitor_text
       FROM conversations conv
       JOIN messages m ON m.conversation_id = conv.id
       WHERE conv.channel = 'telegram'
         AND NOT EXISTS (
           SELECT 1 FROM client_service_attributions a
           WHERE a.contact_id = conv.contact_id AND a.tier = 'fact'
         )
       GROUP BY conv.id, conv.contact_id, conv.channel
       ORDER BY conv.id
       LIMIT $1 OFFSET $2`,
      [batchSize, offset],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      if (!row.visitor_text) continue;
      const matches = classifyServiceText(row.visitor_text).filter(
        (m: ServiceMatch) => m.matched && m.confidence >= INFERENCE_CONFIDENCE_THRESHOLD,
      );
      if (matches.length === 0) continue;
      // primary inferred-сигнал: наибольшая confidence, тай-брейк по приоритету категории.
      const best = matches.reduce((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence > a.confidence ? b : a;
        const pa = CATEGORY_PRIORITY[a.category ?? 'other'] ?? 9;
        const pb = CATEGORY_PRIORITY[b.category ?? 'other'] ?? 9;
        return pb < pa ? b : a;
      });
      await upsertAttributionRow({
        contactId: row.contact_id,
        channel: row.channel || 'telegram',
        serviceSlug: best.slug,
        serviceCategory: best.category,
        serviceLabel: truncateLabel(row.visitor_text),
        method: 'text_inference',
        tier: 'inferred',
        confidence: best.confidence,
        sourceTable: 'conversations',
        sourceId: row.conversation_id,
        determinedAt: null,
      });
      inserted++;
    }

    if (rows.length < batchSize) break;
    offset += batchSize;
  }

  return { scanned, inserted };
}

/** Строка-сигнал об услуге по вложениям/доставке в беседе (Tier2). */
interface AttachmentSignalRow {
  conversation_id: string;
  contact_id: string;
  channel: string;
  has_image: boolean;
  has_file: boolean;
  has_delivery_link: boolean;
}

/**
 * Tier2 inference по ВЛОЖЕНИЯМ: для TG-бесед без Tier1-факта и без текстового
 * Tier2-сигнала — если в переписке есть фото/файл (от клиента ИЛИ от оператора),
 * это признак оказанной услуги:
 *   - фото (image, любая сторона) → 'document_photo' (фото на документы — основная
 *     услуга студии; клиент прислал фото/документ либо мы отправили готовый результат);
 *   - файл (file, любая сторона) → 'copy' (печать документа).
 * Пишем inferred-строки (method='conversation', source_id=conversation_id). При
 * наличии и фото, и файла пишем обе — refresh выберет primary по приоритету
 * категории (document_photo=1 > copy=4). Bot/system-сообщения исключены.
 * Идемпотентно: беседы с уже имеющейся атрибуцией (любой source_id) пропускаются.
 */
async function backfillAttachmentInference(): Promise<{ scanned: number; inserted: number }> {
  let scanned = 0;
  let inserted = 0;

  const { rows } = await pool.query<AttachmentSignalRow>(
    `SELECT conv.id AS conversation_id, conv.contact_id, conv.channel::text AS channel,
            bool_or(m.sender_type IN ('visitor','operator') AND m.message_type = 'image') AS has_image,
            bool_or(m.sender_type IN ('visitor','operator') AND m.message_type = 'file')  AS has_file,
            bool_or(m.sender_type = 'operator' AND m.content ~* 'fmagnus')                AS has_delivery_link
       FROM conversations conv
       JOIN messages m ON m.conversation_id = conv.id
      WHERE conv.channel = 'telegram'
        AND (
              (m.sender_type IN ('visitor','operator') AND m.message_type IN ('image', 'file'))
           OR (m.sender_type = 'operator' AND m.content ~* 'fmagnus')
            )
        AND NOT EXISTS (
          SELECT 1 FROM client_service_attributions a
          WHERE a.contact_id = conv.contact_id AND a.tier = 'fact'
        )
        AND NOT EXISTS (
          SELECT 1 FROM client_service_attributions a
          WHERE a.source_table = 'conversations' AND a.source_id = conv.id
        )
      GROUP BY conv.id, conv.contact_id, conv.channel`,
  );

  for (const row of rows) {
    scanned++;
    const channel = row.channel || 'telegram';
    // Готовые фото отправлены клиенту ссылкой (support.fmagnus.org) ИЛИ фото в
    // переписке → услуга «фото на документы». Доставка ссылкой — сильнее (0.75).
    if (row.has_image || row.has_delivery_link) {
      await upsertAttributionRow({
        contactId: row.contact_id,
        channel,
        serviceSlug: 'document_photo',
        serviceCategory: 'document_photo',
        serviceLabel: row.has_delivery_link
          ? 'Готовые фото отправлены клиенту ссылкой'
          : 'Фото на документы (по фото в переписке)',
        method: 'conversation',
        tier: 'inferred',
        confidence: row.has_delivery_link ? 0.75 : 0.5,
        sourceTable: 'conversations',
        sourceId: row.conversation_id,
        determinedAt: null,
      });
      inserted++;
    }
    if (row.has_file) {
      await upsertAttributionRow({
        contactId: row.contact_id,
        channel,
        serviceSlug: 'copy',
        serviceCategory: 'copy',
        serviceLabel: 'Печать документа (файл в переписке)',
        method: 'conversation',
        tier: 'inferred',
        confidence: 0.55,
        sourceTable: 'conversations',
        sourceId: row.conversation_id,
        determinedAt: null,
      });
      inserted++;
    }
  }

  return { scanned, inserted };
}

/**
 * Bulk-пересчёт денорм-кэша всех TG-контактов одним запросом (шаги 4+5).
 * Для контактов без атрибуций → sentinel (Tier3). Детерминированное правило
 * приоритета (P0-4) применяется через LATERAL-выбор лучшей атрибуции.
 */
async function refreshAllTelegramContacts(): Promise<number> {
  const res = await pool.query(
    `WITH cat_priority(category, priority) AS (VALUES ${CATEGORY_PRIORITY_VALUES}),
     tg_contacts AS (
       SELECT DISTINCT c.id
       FROM contacts c
       JOIN channel_users cu ON cu.contact_id = c.id AND cu.channel = 'telegram'
     )
     UPDATE contacts c SET
       primary_service_slug     = COALESCE(best.service_slug, '${SENTINEL_SLUG}'),
       primary_service_label    = COALESCE(best.service_label, '${SENTINEL_LABEL}'),
       service_attribution_tier = COALESCE(best.tier, 'none'),
       service_attributed_at    = now()
     FROM tg_contacts t
     LEFT JOIN LATERAL (
       SELECT a.service_slug, a.service_label, a.tier
       FROM client_service_attributions a
       LEFT JOIN cat_priority cp ON cp.category = a.service_category
       WHERE a.contact_id = t.id
       ORDER BY
         ${TIER_RANK_SQL} ASC,
         COALESCE(cp.priority, 9) ASC,
         a.determined_at DESC,
         a.service_slug ASC
       LIMIT 1
     ) best ON true
     WHERE c.id = t.id`,
  );
  return res.rowCount ?? 0;
}

/**
 * Online Tier2 inference по одному сообщению (FC-3, за флагом у вызывающего).
 * Классифицирует текст; при сигнале ≥ порога пишет inferred-атрибуцию по беседе
 * (source_id=conversationId) — идемпотентно. НЕ трогает selected_service (это
 * делает вызывающий, см. S5). Best-effort: ошибки не пробрасываются.
 *
 * @returns true, если атрибуция записана.
 */
export async function inferAttributionFromMessage(params: {
  contactId: string;
  conversationId: string;
  channel: string;
  text: string;
}): Promise<boolean> {
  try {
    const matches = classifyServiceText(params.text).filter(
      (m) => m.matched && m.confidence >= INFERENCE_CONFIDENCE_THRESHOLD,
    );
    if (matches.length === 0) return false;
    const best = matches[0]; // classifyServiceText уже отдаёт в порядке приоритета правил
    await recordAttribution({
      contactId: params.contactId,
      channel: params.channel,
      serviceSlug: best.slug,
      serviceCategory: best.category,
      serviceLabel: truncateLabel(params.text),
      method: 'text_inference',
      tier: 'inferred',
      confidence: best.confidence,
      sourceTable: 'conversations',
      sourceId: params.conversationId,
      determinedAt: null,
    });
    return true;
  } catch (err) {
    log.warn('inferAttributionFromMessage failed', {
      conversationId: params.conversationId,
      error: String(err),
    });
    return false;
  }
}

// Реэкспорт для удобства S4/S5 (единая точка нормализации).
export { normalizeServiceOption, normalizeProductName, classifyServiceText, isAddonSlug };
