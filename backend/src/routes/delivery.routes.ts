/**
 * Роуты курьерской доставки печати (Яндекс.Доставка, Cargo v2).
 *
 * Три эндпоинта:
 *   POST /api/delivery/quote            — публичная оценка зоны/цены (UX-подсказка)
 *   POST /api/delivery/webhook/yandex   — приём статусов claim от Яндекса (HMAC + идемпотентность)
 *   GET  /api/delivery/shipments/:orderId — трекинг (IDOR: владелец-или-сотрудник)
 *
 * Вся фича за флагом `config.yandexDelivery.enabled` (off по умолчанию — нет договора/токена).
 * Внешние вызовы Яндекса изолированы в `services/delivery/*` под circuit breaker.
 *
 * Серверный пересчёт зоны/цены для реального заказа — в S4 (`photo-print-orders.routes.ts`).
 * Здесь `/quote` — только подсказка клиенту; реальную цену Яндекса наружу не отдаём.
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { config } from '../config/index.js';
import db from '../database/db.js';
import { authenticateToken, optionalAuth, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createRateLimitStore } from '../middleware/rate-limit-store.js';
import { validate } from '../middleware/validate.js';
import type { AuthRequest } from '../types/index.js';
import { createLogger } from '../utils/logger.js';
import { validateAddress } from '../services/delivery.service.js';
import {
  checkPrice,
  mapStatus,
  normalizeLonLat,
  verifyAndParseWebhook,
  createYandexClaim,
  cancelClaim,
  UNKNOWN_STATUS,
} from '../services/delivery/yandex-delivery.service.js';
import { resolveZone } from '../services/delivery/zone-resolver.service.js';
import { selectNearestStudio } from '../services/delivery/source-studio.service.js';
import { withWebhookIdempotency } from '../services/webhook-idempotency.service.js';

const router = Router();
const log = createLogger('delivery.routes');

/**
 * Дефолтный вес посылки для оценки `/quote`, грамм.
 * Реальный вес заказа считается на сервере при создании заказа (S4) через
 * `weight-calculator.service.ts`. Здесь — лишь оценка дистанции/цены: фото лёгкие,
 * тариф 'courier' допускает до 10 кг, поэтому вес почти не влияет на зону.
 */
const QUOTE_DEFAULT_WEIGHT_GRAMS = 200;

// ---------------------------------------------------------------------------
// Rate-limit для публичного /quote (как webhookLimiter в app.ts: 100 req/min/IP).
// Соседние публичные роуты (booking/print-online) тоже за таргетным лимитером.
// ---------------------------------------------------------------------------
const quoteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { available: false, reason: 'rate_limited' },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('rl:delivery-quote:'),
});

// ---------------------------------------------------------------------------
// POST /api/delivery/quote — оценка зоны/цены доставки (публичный)
// ---------------------------------------------------------------------------

const quoteSchema = z.object({
  /** Свободный адрес (геокодируется через DaData). */
  address: z.string().trim().min(3).max(300).optional(),
  /** Готовые координаты [lon, lat] (если фронт уже геокодировал через /api/address/suggest). */
  coordinates: z.tuple([z.number(), z.number()]).optional(),
  /** Сумма заказа печати — для подсказки про мин. заказ дальних зон (не жёсткая проверка). */
  orderTotalRub: z.number().nonnegative().optional(),
  /** Параметры посылки (вес считается на сервере — это лишь подсказка габаритов). */
  parcel: z
    .object({
      weightGrams: z.number().positive().max(10_000).optional(),
      quantity: z.number().int().positive().max(1000).optional(),
    })
    .optional(),
});

type QuoteBody = z.infer<typeof quoteSchema>;

/** Ответ «доставка недоступна» с машинной причиной (фронт показывает текст). */
type QuoteUnavailableReason =
  | 'feature_disabled'
  | 'address_required'
  | 'out_of_zone'
  | 'address_imprecise'
  | 'provider_unavailable';

