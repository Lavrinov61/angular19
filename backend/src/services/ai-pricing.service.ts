/**
 * AI Pricing Service — интеллектуальное управление ценами.
 *
 * Принцип: ИИ предлагает изменения → администратор утверждает/отклоняет.
 * Все изменения логируются в pricing_ai_suggestions.
 *
 * Guardrails (жёсткие ограничения):
 *   - Максимальная скидка: 30%
 *   - Максимальный срок акции: 7 дней
 *   - Повышение цен запрещено (ИИ не может поднять цену выше текущей)
 *   - Минимальная цена = 100₽
 */

import crypto from 'crypto';
import db from '../database/db.js';
import { getAIProvider } from './ai-providers/index.js';
import { cacheGet, cacheSet } from './redis-cache.service.js';
import { SERVICE_BREAKERS, getBreaker } from '../utils/circuit-breaker.js';

const AI_PRICING_PREFIX = 'ai-pricing:suggestions:';
const AI_PRICING_TTL = 300; // 5 min

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AiPricingSuggestion {
  id: string;
  option_slug: string;
  option_name: string;
  current_price: number;
  suggested_price: number;
  discount_percent: number;
  reason: string;
  valid_from: string;
  valid_until: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface AiPricingAnalysis {
  total_orders_7d: number;
  avg_order_value: number;
  top_category: string;
  slow_moving: string[];
  recommendation: string;
}

// ── Guardrails ────────────────────────────────────────────────────────────────

const MAX_DISCOUNT_PERCENT = 30;
const MAX_PROMO_DAYS = 7;
const MIN_PRICE = 100;

function applyGuardrails(currentPrice: number, suggestedPrice: number, validUntilStr: string): {
  price: number;
  discountPercent: number;
  validUntil: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  let price = suggestedPrice;
  const now = new Date();
  let validUntil = new Date(validUntilStr);

  // No price increases
  if (price > currentPrice) {
    warnings.push(`Повышение цены запрещено. Оставляю текущую цену ${currentPrice}₽.`);
    price = currentPrice;
  }

  // Min price
  if (price < MIN_PRICE) {
    warnings.push(`Цена ниже минимума ${MIN_PRICE}₽. Ограничиваю.`);
    price = MIN_PRICE;
  }

  // Max discount
  const discountPercent = Math.round(((currentPrice - price) / currentPrice) * 100);
  let finalDiscountPercent = discountPercent;
  if (discountPercent > MAX_DISCOUNT_PERCENT) {
    warnings.push(`Скидка ${discountPercent}% превышает максимум ${MAX_DISCOUNT_PERCENT}%. Ограничиваю.`);
    finalDiscountPercent = MAX_DISCOUNT_PERCENT;
    price = Math.round(currentPrice * (1 - MAX_DISCOUNT_PERCENT / 100));
  }

  // Max promo duration
  const maxUntil = new Date(now.getTime() + MAX_PROMO_DAYS * 24 * 60 * 60 * 1000);
  if (validUntil > maxUntil) {
    warnings.push(`Срок акции превышает ${MAX_PROMO_DAYS} дней. Ограничиваю.`);
    validUntil = maxUntil;
  }

  return {
    price,
    discountPercent: finalDiscountPercent,
    validUntil: validUntil.toISOString(),
    warnings,
  };
}

// ── AI call ───────────────────────────────────────────────────────────────────

async function callAI(prompt: string): Promise<string> {
  const provider = getAIProvider();
  return provider.chat(
    [
      {
        role: 'system',
        content: `Ты — ИИ-менеджер по ценообразованию для фотостудии "Своё Фото".
Задача: анализировать данные о продажах и предлагать скидки на медленно продающиеся услуги.
Правила:
- Никогда не предлагай повышение цен
- Максимальная скидка: 30%
- Минимальная цена: 100₽
- Максимальный срок акции: 7 дней
- Отвечай строго в формате JSON`,
      },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.3, maxTokens: 1000 }
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Анализирует продажи за последние 7 дней и генерирует предложения по скидкам.
 */
export async function generatePricingSuggestions(requestedBy: string): Promise<{
  suggestions: AiPricingSuggestion[];
  analysis: AiPricingAnalysis;
  warnings: string[];
}> {
  const allWarnings: string[] = [];

  // Gather context: orders last 7 days by option
  const salesData = await db.query<{
    option_slug: string;
    option_name: string;
    base_price: string;
    order_count: string;
  }>(
    `SELECT so.slug AS option_slug, so.name AS option_name,
            so.base_price::text,
            COALESCE(COUNT(oi.id), 0)::text AS order_count
     FROM service_options so
     LEFT JOIN order_items oi ON oi.option_slug = so.slug
       AND oi.created_at >= NOW() - INTERVAL '7 days'
     WHERE so.is_active = true
     GROUP BY so.slug, so.name, so.base_price
     ORDER BY order_count ASC
     LIMIT 20`,
  );

  const totalOrders = await db.queryOne<{ cnt: string; avg: string }>(
    `SELECT COUNT(*)::text AS cnt, COALESCE(AVG(total_amount), 0)::text AS avg
     FROM orders WHERE created_at >= NOW() - INTERVAL '7 days'`,
  );

  const topCategory = await db.queryOne<{ category_slug: string }>(
    `SELECT so.category_slug
     FROM order_items oi
     JOIN service_options so ON so.slug = oi.option_slug
     WHERE oi.created_at >= NOW() - INTERVAL '7 days'
     GROUP BY so.category_slug
     ORDER BY COUNT(*) DESC
     LIMIT 1`,
  );

  const slowMoving = salesData
    .filter(r => parseInt(r.order_count, 10) === 0)
    .map(r => r.option_slug);

  const analysis: AiPricingAnalysis = {
    total_orders_7d: parseInt(totalOrders?.cnt || '0', 10),
    avg_order_value: Math.round(parseFloat(totalOrders?.avg || '0')),
    top_category: topCategory?.category_slug || 'неизвестно',
    slow_moving: slowMoving,
    recommendation: '',
  };

  if (slowMoving.length === 0) {
    analysis.recommendation = 'Все услуги продаются. Скидки не требуются.';
    return { suggestions: [], analysis, warnings: [] };
  }

  // Hot cache: hash context (date + sorted slow-moving slugs) to avoid repeated AI calls for the same dataset
  type CachedResult = { suggestions: AiPricingSuggestion[]; analysis: AiPricingAnalysis; warnings: string[] };
  const hashKey = crypto
    .createHash('sha1')
    .update(JSON.stringify({ date: new Date().toDateString(), slowMoving: [...slowMoving].sort() }))
    .digest('hex');
  const cacheKey = AI_PRICING_PREFIX + hashKey;
  const cachedResult = await cacheGet<CachedResult>(cacheKey);
  if (cachedResult) return cachedResult;

  // Breaker gate: if Gemini breaker is OPEN, fail soft with cache miss (no DB writes, no AI call)
  const breaker = getBreaker(SERVICE_BREAKERS.gemini.name);
  if (breaker.getState() === 'OPEN') {
    analysis.recommendation = 'ИИ временно недоступен (breaker open).';
    return {
      suggestions: [],
      analysis,
      warnings: ['AI временно недоступен (breaker open)'],
    };
  }

  const prompt = `Данные за последние 7 дней:
Заказов: ${analysis.total_orders_7d}
Средний чек: ${analysis.avg_order_value}₽
Топ категория: ${analysis.top_category}
Услуги без заказов: ${JSON.stringify(salesData.filter(r => parseInt(r.order_count, 10) === 0).map(r => ({
    slug: r.option_slug,
    name: r.option_name,
    price: parseFloat(r.base_price),
  })))}

Предложи скидки (1-3 штуки) для стимулирования продаж. Для каждой услуги укажи:
- option_slug
- suggested_price (число в рублях, должно быть меньше текущей цены)
- reason (краткое объяснение 1-2 предложения)
- valid_days (1-7 дней)

Ответ в формате JSON: { "suggestions": [...], "recommendation": "..." }`;

  let aiResponseRaw = '{}';
  try {
    aiResponseRaw = await callAI(prompt);
  } catch (err) {
    allWarnings.push(`ИИ недоступен: ${(err as Error).message}`);
    analysis.recommendation = 'ИИ временно недоступен.';
    return { suggestions: [], analysis, warnings: allWarnings };
  }

  let aiResponse: { suggestions?: any[]; recommendation?: string } = {};
  try {
    // Extract JSON from possible markdown wrapper
    const jsonMatch = aiResponseRaw.match(/```json\s*([\s\S]*?)```/) || aiResponseRaw.match(/\{[\s\S]*\}/);
    aiResponse = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : aiResponseRaw);
  } catch {
    allWarnings.push('ИИ вернул невалидный JSON');
    analysis.recommendation = 'Ошибка разбора ответа ИИ.';
    return { suggestions: [], analysis, warnings: allWarnings };
  }

  analysis.recommendation = aiResponse.recommendation || 'Смотрите предложения ниже.';

  const createdSuggestions: AiPricingSuggestion[] = [];
  const now = new Date();

  for (const s of (aiResponse.suggestions || [])) {
    const optionData = salesData.find(r => r.option_slug === s.option_slug);
    if (!optionData) continue;
    const currentPrice = parseFloat(optionData.base_price);
    const validDays = Math.min(s.valid_days || 3, MAX_PROMO_DAYS);
    const validUntilRaw = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000).toISOString();

    const { price: finalPrice, discountPercent, validUntil, warnings } = applyGuardrails(
      currentPrice,
      parseFloat(s.suggested_price) || currentPrice,
      validUntilRaw,
    );
    allWarnings.push(...warnings);

    if (finalPrice >= currentPrice) continue; // no real discount after guardrails

    const row = await db.queryOne<AiPricingSuggestion>(
      `INSERT INTO pricing_ai_suggestions
         (option_slug, option_name, current_price, suggested_price, discount_percent,
          reason, valid_from, valid_until, status, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, 'pending', $8)
       RETURNING *`,
      [
        s.option_slug, optionData.option_name, currentPrice,
        finalPrice, discountPercent, s.reason || 'Рекомендация ИИ',
        validUntil, requestedBy,
      ],
    );
    if (row) createdSuggestions.push(row);
  }

  const result = { suggestions: createdSuggestions, analysis, warnings: allWarnings };
  await cacheSet(cacheKey, result, AI_PRICING_TTL);
  return result;
}

/**
 * Получает список предложений со статусом pending.
 */
export async function getPendingSuggestions(): Promise<AiPricingSuggestion[]> {
  return db.query<AiPricingSuggestion>(
    `SELECT * FROM pricing_ai_suggestions WHERE status = 'pending' ORDER BY created_at DESC`,
  );
}

/**
 * Получает все предложения (для истории).
 */
export async function getAllSuggestions(limit = 50): Promise<AiPricingSuggestion[]> {
  return db.query<AiPricingSuggestion>(
    `SELECT * FROM pricing_ai_suggestions ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
}

/**
 * Одобряет предложение ИИ — применяет скидку в service_options.
 */
export async function approveSuggestion(suggestionId: string, reviewedBy: string): Promise<{
  success: boolean;
  suggestion: AiPricingSuggestion;
}> {
  const suggestion = await db.queryOne<AiPricingSuggestion>(
    `SELECT * FROM pricing_ai_suggestions WHERE id = $1 AND status = 'pending'`,
    [suggestionId],
  );
  if (!suggestion) throw new Error('Предложение не найдено или уже обработано');

  const optionRow = await db.queryOne<{
    base_price: string;
    price_online: string | null;
    price_studio: string | null;
    price_next_unit: string | null;
  }>(
    `SELECT base_price::text, price_online::text, price_studio::text, price_next_unit::text
     FROM service_options WHERE slug = $1`,
    [suggestion.option_slug],
  );
  if (!optionRow) throw new Error('Услуга для применения предложения не найдена');

  const currentBase = parseFloat(optionRow.base_price || '0');
  const ratio = currentBase > 0 ? suggestion.suggested_price / currentBase : 1;
  const scaledOnline = optionRow.price_online != null
    ? Math.max(MIN_PRICE, Math.round(parseFloat(optionRow.price_online) * ratio))
    : null;
  const scaledStudio = optionRow.price_studio != null
    ? Math.max(MIN_PRICE, Math.round(parseFloat(optionRow.price_studio) * ratio))
    : null;
  const scaledNextUnit = optionRow.price_next_unit != null
    ? Math.max(MIN_PRICE, Math.round(parseFloat(optionRow.price_next_unit) * ratio))
    : null;

  // Apply prices to service_options consistently across price columns.
  await db.query(
    `UPDATE service_options
     SET base_price = $1,
         price_online = $2,
         price_studio = $3,
         price_next_unit = $4,
         updated_at = NOW()
     WHERE slug = $5`,
    [
      suggestion.suggested_price,
      scaledOnline,
      scaledStudio,
      scaledNextUnit,
      suggestion.option_slug,
    ],
  );

  // Also create a promotion entry for the discount period
  await db.query(
    `INSERT INTO promotions
       (slug, title, promo_code, discount_percent, is_active, starts_at, ends_at, service_slug)
     VALUES ($1, $2, $3, $4, true, NOW(), $5, $6)
     ON CONFLICT (slug) DO UPDATE
       SET discount_percent = EXCLUDED.discount_percent,
           ends_at = EXCLUDED.ends_at,
           is_active = true`,
    [
      `ai-promo-${suggestion.option_slug}-${Date.now()}`,
      `Акция ИИ: ${suggestion.option_name}`,
      `AI-${suggestion.option_slug.toUpperCase().slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`,
      suggestion.discount_percent,
      suggestion.valid_until,
      suggestion.option_slug,
    ],
  );

  const updated = await db.queryOne<AiPricingSuggestion>(
    `UPDATE pricing_ai_suggestions
     SET status = 'approved', reviewed_by = $2, reviewed_at = NOW()
     WHERE id = $1 RETURNING *`,
    [suggestionId, reviewedBy],
  );

  return { success: true, suggestion: updated! };
}

/**
 * Отклоняет предложение ИИ (цену не меняет).
 */
export async function rejectSuggestion(suggestionId: string, reviewedBy: string): Promise<AiPricingSuggestion> {
  const updated = await db.queryOne<AiPricingSuggestion>(
    `UPDATE pricing_ai_suggestions
     SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [suggestionId, reviewedBy],
  );
  if (!updated) throw new Error('Предложение не найдено или уже обработано');
  return updated;
}
