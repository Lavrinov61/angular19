import crypto from 'node:crypto';

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../config/index.js', () => ({
  config: {
    yandexDelivery: {
      enabled: true,
      token: 'test-token',
      baseUrl: 'https://b2b.taxi.yandex.net',
      webhookSecret: 'test-secret',
      taxiClass: 'courier',
    },
  },
}));

// circuit-breaker: withServiceCall просто прогоняет fn (тесты не проверяют CB-логику).
vi.mock('../../utils/circuit-breaker.js', () => ({
  withServiceCall: vi.fn(async (_cfg: unknown, fn: () => Promise<unknown>) => fn()),
  SERVICE_BREAKERS: {
    yandexDelivery: { name: 'yandex-delivery', threshold: 3, cooldownMs: 60_000, timeoutMs: 30_000 },
  },
}));

vi.mock('../../database/db.js', () => ({
  default: { query: vi.fn(), queryOne: vi.fn() },
}));

const svc = await import('./yandex-delivery.service.js');
const {
  mapStatus,
  UNKNOWN_STATUS,
  normalizeLonLat,
  verifyAndParseWebhook,
  setWebhookVerifyStrategy,
  defaultWebhookVerify,
  checkPrice,
  createYandexClaim,
  cancelClaim,
  calculateParcelWeight,
} = svc;
const dbModule = await import('../../database/db.js');
const db = dbModule.default as unknown as {
  query: ReturnType<typeof vi.fn>;
  queryOne: ReturnType<typeof vi.fn>;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setWebhookVerifyStrategy(defaultWebhookVerify);
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// mapStatus
// ---------------------------------------------------------------------------
describe('mapStatus', () => {
  it('маппит известные raw-статусы в нормализованный домен', () => {
    expect(mapStatus('new')).toBe('created');
    expect(mapStatus('performer_found')).toBe('courier_assigned');
    expect(mapStatus('pickuped')).toBe('picked_up');
    expect(mapStatus('delivery_arrived')).toBe('in_transit');
    expect(mapStatus('delivered')).toBe('delivered');
    expect(mapStatus('cancelled')).toBe('cancelled');
    expect(mapStatus('failed')).toBe('failed');
    expect(mapStatus('returned')).toBe('failed');
    expect(mapStatus('performer_not_found')).toBe('failed');
  });

  it('регистронезависим и тримит', () => {
    expect(mapStatus('  DELIVERED  ')).toBe('delivered');
  });

  it('P2-4: неизвестный raw → UNKNOWN_STATUS (не теряем молча)', () => {
    expect(mapStatus('some_new_yandex_status')).toBe(UNKNOWN_STATUS);
    expect(mapStatus('')).toBe(UNKNOWN_STATUS);
  });
});

// ---------------------------------------------------------------------------
// normalizeLonLat
// ---------------------------------------------------------------------------
describe('normalizeLonLat', () => {
  it('строки DaData → [lon, lat] числами', () => {
    expect(normalizeLonLat('39.7015', '47.2357')).toEqual([39.7015, 47.2357]);
  });

  it('числа проходят как есть', () => {
    expect(normalizeLonLat(39.7, 47.2)).toEqual([39.7, 47.2]);
  });

  it('невалидные координаты → throw', () => {
    expect(() => normalizeLonLat('abc', '47.2')).toThrow(/невалидные координаты/i);
    expect(() => normalizeLonLat(Number.NaN, 47.2)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// verifyAndParseWebhook
// ---------------------------------------------------------------------------
describe('verifyAndParseWebhook', () => {
  function sign(body: string): string {
    return crypto.createHmac('sha256', 'test-secret').update(body, 'utf8').digest('hex');
  }

  it('валидная подпись → парсит claim_id/status/event_ts', () => {
    const body = JSON.stringify({ claim_id: 'cl-1', status: 'delivered', updated_ts: '2026-05-30T10:00:00Z' });
    const parsed = verifyAndParseWebhook(body, { 'x-yandex-signature': sign(body) });
    expect(parsed.claimId).toBe('cl-1');
    expect(parsed.rawStatus).toBe('delivered');
    expect(parsed.eventTs).toBe('2026-05-30T10:00:00Z');
  });

  it('невалидная подпись → throw (роут вернёт 401)', () => {
    const body = JSON.stringify({ claim_id: 'cl-1', status: 'delivered' });
    expect(() => verifyAndParseWebhook(body, { 'x-yandex-signature': 'deadbeef' })).toThrow(/подпись/i);
  });

  it('отсутствие заголовка подписи → throw', () => {
    const body = JSON.stringify({ claim_id: 'cl-1', status: 'delivered' });
    expect(() => verifyAndParseWebhook(body, {})).toThrow(/подпись/i);
  });

  it('валидная подпись, но битый JSON → throw', () => {
    const body = 'not-json';
    expect(() => verifyAndParseWebhook(body, { 'x-yandex-signature': sign(body) })).toThrow(/JSON/i);
  });

  it('валидная подпись, но нет claim_id/status → throw', () => {
    const body = JSON.stringify({ foo: 'bar' });
    expect(() => verifyAndParseWebhook(body, { 'x-yandex-signature': sign(body) })).toThrow(
      /claim_id или status/i,
    );
  });

  it('заменяемая verify-стратегия (P1-2): подменяется на always-true', () => {
    setWebhookVerifyStrategy(() => true);
    const body = JSON.stringify({ claim_id: 'cl-9', status: 'new' });
    const parsed = verifyAndParseWebhook(body, {}); // без подписи, но стратегия пропускает
    expect(parsed.claimId).toBe('cl-9');
  });
});

// ---------------------------------------------------------------------------
// checkPrice (мок fetch)
// ---------------------------------------------------------------------------
describe('checkPrice', () => {
  it('POST на check-price с Bearer-токеном, парсит цену/дистанцию/eta', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ price: '349.50', distance_meters: 4200, eta: 1800 }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await checkPrice({ source: [39.7, 47.23], dest: [39.72, 47.24], weightGrams: 120 });
    expect(result.priceRub).toBe(349.5);
    expect(result.distanceMeters).toBe(4200);
    expect(result.etaMinutes).toBe(30); // 1800с → 30 мин

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/b2b/cargo/integration/v2/check-price');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    const sentBody = JSON.parse(opts.body as string);
    expect(sentBody.route_points[0].coordinates).toEqual([39.7, 47.23]);
    expect(sentBody.items[0].weight).toBeCloseTo(0.12); // граммы → кг
  });

  it('HTTP-ошибка → throw', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error',
    }) as unknown as typeof fetch;

    await expect(
      checkPrice({ source: [39.7, 47.23], dest: [39.72, 47.24], weightGrams: 120 }),
    ).rejects.toThrow(/check-price HTTP 500/i);
  });
});

// ---------------------------------------------------------------------------
// createYandexClaim (идемпотентность + мок fetch)
// ---------------------------------------------------------------------------
describe('createYandexClaim', () => {
  it('R5: claim_id уже есть → idempotent no-op, Яндекс не вызывается', async () => {
    db.queryOne.mockResolvedValueOnce({
      order_id: 'ORD-1',
      claim_id: 'existing-claim',
      source_studio_id: 's1',
      dropoff_address: 'addr',
      dropoff_lon: '39.7',
      dropoff_lat: '47.2',
      weight_grams: 120,
      price_rub: '300.00',
    });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await createYandexClaim('ORD-1');
    expect(res).toEqual({ created: false, claimId: 'existing-claim' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('claim_id NULL → create-claim + UPDATE строки', async () => {
    db.queryOne
      .mockResolvedValueOnce({
        order_id: 'ORD-2',
        claim_id: null,
        source_studio_id: 's1',
        dropoff_address: 'addr',
        dropoff_lon: '39.72',
        dropoff_lat: '47.24',
        weight_grams: 120,
        price_rub: '400.00',
      })
      .mockResolvedValueOnce({ lon: 39.7015, lat: 47.2357 }); // координаты студии
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'new-claim-123', pricing: { final_price: '371.00' } }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    db.query.mockResolvedValue([]);

    const res = await createYandexClaim('ORD-2');
    expect(res.created).toBe(true);
    expect(res.claimId).toBe('new-claim-123');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/b2b/cargo/integration/v2/claims/create');
    expect(url).toContain('request_id=claim-ORD-2'); // идемпотентный request_id
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer test-token');

    // UPDATE пишет claim_id/status='created'/real_price, гард claim_id IS NULL
    const updateSql = db.query.mock.calls[0][0] as string;
    const updateParams = db.query.mock.calls[0][1] as unknown[];
    expect(updateSql).toMatch(/UPDATE delivery_shipments/i);
    expect(updateSql).toMatch(/claim_id IS NULL/i);
    expect(updateParams[0]).toBe('new-claim-123');
    expect(updateParams[2]).toBe(371); // real_price_rub
  });

  it('нет активной отправки → throw', async () => {
    db.queryOne.mockResolvedValueOnce(null);
    await expect(createYandexClaim('ORD-X')).rejects.toThrow(/не найдена активная отправка/i);
  });

  it('студия без валидных координат → throw', async () => {
    db.queryOne
      .mockResolvedValueOnce({
        order_id: 'ORD-3',
        claim_id: null,
        source_studio_id: 's-bad',
        dropoff_address: 'addr',
        dropoff_lon: '39.72',
        dropoff_lat: '47.24',
        weight_grams: 120,
        price_rub: '400.00',
      })
      .mockResolvedValueOnce(null); // студия не найдена / нет координат
    await expect(createYandexClaim('ORD-3')).rejects.toThrow(/координат/i);
  });
});

// ---------------------------------------------------------------------------
// cancelClaim
// ---------------------------------------------------------------------------
describe('cancelClaim', () => {
  it('POST на claims/cancel с claim_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await cancelClaim('cl-1', 'отмена клиентом');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/b2b/cargo/integration/v2/claims/cancel');
    expect(url).toContain('claim_id=cl-1');
  });

  it('HTTP-ошибка → throw', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => 'conflict',
    }) as unknown as typeof fetch;
    await expect(cancelClaim('cl-2')).rejects.toThrow(/cancel-claim HTTP 409/i);
  });
});

// ---------------------------------------------------------------------------
// calculateParcelWeight (реэкспорт weight-calculator)
// ---------------------------------------------------------------------------
describe('calculateParcelWeight', () => {
  it('считает вес через существующий калькулятор (260 г/м² + 55г упаковки)', () => {
    // 10x15: ~3.9 г/лист; 2 листа + 55г упаковки ≈ 63г, округление вверх
    const w = calculateParcelWeight([{ format: '10x15', quantity: 2 }]);
    expect(w).toBeGreaterThan(55);
    expect(Number.isInteger(w)).toBe(true);
  });
});
