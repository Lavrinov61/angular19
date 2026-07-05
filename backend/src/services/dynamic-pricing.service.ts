/**
 * Dynamic Pricing Service — модификаторы цен, ночные скидки, demand-based корректировки.
 *
 * Архитектура:
 * - Модификаторы хранятся в price_modifiers (DB), кэш 60s
 * - Конфигурация в dynamic_pricing_config (DB), кэш 60s
 * - calculateDynamicPrice() — обёртка над calculatePrice() из pricing-engine
 * - Price Locks: фиксация цены на 24ч за символический платёж
 */

import db from '../database/db.js';

// ============================================================================
// Типы
// ============================================================================

export interface PriceModifier {
  id: string;
  name: string;
  modifier_type: 'time_of_day' | 'seasonal' | 'volume' | 'customer_segment';
  scope: 'global' | 'category' | 'option';
  service_category_id: string | null;
  modifier_action: 'multiply' | 'add' | 'subtract' | 'override';
  modifier_value: number;
  conditions: Record<string, unknown>;
  priority: number;
  is_active: boolean;
}

export interface DynamicPriceContext {
  paymentTime?: Date;
  loyaltyLevel?: number;
  isSubscriber?: boolean;
  categorySlug?: string;
  bundleCount?: number;
  /** Дата слота (для early bird / last-minute) */
  slotDate?: Date;
  /** Процент загрузки дня 0-100 (для demand-based) */
  dayLoadPercent?: number;
}

export interface AppliedModifier {
  id: string;
  name: string;
  modifier_type: string;
  action: string;
  value: number;
  description: string;
}

export interface DynamicPriceResult {
  basePrice: number;
  finalPrice: number;
  totalDiscount: number;
  discountPercent: number;
  appliedModifiers: AppliedModifier[];
  reasons: string[];
  floorPrice: number;
}

// ============================================================================
// Кэш
// ============================================================================

interface ModifiersCache {
  data: PriceModifier[];
  timestamp: number;
}

interface ConfigCache {
  data: Record<string, unknown>;
  timestamp: number;
}

const CACHE_TTL = 60_000; // 60 секунд

let modifiersCache: ModifiersCache | null = null;
const configCache = new Map<string, ConfigCache>();

export function invalidateModifiersCache(): void {
  modifiersCache = null;
  configCache.clear();
}

// ============================================================================
// Загрузка данных
// ============================================================================

async function loadModifiers(): Promise<PriceModifier[]> {
  if (modifiersCache && Date.now() - modifiersCache.timestamp < CACHE_TTL) {
    return modifiersCache.data;
  }

  const rows = await db.query<{
    id: string; name: string; modifier_type: string; scope: string;
    service_category_id: string | null; modifier_action: string;
    modifier_value: string; conditions: Record<string, unknown>; priority: number;
  }>(
    `SELECT id, name, modifier_type, scope, service_category_id, modifier_action,
            modifier_value, conditions, priority
     FROM price_modifiers
     WHERE is_active = true
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())
     ORDER BY priority DESC`
  );

  const data: PriceModifier[] = rows.map(r => ({
    id: r.id,
    name: r.name,
    modifier_type: r.modifier_type as PriceModifier['modifier_type'],
    scope: r.scope as PriceModifier['scope'],
    service_category_id: r.service_category_id,
    modifier_action: r.modifier_action as PriceModifier['modifier_action'],
    modifier_value: parseFloat(r.modifier_value as unknown as string),
    conditions: r.conditions || {},
    priority: r.priority,
    is_active: true,
  }));

  modifiersCache = { data, timestamp: Date.now() };
  return data;
}

async function loadConfig(key: string): Promise<Record<string, unknown>> {
  const cached = configCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const row = await db.queryOne<{ config_value: Record<string, unknown> }>(
    `SELECT config_value FROM dynamic_pricing_config WHERE config_key = $1`,
    [key]
  );

  const data = row?.config_value || {};
  configCache.set(key, { data, timestamp: Date.now() });
  return data;
}

// ============================================================================
// Вычисление ночной скидки по градиенту
// ============================================================================

/**
 * Возвращает процент скидки (0-100) для текущего времени суток.
 * В рабочее время — 0. Вне рабочего времени — по градиенту из конфига.
 */
