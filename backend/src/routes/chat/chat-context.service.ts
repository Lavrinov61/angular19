/**
 * Chat context service — управление контекстом сессии (кэш JSONB, пересчёт, обновление).
 * Извлечено из visitor-chat.routes.ts (lines 2757-3010).
 *
 * Включает in-memory кеш customer-данных (30s TTL) для сокращения DB-запросов:
 * без кеша isReturningBasicCustomer() делает 2-3 DB-запроса за вызов × 10+ вызовов = 20-30 запросов.
 * С кешом: 2-3 запроса за первый вызов, остальные — из памяти.
 */

import { pool } from '../../database/db.js';
import { findOrCreateCustomer, hasUsedBasicPromo } from '../../services/customer.service.js';
import { DOCUMENT_TYPES, getServiceOptionsForCustomer } from './chat-pricing.helpers.js';

// ============================================================================
// In-memory customer cache (per session, 30s TTL)
// ============================================================================

interface CachedCustomerInfo {
  visitorId: string;
  isReturning: boolean;
  timestamp: number;
}

const customerCache = new Map<string, CachedCustomerInfo>();
const CACHE_TTL = 30_000;

/** Периодическая очистка устаревших записей (каждые 60с) */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of customerCache) {
    if (now - entry.timestamp > CACHE_TTL * 2) {
      customerCache.delete(key);
    }
  }
}, 60_000).unref();

// ============================================================================
// Visitor / Customer helpers
// ============================================================================

/** Получить visitor_id из conversation */
export async function getVisitorIdFromSession(sessionId: string): Promise<string> {
  // Проверяем кеш — visitor_id не меняется в течение сессии
  const cached = customerCache.get(sessionId);
  if (cached) return cached.visitorId;

  const res = await pool.query(
    `SELECT visitor_id FROM conversations WHERE id = $1`, [sessionId]
  );
  return res.rows[0]?.visitor_id || '';
}

/** Проверить, использовал ли клиент промо (через customer service, с кешированием) */
export async function isReturningBasicCustomer(sessionId: string): Promise<boolean> {
  const cached = customerCache.get(sessionId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.isReturning;
  }

  try {
    const visitorId = await getVisitorIdFromSession(sessionId);
    if (!visitorId) return false;
    const customer = await findOrCreateCustomer({ visitorId });
    const isReturning = hasUsedBasicPromo(customer);

    customerCache.set(sessionId, { visitorId, isReturning, timestamp: Date.now() });
    return isReturning;
  } catch {
    return false;
  }
}

/** Инвалидировать кеш клиента (после оплаты, когда used_basic_promo меняется) */
export function invalidateCustomerCache(sessionId: string): void {
  customerCache.delete(sessionId);
}

// ============================================================================
// Session context (JSONB cache)
// ============================================================================

/**
 * Получить контекст ТЕКУЩЕГО заказа.
 *
 * Читает из JSONB-кэша `context` в conversations (O(1)).
 * Если кэш пуст (новая сессия / миграция) — fallback на recalcSessionContext.
 *
 * orderNumber: 1-based номер текущего цикла заказа (order_photo).
 */
export interface SessionContext {
  hasPhoto: boolean;
  photoCount: number;
  selectedDoc: string | null;
  selectedTariff: string | null;
  orderNumber: number;
  categorySlug: string | null;
  /** Новый flow: group_slug → [option_slugs] */
  selectedOptions: Record<string, string[]>;
  currentOptionStep: string | null;
}

