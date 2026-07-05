import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { Readable } from 'stream';

const { mockDb, mockPool } = vi.hoisted(() => {
  const mockDb = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn().mockImplementation(async (fn: (c: unknown) => unknown) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) })),
    getClient: vi.fn(), getPool: vi.fn(), close: vi.fn(),
  };
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn(), end: vi.fn() };
  return { mockDb, mockPool };
});

vi.mock('../database/db.js', () => ({ default: mockDb, pool: mockPool }));
vi.mock('../services/redis-factory.js', () => {
  const redisClient = {
    status: 'end',
    on: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    call: vi.fn(async (...args: string[]) => {
      if (args[0] === 'SCRIPT' && args[1] === 'LOAD') return 'sha-test';
      if (args[0] === 'EVALSHA') return [1, 15 * 60 * 1000];
      return 1;
    }),
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
  };
  return {
    createResilientRedis: vi.fn(() => redisClient),
    createLazyRedis: vi.fn(() => () => redisClient),
    isRedisReady: vi.fn(() => false),
  };
});
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '' },
    guestSession: { secret: 'guest-secret-for-tests' },
    // Курьерская доставка включена в тестах, чтобы проверить серверный пересчёт цены (P0-2).
    yandexDelivery: { enabled: true, token: 'test', baseUrl: 'https://b2b.test', webhookSecret: '', taxiClass: 'courier' },
  },
}));