export async function getTimeDiscount(paymentTime: Date = new Date()): Promise<number> {
  const cfg = await loadConfig('time_gradient');

  const wh = cfg['working_hours'] as { start: string; end: string } | undefined;
  const gradient = cfg['gradient'] as Array<{ hour: number; discount: number }> | undefined;

  if (!wh || !gradient) return 0;

  const hour = paymentTime.getHours();

  // Парсим рабочее время
  const [startH] = (wh.start || '09:00').split(':').map(Number);
  const [endH] = (wh.end || '19:30').split(':').map(Number);

  // Рабочие часы — скидки нет
  if (hour >= startH && hour < endH) return 0;

  // Нерабочее время — ищем подходящий слот в градиенте
  const sorted = [...gradient].sort((a, b) => b.discount - a.discount);

  // Находим максимальную скидку для данного часа
  for (const slot of sorted) {
    if (slot.hour === hour) return slot.discount;
  }

  // Интерполяция: берём ближайший более ранний слот
  let bestDiscount = 0;
  for (const slot of gradient) {
    if (slot.discount > bestDiscount) {
      bestDiscount = slot.discount;
    }
  }

  return bestDiscount;
}

// ============================================================================
// Применение модификаторов
// ============================================================================

/**
 * Применяет все активные модификаторы к базовой цене.
 * Возвращает финальную цену и список применённых модификаторов.
 */