export async function getSessionContext(sessionId: string): Promise<SessionContext> {
  const res = await pool.query(
    `SELECT context, metadata FROM conversations WHERE id = $1`,
    [sessionId]
  );
  const row = res.rows[0];
  if (!row) {
    return {
      hasPhoto: false,
      photoCount: 0,
      selectedDoc: null,
      selectedTariff: null,
      orderNumber: 1,
      categorySlug: null,
      selectedOptions: {},
      currentOptionStep: null,
    };
  }

  const ctx = row.context || {};
  const cachedSelectedOptions = (ctx.selectedOptions as Record<string, string[]>) || {};
  const cachedCategorySlug = (ctx.categorySlug as string | null) || null;
  // Если кэш заполнен (orderNumber есть) — быстрый путь
  if (ctx.orderNumber !== undefined) {
    const meta = row.metadata || {};
    return {
      hasPhoto: !!ctx.hasPhoto,
      photoCount: ctx.photoCount || 0,
      selectedDoc: ctx.selectedDoc || null,
      selectedTariff: meta.upgradedTariff || ctx.selectedTariff || null,
      orderNumber: ctx.orderNumber || 1,
      categorySlug: cachedCategorySlug,
      selectedOptions: (ctx.selectedOptions as Record<string, string[]>) || {},
      currentOptionStep: (ctx.currentOptionStep as string | null) || null,
    };
  }

  // Fallback: полный пересчёт + запись в кэш
  const recalculated = await recalcSessionContext(sessionId);
  if (Object.keys(recalculated.selectedOptions).length === 0 && Object.keys(cachedSelectedOptions).length > 0) {
    await updateSessionContext(sessionId, { selectedOptions: cachedSelectedOptions, categorySlug: cachedCategorySlug });
    return { ...recalculated, selectedOptions: cachedSelectedOptions, categorySlug: cachedCategorySlug };
  }
  return recalculated;
}

/**
 * Полный пересчёт контекста из всех сообщений + запись в кэш.
 * Используется: первый вызов / миграция / после удаления фото.
 */
export async function recalcSessionContext(sessionId: string): Promise<SessionContext> {
  const [result, serviceOptions, sessionRes] = await Promise.all([
    pool.query(
      `SELECT sender_type, message_type, content, metadata FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    ),
    getServiceOptionsForCustomer(false),
    pool.query(
      `SELECT context FROM conversations WHERE id = $1`,
      [sessionId],
    ),
  ]);

  let hasPhoto = false;
  let photoCount = 0;
  let selectedDoc: string | null = null;
  let selectedTariff: string | null = null;
  let orderCycles = 0;
  const categorySlug = (sessionRes.rows[0]?.context?.categorySlug as string | null) || null;

  for (const row of result.rows) {
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : null;
    // Prefer buttonValue from metadata (new format), fall back to content (legacy messages)
    const effectiveValue = (meta?.['buttonValue'] as string | undefined) || row.content;

    if (row.sender_type === 'visitor' && effectiveValue === 'order_photo') {
      orderCycles++;
      hasPhoto = false;
      photoCount = 0;
      selectedDoc = null;
      selectedTariff = null;
      continue;
    }
    const hiddenInUi = meta?.['hiddenInUi'] === true;

    if (row.sender_type === 'visitor' && row.message_type === 'image' && !hiddenInUi) {
      hasPhoto = true;
      photoCount++;
    }
    if (row.sender_type === 'visitor') {
      const docMatch = DOCUMENT_TYPES.find(d => d.value === effectiveValue || effectiveValue?.includes(d.value));
      if (docMatch) selectedDoc = docMatch.value;
      const serviceMatch = serviceOptions.find(s => s.value === effectiveValue || effectiveValue?.includes(s.value));
      if (serviceMatch) selectedTariff = serviceMatch.value;
    }
  }

  const orderNumber = Math.max(1, orderCycles);

  // Записываем кэш (без upgradedTariff — он в metadata; selectedOptions восстанавливается пустым)
  const metaRes = await pool.query(
    `UPDATE conversations SET context = $1::jsonb WHERE id = $2 RETURNING metadata`,
    [JSON.stringify({ hasPhoto, photoCount, selectedDoc, selectedTariff, orderCycles, orderNumber, categorySlug }), sessionId]
  );
  const sessionMeta = metaRes.rows[0]?.metadata || {};
  if (sessionMeta.upgradedTariff) {
    selectedTariff = sessionMeta.upgradedTariff;
  }

  return {
    hasPhoto,
    photoCount,
    selectedDoc,
    selectedTariff,
    orderNumber,
    categorySlug,
    selectedOptions: {},
    currentOptionStep: null,
  };
}

/**
 * Атомарное обновление отдельных полей контекста (JSONB merge).
 */
export async function updateSessionContext(sessionId: string, patch: Record<string, any>): Promise<void> {
  await pool.query(
    `UPDATE conversations SET context = COALESCE(context, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
    [JSON.stringify(patch), sessionId]
  );
}