// ─── Моки сервисного слоя доставки (S2) — серверный пересчёт цены/зоны (P0-2/P1-4) ──
const { mockValidateAddress, mockSelectNearestStudio, mockResolveZone, mockCheckPrice } = vi.hoisted(() => ({
  mockValidateAddress: vi.fn(),
  mockSelectNearestStudio: vi.fn(),
  mockResolveZone: vi.fn(),
  mockCheckPrice: vi.fn(),
}));
vi.mock('../services/delivery.service.js', () => ({
  validateAddress: mockValidateAddress,
}));
vi.mock('../services/delivery/source-studio.service.js', () => ({
  selectNearestStudio: mockSelectNearestStudio,
}));
vi.mock('../services/delivery/zone-resolver.service.js', () => ({
  resolveZone: mockResolveZone,
}));
vi.mock('../services/delivery/yandex-delivery.service.js', () => ({
  checkPrice: mockCheckPrice,
  // Нормализация координат и вес — настоящая логика не нужна в этом тесте, мокаем тривиально.
  normalizeLonLat: (lon: number | string, lat: number | string) => [Number(lon), Number(lat)],
  calculateParcelWeight: () => 110,
}));
vi.mock('../middleware/telegramAuth.js', () => ({
  requireTelegramAuth: (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
}));
vi.mock('../services/task-auto.service.js', () => ({
  createTaskFromWalkIn: vi.fn().mockResolvedValue(undefined),
  createTaskFromOrder: vi.fn().mockResolvedValue({ id: 'task-1' }),
}));
vi.mock('../services/photo-processor.service.js', () => ({
  processPhotosForPrint: vi.fn().mockResolvedValue(undefined),
  formatFileSize: vi.fn().mockReturnValue('1 MB'),
}));
vi.mock('../services/visitor-push.service.js', () => ({ sendVisitorChatPush: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/email.service.js', () => ({ sendOrderStatusUpdate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/payment.service.js', () => ({
  notifyChatOrderPaidService: vi.fn().mockResolvedValue(undefined),
  syncChatPaymentCardStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/crm-event-queue.service.js', () => ({ enqueueCrmEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/post-payment-queue.service.js', () => ({ enqueuePostPaymentJobs: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/employee-gamification.service.js', () => ({ awardXP: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../utils/secure-random.js', () => ({
  generateOrderId: vi.fn().mockReturnValue('SF-TEST-001'),
  secureRandomString: vi.fn().mockReturnValue('random-string-123'),
}));
vi.mock('../services/queue.service.js', () => ({
  recalculateQueue: vi.fn().mockResolvedValue(undefined),
  updateEstimatedTimes: vi.fn().mockResolvedValue(undefined),
  recordStatusChange: vi.fn().mockResolvedValue(undefined),
  getStatusHistory: vi.fn().mockResolvedValue([]),
  getQueuePosition: vi.fn().mockResolvedValue(null),
  getQueueStats: vi.fn().mockResolvedValue({ total: 0 }),
}));
vi.mock('../services/pos.service.js', () => ({
  getCurrentShift: vi.fn().mockResolvedValue(null),
  createReceipt: vi.fn().mockResolvedValue(undefined),
  calculateSubscriptionCoverageWithClient: vi.fn(),
}));
vi.mock('../services/subscription.service.js', () => ({
  EDUCATION_ACCESS_PLAN_SLUG: 'education-monthly-199',
  EDUCATION_ACCESS_PLAN_SLUGS: ['education-monthly-199', 'education-yearly-199'],
  checkSubscription: vi.fn().mockResolvedValue(null),
  checkSubscriptionByUserId: vi.fn().mockResolvedValue(null),
  useCreditsWithClient: vi.fn().mockResolvedValue({ used: 1, remaining: 0 }),
  restoreCreditsForPrintOrderWithClient: vi.fn().mockResolvedValue({ restored: 0 }),
}));
vi.mock('../services/customer.service.js', () => ({ findOrCreateCustomer: vi.fn().mockResolvedValue({ id: 'cust-1' }) }));
// ─── Моки для врезки задачи ретуши «Супер обработки» в /crm-create (P1-1) ──────
const { mockCreateRetouchTaskFromCrm, mockResolveRetouchConfig } = vi.hoisted(() => ({
  mockCreateRetouchTaskFromCrm: vi.fn(),
  mockResolveRetouchConfig: vi.fn(),
}));
vi.mock('../services/retouch.service.js', () => ({
  createRetouchTaskFromCrm: mockCreateRetouchTaskFromCrm,
}));
vi.mock('../services/retouch-checklist.service.js', () => ({
  resolveRetouchConfig: mockResolveRetouchConfig,
}));
vi.mock('../services/sla.service.js', () => ({
  computeSlaFromOrderItems: vi.fn().mockResolvedValue(60),
}));
vi.mock('../services/business-observability.service.js', () => ({
  recordBusinessEvent: vi.fn(),
}));
// ─── Моки чат-уведомлений (notifyChatOrderReadyEstimate / notifyChatSuperRetouch) ─
const { mockBroadcastChatMessage, mockEnqueueOutbound } = vi.hoisted(() => ({
  mockBroadcastChatMessage: vi.fn(),
  mockEnqueueOutbound: vi.fn(),
}));
vi.mock('../services/chat-broadcast.service.js', () => ({
  broadcastChatMessage: mockBroadcastChatMessage,
}));
vi.mock('../services/connectors/pipeline/outbound-worker.js', () => ({
  enqueueOutbound: mockEnqueueOutbound,
}));
vi.mock('../services/service-attribution-forward.js', () => ({
  captureOrderServiceAttribution: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/storage.service.js', () => ({
  storageService: {
    saveFile: vi.fn(),
    deleteFile: vi.fn(),
    resolveSignedUrl: vi.fn(async (url: string) => `signed:${url}`),
    generatePresignedPutUrl: vi.fn(),
    headObject: vi.fn(),
    getReadStream: vi.fn(async () => Readable.from(Buffer.from('photo-data'))),
    getPublicUrl: vi.fn((key: string) => `https://svoefoto.ru/media/${key}`),
    keyFromUrl: vi.fn((url: string) => {
      const prefix = 'https://svoefoto.ru/media/';
      return url.startsWith(prefix) ? url.slice(prefix.length) : null;
    }),
  },
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./photo-print-orders.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeClientUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';
import { calculateSubscriptionCoverageWithClient } from '../services/pos.service.js';
import { restoreCreditsForPrintOrderWithClient, useCreditsWithClient } from '../services/subscription.service.js';
import { storageService } from '../services/storage.service.js';
import { recordStatusChange } from '../services/queue.service.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };
const DB_CLIENT = { id: 'client-id', email: 'client@example.com', role: 'client', is_active: true, display_name: 'Client', phone: '+79001234567', force_password_change: false, last_password_change: null };

const ORDER = { id: 'SF-TEST-001', order_id: 'SF-TEST-001', status: 'processing', contact_name: 'Иван', total_price: 500, created_at: new Date().toISOString() };
const SUBSCRIPTION_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '81476759-8e40-4d50-a15b-556f3f8a3368';

const SUBSCRIPTION_COVERAGE = {
  subscription_id: SUBSCRIPTION_ID,
  total_covered_amount: 19.5,
  total_credits_consumed: 1,
  items: [
    {
      index: 0,
      product_id: PRODUCT_ID,
      credit_product_id: PRODUCT_ID,
      product_name: 'Фотобумага 10x15 Premium',
      quantity: 1,
      credit_multiplier: 1,
      coverage_multiplier: 1,
      coverage_percent: null,
      covered_quantity: 1,
      remaining_quantity: 0,
      credits_consumed: 1,
      covered_amount: 19.5,
    },
  ],
};

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockDb.transaction).mockReset().mockImplementation(async (fn: (c: unknown) => unknown) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
  vi.mocked(calculateSubscriptionCoverageWithClient).mockReset().mockResolvedValue(SUBSCRIPTION_COVERAGE);
  vi.mocked(useCreditsWithClient).mockReset().mockResolvedValue({ used: 1, remaining: 0 });
  vi.mocked(restoreCreditsForPrintOrderWithClient).mockReset().mockResolvedValue({ restored: 0, entries: 0 });
  vi.mocked(recordStatusChange).mockReset().mockResolvedValue(undefined);
  vi.mocked(storageService.getReadStream).mockReset().mockImplementation(async () => Readable.from(Buffer.from('photo-data')));
  // Сбрасываем моки доставки (по умолчанию неактивны — настраиваются в тестах курьера).
  mockValidateAddress.mockReset().mockResolvedValue(null);
  mockSelectNearestStudio.mockReset();
  mockResolveZone.mockReset();
  mockCheckPrice.mockReset();
  // Моки врезки ретуши.
  mockCreateRetouchTaskFromCrm.mockReset().mockResolvedValue({ id: 'retouch-task-1', task_number: 1, status: 'open' });
  mockResolveRetouchConfig.mockReset().mockResolvedValue({ options: [], notes: null, gender: 'any' });
  // Моки чат-уведомлений (fire-and-forget).
  mockBroadcastChatMessage.mockReset().mockResolvedValue(undefined);
  mockEnqueueOutbound.mockReset().mockResolvedValue(undefined);
}

// ─── POST /upload — upload photo ──────────────────────────────────────────────
describe('POST /upload — upload photo for print', () => {
  beforeEach(resetMocks);

  it('returns 400 if no file', async () => {
    const res = await request(app).post('/upload').send({});
    expect(res.status).toBe(400);
  });
});

// ─── POST / — create order ────────────────────────────────────────────────────
describe('POST / — create print order', () => {
  beforeEach(resetMocks);

  it('returns 400 if contact name missing', async () => {
    const res = await request(app)
      .post('/')
      .send({ items: [{ uploadedUrl: '/uploads/photo.jpg' }], totalPrice: 500 });
    expect(res.status).toBe(400);
  });

  it('returns 400 if phone is invalid', async () => {
    const res = await request(app)
      .post('/')
      .send({
        items: [{ uploadedUrl: '/uploads/photo.jpg' }],
        totalPrice: 500,
        contact: { name: 'Иван', phone: '123' },
      });
    expect(res.status).toBe(400);
  });

  it('returns 400 if items are empty', async () => {
    const res = await request(app)
      .post('/')
      .send({
        items: [],
        totalPrice: 0,
        contact: { name: 'Иван Иванов', phone: '+79001234567' },
      });
    expect(res.status).toBe(400);
  });

  it('creates order and returns 201', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(ORDER); // INSERT

    const res = await request(app)
      .post('/')
      .send({
        items: [{ uploadedUrl: '/uploads/photo1.jpg', count: 1 }],
        totalPrice: 400,
        contact: { name: 'Иван Иванов', phone: '+79001234567' },
        mode: 'standard',
        source: 'website',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orderId).toBeDefined();
  });

  // ─── Курьерская доставка: серверный пересчёт цены (P0-2 / P1-4) ──────────────
  describe('courier delivery — server-side price recompute', () => {
    /** Настроить «здоровый» путь доставки: адрес в Ростове, зона 1, цена 300. */
    function arrangeHealthyDelivery(opts?: { zonePriceRub?: number; minOrderRub?: number; zoneId?: number }) {
      mockValidateAddress.mockResolvedValue({
        result: 'г Ростов-на-Дону, ул Большая Садовая, д 1',
        city: 'Ростов-на-Дону', region: 'Ростовская', postalCode: '344002',
        geoLat: '47.222531', geoLon: '39.718705', qc: 0,
        streetWithType: 'ул Большая Садовая', house: '1', flat: null,
      });
      mockSelectNearestStudio.mockResolvedValue({
        studioId: 'studio-soborny', locationCode: 'soborny',
        lon: 39.71, lat: 47.22, distanceMeters: 1200,
      });
      mockCheckPrice.mockResolvedValue({ priceRub: 287.5, distanceMeters: 1200, etaMinutes: 25 });
      mockResolveZone.mockResolvedValue({
        zoneId: opts?.zoneId ?? 1, name: 'Зона 1 (центр)',
        priceRub: opts?.zonePriceRub ?? 300, minOrderRub: opts?.minOrderRub ?? 0,
        taxiClass: 'courier', maxDistanceM: 5000,
      });
    }

    /** Достать массив значений из вызова INSERT в photo_print_orders. */
    function insertOrderValues(): unknown[] | null {
      const call = vi.mocked(mockDb.queryOne).mock.calls.find(
        ([sql]) => String(sql).includes('INSERT INTO photo_print_orders'),
      );
      return call ? (call[1] as unknown[]) : null;
    }

    it('overrides a lowballed client delivery price with the server zone price (P0-2)', async () => {
      arrangeHealthyDelivery({ zonePriceRub: 300, minOrderRub: 0 });
      vi.mocked(mockDb.queryOne).mockResolvedValueOnce(ORDER); // INSERT RETURNING *
      vi.mocked(mockDb.query).mockResolvedValue([]); // shipment INSERT

      const res = await request(app)
        .post('/')
        .send({
          items: [{ uploadedUrl: '/uploads/p.jpg', format: '10x15', paperType: 'glossy', quantity: 5 }],
          totalPrice: 1000,
          contact: { name: 'Иван Иванов', phone: '+79001234567' },
          mode: 'simple',
          source: 'website',
          // Клиент пытается занизить доставку до 1 ₽ + шлёт фейковые координаты — должно игнорироваться.
          delivery: { method: 'courier', address: 'Ростов, Большая Садовая 1', coordinates: [0, 0] },
        });

      expect(res.status).toBe(201);

      const values = insertOrderValues();
      expect(values).not.toBeNull();
      // Параметры INSERT (1-based в SQL): $7 total_price, $11 delivery_method, $19 delivery_cost,
      // $20 delivery_provider, $21 delivery_zone → индексы массива 6/10/18/19/20.
      const totalPrice = values![6];
      const deliveryMethod = values![10];
      const deliveryCost = values![18];
      const deliveryProvider = values![19];
      const deliveryZone = values![20];

      // Цена доставки — серверная зональная (300), НЕ клиентская (1).
      expect(Number(deliveryCost)).toBe(300);
      // total_price пересобран: печать (1000) + доставка (300).
      expect(Number(totalPrice)).toBe(1300);
      expect(deliveryMethod).toBe('courier');
      expect(deliveryProvider).toBe('yandex');
      expect(deliveryZone).toBe(1);
      // Ответ клиенту тоже отражает серверный итог.
      expect(Number(res.body.data.totalPrice)).toBe(1300);
      expect(Number(res.body.data.deliveryCost)).toBe(300);
      // Координаты резолвятся серверно (DaData), клиентские [0,0] — не используются.
      expect(mockValidateAddress).toHaveBeenCalledWith('Ростов, Большая Садовая 1');
      expect(mockSelectNearestStudio).toHaveBeenCalledWith(39.718705, 47.222531);
    });

    it('rejects with 422 when print subtotal is below the zone min_order (P1-4)', async () => {
      // Зона 4 (за Доном): мин. заказ 3000 ₽. Печать всего 500 ₽ → ниже порога.
      arrangeHealthyDelivery({ zoneId: 4, zonePriceRub: 550, minOrderRub: 3000 });

      const res = await request(app)
        .post('/')
        .send({
          items: [{ uploadedUrl: '/uploads/p.jpg', format: '10x15', paperType: 'glossy', quantity: 2 }],
          totalPrice: 500,
          contact: { name: 'Иван Иванов', phone: '+79001234567' },
          mode: 'simple',
          source: 'website',
          delivery: { method: 'courier', address: 'Ростов, Левобережная 10' },
        });

      expect(res.status).toBe(422);
      // Заказ не вставлен (упали до INSERT).
      expect(insertOrderValues()).toBeNull();
    });

    it('rejects with 422 for an address outside Rostov', async () => {
      mockValidateAddress.mockResolvedValue({
        result: 'г Москва, ул Тверская, д 1',
        city: 'Москва', region: 'Москва', postalCode: '125009',
        geoLat: '55.76', geoLon: '37.61', qc: 0,
        streetWithType: 'ул Тверская', house: '1', flat: null,
      });

      const res = await request(app)
        .post('/')
        .send({
          items: [{ uploadedUrl: '/uploads/p.jpg', format: '10x15', paperType: 'glossy', quantity: 5 }],
          totalPrice: 1000,
          contact: { name: 'Иван Иванов', phone: '+79001234567' },
          mode: 'simple',
          source: 'website',
          delivery: { method: 'courier', address: 'Москва, Тверская 1' },
        });

      expect(res.status).toBe(422);
      expect(mockSelectNearestStudio).not.toHaveBeenCalled();
    });
  });
});

// ─── POST /crm-create — задача ретуши «Супер обработки» (P1-1) ────────────────
describe('POST /crm-create — retouch task fire-and-forget for processing-super', () => {
  beforeEach(resetMocks);

  // UUID заказа (photo_print_orders.id) — то, что должно уйти в print_order_id.
  // НЕ путать с человекочитаемым order_id (CRM-YYMMDD-XXXX).
  const NEW_ORDER_UUID = '33333333-3333-4333-8333-333333333333';

  /**
   * Настроить транзакцию crm-create: pool.connect → клиент, отвечающий на BEGIN/
   * INSERT photo_print_orders (RETURNING id, order_id) / order_items / COMMIT.
   * Возвращает order_id, сгенерированный роутом (для сверки с order_id_label).
   */
  function arrangeCrmTransaction(): void {
    const pgClient = {
      query: vi.fn(async (sql: string) => {
        if (String(sql).includes('INSERT INTO photo_print_orders')) {
          // RETURNING id, order_id — id это UUID, order_id берётся роутом из orderId.
          return { rows: [{ id: NEW_ORDER_UUID, order_id: 'CRM-PLACEHOLDER' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    vi.mocked(mockPool.connect).mockResolvedValue(pgClient as never);
  }

  /** Достать аргумент, переданный в createRetouchTaskFromCrm (первый вызов). */
  function retouchTaskArg(): Record<string, unknown> | undefined {
    return mockCreateRetouchTaskFromCrm.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
  }

  it('создаёт задачу ретуши с print_order_id = UUID заказа (НЕ человекочитаемый order_id)', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth lookup
    // findActiveEmployeeShiftForOrder → null (нет активной смены) — дефолтный queryOne.
    arrangeCrmTransaction();
    mockResolveRetouchConfig.mockResolvedValue({
      options: [{ group: 'skin', group_name: 'Кожа', slug: 'skin-cleanup', label: 'Чистка кожи' }],
      notes: 'аккуратно',
      gender: 'female',
    });

    const res = await request(app)
      .post('/crm-create')
      .set(authHeader(emp))
      .send({
        items: [
          { name: 'Печать 10x15', slug: 'print-10x15', quantity: 1, price: 100 },
          { name: 'Супер обработка', slug: 'processing-super', quantity: 1, price: 3000 },
        ],
        total_price: 3100,
        client_name: 'Иван Петров',
        client_phone: '+79991234567',
        retouch_config: { gender: 'female', groups: { skin: ['skin-cleanup'] }, notes: 'аккуратно' },
      });

    expect(res.status).toBe(201);
    const orderId = res.body.data.orderId as string;
    expect(orderId).toMatch(/^CRM-/); // человекочитаемый ярлык

    // resolveRetouchConfig вызван с переданным retouch_config.
    expect(mockResolveRetouchConfig).toHaveBeenCalledWith(
      expect.objectContaining({ gender: 'female', groups: { skin: ['skin-cleanup'] }, notes: 'аккуратно' }),
    );

    // Задача ретуши создана РОВНО один раз.
    expect(mockCreateRetouchTaskFromCrm).toHaveBeenCalledTimes(1);
    const arg = retouchTaskArg();
    // print_order_id — UUID заказа из INSERT RETURNING, НЕ человекочитаемый ярлык.
    expect(arg?.print_order_id).toBe(NEW_ORDER_UUID);
    expect(arg?.print_order_id).not.toBe(orderId);
    // order_id_label — это строковый orderId (CRM-YYMMDD-XXXX).
    expect(arg?.order_id_label).toBe(orderId);
    // Резолвнутые опции/пол/заметки прокинуты.
    expect(arg?.gender).toBe('female');
    expect(arg?.notes).toBe('аккуратно');
    expect(arg?.retouch_options).toEqual([
      { group: 'skin', group_name: 'Кожа', slug: 'skin-cleanup', label: 'Чистка кожи' },
    ]);
    expect(arg?.created_by).toBe(emp.id);
  });

  it('создаёт заказ (201) и задачу с fallback, если resolveRetouchConfig бросает (fire-and-forget не роняет заказ)', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    arrangeCrmTransaction();
    mockResolveRetouchConfig.mockRejectedValue(new Error('catalog down'));

    const res = await request(app)
      .post('/crm-create')
      .set(authHeader(emp))
      .send({
        items: [{ name: 'Супер обработка', slug: 'processing-super', quantity: 1, price: 3000 }],
        total_price: 3000,
        client_name: 'Мария',
        retouch_config: { groups: { skin: ['skin-cleanup'] } },
      });

    // Заказ всё равно создан, ошибка резолва не повалила запрос.
    expect(res.status).toBe(201);
    // Задача создана с fallback-конфигом.
    expect(mockCreateRetouchTaskFromCrm).toHaveBeenCalledTimes(1);
    const arg = retouchTaskArg();
    expect(arg?.gender).toBe('any');
    expect(arg?.retouch_options).toEqual([]);
    expect(arg?.notes).toBeNull();
    expect(arg?.print_order_id).toBe(NEW_ORDER_UUID);
  });

  it('НЕ создаёт задачу ретуши, если среди items нет processing-super', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    arrangeCrmTransaction();

    const res = await request(app)
      .post('/crm-create')
      .set(authHeader(emp))
      .send({
        items: [
          { name: 'Печать 10x15', slug: 'print-10x15', quantity: 2, price: 100 },
          { name: 'Базовая обработка', slug: 'processing-basic', quantity: 1, price: 500 },
        ],
        total_price: 700,
        client_name: 'Олег',
      });

    expect(res.status).toBe(201);
    expect(mockResolveRetouchConfig).not.toHaveBeenCalled();
    expect(mockCreateRetouchTaskFromCrm).not.toHaveBeenCalled();
  });

  it('при processing-super + chat_session_id шлёт клиенту intro-сообщение про Супер обработку (S4)', async () => {
    const emp = makeEmployeeUser();
    arrangeCrmTransaction();

    // Все INSERT INTO messages пишем в журнал и возвращаем строку, чтобы notifyChat*
    // не упали на `!msg`. Auth-lookup → сотрудник, SELECT conversations → web (без outbound).
    const insertedMessages: { content: string; metadata: string }[] = [];
    let msgSeq = 0;
    vi.mocked(mockDb.queryOne).mockImplementation(async (sql: unknown, params?: unknown) => {
      const text = String(sql);
      if (text.includes('FROM users WHERE id')) return DB_EMPLOYEE as never;
      if (text.includes('INSERT INTO messages')) {
        const p = (params as unknown[]) ?? [];
        insertedMessages.push({ content: String(p[1] ?? ''), metadata: String(p[2] ?? '') });
        msgSeq += 1;
        return {
          id: `msg-${msgSeq}`,
          conversation_id: String(p[0] ?? ''),
          sender_type: 'bot',
          sender_name: 'Своё Фото',
          message_type: 'text',
          content: String(p[1] ?? ''),
          created_at: new Date().toISOString(),
        } as never;
      }
      // SELECT conversations → web-канал: outbound для мессенджеров не вызывается.
      if (text.includes('FROM conversations WHERE id')) {
        return { channel: 'web', external_chat_id: null } as never;
      }
      return null;
    });

    const res = await request(app)
      .post('/crm-create')
      .set(authHeader(emp))
      .send({
        items: [
          { name: 'Печать 10x15', slug: 'print-10x15', quantity: 1, price: 100 },
          { name: 'Супер обработка', slug: 'processing-super', quantity: 1, price: 3000 },
        ],
        total_price: 3100,
        client_name: 'Анна',
        client_phone: '+79990001122',
        chat_session_id: '44444444-4444-4444-8444-444444444444',
      });

    expect(res.status).toBe(201);

    // Среди вставленных bot-сообщений есть intro про Супер обработку.
    const superMsg = insertedMessages.find(m => m.metadata.includes('super_retouch_intro'));
    expect(superMsg).toBeDefined();
    expect(superMsg!.content).toContain('Супер обработку');
    expect(superMsg!.content).toContain('10 вариантов ретуши');
    expect(superMsg!.content).toContain('Своё Фото');
    // Копи без длинного тире и markdown-звёздочек.
    expect(superMsg!.content).not.toContain('—');
    expect(superMsg!.content).not.toContain('**');

    // Сообщение ушло в CRM-бродкаст (web-канал → без outbound в мессенджеры).
    expect(mockBroadcastChatMessage).toHaveBeenCalled();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });

  it('НЕ шлёт intro про Супер, если processing-super есть, но chat_session_id отсутствует', async () => {
    const emp = makeEmployeeUser();
    arrangeCrmTransaction();

    const insertedMessages: string[] = [];
    vi.mocked(mockDb.queryOne).mockImplementation(async (sql: unknown, params?: unknown) => {
      const text = String(sql);
      if (text.includes('FROM users WHERE id')) return DB_EMPLOYEE as never;
      if (text.includes('INSERT INTO messages')) {
        insertedMessages.push(String(((params as unknown[]) ?? [])[2] ?? ''));
        return { id: 'm', conversation_id: 'c', sender_type: 'bot', sender_name: 'Своё Фото', message_type: 'text', content: '', created_at: new Date().toISOString() } as never;
      }
      return null;
    });

    const res = await request(app)
      .post('/crm-create')
      .set(authHeader(emp))
      .send({
        items: [{ name: 'Супер обработка', slug: 'processing-super', quantity: 1, price: 3000 }],
        total_price: 3000,
        client_name: 'Без чата',
      });

    expect(res.status).toBe(201);
    // Без chat_session_id ни ready-estimate, ни super-intro не отправляются.
    expect(insertedMessages.some(m => m.includes('super_retouch_intro'))).toBe(false);
    expect(mockBroadcastChatMessage).not.toHaveBeenCalled();
  });
});

// ─── GET /queue-stats — queue statistics ──────────────────────────────────────
describe('GET /queue-stats — queue statistics', () => {
  beforeEach(resetMocks);

  it('returns queue stats publicly', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ total: 5, avg_wait: 30 }]);

    const res = await request(app).get('/queue-stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /track/:orderId — order tracking ─────────────────────────────────────
describe('GET /track/:orderId — order tracking', () => {
  beforeEach(resetMocks);

  it('returns 404 for unknown order', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);
    const res = await request(app).get('/track/SF-UNKNOWN-001');
    expect(res.status).toBe(404);
  });

  it('returns order tracking data', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(ORDER);
    vi.mocked(mockDb.query).mockResolvedValueOnce([]); // status history

    const res = await request(app).get('/track/SF-TEST-001');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /staff-list — staff order view ───────────────────────────────────────
describe('GET /staff-list — staff order list', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/staff-list');
    expect(res.status).toBe(401);
  });

  it('returns orders for employee with pos:use', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([ORDER]);

    const res = await request(app).get('/staff-list').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('filters staff orders by chat_session_id', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce({ count: '0' });
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/staff-list?chat_session_id=session-42&limit=10')
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    const countCall = vi.mocked(mockDb.queryOne).mock.calls.find(([sql]) => String(sql).includes('COUNT(*)'));
    const listCall = vi.mocked(mockDb.query).mock.calls.find(([sql]) => String(sql).includes('SELECT p.order_id'));
    expect(String(countCall?.[0])).toContain('p.chat_session_id = $1');
    expect(countCall?.[1]).toEqual(['session-42']);
    expect(String(listCall?.[0])).toContain('p.chat_session_id = $1');
    expect(listCall?.[1]).toEqual(['session-42', 10, 0]);
  });

  it('returns signed S3 URLs for staff photo previews and downloads', async () => {
    const emp = makeEmployeeUser();
    const order = {
      ...ORDER,
      items: [{ uploadedUrl: 'https://svoefoto.ru/media/print/photo.jpeg', format: '10x15', quantity: 1 }],
      photo_url: 'https://svoefoto.ru/media/chat/latest.jpeg',
    };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce({ count: '1' });
    vi.mocked(mockDb.query).mockResolvedValueOnce([order]);

    const res = await request(app).get('/staff-list').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.data[0].items[0].uploadedUrl)
      .toMatch(/^https:\/\/svoefoto\.ru\/media\/print\/photo\.jpeg\?exp=\d+&sig=[A-Za-z0-9_-]+$/);
    expect(res.body.data[0].photo_url)
      .toMatch(/^https:\/\/svoefoto\.ru\/media\/chat\/latest\.jpeg\?exp=\d+&sig=[A-Za-z0-9_-]+$/);
  });
});

// ─── GET /:orderId/download-photos — staff photo archive ─────────────────────
describe('GET /:orderId/download-photos — staff photo archive', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/PP-260511-AV6Q/download-photos');
    expect(res.status).toBe(401);
  });

  it('streams a ZIP archive with uploaded print photos', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce({
        order_id: 'PP-260511-AV6Q',
        contact_name: 'Анастасия',
        items: [
          { uploadedUrl: 'https://svoefoto.ru/media/print/a.jpeg', format: '10x15', paperType: 'matte' },
          { uploadedUrl: 'https://svoefoto.ru/media/print/b.jpeg', format: '10x15', paperType: 'matte' },
        ],
      });

    const res = await request(app).get('/PP-260511-AV6Q/download-photos').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('PP-260511-AV6Q-photos.zip');
    expect(storageService.getReadStream).toHaveBeenCalledWith('print/a.jpeg');
    expect(storageService.getReadStream).toHaveBeenCalledWith('print/b.jpeg');
  });
});

// ─── GET /:orderId — order detail ─────────────────────────────────────────────
describe('GET /:orderId — order detail (public)', () => {
  beforeEach(resetMocks);

  it('returns 404 for unknown order', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);
    const res = await request(app).get('/SF-UNKNOWN');
    expect(res.status).toBe(404);
  });

  it('returns order detail', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(ORDER);

    const res = await request(app).get('/SF-TEST-001');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── DELETE /:orderId — staff order deletion ────────────────────────────────
describe('DELETE /:orderId — staff order deletion', () => {
  beforeEach(resetMocks);

  it('deletes a removable order without comparing UUID columns to public order numbers', async () => {
    const emp = makeEmployeeUser();
    const dbOrderId = '11111111-1111-4111-8111-111111111111';
    const orderId = 'CRM-260504-L9V8';
    const txQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce({
        id: dbOrderId,
        order_id: orderId,
        status: 'new',
        payment_status: 'pending',
        chat_session_id: null,
      })
      .mockResolvedValueOnce({
        print_jobs_count: 0,
        production_orders_count: 0,
        pos_receipts_count: 0,
        pos_transactions_count: 0,
        payment_events_count: 0,
        payment_installments_count: 0,
        refund_requests_count: 0,
        priority_purchases_count: 0,
        promo_redemptions_count: 0,
        subscription_credit_usage_count: 0,
        student_discount_redemptions_count: 0,
      });
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn: (c: unknown) => unknown) => fn({ query: txQuery }));

    const res = await request(app)
      .delete(`/${orderId}`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const blockersSql = String(mockDb.queryOne.mock.calls[2]?.[0]);
    expect(blockersSql).toContain('FROM promo_redemptions WHERE order_id = $1');
    expect(blockersSql).not.toContain('order_id IN ($1::text, $2)');

    const approvalUpdateCall = txQuery.mock.calls.find(([sql]) => String(sql).includes('photo_approval_sessions'));
    expect(approvalUpdateCall).toBeDefined();
    expect(String(approvalUpdateCall?.[0])).toContain('WHERE order_id = $1');
    expect(approvalUpdateCall?.[1]).toEqual([dbOrderId]);
  });
});

// ─── PUT /:orderId/status — staff status update ─────────────────────────────
describe('PUT /:orderId/status — staff status update', () => {
  beforeEach(resetMocks);

  it('completes an order, syncs assignment status, and records the previous order status', async () => {
    const emp = makeEmployeeUser();
    const orderId = 'CRM-260511-YH3N';
    const txQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'photo-order-db-id',
          order_id: orderId,
          status: 'completed',
          old_status: 'ready',
          estimated_ready_at: null,
          chat_session_id: null,
          contact_email: null,
          processing_started_at: new Date().toISOString(),
          processing_duration_minutes: 9,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn: (c: unknown) => unknown) => fn({ query: txQuery }));

    const res = await request(app)
      .put(`/${orderId}/status`)
      .set(authHeader(emp))
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updateSql = String(txQuery.mock.calls[0]?.[0]);
    expect(updateSql).toContain('status AS old_status');
    expect(updateSql).toContain('FOR UPDATE');

    const assignmentSql = String(txQuery.mock.calls[2]?.[0]);
    expect(assignmentSql).toContain('status = $1::text');
    expect(assignmentSql).toContain('CASE WHEN $4::boolean');
    expect(txQuery.mock.calls[2]?.[1]).toEqual(['completed', emp.id, orderId, true]);
    expect(recordStatusChange).toHaveBeenCalledWith({
      orderId,
      oldStatus: 'ready',
      newStatus: 'completed',
      changedBy: emp.id,
    });
    expect(res.body.data).not.toHaveProperty('old_status');
  });

  it('cancels an order without refunding subscription credits or payment state', async () => {
    const emp = makeEmployeeUser();
    const orderId = 'CRM-260511-4TCP';
    const txQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'photo-order-db-id',
          order_id: orderId,
          status: 'cancelled',
          old_status: 'processing',
          estimated_ready_at: null,
          chat_session_id: null,
          contact_email: null,
          processing_started_at: null,
          processing_duration_minutes: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn: (c: unknown) => unknown) => fn({ query: txQuery }));

    const res = await request(app)
      .put(`/${orderId}/status`)
      .set(authHeader(emp))
      .send({ status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const orderUpdateSql = String(txQuery.mock.calls[0]?.[0]);
    expect(orderUpdateSql).not.toContain('payment_status');
    expect(restoreCreditsForPrintOrderWithClient).not.toHaveBeenCalled();

    const assignmentSql = String(txQuery.mock.calls[2]?.[0]);
    expect(assignmentSql).toContain('status = $1::text');
    expect(txQuery.mock.calls[2]?.[1]).toEqual(['cancelled', emp.id, orderId, false]);
    expect(recordStatusChange).toHaveBeenCalledWith({
      orderId,
      oldStatus: 'processing',
      newStatus: 'cancelled',
      changedBy: emp.id,
    });
  });
});

// ─── PUT /:orderId/record-payment — staff payment recording ─────────────────
describe('PUT /:orderId/record-payment — staff payment recording', () => {
  beforeEach(resetMocks);

  it('rejects card payment recording without a linked POS receipt', async () => {
    const emp = makeEmployeeUser();
    const orderId = 'CRM-260511-CARD';
    const existingOrder = {
      id: 'photo-order-db-id',
      payment_status: 'pending',
      status: 'pending_payment',
      total_price: 800,
      items: [{ name: 'A3 фоторамка', quantity: 1, total: 800 }],
    };
    const updatedOrder = {
      ...existingOrder,
      order_id: orderId,
      payment_status: 'paid',
      status: 'paid',
      chat_session_id: null,
      service_type: 'A3 фоторамка',
      priority: 'normal',
      delivery_method: null,
      delivery_address: null,
      partner_promo_code: null,
      mode: null,
      telegram_user_id: null,
      telegram_username: null,
      receipt_url: null,
      contact_name: 'Алена',
      contact_phone: null,
      contact_email: null,
      created_at: new Date().toISOString(),
    };
    const txQuery = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM photo_print_orders') && sql.includes('FOR UPDATE')) {
        return { rows: [existingOrder] };
      }
      if (sql.includes('UPDATE photo_print_orders')) {
        return { rows: [updatedOrder] };
      }
      return { rows: [] };
    });

    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn: (c: unknown) => unknown) => fn({ query: txQuery }));

    const res = await request(app)
      .put(`/${orderId}/record-payment`)
      .set(authHeader(emp))
      .send({
        payment_method: 'card',
        transaction_id: 'terminal-tx-1',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Оплата картой требует POS-чек');
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE photo_print_orders'))).toBe(false);
  });

  it('links a matching POS receipt before marking card payment paid', async () => {
    const emp = makeEmployeeUser();
    const orderId = 'CRM-260511-CARD';
    const posReceiptId = '22222222-2222-4222-8222-222222222222';
    const existingOrder = {
      id: 'photo-order-db-id',
      payment_status: 'pending',
      status: 'pending_payment',
      total_price: 800,
      items: [{ name: 'A3 фоторамка', quantity: 1, total: 800 }],
    };
    const updatedOrder = {
      ...existingOrder,
      order_id: orderId,
      payment_status: 'paid',
      status: 'paid',
      payment_id: 'terminal-tx-1',
      payment_card_info: null,
      chat_session_id: null,
      service_type: 'A3 фоторамка',
      priority: 'normal',
      delivery_method: null,
      delivery_address: null,
      partner_promo_code: null,
      mode: null,
      telegram_user_id: null,
      telegram_username: null,
      receipt_url: `/pos/receipts/${posReceiptId}`,
      contact_name: 'Алена',
      contact_phone: null,
      contact_email: null,
      created_at: new Date().toISOString(),
    };
    const txQuery = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM photo_print_orders') && sql.includes('FOR UPDATE')) {
        return { rows: [existingOrder] };
      }
      if (sql.includes('FROM pos_receipts')) {
        return { rows: [{ id: posReceiptId, total: '800', print_order_id: null }] };
      }
      if (sql.includes('FROM pos_receipt_payments')) {
        return { rows: [{ payment_total: '800' }] };
      }
      if (sql.includes('UPDATE pos_receipts')) {
        return { rows: [] };
      }
      if (sql.includes('UPDATE photo_print_orders')) {
        return { rows: [updatedOrder] };
      }
      return { rows: [] };
    });

    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn: (c: unknown) => unknown) => fn({ query: txQuery }));

    const res = await request(app)
      .put(`/${orderId}/record-payment`)
      .set(authHeader(emp))
      .send({
        payment_method: 'card',
        transaction_id: 'terminal-tx-1',
        pos_receipt_id: posReceiptId,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.receipt_url).toBe(`/pos/receipts/${posReceiptId}`);

    const receiptLinkCall = txQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE pos_receipts'));
    expect(receiptLinkCall?.[1]).toEqual([posReceiptId, existingOrder.id]);

    const orderUpdateCall = txQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE photo_print_orders'));
    expect(orderUpdateCall?.[1]).toEqual([
      orderId,
      'terminal-tx-1',
      null,
      'paid',
      `/pos/receipts/${posReceiptId}`,
    ]);
  });
});