export async function applyModifiers(
  basePrice: number,
  context: DynamicPriceContext = {},
): Promise<DynamicPriceResult> {
  const modifiers = await loadModifiers();
  const cfg = await loadConfig('time_gradient');
  const floorPercent = (cfg['floor_percent'] as number | undefined) || 70;
  const floorPrice = Math.round(basePrice * floorPercent / 100);

  const appliedModifiers: AppliedModifier[] = [];
  const reasons: string[] = [];

  let currentPrice = basePrice;
  let totalDiscountMultiplier = 1.0;

  // Собираем скидки от модификаторов
  for (const mod of modifiers) {
    // Проверяем scope: если category — фильтр по categorySlug
    if (mod.scope === 'category' && mod.service_category_id && context.categorySlug) {
      // Пропустить если не та категория (упрощённо: по ID, для полноты нужен slug lookup)
      // В данной реализации категориальные модификаторы работают глобально
    }

    const cond = mod.conditions;
    let matches = false;

    switch (mod.modifier_type) {
      case 'time_of_day': {
        const condType = cond['type'] as string | undefined;

        if (condType === 'off_hours') {
          // Ночная скидка — применяется когда не рабочее время
          const discountPct = await getTimeDiscount(context.paymentTime);
          if (discountPct > 0) {
            matches = true;
            // Переопределяем modifier_value под актуальный процент
            const dynamicMultiplier = 1 - discountPct / 100;

            // Подписчик без ночной скидки?
            if (context.isSubscriber) {
              // Не применяем ночную скидку для подписчиков
              matches = false;
            } else {
              appliedModifiers.push({
                id: mod.id,
                name: mod.name,
                modifier_type: mod.modifier_type,
                action: 'multiply',
                value: dynamicMultiplier,
                description: `Ночная скидка -${discountPct}% (нерабочее время)`,
              });
              reasons.push(`Скидка ${discountPct}% за заказ в нерабочее время`);
              totalDiscountMultiplier *= dynamicMultiplier;
            }
          }
        } else if (condType === 'early_bird') {
          const minDays = (cond['min_days'] as number | undefined) || 3;
          if (context.slotDate) {
            const now = new Date();
            const diffMs = context.slotDate.getTime() - now.getTime();
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            if (diffDays >= minDays) {
              matches = true;
            }
          }
        } else if (condType === 'last_minute') {
          const maxHours = (cond['max_hours'] as number | undefined) || 2;
          if (context.slotDate) {
            const now = new Date();
            const diffMs = context.slotDate.getTime() - now.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);
            if (diffHours > 0 && diffHours <= maxHours) {
              matches = true;
            }
          }
        }
        break;
      }

      case 'customer_segment': {
        const minLevel = cond['min_loyalty_level'] as number | undefined;
        const isSubscriberCond = cond['is_subscriber'] as boolean | undefined;
        const appliesTo = cond['applies_to'] as string | undefined;

        if (isSubscriberCond && context.isSubscriber) {
          // Подписчик — не применяем ночную скидку (уже обработано выше)
          // Но и другие скидки тоже не применяем если no_time_discount
          matches = false;
        } else if (minLevel && context.loyaltyLevel && context.loyaltyLevel >= minLevel) {
          // VIP множитель — применяется только к уже начисленной скидке
          if (appliesTo === 'discount_only') {
            // Логика: VIP получает дополнительные X% сверх уже полученной скидки
            const alreadyDiscount = 1 - totalDiscountMultiplier;
            if (alreadyDiscount > 0) {
              const vipBonus = alreadyDiscount * (mod.modifier_value - 1);
              const vipMultiplier = 1 - vipBonus;
              appliedModifiers.push({
                id: mod.id,
                name: mod.name,
                modifier_type: mod.modifier_type,
                action: 'multiply',
                value: vipMultiplier,
                description: `VIP-бонус ×${mod.modifier_value} к скидке (уровень лояльности ${context.loyaltyLevel})`,
              });
              reasons.push(`VIP-бонус: скидка увеличена в ${mod.modifier_value}× (уровень ${context.loyaltyLevel})`);
              totalDiscountMultiplier *= vipMultiplier;
            }
          }
          matches = false; // уже обработан
        }
        break;
      }

      case 'seasonal': {
        const condType = cond['type'] as string | undefined;
        if (condType === 'demand_based') {
          const threshold = (cond['threshold'] as number | undefined) || 30;
          if (context.dayLoadPercent !== undefined && context.dayLoadPercent < threshold) {
            matches = true;
          }
        }
        break;
      }

      case 'volume': {
        const minServices = (cond['min_services'] as number | undefined) || 2;
        if (context.bundleCount !== undefined && context.bundleCount >= minServices) {
          matches = true;
        }
        break;
      }
    }

    if (matches && mod.modifier_type !== 'time_of_day') {
      // time_of_day уже обработан выше с динамическим процентом
      let multiplier = 1.0;

      switch (mod.modifier_action) {
        case 'multiply':
          multiplier = mod.modifier_value;
          break;
        case 'add':
          // Прибавляем к цене — конвертируем в множитель
          multiplier = 1 + (mod.modifier_value / currentPrice);
          break;
        case 'subtract':
          multiplier = 1 - (mod.modifier_value / currentPrice);
          break;
        case 'override':
          multiplier = mod.modifier_value;
          totalDiscountMultiplier = mod.modifier_value;
          appliedModifiers.push({
            id: mod.id,
            name: mod.name,
            modifier_type: mod.modifier_type,
            action: mod.modifier_action,
            value: mod.modifier_value,
            description: mod.name,
          });
          reasons.push(mod.name);
          continue;
      }

      totalDiscountMultiplier *= multiplier;
      appliedModifiers.push({
        id: mod.id,
        name: mod.name,
        modifier_type: mod.modifier_type,
        action: mod.modifier_action,
        value: multiplier,
        description: mod.name,
      });
      reasons.push(mod.name);
    }
  }

  // Финальная цена с учётом floor
  const calculatedPrice = Math.round(basePrice * totalDiscountMultiplier);
  const finalPrice = Math.max(calculatedPrice, floorPrice);

  return {
    basePrice,
    finalPrice,
    totalDiscount: basePrice - finalPrice,
    discountPercent: Math.round((1 - finalPrice / basePrice) * 100),
    appliedModifiers,
    reasons,
    floorPrice,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Текущая динамическая цена для live-виджета.
 * Принимает базовую цену и контекст → возвращает финальную.
 */
export async function getCurrentDynamicPrice(
  basePrice: number,
  context: DynamicPriceContext = {},
): Promise<DynamicPriceResult> {
  return applyModifiers(basePrice, context);
}

/**
 * Возвращает минуты до следующего изменения цены (для таймера на фронте).
 */
export async function getMinutesToPriceChange(): Promise<number> {
  const cfg = await loadConfig('time_gradient');
  const wh = cfg['working_hours'] as { start: string; end: string } | undefined;
  const gradient = cfg['gradient'] as Array<{ hour: number; discount: number }> | undefined;

  if (!wh || !gradient) return 60;

  const now = new Date();
  const hour = now.getHours();
  const minutes = now.getMinutes();
  const [startH] = (wh.start || '09:00').split(':').map(Number);
  const [endH] = (wh.end || '19:30').split(':').map(Number);

  // Сейчас рабочее время — до конца рабочего дня
  if (hour >= startH && hour < endH) {
    const endMinutes = endH * 60;
    const nowMinutes = hour * 60 + minutes;
    return endMinutes - nowMinutes;
  }

  // Нерабочее время — до следующего часа (скидка меняется каждый час)
  return 60 - minutes;
}

/**
 * Admin: получить все модификаторы из БД (без кэша).
 */
export async function getAllModifiers(): Promise<PriceModifier[]> {
  const rows = await db.query<{
    id: string; name: string; modifier_type: string; scope: string;
    service_category_id: string | null; modifier_action: string;
    modifier_value: string; conditions: Record<string, unknown>;
    priority: number; is_active: boolean;
    starts_at: string | null; ends_at: string | null;
  }>(
    `SELECT id, name, modifier_type, scope, service_category_id, modifier_action,
            modifier_value, conditions, priority, is_active, starts_at, ends_at
     FROM price_modifiers
     ORDER BY priority DESC, created_at DESC`
  );

  return rows.map(r => ({
    ...r,
    modifier_value: parseFloat(r.modifier_value as unknown as string),
    modifier_type: r.modifier_type as PriceModifier['modifier_type'],
    scope: r.scope as PriceModifier['scope'],
    modifier_action: r.modifier_action as PriceModifier['modifier_action'],
  }));
}

/**
 * Admin: получить конфиг dynamic pricing.
 */
export async function getDynamicConfig(): Promise<Record<string, Record<string, unknown>>> {
  const rows = await db.query<{ config_key: string; config_value: Record<string, unknown> }>(
    `SELECT config_key, config_value FROM dynamic_pricing_config ORDER BY config_key`
  );

  const result: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    result[row.config_key] = row.config_value;
  }
  return result;
}

