/**
 * Production AI Service — AI-анализ производственных заказов
 *
 * Использует getAIProvider() (Gemini / Grok) для:
 * - Рекомендаций лучшей типографии по категории
 * - Оптимизации затрат
 * - Прогноза спроса
 * - Алертов качества
 */

import db from '../database/db.js';
import { getAIProvider } from './ai-providers/index.js';

// ============================================================================
// Types
// ============================================================================

export interface HouseRecommendation {
  house_id: string;
  house_name: string;
  category: string;
  reason: string;
  confidence: number;
  avg_price: number;
  avg_lead_days: number;
  quality_score: number;
}

export interface CostOptimization {
  type: 'switch_house' | 'batch_orders' | 'negotiate' | 'seasonal';
  title: string;
  description: string;
  potential_savings: number;
  priority: 'high' | 'medium' | 'low';
}

export interface DemandForecastItem {
  category: string;
  week_label: string;
  predicted_orders: number;
  confidence: number;
}

export interface QualityAlert {
  house_id: string;
  house_name: string;
  alert_type: 'defect_spike' | 'delay_increase' | 'rating_drop';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  metric_value: number;
  threshold: number;
}

export interface ProductionAIInsights {
  recommendations: HouseRecommendation[];
  cost_optimizations: CostOptimization[];
  demand_forecast: DemandForecastItem[];
  quality_alerts: QualityAlert[];
  generated_at: string;
}

/** Wrapper that includes an optional error indicator (instead of silently returning []) */
export interface AIResult<T> {
  data: T;
  error?: string;
}

// ============================================================================
// Helper: safe JSON parse from AI response
// ============================================================================

function parseAIJson<T>(text: string, fallback: T): T {
  try {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    const raw = match ? match[1] : text;
    return JSON.parse(raw.trim()) as T;
  } catch {
    return fallback;
  }
}

// ============================================================================
// Gather context from DB
// ============================================================================

export async function getProductionContext(): Promise<string> {
  const [houses, recentOrders, categoryStats] = await Promise.all([
    db.query(
      `SELECT ph.id, ph.name, ph.status, ph.quality_score, ph.on_time_rate,
              ph.defect_rate, ph.total_orders, ph.total_spent, ph.capabilities
       FROM printing_houses ph WHERE ph.status != 'inactive'
       ORDER BY ph.quality_score DESC
       LIMIT 20`,
    ),
    db.query(
      `SELECT po.status, po.total_cost, po.quality_rating, po.has_defects,
              po.delivery_method, ph.name AS house_name,
              po.deadline_at, po.actual_delivery_at, po.estimated_delivery_at
       FROM production_orders po
       LEFT JOIN printing_houses ph ON ph.id = po.printing_house_id
       WHERE po.created_at >= NOW() - INTERVAL '90 days'
       ORDER BY po.created_at DESC
       LIMIT 50`,
    ),
    db.query(
      `SELECT item->>'category' AS category,
              COUNT(*)::int AS order_count,
              SUM((item->>'total_price')::numeric) AS total_spent,
              AVG((item->>'unit_price')::numeric) AS avg_price
       FROM production_orders po,
            jsonb_array_elements(po.items) AS item
       WHERE po.created_at >= NOW() - INTERVAL '90 days'
         AND po.status NOT IN ('cancelled','draft')
       GROUP BY item->>'category'
       ORDER BY total_spent DESC`,
    ),
  ]);

  return `
Типографии:
${JSON.stringify(houses)}

Последние 50 заказов (90 дней):
${JSON.stringify(recentOrders)}

Статистика по категориям продукции:
${JSON.stringify(categoryStats)}
`.trim();
}

// ============================================================================
// Redis cache (10 minutes, shared across nodes)
// ============================================================================

import { cacheGet, cacheSet } from './redis-cache.service.js';
import { SERVICE_BREAKERS, getBreaker } from '../utils/circuit-breaker.js';

import { createLogger } from '../utils/logger.js';
const PROD_AI_PREFIX = 'prod-ai:';
const PROD_AI_TTL_SEC = 600; // 10 minutes
const PROD_AI_STALE_TTL_SEC = 86400; // 24h stale-while-breaker-open
const LATEST_SUFFIX = ':latest_success';

