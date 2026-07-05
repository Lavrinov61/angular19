/**
 * Integration tests for /pricing routes.
 *
 * Covers: GET /categories, GET /categories/:slug, POST /calculate,
 *         POST /validate-selection, and admin endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  mockDb,
  resetMockDb,
  TEST_JWT_SECRET,
  makeAdminUser,
  makeClientUser,
  authHeader,
} from '../test-utils/index.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../database/db.js', () => ({
  default: mockDb,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../config/index.js', () => ({
  config: {
    jwt: { secret: TEST_JWT_SECRET, expiresIn: '15m', refreshExpiresIn: '30d' },
  },
}));

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

// Mock pricing engine service
const mockGetCategories = vi.fn();
const mockGetCategoryBySlug = vi.fn();
const mockCalculatePrice = vi.fn();
const mockValidateSelection = vi.fn();
const mockInvalidatePricingCache = vi.fn();
const mockCalculatePriceWaterfall = vi.fn();
const mockResolveSlugsToWaterfallItems = vi.fn();
const mockGetVolumeThresholdHints = vi.fn();

vi.mock('../services/pricing-engine.service.js', () => ({
  getCategories: mockGetCategories,
  getCategoryBySlug: mockGetCategoryBySlug,
  calculatePrice: mockCalculatePrice,
  validateSelection: mockValidateSelection,
  invalidatePricingCache: mockInvalidatePricingCache,
  calculatePriceWaterfall: mockCalculatePriceWaterfall,
  resolveSlugsToWaterfallItems: mockResolveSlugsToWaterfallItems,
  getVolumeThresholdHints: mockGetVolumeThresholdHints,
}));

vi.mock('../data/ai-actions.js', () => ({
  invalidateAiActionsCache: vi.fn(),
}));

// Mock dynamic pricing service
vi.mock('../services/dynamic-pricing.service.js', () => ({
  applyModifiers: vi.fn().mockResolvedValue({}),
  getCurrentDynamicPrice: vi.fn().mockResolvedValue(null),
  getMinutesToPriceChange: vi.fn().mockResolvedValue(null),
  getAllModifiers: vi.fn().mockResolvedValue([]),
  getDynamicConfig: vi.fn().mockResolvedValue({}),
  createPriceLock: vi.fn().mockResolvedValue(null),
  checkPriceLock: vi.fn().mockResolvedValue(null),
  invalidateModifiersCache: vi.fn(),
}));

vi.mock('../services/queue.service.js', () => ({
  getQueueStats: vi.fn().mockResolvedValue({ pending: 0 }),
  calculatePrioritySurcharge: vi.fn().mockResolvedValue(0),
  purchasePriority: vi.fn().mockResolvedValue(null),
}));

// ─── SUT import ───────────────────────────────────────────────────────────────

const { default: pricingRouter } = await import('./pricing.routes.js');

const app = createTestApp(pricingRouter, '/');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CATEGORY_FIXTURE = {
  id: 'cat-1',
  slug: 'foto-na-dokument',
  name: 'Фото на документы',
  option_groups: [],
  rules: [],
};

const CALCULATE_RESULT_FIXTURE = {
  price: 500,
  base_price: 500,
  total: 500,
  breakdown: [],
};

const VALIDATE_RESULT_FIXTURE = {
  valid: true,
  errors: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /pricing/categories', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetCategories.mockResolvedValue([CATEGORY_FIXTURE]);
  });

  it('returns 200 with array of categories', async () => {
    const res = await request(app).get('/categories');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories).toHaveLength(1);
  });

  it('returns empty array when no categories exist', async () => {
    mockGetCategories.mockResolvedValue([]);

    const res = await request(app).get('/categories');

    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual([]);
  });

  it('returns 500 when pricing engine throws', async () => {
    mockGetCategories.mockRejectedValue(new Error('DB error'));

    const res = await request(app).get('/categories');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /pricing/categories/:slug', () => {
  beforeEach(() => {
    resetMockDb();
    mockGetCategoryBySlug.mockResolvedValue(CATEGORY_FIXTURE);
  });

  it('returns 200 with category when slug exists', async () => {
    const res = await request(app).get('/categories/foto-na-dokument');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.category.slug).toBe('foto-na-dokument');
  });

  it('returns 404 when slug does not exist', async () => {
    mockGetCategoryBySlug.mockResolvedValue(null);

    const res = await request(app).get('/categories/non-existent-slug');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/не найден/i);
  });

  it('calls pricing engine with correct slug', async () => {
    await request(app).get('/categories/my-slug');

    expect(mockGetCategoryBySlug).toHaveBeenCalledWith('my-slug');
  });
});

describe('POST /pricing/calculate', () => {
  beforeEach(() => {
    resetMockDb();
    mockCalculatePrice.mockResolvedValue(CALCULATE_RESULT_FIXTURE);
  });

  it('returns 200 with calculation result for valid request', async () => {
    const res = await request(app)
      .post('/calculate')
      .send({
        category_slug: 'foto-na-dokument',
        selected_options: ['opt-1', 'opt-2'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('price');
  });

  it('returns 400 when category_slug is missing', async () => {
    const res = await request(app)
      .post('/calculate')
      .send({ selected_options: ['opt-1'] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/category_slug/);
  });

  it('returns 400 when selected_options is missing', async () => {
    const res = await request(app)
      .post('/calculate')
      .send({ category_slug: 'foto-na-dokument' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/selected_options/);
  });

  it('returns 400 when selected_options is empty array', async () => {
    const res = await request(app)
      .post('/calculate')
      .send({ category_slug: 'foto-na-dokument', selected_options: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when selected_options is not an array', async () => {
    const res = await request(app)
      .post('/calculate')
      .send({ category_slug: 'foto-na-dokument', selected_options: 'not-array' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('passes all optional parameters to pricing engine', async () => {
    await request(app)
      .post('/calculate')
      .send({
        category_slug: 'foto-na-dokument',
        selected_options: ['opt-1'],
        delivery_method: 'courier',
        is_returning: true,
        promo_code: 'PROMO10',
        loyalty_points_to_use: 100,
      });

    expect(mockCalculatePrice).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlug: 'foto-na-dokument',
        selectedOptions: ['opt-1'],
        deliveryMethod: 'courier',
        isReturning: true,
        promoCode: 'PROMO10',
        loyaltyPointsToUse: 100,
      }),
    );
  });

  it('returns 500 when pricing engine throws', async () => {
    mockCalculatePrice.mockRejectedValue(new Error('Engine failure'));

    const res = await request(app)
      .post('/calculate')
      .send({ category_slug: 'foto-na-dokument', selected_options: ['opt-1'] });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /pricing/validate-selection', () => {
  beforeEach(() => {
    resetMockDb();
    mockValidateSelection.mockResolvedValue(VALIDATE_RESULT_FIXTURE);
  });

  it('returns 200 with validation result', async () => {
    const res = await request(app)
      .post('/validate-selection')
      .send({
        category_slug: 'foto-na-dokument',
        selected_options: ['opt-1'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when category_slug is missing', async () => {
    const res = await request(app)
      .post('/validate-selection')
      .send({ selected_options: ['opt-1'] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('treats missing selected_options as empty array (no 400)', async () => {
    const res = await request(app)
      .post('/validate-selection')
      .send({ category_slug: 'foto-na-dokument' });

    expect(res.status).toBe(200);
    expect(mockValidateSelection).toHaveBeenCalledWith(
      expect.objectContaining({ selectedOptions: [] }),
    );
  });

  it('returns false valid and errors when selection is invalid', async () => {
    mockValidateSelection.mockResolvedValue({
      valid: false,
      errors: ['Conflict between opt-1 and opt-2'],
    });

    const res = await request(app)
      .post('/validate-selection')
      .send({
        category_slug: 'foto-na-dokument',
        selected_options: ['opt-1', 'opt-2'],
      });

    expect(res.status).toBe(200); // validation returns 200 even for invalid — caller decides
    expect(res.body.valid).toBe(false);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});

describe('POST /pricing/v2/calculate', () => {
  beforeEach(() => {
    resetMockDb();
    mockCalculatePriceWaterfall.mockResolvedValue({
      items: [],
      subtotal: 30,
      total: 30,
      savings: 70,
      waterfall: [],
      isReturning: false,
      accountDiscount: null,
      subscriberDiscount: null,
      studentDiscount: null,
      loyaltyDiscount: null,
      promoDiscount: null,
      partnerDiscount: null,
      promoBlocked: false,
      promoBlockedReason: null,
      detectedCombos: [],
    });
  });

  it('forwards print fill percent to the waterfall engine', async () => {
    const res = await request(app)
      .post('/v2/calculate')
      .send({
        channel: 'crm',
        customer_phone: '+7 989 623-84-48',
        items: [{
          serviceOptionId: 'service-option-1',
          quantity: 10,
          pricing_group_key: 'student-print',
          print_fill_percent: 15,
        }],
      });

    expect(res.status).toBe(200);
    expect(mockCalculatePriceWaterfall).toHaveBeenCalledWith(
      expect.objectContaining({
        customerPhone: '+7 989 623-84-48',
        channel: 'crm',
        items: [expect.objectContaining({
          serviceOptionId: 'service-option-1',
          quantity: 10,
          pricingGroupKey: 'student-print',
          printFillPercent: 15,
        })],
      }),
    );
  });
});

describe('GET /pricing/admin/categories', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/admin/categories');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for client user without pricing:manage permission', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'client-id',
      email: 'client@example.com',
      role: 'client',
      is_active: true,
      display_name: 'Client',
      force_password_change: false,
      last_password_change: null,
    } as never);

    const client = makeClientUser();
    const res = await request(app)
      .get('/admin/categories')
      .set(authHeader(client));

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 with categories list for admin with pricing:manage', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'admin-id',
      email: 'admin@example.com',
      role: 'admin',
      is_active: true,
      display_name: 'Admin',
      force_password_change: false,
      last_password_change: null,
    } as never);
    vi.mocked(mockDb.query).mockResolvedValueOnce([CATEGORY_FIXTURE] as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .get('/admin/categories')
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.categories)).toBe(true);
  });
});
