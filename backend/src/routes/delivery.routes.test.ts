/**
 * Интеграционные тесты роутов курьерской доставки (Яндекс).
 *
 * Покрывают:
 *  - /quote: фича off → feature_disabled; адрес вне Ростова → out_of_zone;
 *            qc>=2 → address_imprecise; мок сервисов → зона/цена.
 *  - /webhook/yandex: невалидная подпись → 401; неизвестный claim_id (0 строк UPDATE)
 *                     НЕ съедается идемпотентностью → 409 retryable (P1-1).
 *  - /shipments/:orderId: IDOR — чужой заказ → 404; владелец → трекинг.
 *
 * Падающие тесты = баги в продакшен-коде, которые надо чинить.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  mockDb,
  resetMockDb,
  TEST_JWT_SECRET,
  makeClientUser,
  makeEmployeeUser,
  makeManagerUser,
  authHeader,
} from '../test-utils/index.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../database/db.js', () => ({
  default: mockDb,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

// config мутируется по-тестно (yandexDelivery.enabled toggle).
const mockConfig = {
  jwt: { secret: TEST_JWT_SECRET, expiresIn: '15m', refreshExpiresIn: '30d' },
  yandexDelivery: {
    enabled: false,
    token: 'test-token',
    baseUrl: 'https://b2b.taxi.yandex.net',
    webhookSecret: 'test-secret',
    taxiClass: 'courier',
  },
  dadata: { apiKey: 'k', secretKey: 's', cleanerUrl: 'https://cleaner' },
};

vi.mock('../config/index.js', () => ({ config: mockConfig }));

vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/permission.service.js', () => ({
  permissionService: {
    getUserPermissions: vi.fn().mockResolvedValue([]),
    hasAllPermissions: vi.fn().mockResolvedValue(false),
  },
}));

// Rate-limit store обращается к Redis при импорте роутера — мокаем на MemoryStore
// (undefined store → express-rate-limit использует встроенный MemoryStore).
vi.mock('../middleware/rate-limit-store.js', () => ({
  createRateLimitStore: vi.fn(() => undefined),
}));

// ─── Delivery service mocks ────────────────────────────────────────────────────

const mockValidateAddress = vi.fn();
vi.mock('../services/delivery.service.js', () => ({
  validateAddress: mockValidateAddress,
}));

const mockCheckPrice = vi.fn();
const mockVerifyAndParseWebhook = vi.fn();
const mockMapStatus = vi.fn();
const mockCreateYandexClaim = vi.fn();
const mockCancelClaim = vi.fn();
vi.mock('../services/delivery/yandex-delivery.service.js', () => ({
  checkPrice: mockCheckPrice,
  verifyAndParseWebhook: mockVerifyAndParseWebhook,
  mapStatus: mockMapStatus,
  createYandexClaim: mockCreateYandexClaim,
  cancelClaim: mockCancelClaim,
  UNKNOWN_STATUS: '__unknown__',
  // нормализация координат — реальная логика проста, реализуем минимально
  normalizeLonLat: (lon: string | number, lat: string | number) => {
    const l = typeof lon === 'string' ? parseFloat(lon) : lon;
    const a = typeof lat === 'string' ? parseFloat(lat) : lat;
    if (!Number.isFinite(l) || !Number.isFinite(a)) throw new Error('bad coords');
    return [l, a];
  },
}));

const mockResolveZone = vi.fn();
vi.mock('../services/delivery/zone-resolver.service.js', () => ({
  resolveZone: mockResolveZone,
}));

const mockSelectNearestStudio = vi.fn();
vi.mock('../services/delivery/source-studio.service.js', () => ({
  selectNearestStudio: mockSelectNearestStudio,
}));

// withWebhookIdempotency — мок, который РЕАЛЬНО исполняет callback и пробрасывает throw
// (имитируя rollback транзакции идемпотентности: ключ не фиксируется при ошибке callback).
type IdemMockResult =
  | { duplicate: true; cachedResponse: unknown }
  | { duplicate: false; result: unknown };

const mockWithWebhookIdempotency = vi.fn<
  (
    type: string,
    disc: string,
    orderId: string | null,
    cb: (client: unknown) => Promise<unknown>,
  ) => Promise<IdemMockResult>
>(async (_type, _disc, _orderId, cb) => {
  const client = { query: vi.fn() };
  const result = await cb(client); // throw из cb пробрасывается наружу — как rollback
  return { duplicate: false, result };
});
vi.mock('../services/webhook-idempotency.service.js', () => ({
  withWebhookIdempotency: mockWithWebhookIdempotency,
}));

// ─── SUT import ─────────────────────────────────────────────────────────────────

const { default: deliveryRouter } = await import('./delivery.routes.js');

const app = createTestApp(deliveryRouter, '/');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROSTOV_DADATA = {
  result: 'г Ростов-на-Дону, ул Стачки, д 26',
  city: 'Ростов-на-Дону',
  region: 'Ростовская',
  postalCode: '344000',
  geoLat: '47.2',
  geoLon: '39.6',
  qc: 0,
  streetWithType: 'ул Стачки',
  house: '26',
  flat: null,
};

const ZONE_1 = {
  zoneId: 1,
  name: 'Зона 1 (центр)',
  priceRub: 300,
  minOrderRub: 0,
  taxiClass: 'courier',
  maxDistanceM: 5000,
};

beforeEach(() => {
  resetMockDb();
  vi.clearAllMocks();
  mockConfig.yandexDelivery.enabled = false;
  // sane defaults
  mockSelectNearestStudio.mockResolvedValue({
    studioId: 'studio-1',
    locationCode: 'soborny',
    lon: 39.71,
    lat: 47.22,
    distanceMeters: 1500,
  });
  mockCheckPrice.mockResolvedValue({ priceRub: 250, distanceMeters: 1500, etaMinutes: 25 });
  mockResolveZone.mockResolvedValue(ZONE_1);
  mockValidateAddress.mockResolvedValue(ROSTOV_DADATA);
  mockCreateYandexClaim.mockResolvedValue({ created: true, claimId: 'claim-new' });
  mockCancelClaim.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /quote
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /quote', () => {
  it('фича off → available:false, reason:feature_disabled (Яндекс не вызывается)', async () => {
    mockConfig.yandexDelivery.enabled = false;

    const res = await request(app).post('/quote').send({ address: 'Ростов, Стачки 26' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, reason: 'feature_disabled' });
    expect(mockCheckPrice).not.toHaveBeenCalled();
    expect(mockSelectNearestStudio).not.toHaveBeenCalled();
  });

  it('адрес вне Ростова → out_of_zone', async () => {
    mockConfig.yandexDelivery.enabled = true;
    mockValidateAddress.mockResolvedValueOnce({
      ...ROSTOV_DADATA,
      city: 'Москва',
      region: 'Москва',
    });

    const res = await request(app).post('/quote').send({ address: 'Москва, Тверская 1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, reason: 'out_of_zone' });
    expect(mockCheckPrice).not.toHaveBeenCalled();
  });

  it('qc>=2 (неточный адрес) → address_imprecise', async () => {
    mockConfig.yandexDelivery.enabled = true;
    mockValidateAddress.mockResolvedValueOnce({ ...ROSTOV_DADATA, qc: 2 });

    const res = await request(app).post('/quote').send({ address: 'Ростов где-то' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, reason: 'address_imprecise' });
    expect(mockCheckPrice).not.toHaveBeenCalled();
  });

  it('валидный адрес в Ростове → зона/цена (мок сервисов)', async () => {
    mockConfig.yandexDelivery.enabled = true;

    const res = await request(app)
      .post('/quote')
      .send({ address: 'Ростов, Стачки 26', orderTotalRub: 1500 });

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.zone).toBe(1);
    expect(res.body.priceRub).toBe(300); // зональная ступень, НЕ цена Яндекса (250)
    expect(res.body).not.toHaveProperty('realPriceRub');
    expect(res.body.distanceMeters).toBe(1500);
    expect(res.body.minOrderRub).toBe(0);
    expect(res.body.meetsMinOrder).toBe(true);
    expect(res.body.sourceStudio.studioId).toBe('studio-1');
    expect(mockCheckPrice).toHaveBeenCalledTimes(1);
  });

  it('дальняя зона + заказ ниже мин. → meetsMinOrder:false (UX-подсказка, всё равно available)', async () => {
    mockConfig.yandexDelivery.enabled = true;
    mockResolveZone.mockResolvedValueOnce({
      ...ZONE_1,
      zoneId: 3,
      name: 'Зона 3 (дальняя)',
      priceRub: 450,
      minOrderRub: 2000,
      maxDistanceM: 18000,
    });

    const res = await request(app)
      .post('/quote')
      .send({ address: 'Ростов, окраина', orderTotalRub: 500 });

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.zone).toBe(3);
    expect(res.body.minOrderRub).toBe(2000);
    expect(res.body.meetsMinOrder).toBe(false);
  });

  it('CB open / Яндекс недоступен → provider_unavailable', async () => {
    mockConfig.yandexDelivery.enabled = true;
    mockCheckPrice.mockRejectedValueOnce(new Error('Circuit breaker OPEN for yandex-delivery'));

    const res = await request(app).post('/quote').send({ address: 'Ростов, Стачки 26' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, reason: 'provider_unavailable' });
  });

  it('готовые координаты обходят геокодинг DaData', async () => {
    mockConfig.yandexDelivery.enabled = true;

    const res = await request(app)
      .post('/quote')
      .send({ coordinates: [39.6, 47.2] });

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(mockValidateAddress).not.toHaveBeenCalled();
    expect(mockSelectNearestStudio).toHaveBeenCalledWith(39.6, 47.2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /webhook/yandex
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /webhook/yandex', () => {
  it('невалидная подпись → 401 (verifyAndParseWebhook бросает)', async () => {
    mockVerifyAndParseWebhook.mockImplementationOnce(() => {
      throw new Error('Yandex webhook: невалидная подпись');
    });

    const res = await request(app)
      .post('/webhook/yandex')
      .send({ claim_id: 'c1', status: 'delivered' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(mockWithWebhookIdempotency).not.toHaveBeenCalled();
  });

  it('известный claim_id → UPDATE статуса + 200', async () => {
    mockVerifyAndParseWebhook.mockReturnValueOnce({
      claimId: 'claim-123',
      rawStatus: 'delivered',
      eventTs: '2026-05-30T10:00:00Z',
      raw: { claim_id: 'claim-123', status: 'delivered' },
    });
    mockMapStatus.mockReturnValueOnce('delivered');

    // UPDATE затронул 1 строку — claim существует.
    const clientQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'ship-1', order_id: 'ORD-1' }],
    });
    mockWithWebhookIdempotency.mockImplementationOnce(async (_t, _d, _o, cb) => {
      const result = await cb({ query: clientQuery });
      return { duplicate: false, result };
    });

    const res = await request(app)
      .post('/webhook/yandex')
      .send({ claim_id: 'claim-123', status: 'delivered' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  it('P1-1: неизвестный claim_id (0 строк UPDATE) НЕ съедается идемпотентностью → 409 retryable', async () => {
    mockVerifyAndParseWebhook.mockReturnValueOnce({
      claimId: 'claim-not-yet',
      rawStatus: 'performer_found',
      eventTs: '2026-05-30T10:00:00Z',
      raw: { claim_id: 'claim-not-yet', status: 'performer_found' },
    });
    mockMapStatus.mockReturnValueOnce('courier_assigned');

    // UPDATE вернул 0 строк — claim_id ещё не закоммичен воркером.
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    // Мок имитирует реальный rollback: throw из cb пробрасывается, ключ не фиксируется.
    mockWithWebhookIdempotency.mockImplementationOnce(async (_t, _d, _o, cb) => {
      const result = await cb({ query: clientQuery }); // бросит ClaimNotReadyError
      return { duplicate: false, result };
    });

    const res = await request(app)
      .post('/webhook/yandex')
      .send({ claim_id: 'claim-not-yet', status: 'performer_found' });

    // 409 = retryable: Яндекс ретраит позже, idem-ключ НЕ зафиксирован (rollback).
    expect(res.status).toBe(409);
    expect(res.body.retry).toBe(true);
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  it('дубликат вебхука (idem-ключ уже был) → 200 duplicate, апдейт не повторяется', async () => {
    mockVerifyAndParseWebhook.mockReturnValueOnce({
      claimId: 'claim-123',
      rawStatus: 'delivered',
      eventTs: '2026-05-30T10:00:00Z',
      raw: { claim_id: 'claim-123', status: 'delivered' },
    });
    mockMapStatus.mockReturnValueOnce('delivered');
    mockWithWebhookIdempotency.mockResolvedValueOnce({
      duplicate: true,
      cachedResponse: { code: 0 },
    });

    const res = await request(app)
      .post('/webhook/yandex')
      .send({ claim_id: 'claim-123', status: 'delivered' });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
  });

  it('неизвестный raw-статус → needs_attention, статус не двигается (UPDATE с флагом unknown)', async () => {
    mockVerifyAndParseWebhook.mockReturnValueOnce({
      claimId: 'claim-x',
      rawStatus: 'some_new_unknown',
      eventTs: '2026-05-30T10:00:00Z',
      raw: { claim_id: 'claim-x', status: 'some_new_unknown' },
    });
    mockMapStatus.mockReturnValueOnce('__unknown__'); // UNKNOWN_STATUS

    const clientQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'ship-1', order_id: 'ORD-1' }],
    });
    mockWithWebhookIdempotency.mockImplementationOnce(async (_t, _d, _o, cb) => {
      const result = await cb({ query: clientQuery });
      return { duplicate: false, result };
    });

    const res = await request(app)
      .post('/webhook/yandex')
      .send({ claim_id: 'claim-x', status: 'some_new_unknown' });

    expect(res.status).toBe(200);
    // SQL получил isUnknown=true ($2) → status сохраняется, needs_attention=true.
    const sqlArgs = clientQuery.mock.calls[0]![1] as unknown[];
    expect(sqlArgs[1]).toBe(true); // isUnknown
    expect(sqlArgs[2]).toBeNull(); // mapped → null при unknown
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /shipments/:orderId
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /shipments/:orderId', () => {
  const client = makeClientUser();
  const employee = makeEmployeeUser();

  /**
   * Настраивает mockDb.queryOne различать запросы по SQL:
   *  - users (auth middleware) → возвращает authUser
   *  - photo_print_orders → order
   *  - delivery_shipments → shipment
   */
  function wireDb(opts: {
    authUser: { id: string; role: string };
    order: { order_id: string; customer_id: string | null } | null;
    shipment: Record<string, unknown> | null;
  }): void {
    vi.mocked(mockDb.queryOne).mockImplementation((sql: string) => {
      if (sql.includes('FROM users')) {
        return Promise.resolve({
          id: opts.authUser.id,
          email: 'u@e.com',
          role: opts.authUser.role,
          is_active: true,
          display_name: 'U',
          phone: null,
          force_password_change: false,
          last_password_change: null,
        } as never);
      }
      if (sql.includes('FROM photo_print_orders')) {
        return Promise.resolve(opts.order as never);
      }
      if (sql.includes('FROM delivery_shipments')) {
        return Promise.resolve(opts.shipment as never);
      }
      return Promise.resolve(null as never);
    });
  }

  it('владелец заказа → трекинг', async () => {
    wireDb({
      authUser: { id: client.id, role: 'client' },
      order: { order_id: 'ORD-1', customer_id: client.id },
      shipment: {
        status: 'in_transit',
        raw_status: 'delivery_arrived',
        tracking_url: 'https://dostavka.yandex.ru/track/c1',
        courier_name: 'Иван',
        courier_phone: '+7900',
        needs_attention: false,
      },
    });

    const res = await request(app).get('/shipments/ORD-1').set(authHeader(client));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_transit');
    expect(res.body.trackingUrl).toBe('https://dostavka.yandex.ru/track/c1');
    expect(res.body.courier).toEqual({ name: 'Иван', phone: '+7900' });
    expect(res.body.etaMinutes).toBeNull();
  });

  it('IDOR: чужой заказ (другой customer_id, не сотрудник) → 404 (не раскрываем существование)', async () => {
    wireDb({
      authUser: { id: client.id, role: 'client' },
      order: { order_id: 'ORD-1', customer_id: 'someone-else-id' },
      shipment: { status: 'in_transit', raw_status: null, tracking_url: null, courier_name: null, courier_phone: null, needs_attention: false },
    });

    const res = await request(app).get('/shipments/ORD-1').set(authHeader(client));

    expect(res.status).toBe(404);
  });

  it('сотрудник видит чужой заказ (право управления)', async () => {
    wireDb({
      authUser: { id: employee.id, role: 'employee' },
      order: { order_id: 'ORD-1', customer_id: 'some-client-id' },
      shipment: {
        status: 'delivered',
        raw_status: 'delivered',
        tracking_url: null,
        courier_name: null,
        courier_phone: null,
        needs_attention: false,
      },
    });

    const res = await request(app).get('/shipments/ORD-1').set(authHeader(employee));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('delivered');
    expect(res.body.courier).toBeNull();
  });

  it('без токена → 401', async () => {
    const res = await request(app).get('/shipments/ORD-1');
    expect(res.status).toBe(401);
  });

  it('заказ не найден → 404', async () => {
    wireDb({
      authUser: { id: client.id, role: 'client' },
      order: null,
      shipment: null,
    });

    const res = await request(app).get('/shipments/ORD-NONE').set(authHeader(client));
    expect(res.status).toBe(404);
  });
});
