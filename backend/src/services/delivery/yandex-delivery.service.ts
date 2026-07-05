/**
 * Адаптер внешнего API Яндекс.Доставки (Cargo B2B v2).
 *
 * Изоляция платного внешнего API: все сетевые вызовы — под circuit breaker
 * `SERVICE_BREAKERS.yandexDelivery`. Фича по умолчанию выключена
 * (`config.yandexDelivery.enabled === false`) — пока нет реального договора/токена.
 *
 * Эндпоинты Cargo v2:
 *   POST {baseUrl}/b2b/cargo/integration/v2/check-price  — оценка цены/дистанции
 *   POST {baseUrl}/b2b/cargo/integration/v2/claims/create — создание заявки (claim)
 *   POST {baseUrl}/b2b/cargo/integration/v2/claims/cancel  — отмена заявки
 *
 * Авторизация — `Authorization: Bearer {token}`.
 *
 * ВЕС посылки — через существующий `weight-calculator.service.ts` (260 г/м² + 55г),
 * НЕ вводим собственных констант (решение архитектуры — корректирует ошибочные 80 г/м²).
 *
 * Координаты везде нормализуем как `[parseFloat(lon), parseFloat(lat)]` — DaData
 * отдаёт координаты строками.
 */

import crypto from 'node:crypto';

import { config } from '../../config/index.js';
import db from '../../database/db.js';
import { withServiceCall, SERVICE_BREAKERS } from '../../utils/circuit-breaker.js';
import { calculateOrderWeight } from '../weight-calculator.service.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('yandex-delivery.service');

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

/** Координаты в порядке Яндекса: [долгота, широта]. */
export type LonLat = [number, number];

export interface CheckPriceParams {
  /** Координаты студии-отправителя [lon, lat]. */
  source: LonLat;
  /** Координаты точки доставки [lon, lat]. */
  dest: LonLat;
  /** Вес посылки в граммах. */
  weightGrams: number;
  /** Тариф ('courier' | 'express' | 'cargo'). По умолчанию из config. */
  taxiClass?: string;
}

export interface CheckPriceResult {
  /** Реальная цена Яндекса (себестоимость/калибровка — клиенту НЕ показываем). */
  priceRub: number;
  /** Дистанция маршрута в метрах (для резолва зоны). */
  distanceMeters: number;
  /** Оценка времени доставки, минуты (может отсутствовать). */
  etaMinutes: number | null;
}

/** Нормализованный статус доставки (домен `delivery_shipments.status`). */
export type NormalizedDeliveryStatus =
  | 'pending'
  | 'created'
  | 'courier_assigned'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'cancelled'
  | 'failed';

/** Спец-маркер для неизвестного raw-статуса (P2-4: не теряем молча — оператору). */
export const UNKNOWN_STATUS = '__unknown__' as const;

/** Результат маппинга raw-статуса: либо нормализованный, либо маркер «нужно внимание». */
export type MapStatusResult = NormalizedDeliveryStatus | typeof UNKNOWN_STATUS;