// ============================================================================
// Price Lock
// ============================================================================

export interface PriceLock {
  id: string;
  visitor_id: string | null;
  user_id: string | null;
  category_slug: string;
  locked_price: number;
  lock_fee: number;
  lock_fee_paid: boolean;
  expires_at: Date;
  used: boolean;
  used_order_id: string | null;
  created_at: Date;
}

/**
 * Создать или получить активный price lock для посетителя/пользователя.
 * Лок фиксирует текущую цену на 24 часа.
 */
export async function createPriceLock(params: {
  visitorId?: string;
  userId?: string;
  categorySlug: string;
  currentPrice: number;
}): Promise<PriceLock> {
  const { visitorId, userId, categorySlug, currentPrice } = params;

  // Проверить существующий активный лок
  const existing = await checkPriceLock({ visitorId, userId, categorySlug });
  if (existing) return existing;

  // Rate limit: 1 лок в день на visitor/user
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (visitorId) { conditions.push(`visitor_id = $${idx++}`); values.push(visitorId); }
  if (userId) { conditions.push(`user_id = $${idx++}`); values.push(userId); }
  conditions.push(`created_at > $${idx++}`);
  values.push(oneDayAgo);

  const countResult = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM price_locks WHERE (${conditions.join(' OR ')}) AND created_at > $${values.length}`,
    values
  );
  // Упрощённо: не ограничиваем строго в MVP

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const row = await db.queryOne<{
    id: string; visitor_id: string | null; user_id: string | null;
    category_slug: string; locked_price: string; lock_fee: string;
    lock_fee_paid: boolean; expires_at: string; used: boolean; used_order_id: string | null;
    created_at: string;
  }>(
    `INSERT INTO price_locks (visitor_id, user_id, category_slug, locked_price, lock_fee, expires_at)
     VALUES ($1, $2, $3, $4, 50, $5)
     RETURNING *`,
    [visitorId || null, userId || null, categorySlug, currentPrice, expiresAt]
  );

  if (!row) throw new Error('Не удалось создать price lock');

  return {
    ...row,
    locked_price: parseFloat(row.locked_price),
    lock_fee: parseFloat(row.lock_fee),
    expires_at: new Date(row.expires_at),
    created_at: new Date(row.created_at),
  };
}

/**
 * Проверить активный price lock для посетителя/пользователя.
 */
export async function checkPriceLock(params: {
  visitorId?: string;
  userId?: string;
  categorySlug: string;
}): Promise<PriceLock | null> {
  const { visitorId, userId, categorySlug } = params;

  const conditions: string[] = ['category_slug = $1', 'used = false', 'expires_at > NOW()'];
  const values: unknown[] = [categorySlug];
  let idx = 2;

  const orConditions: string[] = [];
  if (visitorId) { orConditions.push(`visitor_id = $${idx++}`); values.push(visitorId); }
  if (userId) { orConditions.push(`user_id = $${idx++}`); values.push(userId); }

  if (orConditions.length === 0) return null;

  conditions.push(`(${orConditions.join(' OR ')})`);

  const row = await db.queryOne<{
    id: string; visitor_id: string | null; user_id: string | null;
    category_slug: string; locked_price: string; lock_fee: string;
    lock_fee_paid: boolean; expires_at: string; used: boolean; used_order_id: string | null;
    created_at: string;
  }>(
    `SELECT * FROM price_locks WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 1`,
    values
  );

  if (!row) return null;

  return {
    ...row,
    locked_price: parseFloat(row.locked_price),
    lock_fee: parseFloat(row.lock_fee),
    expires_at: new Date(row.expires_at),
    created_at: new Date(row.created_at),
  };
}

/**
 * Пометить price lock как использованный.
 */
export async function usePriceLock(lockId: string, orderId: string): Promise<void> {
  await db.query(
    `UPDATE price_locks SET used = true, used_order_id = $1 WHERE id = $2`,
    [orderId, lockId]
  );
}