function unavailable(reason: QuoteUnavailableReason): { available: false; reason: QuoteUnavailableReason } {
  return { available: false, reason };
}

/** Город Ростов-на-Дону / Ростовская область — единственная зона обслуживания (P2-2). */
function isRostovServiceArea(city: string | null, region: string | null): boolean {
  const hay = `${city ?? ''} ${region ?? ''}`.toLowerCase();
  return hay.includes('ростов');
}

router.post(
  '/quote',
  quoteLimiter,
  optionalAuth,
  validate(quoteSchema),
  async (req: Request, res: Response): Promise<void> => {
    // Gate фичи: пока нет договора/токена — доставка недоступна.
    if (!config.yandexDelivery.enabled) {
      res.json(unavailable('feature_disabled'));
      return;
    }

    const body = req.body as QuoteBody;

    // 1. Координаты точки доставки: из тела или геокодинг адреса через DaData.
    let lon: number;
    let lat: number;
    let dropoffAddress: string | null = null;

    if (body.coordinates) {
      try {
        [lon, lat] = normalizeLonLat(body.coordinates[0], body.coordinates[1]);
      } catch {
        res.json(unavailable('address_required'));
        return;
      }
      dropoffAddress = body.address ?? null;
    } else if (body.address) {
      const validated = await validateAddress(body.address);
      if (!validated || !validated.geoLon || !validated.geoLat) {
        res.json(unavailable('address_required'));
        return;
      }
      // Guard зоны обслуживания (P2-2): только Ростов-на-Дону / Ростовская обл.
      if (!isRostovServiceArea(validated.city, validated.region)) {
        res.json(unavailable('out_of_zone'));
        return;
      }
      // Guard точности (P2-3): qc>=2 — адрес неточный, координаты ненадёжны.
      if (validated.qc >= 2) {
        res.json(unavailable('address_imprecise'));
        return;
      }
      try {
        [lon, lat] = normalizeLonLat(validated.geoLon, validated.geoLat);
      } catch {
        res.json(unavailable('address_required'));
        return;
      }
      dropoffAddress = validated.result;
    } else {
      res.json(unavailable('address_required'));
      return;
    }

    // 2. Ближайшая студия-отправитель (гаверсин, фантомы отфильтрованы в сервисе).
    let source;
    try {
      source = await selectNearestStudio(lon, lat);
    } catch (err) {
      // Ошибка конфигурации (нет валидных студий) — деградируем как недоступность.
      log.error('[quote] selectNearestStudio failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.json(unavailable('provider_unavailable'));
      return;
    }

    // 3. Реальная цена/дистанция через Яндекс check-price (под circuit breaker).
    //    CB open или сетевая ошибка → withServiceCall бросает Error → деградация.
    let priced;
    try {
      priced = await checkPrice({
        source: [source.lon, source.lat],
        dest: [lon, lat],
        weightGrams: body.parcel?.weightGrams ?? QUOTE_DEFAULT_WEIGHT_GRAMS,
      });
    } catch (err) {
      log.warn('[quote] checkPrice unavailable (CB open / network)', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.json(unavailable('provider_unavailable'));
      return;
    }

    // 4. Зона по дистанции (зональная ступень — её и показываем клиенту, НЕ цену Яндекса).
    const zone = await resolveZone(priced.distanceMeters);
    if (!zone) {
      res.json(unavailable('out_of_zone'));
      return;
    }

    // 5. Проверка мин. заказа дальних зон — только UX-подсказка (жёсткая проверка — S4).
    const meetsMinOrder =
      zone.minOrderRub <= 0 ||
      (typeof body.orderTotalRub === 'number' && body.orderTotalRub >= zone.minOrderRub);

    res.json({
      available: true,
      zone: zone.zoneId,
      zoneName: zone.name,
      priceRub: zone.priceRub,
      distanceMeters: priced.distanceMeters,
      sourceStudio: {
        studioId: source.studioId,
        locationCode: source.locationCode,
      },
      etaMinutes: priced.etaMinutes,
      minOrderRub: zone.minOrderRub,
      meetsMinOrder,
      dropoffAddress,
    });
  },
);

// ---------------------------------------------------------------------------
// POST /api/delivery/webhook/yandex — приём статусов claim (HMAC + идемпотентность)
// ---------------------------------------------------------------------------

/** Тело апдейта shipment по claim_id. */
interface WebhookUpdateRow {
  id: string;
  order_id: string;
}

/**
 * Маркер «claim_id ещё не закоммичен» (P1-1).
 *
 * Бросается ВНУТРИ callback `withWebhookIdempotency`, когда UPDATE затронул 0 строк
 * (claim_id ещё не записан post-payment-воркером). Транзакция идемпотентности
 * откатывается ⇒ idem-ключ НЕ фиксируется ⇒ ретрай Яндекса дойдёт после коммита claim_id.
 * Роут ловит этот класс и отвечает retryable-кодом (409), не 200.
 */
class ClaimNotReadyError extends Error {
  constructor(public readonly claimId: string) {
    super(`delivery webhook: shipment с claim_id=${claimId} ещё не существует (retry)`);
    this.name = 'ClaimNotReadyError';
  }
}

router.post('/webhook/yandex', async (req: Request, res: Response): Promise<void> => {
  // Сырое тело (для HMAC) сохранено глобальным express.json({ verify: captureRawBody }).
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body ?? {});

  // 1. Проверка подписи + парс. Невалидная подпись/тело → 401 (не ретраим мусор).
  let event;
  try {
    event = verifyAndParseWebhook(rawBody, req.headers);
  } catch (err) {
    log.warn('[webhook/yandex] verify/parse failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(401).json({ ok: false, error: 'invalid signature or payload' });
    return;
  }

  const { claimId, rawStatus, eventTs, raw } = event;
  // Per-event дискриминатор идемпотентности (P2-4): claim+status+ts, чтобы повторные
  // переходы статуса по одному claim не схлопывались в один ключ.
  const idemDiscriminator = `${claimId}:${rawStatus}:${eventTs ?? 'noTs'}`;

  const mapped = mapStatus(rawStatus);
  const isUnknown = mapped === UNKNOWN_STATUS;

  // Поля курьера/трекинга — best-effort из сырого тела (формат финализируется по контракту).
  const rawObj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const courierName =
    typeof rawObj['courier_name'] === 'string'
      ? (rawObj['courier_name'] as string)
      : ((rawObj['performer_info'] as Record<string, unknown> | undefined)?.['courier_name'] as
          | string
          | undefined) ?? null;
  const courierPhone =
    typeof rawObj['courier_phone'] === 'string' ? (rawObj['courier_phone'] as string) : null;
  const trackingUrl =
    typeof rawObj['tracking_url'] === 'string' ? (rawObj['tracking_url'] as string) : null;

  try {
    const result = await withWebhookIdempotency(
      'yandex-delivery',
      idemDiscriminator,
      claimId,
      async (client): Promise<WebhookUpdateRow | null> => {
        // UPDATE shipment по claim_id. Неизвестный raw → НЕ двигаем status, ставим needs_attention.
        // COALESCE сохраняет существующие значения, если в payload поля нет.
        const upd = await client.query<WebhookUpdateRow>(
          `UPDATE delivery_shipments
           SET status = CASE WHEN $2::boolean THEN status ELSE $3 END,
               raw_status = $4,
               needs_attention = CASE WHEN $2::boolean THEN true ELSE needs_attention END,
               courier_name = COALESCE($5, courier_name),
               courier_phone = COALESCE($6, courier_phone),
               tracking_url = COALESCE($7, tracking_url),
               updated_at = now()
           WHERE claim_id = $1
           RETURNING id, order_id`,
          [
            claimId,
            isUnknown,
            isUnknown ? null : mapped,
            rawStatus.slice(0, 120),
            courierName,
            courierPhone,
            trackingUrl,
          ],
        );

        // P1-1: 0 строк = claim_id ещё не закоммичен воркером. Бросаем — транзакция
        // идемпотентности откатывается, idem-ключ НЕ фиксируется, ретрай дойдёт позже.
        if (upd.rows.length === 0) {
          throw new ClaimNotReadyError(claimId);
        }

        return upd.rows[0] ?? null;
      },
    );

    // Дубликат вебхука (idem-ключ уже был) — отвечаем кэшем, апдейт/эмит не повторяем.
    if (result.duplicate) {
      res.json({ ok: true, duplicate: true });
      return;
    }

    const updated = result.result;

    // WS-эмит обновления статуса доставки (как order:paid в payments.routes.ts).
    // P1-1: один эмит в объединение комнат — операторская доска (`employee:dashboard`,
    // куда входят admin/manager/employee) + клиент-владелец (`order:{id}`). Прежний
    // `admin:visitor-chats` для этого события — подмножество `employee:dashboard`, убран.
    if (updated) {
      try {
        const io = req.app.socketServer?.getIO();
        if (io) {
          const payload = {
            orderId: updated.order_id,
            status: isUnknown ? null : mapped,
            rawStatus,
            needsAttention: isUnknown,
          };
          io.to('employee:dashboard')
            .to(`order:${updated.order_id}`)
            .emit('order:delivery-status', payload);
        }
      } catch {
        /* socket недоступен — не критично */
      }
    }

    res.json({ ok: true });
  } catch (err) {
    // P1-1: claim ещё не готов → retryable 409 (Яндекс ретраит позже, idem-ключ не зафиксирован).
    if (err instanceof ClaimNotReadyError) {
      log.info('[webhook/yandex] claim_id ещё не готов — просим ретрай', { claimId });
      res.status(409).json({ ok: false, error: 'claim not ready', retry: true });
      return;
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// GET /api/delivery/shipments/:orderId — трекинг (IDOR: владелец-или-сотрудник)
// ---------------------------------------------------------------------------

/** Признак права управления доставкой (сотрудник/админ) — эталон canManageSubscriptions. */
function canManageDelivery(req: AuthRequest): boolean {
  return (
    req.user?.role === 'admin' ||
    req.user?.role === 'manager' ||
    req.user?.role === 'employee' ||
    Boolean(req.user?.permissions?.includes('orders:manage'))
  );
}

interface OrderOwnerRow {
  order_id: string;
  customer_id: string | null;
}

interface ShipmentTrackRow {
  status: string;
  raw_status: string | null;
  tracking_url: string | null;
  courier_name: string | null;
  courier_phone: string | null;
  needs_attention: boolean;
}

router.get(
  '/shipments/:orderId',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.user) {
      throw new AppError(401, 'Authentication required');
    }

    const orderId = req.params['orderId']!;

    // IDOR: читать трекинг может владелец заказа (по customer_id) или сотрудник.
    const order = await db.queryOne<OrderOwnerRow>(
      `SELECT order_id, customer_id FROM photo_print_orders WHERE order_id = $1`,
      [orderId],
    );

    if (!order) {
      throw new AppError(404, 'Заказ не найден');
    }

    if (order.customer_id !== req.user.id && !canManageDelivery(req)) {
      // 404 (не 403) — не раскрываем существование чужого заказа.
      throw new AppError(404, 'Заказ не найден');
    }

    // P2-1: предпочитаем активную (не-терминальную) отправку; иначе самую свежую.
    const shipment = await db.queryOne<ShipmentTrackRow>(
      `SELECT status, raw_status, tracking_url, courier_name, courier_phone, needs_attention
       FROM delivery_shipments
       WHERE order_id = $1
       ORDER BY (status NOT IN ('cancelled','failed','delivered')) DESC, created_at DESC
       LIMIT 1`,
      [orderId],
    );

    if (!shipment) {
      throw new AppError(404, 'Доставка по заказу не найдена');
    }

    res.json({
      status: shipment.status,
      rawStatus: shipment.raw_status,
      // ETA не персистится в shipment (приходит только в /quote от Яндекса) — null по контракту.
      etaMinutes: null,
      trackingUrl: shipment.tracking_url,
      courier: shipment.courier_name
        ? { name: shipment.courier_name, phone: shipment.courier_phone }
        : null,
      needsAttention: shipment.needs_attention,
    });
  },
);

// ===========================================================================
// Операторская доска доставки (ФотоПульт). Guard = requirePermission('pos:use')
// (admin/manager/employee имеют; photographer/reception — нет). P0-2: пермишена
// `orders:manage` НЕ существует, поэтому `canManageDelivery` для guard'а НЕ годится
// (ветка с ним мёртвая, гард по нему отсёк бы всех) — используем pos:use напрямую,
// как эталонный staff-list (`photo-print-orders.routes.ts:1472`).
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/delivery/queue — очередь курьерских заказов для доски
// ---------------------------------------------------------------------------

/** Сколько дней терминальные отправки (delivered/cancelled/failed) ещё висят в очереди. */
const QUEUE_TERMINAL_TTL_DAYS = 3;

/** Жёсткий лимит строк очереди (защита от разрастания; курьерских заказов мало). */
const QUEUE_LIMIT = 200;

interface DeliveryQueueRow {
  order_id: string;
  order_status: string;
  customer_name: string | null;
  dropoff_address: string | null;
  zone_name: string | null;
  price_rub: string | null;
  shipment_status: string | null;
  claim_id: string | null;
  courier_name: string | null;
  courier_phone: string | null;
  tracking_url: string | null;
  needs_attention: boolean | null;
  created_at: Date;
}

router.get(
  '/queue',
  authenticateToken,
  requirePermission('pos:use'),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    // P1-2: LEFT JOIN LATERAL выбирает РОВНО одну активную/свежую отправку на заказ —
    // плоский JOIN дублировал бы строки (активная + терминальные). Правило выбора
    // повторяет `GET /shipments/:orderId`: активная (не-терминальная) приоритетнее, затем свежая.
    const rows = await db.query<DeliveryQueueRow>(
      `SELECT p.order_id,
              p.status        AS order_status,
              p.contact_name  AS customer_name,
              COALESCE(s.dropoff_address, p.delivery_address) AS dropoff_address,
              z.name          AS zone_name,
              COALESCE(s.price_rub, p.delivery_cost)          AS price_rub,
              s.status        AS shipment_status,
              s.claim_id,
              s.courier_name,
              s.courier_phone,
              s.tracking_url,
              s.needs_attention,
              p.created_at
       FROM photo_print_orders p
       LEFT JOIN LATERAL (
         SELECT ds.status, ds.claim_id, ds.tracking_url, ds.courier_name,
                ds.courier_phone, ds.needs_attention, ds.zone_id,
                ds.price_rub, ds.dropoff_address, ds.updated_at
         FROM delivery_shipments ds
         WHERE ds.order_id = p.order_id
         ORDER BY (ds.status NOT IN ('cancelled','failed','delivered')) DESC,
                  ds.created_at DESC
         LIMIT 1
       ) s ON true
       LEFT JOIN delivery_zones z ON z.id = s.zone_id
       WHERE p.delivery_method = 'courier'
         -- Свернуть старые терминальные: терминальную отправку показываем только N дней.
         AND (
           s.status IS NULL
           OR s.status NOT IN ('delivered','cancelled','failed')
           OR s.updated_at >= now() - ($1 || ' days')::interval
         )
       ORDER BY
         COALESCE(s.needs_attention, false) DESC,
         p.created_at DESC
       LIMIT $2`,
      [QUEUE_TERMINAL_TTL_DAYS, QUEUE_LIMIT],
    );

    const items = rows.map((r) => ({
      orderId: r.order_id,
      orderNumber: r.order_id, // order_id — человекочитаемый номер (напр. CRM-260530-XDBY)
      orderStatus: r.order_status,
      customerName: r.customer_name,
      dropoffAddress: r.dropoff_address,
      zone: r.zone_name,
      priceRub: r.price_rub !== null ? Number(r.price_rub) : null,
      shipmentStatus: r.shipment_status,
      claimId: r.claim_id,
      courierName: r.courier_name,
      courierPhone: r.courier_phone,
      trackingUrl: r.tracking_url,
      needsAttention: r.needs_attention ?? false,
      createdAt: r.created_at,
    }));

    res.json({ items });
  },
);

// ---------------------------------------------------------------------------
// POST /api/delivery/shipments/:orderId/dispatch — ручной вызов курьера
// ---------------------------------------------------------------------------

interface OrderStatusRow {
  status: string;
}

router.post(
  '/shipments/:orderId/dispatch',
  authenticateToken,
  requirePermission('pos:use'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    // Flag off → фича выключена (нет договора/токена Яндекса).
    if (!config.yandexDelivery.enabled) {
      res.status(400).json({ error: 'feature_disabled' });
      return;
    }

    const orderId = req.params['orderId']!;

    // P1-3 (TOCTOU-safe): читаем статус заказа в транзакции под FOR UPDATE — между
    // проверкой и вызовом createYandexClaim статус не сдвинется. Вызов курьера допустим
    // только когда печать готова (`status='ready'`) — фикс дефекта «курьер до готовности».
    const order = await db.transaction(async (client) => {
      const r = await client.query<OrderStatusRow>(
        `SELECT status FROM photo_print_orders WHERE order_id = $1 FOR UPDATE`,
        [orderId],
      );
      return r.rows[0] ?? null;
    });

    if (!order) {
      throw new AppError(404, 'Заказ не найден');
    }

    if (order.status !== 'ready') {
      res.status(409).json({ error: 'order_not_ready' });
      return;
    }

    // createYandexClaim идемпотентна (SELECT claim_id + WHERE claim_id IS NULL) —
    // повторный клик не создаёт второй claim (фронт дополнительно дизейблит кнопку).
    const result = await createYandexClaim(orderId);

    res.json({
      ok: true,
      shipmentStatus: 'created',
      claimId: result.claimId,
    });
  },
);

// ---------------------------------------------------------------------------
// POST /api/delivery/shipments/:orderId/cancel — отмена вызова курьера
// ---------------------------------------------------------------------------

const cancelSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

interface ShipmentCancelRow {
  id: string;
  claim_id: string | null;
}

router.post(
  '/shipments/:orderId/cancel',
  authenticateToken,
  requirePermission('pos:use'),
  validate(cancelSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const orderId = req.params['orderId']!;
    const reason = (req.body as z.infer<typeof cancelSchema>).reason;

    // Активная отправка по заказу (не-терминальная приоритетнее) — её и отменяем.
    const shipment = await db.queryOne<ShipmentCancelRow>(
      `SELECT id, claim_id
       FROM delivery_shipments
       WHERE order_id = $1
       ORDER BY (status NOT IN ('cancelled','failed','delivered')) DESC, created_at DESC
       LIMIT 1`,
      [orderId],
    );

    if (!shipment) {
      throw new AppError(404, 'Доставка по заказу не найдена');
    }

    // Если claim уже создан в Яндексе — отменяем у провайдера (под circuit breaker).
    // Если claim ещё нет (курьер не вызван) — просто локальная отмена отправки.
    if (shipment.claim_id) {
      try {
        await cancelClaim(shipment.claim_id, reason);
      } catch (err) {
        // Отмена у Яндекса не удалась — не глотаем: оператор увидит ошибку, повторит.
        log.error('[cancel] cancelClaim failed', {
          orderId,
          claimId: shipment.claim_id,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new AppError(502, 'Не удалось отменить вызов курьера у провайдера');
      }
    }

    // Локально помечаем отправку отменённой (идемпотентно — повторный cancel безвреден).
    await db.query(
      `UPDATE delivery_shipments
       SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND status NOT IN ('cancelled','failed','delivered')`,
      [shipment.id],
    );

    res.json({ ok: true, shipmentStatus: 'cancelled' });
  },
);

export default router;