const logger = createLogger('production-ai.service');
async function getCached<T>(key: string): Promise<T | null> {
  return cacheGet<T>(`${PROD_AI_PREFIX}${key}`);
}

async function setCached<T>(key: string, data: T): Promise<T> {
  await cacheSet(`${PROD_AI_PREFIX}${key}`, data, PROD_AI_TTL_SEC);
  return data;
}

async function getStaleCache<T>(key: string): Promise<T | null> {
  return cacheGet<T>(`${PROD_AI_PREFIX}${key}`);
}

async function setStaleCache<T>(key: string, data: T): Promise<void> {
  await cacheSet(`${PROD_AI_PREFIX}${key}`, data, PROD_AI_STALE_TTL_SEC);
}

// ============================================================================
// A1: House Recommendations
// ============================================================================

export async function getHouseRecommendations(context: string): Promise<AIResult<HouseRecommendation[]>> {
  const CACHE_KEY = 'production_ai_recommendations';
  const LATEST_KEY = `${CACHE_KEY}${LATEST_SUFFIX}`;

  // 1. Hot cache — only if no error
  const cached = await getCached<AIResult<HouseRecommendation[]>>(CACHE_KEY);
  if (cached && !cached.error) return cached;

  // 2. Breaker gate — if OPEN, serve stale immediately
  const breaker = getBreaker(SERVICE_BREAKERS.gemini.name);
  if (breaker.getState() === 'OPEN') {
    const stale = await getStaleCache<HouseRecommendation[]>(LATEST_KEY);
    if (stale) return { data: stale, error: 'AI временно недоступен (breaker open), показан stale-результат' };
    return { data: [], error: 'AI временно недоступен (breaker open)' };
  }

  const ai = getAIProvider();

  const systemPrompt = `Ты аналитик производственных заказов фотостудии.
Твоя задача — по данным о типографиях и заказах определить лучшую типографию для каждой категории продукции.
Верни ТОЛЬКО JSON-массив объектов с полями:
house_id (string), house_name (string), category (string), reason (string, 1-2 предложения на русском),
confidence (число 0-1), avg_price (число), avg_lead_days (число), quality_score (число 0-5).
Не добавляй объяснений вне JSON.`;

  const userMessage = `На основе этих данных выбери лучшую типографию для каждой категории:
${context}`;

  try {
    const response = await ai.chat(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
      { temperature: 0.2, maxTokens: 800 },
    );
    const data = parseAIJson<HouseRecommendation[]>(response, []);
    const result: AIResult<HouseRecommendation[]> = { data };
    await setCached(CACHE_KEY, result);       // hot cache 10 min
    await setStaleCache(LATEST_KEY, data);    // stale 24h for breaker-open fallback
    return result;
  } catch (err) {
    logger.error('[production-ai] getHouseRecommendations error:', { error: String(err) });
    // DO NOT cache errors — try stale cache
    const stale = await getStaleCache<HouseRecommendation[]>(LATEST_KEY);
    if (stale) return { data: stale, error: `AI ошибка, показан stale: ${String(err)}` };
    return { data: [], error: 'AI временно недоступен' };
  }
}

// ============================================================================
// A2: Cost Optimizations
// ============================================================================

export async function getCostOptimizations(context: string): Promise<AIResult<CostOptimization[]>> {
  const CACHE_KEY = 'production_ai_cost_optimizations';
  const LATEST_KEY = `${CACHE_KEY}${LATEST_SUFFIX}`;

  const cached = await getCached<AIResult<CostOptimization[]>>(CACHE_KEY);
  if (cached && !cached.error) return cached;

  const breaker = getBreaker(SERVICE_BREAKERS.gemini.name);
  if (breaker.getState() === 'OPEN') {
    const stale = await getStaleCache<CostOptimization[]>(LATEST_KEY);
    if (stale) return { data: stale, error: 'AI временно недоступен (breaker open), показан stale-результат' };
    return { data: [], error: 'AI временно недоступен (breaker open)' };
  }

  const ai = getAIProvider();

  const systemPrompt = `Ты финансовый аналитик фотостудии.
Проанализируй расходы на производство и предложи конкретные способы снизить затраты.
Верни ТОЛЬКО JSON-массив объектов с полями:
type ('switch_house'|'batch_orders'|'negotiate'|'seasonal'),
title (строка на русском), description (строка на русском, 2-3 предложения),
potential_savings (число в рублях), priority ('high'|'medium'|'low').
Не более 4 рекомендаций. Без лишнего текста.`;

  const userMessage = `Данные о заказах и расходах за 90 дней:
${context}`;

  try {
    const response = await ai.chat(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
      { temperature: 0.3, maxTokens: 600 },
    );
    const data = parseAIJson<CostOptimization[]>(response, []);
    const result: AIResult<CostOptimization[]> = { data };
    await setCached(CACHE_KEY, result);
    await setStaleCache(LATEST_KEY, data);
    return result;
  } catch (err) {
    logger.error('[production-ai] getCostOptimizations error:', { error: String(err) });
    const stale = await getStaleCache<CostOptimization[]>(LATEST_KEY);
    if (stale) return { data: stale, error: `AI ошибка, показан stale: ${String(err)}` };
    return { data: [], error: 'AI временно недоступен' };
  }
}

