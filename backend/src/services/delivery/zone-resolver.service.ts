/**
 * Резолвер зоны доставки по дистанции (Яндекс.Доставка, Cargo v2).
 *
 * Бизнес-модель — 4 зоны фиксированной цены (300/400/450/550 ₽), пороги и цены
 * хранятся в таблице `delivery_zones` (бизнес калибрует UPDATE-ом без деплоя).
 * Зона определяется по `distance_meters` из ответа Яндекс `check-price`:
 * берём минимальную зону, чья верхняя граница (`max_distance_m`) покрывает дистанцию.
 *
 * Реальную цену Яндекса клиенту НЕ показываем — отдаём зональную ступень (`priceRub`).
 */

import db from '../../database/db.js';
import { cacheGetOrFetch } from '../redis-cache.service.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('zone-resolver.service');

/** TTL кэша зон в Redis (зоны меняются редко — раз в месяц). */
const ZONE_CACHE_TTL_SEC = 300;
/** Фоновое обновление кэша, когда до истечения остаётся < 30с. */
const ZONE_CACHE_EARLY_REFRESH_SEC = 30;

/** Строка таблицы `delivery_zones` (как приходит из БД — numeric → string). */
interface DeliveryZoneRow {
  id: number;
  name: string;
  max_distance_m: number;
  price_rub: string;
  min_order_rub: string;
  taxi_class: string;
  is_active: boolean;
}

/** Результат резолва зоны для вызывающего кода (числа — уже распарсены). */
export interface ResolvedZone {
  zoneId: number;
  name: string;
  priceRub: number;
  minOrderRub: number;
  taxiClass: string;
  maxDistanceM: number;
}

/**
 * Резолв зоны по дистанции в метрах.
 *
 * SELECT минимальной активной зоны, чья верхняя граница покрывает дистанцию:
 *   WHERE is_active AND max_distance_m >= $1 ORDER BY max_distance_m ASC LIMIT 1
 *
 * @param distanceMeters Дистанция из ответа Яндекс `check-price` (метры).
 * @returns Зона с зональной ценой / мин. заказом, либо null если ни одна не покрывает
 *          (теоретически невозможно — зона 4 имеет max_distance_m ~2e9, но guard на всякий случай).
 */
export async function resolveZone(distanceMeters: number): Promise<ResolvedZone | null> {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    logger.warn('[resolveZone] invalid distance', { distanceMeters });
    return null;
  }

  const distance = Math.ceil(distanceMeters);

  // Redis-кэш всех активных зон (один SELECT всей сетки), резолв — в памяти.
  // Если Redis недоступен — cacheGetOrFetch прозрачно ходит в БД.
  const zones = await cacheGetOrFetch<DeliveryZoneRow[]>(
    'delivery:zones:active',
    ZONE_CACHE_TTL_SEC,
    ZONE_CACHE_EARLY_REFRESH_SEC,
    async () =>
      db.query<DeliveryZoneRow>(
        `SELECT id, name, max_distance_m, price_rub, min_order_rub, taxi_class, is_active
         FROM delivery_zones
         WHERE is_active = true
         ORDER BY max_distance_m ASC`,
      ),
  );

  // Первая (минимальная по max_distance_m) зона, покрывающая дистанцию.
  const match = zones.find((z) => z.max_distance_m >= distance);
  if (!match) {
    logger.warn('[resolveZone] no zone covers distance', { distance });
    return null;
  }

  return {
    zoneId: match.id,
    name: match.name,
    priceRub: parseFloat(match.price_rub),
    minOrderRub: parseFloat(match.min_order_rub),
    taxiClass: match.taxi_class,
    maxDistanceM: match.max_distance_m,
  };
}