export interface ParsedWebhook {
  claimId: string;
  rawStatus: string;
  /** Временная метка события из payload (per-event дискриминатор идемпотентности — P2-4). */
  eventTs: string | null;
  /** Сырое тело (для логирования/последующего разбора). */
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Маппинг статусов (P2-4) — конфиг-словарь, не разбросанный switch
// ---------------------------------------------------------------------------

/**
 * Сопоставление raw-статусов Cargo v2 → нормализованный домен.
 *
 * Перечень raw-статусов Cargo v2 (по публичной документации Яндекса). Финальный
 * список калибруется по живому контракту — неизвестные значения НЕ теряем молча,
 * а возвращаем `UNKNOWN_STATUS` (вызывающий код помечает shipment `needs_attention`).
 */
const RAW_STATUS_MAP: Record<string, NormalizedDeliveryStatus> = {
  // приёмка/создание
  new: 'created',
  estimating: 'created',
  estimating_failed: 'failed',
  ready_for_approval: 'created',
  accepted: 'created',
  performer_lookup: 'created',
  performer_draft: 'created',
  // назначен курьер
  performer_found: 'courier_assigned',
  // курьер едет за посылкой / забрал
  pickup_arrived: 'courier_assigned',
  ready_for_pickup_confirmation: 'courier_assigned',
  pickuped: 'picked_up',
  // в пути к получателю
  delivery_arrived: 'in_transit',
  ready_for_delivery_confirmation: 'in_transit',
  // доставлено
  delivered: 'delivered',
  delivered_finish: 'delivered',
  // отмены / возвраты / провалы
  returning: 'failed',
  return_arrived: 'failed',
  ready_for_return_confirmation: 'failed',
  returned: 'failed',
  returned_finish: 'failed',
  failed: 'failed',
  cancelled: 'cancelled',
  cancelled_with_payment: 'cancelled',
  cancelled_by_taxi: 'cancelled',
  cancelled_with_items_on_hands: 'cancelled',
  performer_not_found: 'failed',
};

/**
 * Маппинг raw-статуса Яндекса → нормализованный.
 * Неизвестный raw → `UNKNOWN_STATUS` (P2-4: не двигаем статус, помечаем needs_attention).
 */
export function mapStatus(rawStatus: string): MapStatusResult {
  if (!rawStatus) return UNKNOWN_STATUS;
  const normalized = RAW_STATUS_MAP[rawStatus.toLowerCase().trim()];
  if (!normalized) {
    logger.warn('[mapStatus] неизвестный raw-статус Яндекса', { rawStatus });
    return UNKNOWN_STATUS;
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Нормализация координат (DaData отдаёт строки)
// ---------------------------------------------------------------------------

/**
 * Нормализовать координаты в порядок Яндекса [lon, lat] из строк/чисел.
 * @throws Error если координаты не парсятся в конечные числа.
 */
export function normalizeLonLat(lon: string | number, lat: string | number): LonLat {
  const lonNum = typeof lon === 'string' ? parseFloat(lon) : lon;
  const latNum = typeof lat === 'string' ? parseFloat(lat) : lat;
  if (!Number.isFinite(lonNum) || !Number.isFinite(latNum)) {
    throw new Error(`normalizeLonLat: невалидные координаты (lon=${lon}, lat=${lat})`);
  }
  return [lonNum, latNum];
}

// ---------------------------------------------------------------------------
// check-price
// ---------------------------------------------------------------------------

interface YandexCheckPriceResponse {
  price?: string | number;
  distance_meters?: number;
  eta?: number;
  requirements?: { taxi_classes?: string[] };
}

/**
 * Оценка цены и дистанции доставки через Cargo v2 `check-price`.
 * Под circuit breaker. Реальную цену используем для зоны (distance) и калибровки —
 * клиенту отдаём зональную ступень, не эту цену.
 */
export async function checkPrice(params: CheckPriceParams): Promise<CheckPriceResult> {
  const { token, baseUrl, taxiClass: defaultClass } = config.yandexDelivery;
  const taxiClass = params.taxiClass || defaultClass || 'courier';

  const body = {
    route_points: [
      { coordinates: params.source }, // [lon, lat]
      { coordinates: params.dest },
    ],
    requirements: {
      taxi_class: taxiClass,
    },
    items: [
      {
        quantity: 1,
        size: { length: 0.3, width: 0.25, height: 0.05 },
        weight: params.weightGrams / 1000, // Cargo ожидает килограммы
      },
    ],
  };

  return withServiceCall(SERVICE_BREAKERS.yandexDelivery, async () => {
    const response = await fetch(`${baseUrl}/b2b/cargo/integration/v2/check-price`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Accept-Language': 'ru',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SERVICE_BREAKERS.yandexDelivery.timeoutMs ?? 30_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Yandex check-price HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const data = (await response.json()) as YandexCheckPriceResponse;
    const priceRub =
      typeof data.price === 'string' ? parseFloat(data.price) : Number(data.price ?? 0);

    return {
      priceRub: Number.isFinite(priceRub) ? priceRub : 0,
      distanceMeters: Number(data.distance_meters ?? 0),
      etaMinutes:
        typeof data.eta === 'number' && Number.isFinite(data.eta) ? Math.round(data.eta / 60) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// create claim (идемпотентно по order_id — R5)
// ---------------------------------------------------------------------------

interface ShipmentRow {
  order_id: string;
  claim_id: string | null;
  source_studio_id: string | null;
  dropoff_address: string | null;
  dropoff_lon: string | null;
  dropoff_lat: string | null;
  weight_grams: number | null;
  price_rub: string;
}

interface StudioCoordRow {
  lon: number;
  lat: number;
}

interface YandexCreateClaimResponse {
  id?: string;
  /** Cargo возвращает версию/статус; трекинг-ссылка приходит отдельным полем или в claim. */
  status?: string;
  pricing?: { final_price?: string | number };
  route_points?: Array<{ id?: number }>;
}

export interface CreateClaimResult {
  /** true — claim создан в этом вызове; false — уже существовал (идемпотентный no-op). */
  created: boolean;
  claimId: string | null;
}

/**
 * Создать claim в Яндексе для оплаченного заказа.
 *
 * Идемпотентность (R5): сначала SELECT существующего `claim_id` по `order_id`.
 * Если не NULL — возвращаем без вызова Яндекса (повторный post-payment job не создаёт 2-й claim).
 * Иначе — POST create-claim под CB, затем UPDATE строки shipment.
 *
 * @param orderId Идентификатор заказа (`photo_print_orders.order_id` / `delivery_shipments.order_id`).
 */
export async function createYandexClaim(orderId: string): Promise<CreateClaimResult> {
  const { token, baseUrl } = config.yandexDelivery;

  const shipment = await db.queryOne<ShipmentRow>(
    `SELECT order_id, claim_id, source_studio_id, dropoff_address,
            dropoff_lon, dropoff_lat, weight_grams, price_rub
     FROM delivery_shipments
     WHERE order_id = $1
       AND status NOT IN ('cancelled','failed','delivered')
     ORDER BY created_at DESC
     LIMIT 1`,
    [orderId],
  );

  if (!shipment) {
    throw new Error(`createYandexClaim: не найдена активная отправка для заказа ${orderId}`);
  }

  // Идемпотентность: claim уже создан — no-op.
  if (shipment.claim_id) {
    logger.info('[createYandexClaim] claim уже существует — idempotent no-op', {
      orderId,
      claimId: shipment.claim_id,
    });
    return { created: false, claimId: shipment.claim_id };
  }

  if (!shipment.source_studio_id || !shipment.dropoff_lon || !shipment.dropoff_lat) {
    throw new Error(`createYandexClaim: неполные данные отправки для заказа ${orderId}`);
  }

  // Координаты студии-отправителя из БД (jsonb).
  const studio = await db.queryOne<StudioCoordRow>(
    `SELECT (coordinates->>'lng')::double precision AS lon,
            (coordinates->>'lat')::double precision AS lat
     FROM studios
     WHERE id = $1 AND coordinates ? 'lat' AND coordinates ? 'lng'`,
    [shipment.source_studio_id],
  );

  if (!studio || !Number.isFinite(studio.lon) || !Number.isFinite(studio.lat)) {
    throw new Error(`createYandexClaim: у студии ${shipment.source_studio_id} нет валидных координат`);
  }

  const source = normalizeLonLat(studio.lon, studio.lat);
  const dest = normalizeLonLat(shipment.dropoff_lon, shipment.dropoff_lat);
  const weightGrams = shipment.weight_grams ?? 0;

  const claimBody = {
    items: [
      {
        title: 'Фотопечать',
        quantity: 1,
        cost_value: shipment.price_rub,
        cost_currency: 'RUB',
        weight: weightGrams / 1000,
        size: { length: 0.3, width: 0.25, height: 0.05 },
        pickup_point: 1,
        droppof_point: 2,
      },
    ],
    route_points: [
      {
        point_id: 1,
        visit_order: 1,
        type: 'source',
        address: { coordinates: source, fullname: 'Студия «Своё Фото»' },
      },
      {
        point_id: 2,
        visit_order: 2,
        type: 'destination',
        address: { coordinates: dest, fullname: shipment.dropoff_address ?? 'Адрес доставки' },
      },
    ],
  };

  const claim = await withServiceCall(SERVICE_BREAKERS.yandexDelivery, async () => {
    const requestId = `claim-${orderId}`; // request_id обязателен и идемпотентен у Cargo
    const response = await fetch(
      `${baseUrl}/b2b/cargo/integration/v2/claims/create?request_id=${encodeURIComponent(requestId)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Accept-Language': 'ru',
        },
        body: JSON.stringify(claimBody),
        signal: AbortSignal.timeout(SERVICE_BREAKERS.yandexDelivery.timeoutMs ?? 30_000),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Yandex create-claim HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    return (await response.json()) as YandexCreateClaimResponse;
  });

  const claimId = claim.id ?? null;
  const realPrice =
    typeof claim.pricing?.final_price === 'string'
      ? parseFloat(claim.pricing.final_price)
      : typeof claim.pricing?.final_price === 'number'
        ? claim.pricing.final_price
        : null;
  const trackingUrl = claimId
    ? `https://dostavka.yandex.ru/track/${encodeURIComponent(claimId)}`
    : null;

  // UPDATE строки shipment под уникальным claim_id (uq_shipment_claim_id защищает от дублей).
  await db.query(
    `UPDATE delivery_shipments
     SET claim_id = $1,
         status = 'created',
         tracking_url = $2,
         real_price_rub = $3,
         updated_at = now()
     WHERE order_id = $4
       AND claim_id IS NULL
       AND status NOT IN ('cancelled','failed','delivered')`,
    [claimId, trackingUrl, realPrice, orderId],
  );

  logger.info('[createYandexClaim] claim создан', { orderId, claimId });
  return { created: true, claimId };
}

// ---------------------------------------------------------------------------
// cancel claim
// ---------------------------------------------------------------------------

/**
 * Отменить claim в Яндексе. Под circuit breaker.
 * @param claimId Идентификатор claim (Cargo).
 * @param reason Опциональная причина отмены (для лога/аудита).
 */
export async function cancelClaim(claimId: string, reason?: string): Promise<void> {
  const { token, baseUrl } = config.yandexDelivery;

  await withServiceCall(SERVICE_BREAKERS.yandexDelivery, async () => {
    const response = await fetch(
      `${baseUrl}/b2b/cargo/integration/v2/claims/cancel?claim_id=${encodeURIComponent(claimId)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Accept-Language': 'ru',
        },
        // version обязателен у Cargo cancel; cancel_state 'free' (до назначения) — финализируется по контракту.
        body: JSON.stringify({ cancel_state: 'free', version: 1 }),
        signal: AbortSignal.timeout(SERVICE_BREAKERS.yandexDelivery.timeoutMs ?? 30_000),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Yandex cancel-claim HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
  });

  logger.info('[cancelClaim] claim отменён', { claimId, reason: reason ?? null });
}

// ---------------------------------------------------------------------------
// Верификация вебхука (P1-2: абстрактная verify-стратегия, формат GATED)
// ---------------------------------------------------------------------------

/**
 * Стратегия верификации подписи вебхука.
 * @param rawBody Сырое тело запроса (Buffer/строка — до JSON.parse).
 * @param headers Заголовки запроса (нормализованные в lower-case ключи у Express).
 * @param secret Секрет вебхука (`config.yandexDelivery.webhookSecret`).
 * @returns true — подпись валидна.
 */
export type WebhookVerifyStrategy = (
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
) => boolean;

/**
 * Дефолтная verify-стратегия — ЗАГЛУШКА.
 *
 * ⚠️ Формат подписи Яндекс Cargo v2 НЕ финализирован (нет живого интеграционного
 * контракта/договора). Здесь — HMAC-SHA256 от rawBody с webhookSecret +
 * timingSafeEqual, как заглушка эталона (см. `requireCloudPaymentsSignature`).
 * При получении живого контракта Cargo v2 заменить:
 *   - имя заголовка подписи (сейчас пробуем 'x-yandex-signature' / 'x-delivery-signature');
 *   - кодировку (hex/base64);
 *   - что именно подписывается (rawBody / rawBody+timestamp).
 * Фича за флагом `DELIVERY_YANDEX_ENABLED` (off) — вебхук неактивен до финализации.
 */
export const defaultWebhookVerify: WebhookVerifyStrategy = (rawBody, headers, secret) => {
  if (!secret) return false;

  const provided =
    pickHeader(headers, 'x-yandex-signature') ??
    pickHeader(headers, 'x-delivery-signature') ??
    pickHeader(headers, 'x-signature');
  if (!provided) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  // timingSafeEqual требует равной длины буферов — иначе сразу false.
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Активная verify-стратегия (заменяема — для тестов и финализации контракта). */
let activeVerifyStrategy: WebhookVerifyStrategy = defaultWebhookVerify;

/** Переопределить verify-стратегию (например, после получения контракта Cargo v2). */
export function setWebhookVerifyStrategy(strategy: WebhookVerifyStrategy): void {
  activeVerifyStrategy = strategy;
}

/**
 * Проверить подпись и распарсить тело вебхука Яндекса.
 *
 * @param rawBody Сырое тело запроса (строка — ДО JSON.parse, для корректного HMAC).
 * @param headers Заголовки запроса.
 * @returns Распарсенные поля события.
 * @throws Error если подпись невалидна (вызывающий роут отвечает 401).
 */
export function verifyAndParseWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
): ParsedWebhook {
  const { webhookSecret } = config.yandexDelivery;

  if (!activeVerifyStrategy(rawBody, headers, webhookSecret)) {
    throw new Error('Yandex webhook: невалидная подпись');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new Error('Yandex webhook: тело не является валидным JSON');
  }

  const claimId =
    (parsed['claim_id'] as string | undefined) ??
    (parsed['id'] as string | undefined) ??
    '';
  const rawStatus = (parsed['status'] as string | undefined) ?? '';
  const eventTs =
    (parsed['updated_ts'] as string | undefined) ??
    (parsed['event_time'] as string | undefined) ??
    (parsed['timestamp'] as string | undefined) ??
    null;

  if (!claimId || !rawStatus) {
    throw new Error('Yandex webhook: отсутствует claim_id или status в теле');
  }

  return { claimId, rawStatus, eventTs, raw: parsed };
}

// ---------------------------------------------------------------------------
// Вспомогательное: вес посылки через существующий калькулятор
// ---------------------------------------------------------------------------

/**
 * Рассчитать вес посылки для заказа (грамм) через `weight-calculator.service.ts`.
 * Реэкспорт-обёртка, чтобы вызывающий код доставки не импортировал калькулятор напрямую
 * и использовал единый источник веса.
 */
export function calculateParcelWeight(
  items: Array<{ format: string; quantity: number }>,
): number {
  return calculateOrderWeight(items);
}