// ============================================================================
// A3: Demand Forecast
// ============================================================================

export async function getDemandForecast(): Promise<AIResult<DemandForecastItem[]>> {
  const CACHE_KEY = 'production_ai_demand_forecast';
  const LATEST_KEY = `${CACHE_KEY}${LATEST_SUFFIX}`;

  const cached = await getCached<AIResult<DemandForecastItem[]>>(CACHE_KEY);
  if (cached && !cached.error) return cached;

  // Данные за последние 12 недель для прогноза
  const historyResult = await db.query(
    `SELECT DATE_TRUNC('week', po.created_at) AS week_start,
            item->>'category' AS category,
            COUNT(*)::int AS order_count
     FROM production_orders po,
          jsonb_array_elements(po.items) AS item
     WHERE po.created_at >= NOW() - INTERVAL '12 weeks'
       AND po.status NOT IN ('cancelled','draft')
     GROUP BY week_start, item->>'category'
     ORDER BY week_start, category`,
  );

  if (historyResult.length === 0) {
    return await setCached(CACHE_KEY, { data: [] });
  }

  const breaker = getBreaker(SERVICE_BREAKERS.gemini.name);
  if (breaker.getState() === 'OPEN') {
    const stale = await getStaleCache<DemandForecastItem[]>(LATEST_KEY);
    if (stale) return { data: stale, error: 'AI временно недоступен (breaker open), показан stale-результат' };
    return { data: [], error: 'AI временно недоступен (breaker open)' };
  }

  const ai = getAIProvider();

  const systemPrompt = `Ты аналитик производственных заказов.
Спрогнозируй количество заказов по каждой категории на следующие 2 недели.
Верни ТОЛЬКО JSON-массив объектов с полями:
category (string), week_label ('Следующая неделя' или '2 недели'), predicted_orders (integer), confidence (0-1).
Без лишнего текста.`;

  const userMessage = `История заказов по неделям:
${JSON.stringify(historyResult)}`;

  try {
    const response = await ai.chat(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
      { temperature: 0.2, maxTokens: 400 },
    );
    const data = parseAIJson<DemandForecastItem[]>(response, []);
    const result: AIResult<DemandForecastItem[]> = { data };
    await setCached(CACHE_KEY, result);
    await setStaleCache(LATEST_KEY, data);
    return result;
  } catch (err) {
    logger.error('[production-ai] getDemandForecast error:', { error: String(err) });
    const stale = await getStaleCache<DemandForecastItem[]>(LATEST_KEY);
    if (stale) return { data: stale, error: `AI ошибка, показан stale: ${String(err)}` };
    return { data: [], error: 'AI временно недоступен' };
  }
}

// ============================================================================
// A4: Quality Alerts (pure rule-based — no AI cost)
// ============================================================================

