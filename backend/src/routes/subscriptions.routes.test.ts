/**
 * Integration tests for /subscriptions routes.
 *
 * Covers: тарифы, подписки, финансовая логика.
 * Failing tests = bugs to fix in production code.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  mockDb,
  resetMockDb,
  TEST_JWT_SECRET,
  makeAdminUser,
  makeEmployeeUser,
  makeClientUser,
  makeUser,
  authHeader,
} from '../test-utils/index.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../database/db.js', () => ({
  default: mockDb,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

// featureFlags is mutated per-test via the legacy redeem-gift suite.
const mockConfig = {
  jwt: { secret: TEST_JWT_SECRET, expiresIn: '15m', refreshExpiresIn: '30d' },
  featureFlags: { paymentLinksEnabled: true, giftActivationEnabled: true, legacyRedeemGiftEnabled: false },
};

vi.mock('../config/index.js', () => ({
  config: mockConfig,
}));

vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/channel-linking.service.js', () => ({
  findUserByChannel: vi.fn().mockResolvedValue(null),
}));

vi.mock('./chat/chat-shared.js', () => ({
  getSocketServer: vi.fn(() => null),
}));

vi.mock('../services/chat-broadcast.service.js', () => ({
  broadcastChatMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/connectors/pipeline/outbound-worker.js', () => ({
  enqueueOutbound: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/permission.service.js', () => ({
  permissionService: {
    getUserPermissions: vi.fn().mockResolvedValue([]),
    hasAllPermissions: vi.fn().mockResolvedValue(false),
  },
}));

// Mock subscription service
const mockGetPlans = vi.fn();
const mockGetPlanById = vi.fn();
const mockCreatePlan = vi.fn();
const mockCalculateCustomPackage = vi.fn();
const mockSubscribe = vi.fn();
const mockInitSubscription = vi.fn();
const mockPauseSubscription = vi.fn();
const mockResumeSubscription = vi.fn();
const mockCancelSubscription = vi.fn();
const mockGetCredits = vi.fn();
const mockUseCredits = vi.fn();
const mockCheckSubscription = vi.fn();
const mockCheckSubscriptionByUserId = vi.fn();
const mockGetMySubscriptions = vi.fn();
const mockGetActiveSubscription = vi.fn();
const mockGetAvailableCredits = vi.fn();
const mockGetSubscriberDiscount = vi.fn();
const mockGetCreditUsageHistory = vi.fn();
const mockValidatePromoCode = vi.fn();
const mockGetGiftSubscriptionPromoInfo = vi.fn();
const mockCreateGiftSubscriptionPromo = vi.fn();
const mockRedeemGiftSubscriptionPromo = vi.fn();
const mockInitCardChange = vi.fn();
const mockConfirmCardChange = vi.fn();
const mockGetCardChangeStatus = vi.fn();
const mockIsEducationSubscriptionPlan = vi.fn(
  (plan: { category: string; slug: string }) =>
    plan.category === 'education' && plan.slug === 'education-monthly-199',
);

vi.mock('../services/subscription.service.js', () => ({
  getPlans: mockGetPlans,
  getPlanById: mockGetPlanById,
  createPlan: mockCreatePlan,
  calculateCustomPackage: mockCalculateCustomPackage,
  subscribe: mockSubscribe,
  initSubscription: mockInitSubscription,
  activateSubscription: vi.fn(),
  pauseSubscription: mockPauseSubscription,
  resumeSubscription: mockResumeSubscription,
  cancelSubscription: mockCancelSubscription,
  getCredits: mockGetCredits,
  useCredits: mockUseCredits,
  checkSubscription: mockCheckSubscription,
  checkSubscriptionByUserId: mockCheckSubscriptionByUserId,
  getMySubscriptions: mockGetMySubscriptions,
  renewSubscription: vi.fn(),
  getActiveSubscription: mockGetActiveSubscription,
  provisionCredits: vi.fn(),
  consumeCredits: vi.fn(),
  rolloverCredits: vi.fn(),
  getAvailableCredits: mockGetAvailableCredits,
  getSubscriberDiscount: mockGetSubscriberDiscount,
  getCreditUsageHistory: mockGetCreditUsageHistory,
  normalizePhone: vi.fn((phone: string) => phone.replace(/\D/g, '')),
  validatePromoCode: mockValidatePromoCode,
  getGiftSubscriptionPromoInfo: mockGetGiftSubscriptionPromoInfo,
  createGiftSubscriptionPromo: mockCreateGiftSubscriptionPromo,
  redeemGiftSubscriptionPromo: mockRedeemGiftSubscriptionPromo,
  isEducationSubscriptionPlan: mockIsEducationSubscriptionPlan,
  EDUCATION_ACCESS_PLAN_SLUG: 'education-monthly-199',
  EDUCATION_ACCESS_PLAN_SLUGS: ['education-monthly-199'],
  initCardChange: mockInitCardChange,
  confirmCardChange: mockConfirmCardChange,
  getCardChangeStatus: mockGetCardChangeStatus,
}));

// ─── SUT import ───────────────────────────────────────────────────────────────

const { default: subscriptionsRouter } = await import('./subscriptions.routes.js');

const app = createTestApp(subscriptionsRouter, '/');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PLAN_ID = '11111111-1111-4111-8111-111111111111';

const PLAN_FIXTURE = {
  id: PLAN_ID,
  name: 'Базовый',
  slug: 'doc-print-student',
  base_price: 990,
  description: 'Базовый тариф',
  category: 'doc-print',
  is_active: true,
};

const EDUCATION_PLAN_FIXTURE = {
  ...PLAN_FIXTURE,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Образовательный доступ',
  slug: 'education-monthly-199',
  base_price: 199,
  description: 'Месячный образовательный доступ',
  category: 'education',
};

const SUBSCRIPTION_FIXTURE = {
  id: 'sub-1',
  user_id: 'client-id',
  phone: '+79001234567',
  plan_id: PLAN_ID,
  status: 'active',
  monthly_price: 990,
};

const DB_ADMIN = {
  id: 'admin-id',
  email: 'admin@example.com',
  role: 'admin',
  is_active: true,
  display_name: 'Admin',
  force_password_change: false,
  last_password_change: null,
};

const DB_CLIENT = {
  id: 'client-id',
  email: 'client@example.com',
  role: 'client',
  is_active: true,
  display_name: 'Client',
  force_password_change: false,
  last_password_change: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetMockDb();
});

describe('GET /subscriptions/plans', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetPlans.mockResolvedValue([PLAN_FIXTURE]);
  });

  it('returns 200 with plans array (public endpoint, no auth required)', async () => {
    const res = await request(app).get('/plans');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.plans)).toBe(true);
    expect(res.body.plans).toHaveLength(1);
  });

  it('returns empty array when no plans exist', async () => {
    mockGetPlans.mockResolvedValue([]);

    const res = await request(app).get('/plans');

    expect(res.status).toBe(200);
    expect(res.body.plans).toEqual([]);
  });

  it('filters plans by category query param', async () => {
    await request(app).get('/plans?category=smm');

    expect(mockGetPlans).toHaveBeenCalledWith('smm');
  });

  it('calls getPlans without filter when no category', async () => {
    await request(app).get('/plans');

    expect(mockGetPlans).toHaveBeenCalledWith(undefined);
  });
});

describe('GET /subscriptions/plans/:id', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetPlanById.mockResolvedValue(PLAN_FIXTURE);
  });

  it('returns 200 with plan data', async () => {
    const res = await request(app).get(`/plans/${PLAN_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.plan.id).toBe(PLAN_ID);
  });

  it('returns 404 when plan does not exist', async () => {
    mockGetPlanById.mockResolvedValue(null);

    const res = await request(app).get('/plans/non-existent');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/not found/i);
  });
});

describe('POST /subscriptions/plans (admin only)', () => {
  beforeEach(() => {
    resetMockDb();
    mockCreatePlan.mockResolvedValue(PLAN_FIXTURE);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/plans')
      .send({ name: 'Test', slug: 'test', base_price: 500 });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for employee (no subscriptions:manage)', async () => {
    const DB_EMPLOYEE = {
      id: 'employee-id', email: 'emp@example.com', role: 'employee',
      is_active: true, display_name: 'Emp', force_password_change: false, last_password_change: null,
    };
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE as never);

    const employee = makeEmployeeUser();
    const res = await request(app)
      .post('/plans')
      .set(authHeader(employee))
      .send({ name: 'Test', slug: 'test', base_price: 500 });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when required fields are missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/plans')
      .set(authHeader(admin))
      .send({ name: 'Test' }); // missing slug and base_price

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 201 with created plan for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/plans')
      .set(authHeader(admin))
      .send({ name: 'Test Plan', slug: 'test-plan', base_price: 990 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.plan).toBeDefined();
  });
});

describe('POST /subscriptions/calculate', () => {
  beforeEach(() => {
    resetMockDb();
    mockCalculateCustomPackage.mockResolvedValue({ monthly_price: 1500, items: [] });
  });

  it('returns 400 while custom subscriptions are paused', async () => {
    const res = await request(app)
      .post('/calculate')
      .send({ items: [{ service_slug: 'print-a4-bw', product_id: 'p1', quantity: 10 }] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/custom subscriptions/i);
    expect(mockCalculateCustomPackage).not.toHaveBeenCalled();
  });

  it('returns 400 when items array is missing', async () => {
    const res = await request(app).post('/calculate').send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/items/i);
  });

  it('returns 400 when items array is empty', async () => {
    const res = await request(app)
      .post('/calculate')
      .send({ items: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /subscriptions/init', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetPlanById.mockResolvedValue(PLAN_FIXTURE);
    mockInitSubscription.mockResolvedValue({ id: 'sub-pending-1', monthly_price: 990 });
  });

  it('returns 400 when phone is missing', async () => {
    const res = await request(app)
      .post('/init')
      .send({ plan_id: PLAN_ID });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/phone/i);
  });

  it('returns 400 when neither plan_id nor custom_items provided', async () => {
    const res = await request(app)
      .post('/init')
      .send({ phone: '+79001234567' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when only custom_items are provided', async () => {
    const res = await request(app)
      .post('/init')
      .send({
        phone: '+79001234567',
        custom_items: [{ service_slug: 'print-a4-bw', product_id: 'p1', quantity: 10 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/custom subscriptions/i);
  });

  it('returns 404 when plan_id does not exist', async () => {
    mockGetPlanById.mockResolvedValue(null);

    const res = await request(app)
      .post('/init')
      .send({ phone: '+79001234567', plan_id: '22222222-2222-4222-8222-222222222222' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 201 with subscription_id when init succeeds', async () => {
    const res = await request(app)
      .post('/init')
      .send({ phone: '+79001234567', plan_id: PLAN_ID });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('subscription_id');
    expect(res.body).toHaveProperty('monthly_price');
  });

  it('works without auth (optionalAuth endpoint)', async () => {
    // No Authorization header — should still work
    const res = await request(app)
      .post('/init')
      .send({ phone: '+79001234567', plan_id: PLAN_ID });

    expect(res.status).toBe(201);
  });

  it('requires auth before initializing the education plan', async () => {
    mockGetPlanById.mockResolvedValue(EDUCATION_PLAN_FIXTURE);

    const res = await request(app)
      .post('/init')
      .send({ phone: '+79001234567', plan_id: EDUCATION_PLAN_FIXTURE.id });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Войдите/);
  });
});

describe('POST /subscriptions/purchase', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetPlanById.mockResolvedValue(EDUCATION_PLAN_FIXTURE);
    mockInitSubscription.mockResolvedValue({
      id: 'sub-new-1',
      monthly_price: 199,
      trial_period_days: null,
      trial_end: null,
    });
  });

  it('reuses a recent pending education subscription instead of creating duplicates', async () => {
    const client = makeClientUser({
      id: 'client-id',
      email: 'client@example.com',
      phone: '+79001234567',
    });

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        ...DB_CLIENT,
        phone: '+79001234567',
      } as never)
      .mockResolvedValueOnce({ id: 'student-account-1' } as never)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        phone: '+79001234567',
        email: 'client@example.com',
        display_name: 'Client',
      } as never)
      .mockResolvedValueOnce({
        id: 'sub-pending-1',
        plan_name: 'Образовательный доступ',
        amount: 199,
        billing_period: 'monthly',
        trial_period_days: null,
        trial_end: null,
      } as never);

    const res = await request(app)
      .post('/purchase')
      .set(authHeader(client))
      .send({ plan_id: EDUCATION_PLAN_FIXTURE.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.subscription_id).toBe('sub-pending-1');
    expect(res.body.amount).toBe(199);
    expect(mockInitSubscription).not.toHaveBeenCalled();
  });
});

describe('GET /subscriptions/trial-info/:code', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetGiftSubscriptionPromoInfo.mockResolvedValue(null);
  });

  it('returns gift subscription details for a personal gift code', async () => {
    mockGetGiftSubscriptionPromoInfo.mockResolvedValueOnce({
      promo_code: 'SVF-GIFT-1234',
      plan_id: PLAN_ID,
      plan_name: 'Базовый',
      trial_days: 31,
      expires_at: '2026-06-18T00:00:00.000Z',
    });

    const res = await request(app).get('/trial-info/SVF-GIFT-1234');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.redeem_mode).toBe('gift_subscription');
    expect(res.body.plan_id).toBe(PLAN_ID);
    expect(res.body.trial_days).toBe(31);
  });
});

describe('POST /subscriptions/gift-promos', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetPlanById.mockResolvedValue(PLAN_FIXTURE);
    mockCreateGiftSubscriptionPromo.mockResolvedValue({
      promo_code: 'SVF-GIFT-1234',
      plan_id: PLAN_ID,
      plan_name: 'Базовый',
      redeem_url: 'https://svoefoto.ru/subscriptions?promo=SVF-GIFT-1234',
      expires_at: '2026-06-18T00:00:00.000Z',
    });
  });

  it('creates a one-month gift promo and sends it into the current chat', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never)
      .mockResolvedValueOnce({ id: 'message-id' } as never)
      .mockResolvedValueOnce({ channel: 'web', external_chat_id: null } as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/gift-promos')
      .set(authHeader(admin))
      .send({ plan_id: PLAN_ID, chat_session_id: '33333333-3333-4333-8333-333333333333' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.promo_code).toBe('SVF-GIFT-1234');
    expect(mockCreateGiftSubscriptionPromo).toHaveBeenCalledWith({
      plan_id: PLAN_ID,
      employee_id: admin.id,
      expires_in_days: undefined,
    });

    const insertCall = vi.mocked(mockDb.queryOne).mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO messages')
    );
    expect(insertCall).toBeDefined();
    expect((insertCall?.[1] as unknown[])[1]).toContain('SVF-GIFT-1234');
  });

  it('describes personal account gift discounts without showing the paid tariff name', async () => {
    mockGetPlanById.mockResolvedValueOnce({
      ...PLAN_FIXTURE,
      name: 'Аккаунт 199',
      base_price: 199,
      subscriber_discount_percent: 0,
      items: [],
    });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never)
      .mockResolvedValueOnce({ id: 'message-id' } as never)
      .mockResolvedValueOnce({ channel: 'web', external_chat_id: null } as never);

    const res = await request(app)
      .post('/gift-promos')
      .set(authHeader(makeAdminUser()))
      .send({ plan_id: PLAN_ID, chat_session_id: '33333333-3333-4333-8333-333333333333' });

    expect(res.status).toBe(201);

    const insertCall = vi.mocked(mockDb.queryOne).mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO messages')
    );
    expect(insertCall).toBeDefined();
    const content = (insertCall?.[1] as unknown[])[1] as string;
    expect(content).toContain('личную подписку на 1 месяц');
    expect(content).not.toContain('Аккаунт 199');
    expect(content).toContain('Скидка на печать документов — 20%, на печать фотографий — 10%.');
    expect(content).not.toContain('₽');
    expect(content).not.toContain('10→8');
  });
});

describe('POST /subscriptions/account-access-info', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('sends business account discount information without prices', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never)
      .mockResolvedValueOnce({ id: 'message-id' } as never)
      .mockResolvedValueOnce({ channel: 'web', external_chat_id: null } as never);

    const res = await request(app)
      .post('/account-access-info')
      .set(authHeader(makeAdminUser()))
      .send({
        account_type: 'business',
        chat_session_id: '33333333-3333-4333-8333-333333333333',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.account_type).toBe('business');
    expect(res.body.message_id).toBe('message-id');

    const insertCall = vi.mocked(mockDb.queryOne).mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO messages')
    );
    expect(insertCall).toBeDefined();
    const content = (insertCall?.[1] as unknown[])[1] as string;
    expect(content).toContain('Бизнес-аккаунт');
    expect(content).toContain('Документы А4 −40%, фото 10×15 −15%.');
    expect(content).toContain('https://svoefoto.ru/business');
    expect(content).not.toContain('₽');
    expect(content).not.toContain('руб');
  });
});

describe('POST /subscriptions/offer', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetPlanById.mockResolvedValue({
      ...PLAN_FIXTURE,
      name: 'Аккаунт 199',
      base_price: 199,
      subscriber_discount_percent: 0,
      items: [],
    });
  });

  it('sends a short personal subscription offer without business copy', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never)
      .mockResolvedValueOnce({ base_price: 199 } as never)
      .mockResolvedValueOnce({ visitor_phone: '+79001234567', visitor_name: 'Client' } as never)
      .mockResolvedValueOnce({
        id: 'offer-id',
        token: 'short-token',
        monthly_price: 199,
      } as never)
      .mockResolvedValueOnce({ id: 'message-id' } as never)
      .mockResolvedValueOnce({ channel: 'web', external_chat_id: null } as never);

    const res = await request(app)
      .post('/offer')
      .set(authHeader(makeAdminUser()))
      .send({ plan_id: PLAN_ID, chat_session_id: '33333333-3333-4333-8333-333333333333' });

    expect(res.status).toBe(201);

    const insertCall = vi.mocked(mockDb.queryOne).mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO messages')
    );
    expect(insertCall).toBeDefined();
    const content = (insertCall?.[1] as unknown[])[1] as string;

    expect(content).toContain('Личная подписка');
    expect(content).toContain('Скидка на печать документов — 20%, на печать фотографий — 10%.');
    expect(content).toContain('https://svoefoto.ru/subscribe/short-token');
    expect(content).not.toContain('Бизнес');
    expect(content).not.toContain('Что дешевле по подписке');
    expect(content).not.toContain('Без фиксированных кредитов');
    expect(content.split('\n').filter(Boolean)).toHaveLength(3);
  });
});

describe('POST /subscriptions/redeem-gift (legacy, behind flag)', () => {
  beforeEach(() => {
    resetMockDb();
    mockRedeemGiftSubscriptionPromo.mockResolvedValue({
      id: 'gift-sub-1',
      plan_id: PLAN_ID,
      plan_name: 'Базовый',
      status: 'active',
      current_period_end: '2026-06-18T00:00:00.000Z',
    });
  });

  afterEach(() => {
    mockConfig.featureFlags.legacyRedeemGiftEnabled = false;
  });

  it('returns 410 when the legacy path is disabled (default)', async () => {
    mockConfig.featureFlags.legacyRedeemGiftEnabled = false;
    const res = await request(app)
      .post('/redeem-gift')
      .send({ promo_code: 'SVF-GIFT-1234', phone: '+7 (900) 123-45-67' });

    expect(res.status).toBe(410);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('ACTIVATION_DISABLED');
    expect(mockRedeemGiftSubscriptionPromo).not.toHaveBeenCalled();
  });

  it('activates a gift subscription when the legacy path is enabled', async () => {
    mockConfig.featureFlags.legacyRedeemGiftEnabled = true;
    const res = await request(app)
      .post('/redeem-gift')
      .send({
        promo_code: 'SVF-GIFT-1234',
        phone: '+7 (900) 123-45-67',
        customer_name: 'Виктория',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.subscription.status).toBe('active');
    expect(mockRedeemGiftSubscriptionPromo).toHaveBeenCalledWith({
      promo_code: 'SVF-GIFT-1234',
      user_id: undefined,
      phone: '79001234567',
      customer_name: 'Виктория',
      email: undefined,
    });
  });
});

describe('POST /subscriptions/:id/cancel', () => {
  beforeEach(() => {
    resetMockDb();
    mockCancelSubscription.mockResolvedValue(SUBSCRIPTION_FIXTURE);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/sub-1/cancel')
      .send({ reason: 'not needed' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for client cancelling another user subscription', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)                               // auth
      .mockResolvedValueOnce({ id: 'sub-1', user_id: 'other-user' } as never); // ownership: чужая подписка

    const client = makeClientUser();
    const res = await request(app)
      .post('/sub-1/cancel')
      .set(authHeader(client))
      .send({ reason: 'not needed' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 when owner cancels their own subscription', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)                                // auth
      .mockResolvedValueOnce({ id: 'sub-1', user_id: 'client-id' } as never);   // ownership: своя подписка

    const client = makeClientUser();
    const res = await request(app)
      .post('/sub-1/cancel')
      .set(authHeader(client))
      .send({ reason: 'client request' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockCancelSubscription).toHaveBeenCalledWith('sub-1', 'client request');
  });

  it('returns 404 when subscription not found', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN as never);
    mockCancelSubscription.mockResolvedValue(null);

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/non-existent-sub/cancel')
      .set(authHeader(admin))
      .send({ reason: 'test' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 when admin cancels subscription', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never)                                // auth
      .mockResolvedValueOnce({ id: 'sub-1', user_id: 'client-id' } as never);  // ownership (admin = manager)

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/sub-1/cancel')
      .set(authHeader(admin))
      .send({ reason: 'client request' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.subscription).toBeDefined();
  });
});

describe('POST /subscriptions/:id/change-card/init — card change (IDOR)', () => {
  beforeEach(() => {
    resetMockDb();
    mockInitCardChange.mockResolvedValue({
      changeId: 'cc-1', externalId: 'SUBCC-cc-1', verifyAmount: 1,
      planName: 'Годовая', email: 'client@example.com', phone: '+79001234567',
    });
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).post('/sub-1/change-card/init').send({});
    expect(res.status).toBe(401);
    expect(mockInitCardChange).not.toHaveBeenCalled();
  });

  it('returns 403 for client initiating on another user subscription (IDOR)', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)                                // auth
      .mockResolvedValueOnce({ id: 'sub-1', user_id: 'other-user' } as never);  // ownership: чужая
    const res = await request(app)
      .post('/sub-1/change-card/init')
      .set(authHeader(makeClientUser()))
      .send({});
    expect(res.status).toBe(403);
    expect(mockInitCardChange).not.toHaveBeenCalled();
  });

  it('returns 404 when subscription does not exist', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)  // auth
      .mockResolvedValueOnce(null as never);      // ownership lookup: not found
    const res = await request(app)
      .post('/missing-sub/change-card/init')
      .set(authHeader(makeClientUser()))
      .send({});
    expect(res.status).toBe(404);
    expect(mockInitCardChange).not.toHaveBeenCalled();
  });

  it('returns 200 with externalId when owner initiates', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)                                // auth
      .mockResolvedValueOnce({ id: 'sub-1', user_id: 'client-id' } as never);   // ownership: своя
    const res = await request(app)
      .post('/sub-1/change-card/init')
      .set(authHeader(makeClientUser()))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.externalId).toBe('SUBCC-cc-1');
    expect(mockInitCardChange).toHaveBeenCalledWith('sub-1', 'client-id');
  });
});

describe('POST /subscriptions/:id/change-card/confirm — card change (IDOR + zod)', () => {
  const VALID_CHANGE_ID = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    resetMockDb();
    mockConfirmCardChange.mockResolvedValue({ status: 'card_changed', cardLastFour: '4242' });
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/sub-1/change-card/confirm')
      .send({ changeId: VALID_CHANGE_ID });
    expect(res.status).toBe(401);
    expect(mockConfirmCardChange).not.toHaveBeenCalled();
  });

  it('returns 403 for client confirming on another user subscription (IDOR)', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)
      .mockResolvedValueOnce({ id: 'sub-1', user_id: 'other-user' } as never);
    const res = await request(app)
      .post('/sub-1/change-card/confirm')
      .set(authHeader(makeClientUser()))
      .send({ changeId: VALID_CHANGE_ID });
    expect(res.status).toBe(403);
    expect(mockConfirmCardChange).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid changeId (not a UUID)', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)
      .mockResolvedValueOnce({ id: 'sub-1', user_id: 'client-id' } as never);
    const res = await request(app)
      .post('/sub-1/change-card/confirm')
      .set(authHeader(makeClientUser()))
      .send({ changeId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(mockConfirmCardChange).not.toHaveBeenCalled();
  });

  it('returns 200 with status when owner confirms', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)
      .mockResolvedValueOnce({ id: 'sub-1', user_id: 'client-id' } as never);
    const res = await request(app)
      .post('/sub-1/change-card/confirm')
      .set(authHeader(makeClientUser()))
      .send({ changeId: VALID_CHANGE_ID });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('card_changed');
    expect(mockConfirmCardChange).toHaveBeenCalledWith('sub-1', VALID_CHANGE_ID);
  });
});

describe('GET /subscriptions/my', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetMySubscriptions.mockResolvedValue([SUBSCRIPTION_FIXTURE]);
  });

  it('returns 200 with subscriptions when authenticated', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT as never);

    const client = makeClientUser({ id: 'client-id' });
    const res = await request(app)
      .get('/my')
      .set(authHeader(client));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.subscriptions)).toBe(true);
    expect(mockGetMySubscriptions).toHaveBeenCalledWith('client-id');
  });

  it('returns 401 without auth even when user_id query param is provided', async () => {
    const res = await request(app)
      .get('/my?user_id=some-user-id');

    expect(res.status).toBe(401);
    expect(mockGetMySubscriptions).not.toHaveBeenCalled();
  });

  it('returns 401 when no auth and no user_id param', async () => {
    const res = await request(app).get('/my');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /subscriptions/my/credits', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetCredits.mockResolvedValue([{ product_id: 'p1', remaining_quantity: 3 }]);
  });

  it('returns credits for a subscription owned by the authenticated client', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)
      .mockResolvedValueOnce({ id: 'sub-1', user_id: 'client-id' } as never);

    const client = makeClientUser({ id: 'client-id' });
    const res = await request(app)
      .get('/my/credits?subscription_id=sub-1')
      .set(authHeader(client));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGetCredits).toHaveBeenCalledWith('sub-1');
  });

  it('returns 403 for another client subscription', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)
      .mockResolvedValueOnce({ id: 'sub-2', user_id: 'other-client' } as never);

    const client = makeClientUser({ id: 'client-id' });
    const res = await request(app)
      .get('/my/credits?subscription_id=sub-2')
      .set(authHeader(client));

    expect(res.status).toBe(403);
    expect(mockGetCredits).not.toHaveBeenCalled();
  });
});

describe('GET /subscriptions/:id/credits/available', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetAvailableCredits.mockResolvedValue([{ product_id: 'p1', available_quantity: 5 }]);
  });

  it('returns available credits for the subscription owner', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)
      .mockResolvedValueOnce({ id: 'sub-1', user_id: 'client-id' } as never);

    const client = makeClientUser({ id: 'client-id' });
    const res = await request(app)
      .get('/sub-1/credits/available')
      .set(authHeader(client));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGetAvailableCredits).toHaveBeenCalledWith('sub-1');
  });

  it('allows subscription managers to read available credits', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never)
      .mockResolvedValueOnce({ id: 'sub-1', user_id: 'client-id' } as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .get('/sub-1/credits/available')
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(mockGetAvailableCredits).toHaveBeenCalledWith('sub-1');
  });

  it('returns 403 for another client subscription', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)
      .mockResolvedValueOnce({ id: 'sub-2', user_id: 'other-client' } as never);

    const client = makeClientUser({ id: 'client-id' });
    const res = await request(app)
      .get('/sub-2/credits/available')
      .set(authHeader(client));

    expect(res.status).toBe(403);
    expect(mockGetAvailableCredits).not.toHaveBeenCalled();
  });
});

describe('POST /subscriptions/:id/pause', () => {
  beforeEach(() => {
    resetMockDb();
    mockPauseSubscription.mockResolvedValue({ ...SUBSCRIPTION_FIXTURE, status: 'paused' });
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).post('/sub-1/pause').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for employee (no subscriptions:manage)', async () => {
    const DB_EMPLOYEE = {
      id: 'employee-id', email: 'emp@example.com', role: 'employee',
      is_active: true, display_name: 'Emp', force_password_change: false, last_password_change: null,
    };
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE as never);

    const employee = makeEmployeeUser();
    const res = await request(app)
      .post('/sub-1/pause')
      .set(authHeader(employee))
      .send({});

    expect(res.status).toBe(403);
  });

  it('returns 200 when admin pauses subscription', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/sub-1/pause')
      .set(authHeader(admin))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.subscription.status).toBe('paused');
  });
});