// ─── POST /:orderId/pay-with-subscription — online subscription credits ─────
describe('POST /:orderId/pay-with-subscription', () => {
  beforeEach(resetMocks);

  it('marks an online order paid and consumes subscription credits', async () => {
    const clientUser = makeClientUser({ id: DB_CLIENT.id, phone: DB_CLIENT.phone });
    const existingOrder = {
      id: 'photo-order-db-id',
      payment_status: 'pending',
      status: 'pending_payment',
      total_price: 19.5,
      contact_phone: '+7 900 123-45-67',
      items: [{ format: '10x15', quantity: 1, price: 19.5, total: 19.5 }],
    };
    const updatedOrder = {
      ...existingOrder,
      order_id: 'SF-TEST-001',
      payment_status: 'paid',
      status: 'processing',
      payment_id: 'subscription:SF-TEST-001',
      payment_mode: 'subscription',
      contact_name: 'Иван',
      contact_email: 'client@example.com',
      chat_session_id: null,
      service_type: 'Печать фото',
      priority: 'normal',
      delivery_address: null,
      partner_promo_code: null,
      mode: 'custom',
      telegram_user_id: null,
      telegram_username: null,
      receipt_url: null,
      created_at: new Date().toISOString(),
    };

    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM photo_print_orders') && sql.includes('FOR UPDATE')) {
        return { rows: [existingOrder] };
      }
      if (sql.includes('FROM user_subscriptions')) {
        return { rows: [{ id: SUBSCRIPTION_ID, user_id: DB_CLIENT.id, phone: DB_CLIENT.phone }] };
      }
      if (sql.includes('FROM order_items')) {
        return { rows: [] };
      }
      if (sql.includes('FROM service_options')) {
        return { rows: [] };
      }
      if (sql.includes('FROM products')) {
        return { rows: [{ id: PRODUCT_ID, name: 'Фотобумага 10x15 Premium' }] };
      }
      if (sql.includes('UPDATE photo_print_orders')) {
        return { rows: [updatedOrder] };
      }
      if (sql.includes('INSERT INTO payment_events')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT);
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn: (c: unknown) => unknown) => fn({ query: txQuery }));

    const res = await request(app)
      .post('/SF-TEST-001/pay-with-subscription')
      .set(authHeader(clientUser))
      .send({ subscription_id: SUBSCRIPTION_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.subscription_coverage.total_credits_consumed).toBe(1);
    expect(calculateSubscriptionCoverageWithClient).toHaveBeenCalledWith(
      expect.anything(),
      {
        subscription_id: SUBSCRIPTION_ID,
        items: [
          {
            product_id: PRODUCT_ID,
            product_name: '10x15',
            quantity: 1,
            unit_price: 19.5,
            total: 19.5,
          },
        ],
      },
      { lock: true },
    );
    expect(useCreditsWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subscription_id: SUBSCRIPTION_ID,
        product_id: PRODUCT_ID,
        quantity: 1,
        print_order_id: existingOrder.id,
      }),
    );
  });

  it('rejects a subscription that belongs to another user', async () => {
    const clientUser = makeClientUser({ id: DB_CLIENT.id, phone: DB_CLIENT.phone });
    const existingOrder = {
      id: 'photo-order-db-id',
      payment_status: 'pending',
      status: 'pending_payment',
      total_price: 19.5,
      contact_phone: DB_CLIENT.phone,
      items: [{ format: '10x15', quantity: 1, price: 19.5, total: 19.5 }],
    };

    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM photo_print_orders') && sql.includes('FOR UPDATE')) {
        return { rows: [existingOrder] };
      }
      if (sql.includes('FROM user_subscriptions')) {
        return { rows: [{ id: SUBSCRIPTION_ID, user_id: 'other-client-id', phone: DB_CLIENT.phone }] };
      }
      return { rows: [] };
    });

    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT);
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn: (c: unknown) => unknown) => fn({ query: txQuery }));

    const res = await request(app)
      .post('/SF-TEST-001/pay-with-subscription')
      .set(authHeader(clientUser))
      .send({ subscription_id: SUBSCRIPTION_ID });

    expect(res.status).toBe(403);
    expect(useCreditsWithClient).not.toHaveBeenCalled();
  });

  it('rejects orders without a contact phone', async () => {
    const clientUser = makeClientUser({ id: DB_CLIENT.id, phone: DB_CLIENT.phone });
    const existingOrder = {
      id: 'photo-order-db-id',
      payment_status: 'pending',
      status: 'pending_payment',
      total_price: 19.5,
      contact_phone: null,
      items: [{ format: '10x15', quantity: 1, price: 19.5, total: 19.5 }],
    };

    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM photo_print_orders') && sql.includes('FOR UPDATE')) {
        return { rows: [existingOrder] };
      }
      if (sql.includes('FROM user_subscriptions')) {
        return { rows: [{ id: SUBSCRIPTION_ID, user_id: DB_CLIENT.id, phone: DB_CLIENT.phone }] };
      }
      return { rows: [] };
    });

    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT);
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn: (c: unknown) => unknown) => fn({ query: txQuery }));

    const res = await request(app)
      .post('/SF-TEST-001/pay-with-subscription')
      .set(authHeader(clientUser))
      .send({ subscription_id: SUBSCRIPTION_ID });

    expect(res.status).toBe(403);
    expect(calculateSubscriptionCoverageWithClient).not.toHaveBeenCalled();
    expect(useCreditsWithClient).not.toHaveBeenCalled();
  });

  it('rejects online subscription payments when owner phone is missing', async () => {
    const clientUser = makeClientUser({ id: DB_CLIENT.id, phone: undefined });
    const existingOrder = {
      id: 'photo-order-db-id',
      payment_status: 'pending',
      status: 'pending_payment',
      total_price: 19.5,
      contact_phone: DB_CLIENT.phone,
      items: [{ format: '10x15', quantity: 1, price: 19.5, total: 19.5 }],
    };

    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM photo_print_orders') && sql.includes('FOR UPDATE')) {
        return { rows: [existingOrder] };
      }
      if (sql.includes('FROM user_subscriptions')) {
        return { rows: [{ id: SUBSCRIPTION_ID, user_id: DB_CLIENT.id, phone: null }] };
      }
      return { rows: [] };
    });

    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ ...DB_CLIENT, phone: null });
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn: (c: unknown) => unknown) => fn({ query: txQuery }));

    const res = await request(app)
      .post('/SF-TEST-001/pay-with-subscription')
      .set(authHeader(clientUser))
      .send({ subscription_id: SUBSCRIPTION_ID });

    expect(res.status).toBe(403);
    expect(calculateSubscriptionCoverageWithClient).not.toHaveBeenCalled();
    expect(useCreditsWithClient).not.toHaveBeenCalled();
  });
});