export async function getQualityAlerts(): Promise<QualityAlert[]> {
  // Анализируем последние 30 дней vs предыдущие 30
  const metricsResult = await db.query(
    `SELECT ph.id AS house_id, ph.name AS house_name,
            AVG(CASE WHEN po.created_at >= NOW() - INTERVAL '30 days' THEN po.quality_rating END) AS avg_rating_recent,
            AVG(CASE WHEN po.created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days' THEN po.quality_rating END) AS avg_rating_prev,
            COUNT(CASE WHEN po.created_at >= NOW() - INTERVAL '30 days' AND po.has_defects THEN 1 END)::numeric /
              NULLIF(COUNT(CASE WHEN po.created_at >= NOW() - INTERVAL '30 days' AND po.quality_rating IS NOT NULL THEN 1 END)::numeric, 0) * 100 AS defect_rate_recent,
            COUNT(CASE WHEN po.created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days' AND po.has_defects THEN 1 END)::numeric /
              NULLIF(COUNT(CASE WHEN po.created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days' AND po.quality_rating IS NOT NULL THEN 1 END)::numeric, 0) * 100 AS defect_rate_prev,
            AVG(CASE WHEN po.created_at >= NOW() - INTERVAL '30 days' AND po.actual_delivery_at IS NOT NULL AND po.estimated_delivery_at IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (po.actual_delivery_at - po.estimated_delivery_at)) / 86400 END) AS avg_delay_recent
     FROM printing_houses ph
     LEFT JOIN production_orders po ON po.printing_house_id = ph.id
       AND po.status NOT IN ('draft','cancelled')
     WHERE ph.status = 'active'
     GROUP BY ph.id, ph.name`,
  );

  const alerts: QualityAlert[] = [];

  for (const row of metricsResult) {
    const defectRecent = Number(row.defect_rate_recent) || 0;
    const defectPrev = Number(row.defect_rate_prev) || 0;
    const ratingRecent = Number(row.avg_rating_recent) || 0;
    const ratingPrev = Number(row.avg_rating_prev) || 0;
    const avgDelay = Number(row.avg_delay_recent) || 0;

    // Брак вырос на > 10%
    if (defectRecent > 10 && defectRecent > defectPrev + 5) {
      alerts.push({
        house_id: row.house_id,
        house_name: row.house_name,
        alert_type: 'defect_spike',
        severity: defectRecent > 20 ? 'critical' : 'warning',
        message: `Уровень брака вырос с ${defectPrev.toFixed(1)}% до ${defectRecent.toFixed(1)}% за последние 30 дней`,
        metric_value: defectRecent,
        threshold: 10,
      });
    }

    // Средний рейтинг упал ниже 3.5
    if (ratingRecent > 0 && ratingRecent < 3.5 && ratingPrev >= 3.5) {
      alerts.push({
        house_id: row.house_id,
        house_name: row.house_name,
        alert_type: 'rating_drop',
        severity: ratingRecent < 3.0 ? 'critical' : 'warning',
        message: `Рейтинг качества снизился с ${ratingPrev.toFixed(1)} до ${ratingRecent.toFixed(1)}`,
        metric_value: ratingRecent,
        threshold: 3.5,
      });
    }

    // Среднее опоздание > 2 дней
    if (avgDelay > 2) {
      alerts.push({
        house_id: row.house_id,
        house_name: row.house_name,
        alert_type: 'delay_increase',
        severity: avgDelay > 5 ? 'critical' : 'warning',
        message: `Среднее опоздание доставки составляет ${avgDelay.toFixed(1)} дн. за последние 30 дней`,
        metric_value: avgDelay,
        threshold: 2,
      });
    }
  }

  return alerts;
}

// ============================================================================
// Combined: All insights at once
// ============================================================================

export async function getAllProductionInsights(): Promise<AIResult<ProductionAIInsights>> {
  const CACHE_KEY = 'production_ai_insights';
  const cached = await getCached<AIResult<ProductionAIInsights>>(CACHE_KEY);
  if (cached && !cached.error) return cached;

  // Fetch context once — shared across all 3 AI calls
  const context = await getProductionContext();

  const [recResult, costResult, forecastResult, quality_alerts] = await Promise.all([
    getHouseRecommendations(context),
    getCostOptimizations(context),
    getDemandForecast(),
    getQualityAlerts(),
  ]);

  const hasError = recResult.error ?? costResult.error ?? forecastResult.error;
  const result: AIResult<ProductionAIInsights> = {
    data: {
      recommendations: recResult.data,
      cost_optimizations: costResult.data,
      demand_forecast: forecastResult.data,
      quality_alerts,
      generated_at: new Date().toISOString(),
    },
    error: hasError,
  };

  // Only cache combined result if no error; errors already handled per-function
  if (!hasError) {
    return await setCached(CACHE_KEY, result);
  }
  return result;
}
