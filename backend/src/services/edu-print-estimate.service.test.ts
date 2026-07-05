import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RustCoverageResult } from './print-api-client.service.js';
import type { PriceWaterfallResult } from './pricing-engine.service.js';
import type { StudentDiscountSummary } from './student-discount.service.js';

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('./redis-cache.service.js', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./storage.service.js', () => ({
  storageService: {
    generatePresignedGetUrl: vi.fn().mockResolvedValue('https://svoefoto.ru/s3-proxy/print-estimates/u1/x.pdf?sig'),
  },
}));

vi.mock('./print-api-client.service.js', () => ({
  analyzeCoverageViaService: vi.fn(),
}));

vi.mock('./pricing-engine.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pricing-engine.service.js')>();
  return {
    ...actual,
    calculatePriceWaterfall: vi.fn(),
  };
});

vi.mock('./student-discount.service.js', () => ({
  getStudentDiscountForUser: vi.fn(),
}));

vi.mock('../database/db.js', () => ({
  default: { query: vi.fn() },
}));

const { estimateEduPrint } = await import('./edu-print-estimate.service.js');
const { analyzeCoverageViaService } = await import('./print-api-client.service.js');
const { calculatePriceWaterfall } = await import('./pricing-engine.service.js');
const { getStudentDiscountForUser } = await import('./student-discount.service.js');
const { cacheGet, cacheSet } = await import('./redis-cache.service.js');
const db = (await import('../database/db.js')).default;

const DOC_SLUG = 'km-а4-печать-документа';
const COLOR_SLUG = 'km-а4-печать-до-15-цвет';
const DOC_OPTION_ID = 'opt-doc';
const COLOR_OPTION_ID = 'opt-color';

function coverageWithPages(pages: Array<{ slug: string; price: number; fill: number; tier: string }>): RustCoverageResult {
  return {
    coverage_percent: pages[0]?.fill ?? 0,
    recommended_slug: pages[0]?.slug ?? DOC_SLUG,
    recommended_price: pages[0]?.price ?? 10,
    recommended_name: 'doc',
    tier: pages[0]?.tier ?? 'document',
    page_count: pages.length,
    document_type: 'pdf',
    pages: pages.map((p, i) => ({
      page_number: i + 1,
      coverage_percent: p.fill,
      recommended_slug: p.slug,
      recommended_price: p.price,
      recommended_name: 'page',
      tier: p.tier,
    })),
  };
}

/** Минимальный валидный PriceWaterfallResult с нужными для сервиса полями. */
function waterfallResult(over: Partial<PriceWaterfallResult>): PriceWaterfallResult {
  return {
    items: [],
    subtotal: 0,
    waterfall: [],
    isReturning: false,
    subscriberDiscount: null,
    accountDiscount: null,
    studentDiscount: null,
    loyaltyDiscount: null,
    promoDiscount: null,
    partnerDiscount: null,
    priceAdjustments: [],
    promoBlocked: false,
    promoBlockedReason: null,
    total: 0,
    savings: 0,
    detectedCombos: [],
    educationVolumeConsumed: null,
    ...over,
  };
}

function activeSummary(over: Partial<StudentDiscountSummary> = {}): StudentDiscountSummary {
  return {
    status: 'active',
    source_token: 't',
    activated_at: '2026-05-01',
    expires_at: '2026-06-15',
    print_sheets_limit: 100,
    print_sheets_used: 12,
    print_sheets_remaining: 88,
    print_sheet_price: 3,
    max_print_fill_percent: 15,
    photo_limit: 100,
    photo_used: 0,
    photo_remaining: 100,
    allowance_period_id: 'p1',
    allowance_period_start: '2026-05-16',
    allowance_period_end: '2026-06-15',
    binding_limit: 0,
    binding_uses: 0,
    binding_remaining: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cacheGet).mockResolvedValue(null);
  vi.mocked(cacheSet).mockResolvedValue(undefined);
  vi.mocked(db.query).mockResolvedValue([
    { id: DOC_OPTION_ID, slug: DOC_SLUG },
    { id: COLOR_OPTION_ID, slug: COLOR_SLUG },
  ] as never);
});

describe('estimateEduPrint', () => {
  it('под лимитом: edu-цена ниже каталога, withinLimit для всех страниц', async () => {
    // 2 страницы документной печати: каталог 10₽, edu 3₽ (скидка 7₽/стр).
    vi.mocked(analyzeCoverageViaService).mockResolvedValue(coverageWithPages([
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
      { slug: DOC_SLUG, price: 10, fill: 9, tier: 'document' },
    ]));
    vi.mocked(calculatePriceWaterfall).mockResolvedValue(waterfallResult({
      subtotal: 20,
      total: 6,
      accountDiscount: {
        accountType: 'education', label: 'Образование', source: 'education_verification',
        percent: 70, amount: 14, description: '',
        lines: [
          { serviceOptionId: DOC_OPTION_ID, name: 'doc', kind: 'document_print', label: '', percent: 70, amount: 7, quantity: 1 },
          { serviceOptionId: DOC_OPTION_ID, name: 'doc', kind: 'document_print', label: '', percent: 70, amount: 7, quantity: 1 },
        ],
      },
      educationVolumeConsumed: { entitlementId: 'e1', userId: 'u1', documents: 2, photos: 0 },
    }));
    vi.mocked(getStudentDiscountForUser).mockResolvedValue(activeSummary());

    const res = await estimateEduPrint({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });
    if ('error' in res) throw new Error('unexpected analyze_failed');

    expect(res.pages).toHaveLength(2);
    expect(res.pages.every(p => p.withinLimit)).toBe(true);
    expect(res.pages[0].eduPriceRub).toBe(3);
    expect(res.pages[0].catalogPriceRub).toBe(10);
    expect(res.summary.catalogTotalRub).toBe(20);
    expect(res.summary.eduTotalRub).toBe(6);
    expect(res.summary.savingsRub).toBe(14);
    expect(res.summary.documentsConsumed).toBe(2);
    expect(res.summary.documentsOverLimit).toBe(0);
    expect(res.allowance?.documentsRemaining).toBe(88);
    expect(res.subscription.active).toBe(true);
  });

  it('тариф «без подписки»: документы −50% (5₽), sheet_price 5, лимит активен', async () => {
    // 2 страницы: каталог 10₽, edu 5₽ (−50%, тариф verified без подписки).
    vi.mocked(analyzeCoverageViaService).mockResolvedValue(coverageWithPages([
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
      { slug: DOC_SLUG, price: 10, fill: 9, tier: 'document' },
    ]));
    vi.mocked(calculatePriceWaterfall).mockResolvedValue(waterfallResult({
      subtotal: 20,
      total: 10,
      accountDiscount: {
        accountType: 'education', label: 'Образовательный (без подписки)', source: 'education_verified_only',
        percent: 50, amount: 10, description: '',
        lines: [
          { serviceOptionId: DOC_OPTION_ID, name: 'doc', kind: 'document_print', label: '', percent: 50, amount: 5, quantity: 1 },
          { serviceOptionId: DOC_OPTION_ID, name: 'doc', kind: 'document_print', label: '', percent: 50, amount: 5, quantity: 1 },
        ],
      },
      educationVolumeConsumed: { entitlementId: 'e1', userId: 'u1', documents: 2, photos: 0 },
    }));
    vi.mocked(getStudentDiscountForUser).mockResolvedValue(
      activeSummary({ source_token: 'education_verified', print_sheet_price: 5 }),
    );

    const res = await estimateEduPrint({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });
    if ('error' in res) throw new Error('unexpected analyze_failed');

    expect(res.pages.every(p => p.withinLimit)).toBe(true);
    expect(res.pages[0].eduPriceRub).toBe(5);
    expect(res.pages[0].catalogPriceRub).toBe(10);
    expect(res.summary.eduTotalRub).toBe(10);
    expect(res.summary.savingsRub).toBe(10);
    expect(res.subscription.active).toBe(true);
  });

  it('частично сверх лимита: covered страниц = remaining, остальные по каталогу', async () => {
    // 3 страницы, но покрыта льготой только 1 (остаток лимита = 1).
    vi.mocked(analyzeCoverageViaService).mockResolvedValue(coverageWithPages([
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
    ]));
    vi.mocked(calculatePriceWaterfall).mockResolvedValue(waterfallResult({
      subtotal: 30,
      total: 23, // 1×3 + 2×10
      accountDiscount: {
        accountType: 'education', label: 'Образование', source: 'education_verification',
        percent: 70, amount: 7, description: '',
        lines: [
          { serviceOptionId: DOC_OPTION_ID, name: 'doc', kind: 'document_print', label: '', percent: 70, amount: 7, quantity: 1 },
        ],
      },
      educationVolumeConsumed: { entitlementId: 'e1', userId: 'u1', documents: 1, photos: 0 },
    }));
    vi.mocked(getStudentDiscountForUser).mockResolvedValue(activeSummary({ print_sheets_remaining: 1, print_sheets_used: 99 }));

    const res = await estimateEduPrint({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });
    if ('error' in res) throw new Error('unexpected analyze_failed');

    const within = res.pages.filter(p => p.withinLimit);
    expect(within).toHaveLength(1);
    expect(within[0].eduPriceRub).toBe(3);
    const over = res.pages.filter(p => !p.withinLimit);
    expect(over).toHaveLength(2);
    expect(over.every(p => p.eduPriceRub === 10)).toBe(true);
    expect(res.summary.documentsOverLimit).toBe(2);
    expect(res.summary.eduTotalRub).toBe(23);
  });

  it('неподписчик: каталог, allowance null, subscription неактивна', async () => {
    vi.mocked(analyzeCoverageViaService).mockResolvedValue(coverageWithPages([
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
    ]));
    vi.mocked(calculatePriceWaterfall).mockResolvedValue(waterfallResult({
      subtotal: 10,
      total: 10,
      accountDiscount: null,
    }));
    vi.mocked(getStudentDiscountForUser).mockResolvedValue(null);

    const res = await estimateEduPrint({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });
    if ('error' in res) throw new Error('unexpected analyze_failed');

    expect(res.allowance).toBeNull();
    expect(res.subscription.active).toBe(false);
    expect(res.pages[0].eduPriceRub).toBe(res.pages[0].catalogPriceRub);
    expect(res.pages[0].withinLimit).toBe(false);
    expect(res.summary.eduTotalRub).toBe(res.summary.catalogTotalRub);
    expect(res.summary.savingsRub).toBe(0);
  });

  it('Rust недоступен → analyze_failed, без краша, НЕ кэшируется (ретрай на след. вызове)', async () => {
    vi.mocked(analyzeCoverageViaService).mockRejectedValue(new Error('502 upstream'));
    const res = await estimateEduPrint({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });
    expect(res).toEqual({ error: 'analyze_failed' });
    // analyze_failed не должен попадать в кэш — иначе тумблер/повтор не ретраил бы Rust.
    expect(vi.mocked(cacheSet)).not.toHaveBeenCalled();
  });

  it('пустой документ (0 страниц) → analyze_failed', async () => {
    vi.mocked(analyzeCoverageViaService).mockResolvedValue(coverageWithPages([]));
    const res = await estimateEduPrint({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });
    expect(res).toEqual({ error: 'analyze_failed' });
  });

  it('colorMode color → цветной тир, detectedColor=true', async () => {
    vi.mocked(analyzeCoverageViaService).mockResolvedValue(coverageWithPages([
      { slug: COLOR_SLUG, price: 12, fill: 8, tier: 'light_color_document' },
    ]));
    vi.mocked(calculatePriceWaterfall).mockResolvedValue(waterfallResult({
      subtotal: 12,
      total: 4,
      accountDiscount: {
        accountType: 'education', label: 'Образование', source: 'education_verification',
        percent: 70, amount: 8, description: '',
        lines: [
          { serviceOptionId: COLOR_OPTION_ID, name: 'c', kind: 'document_print', label: '', percent: 70, amount: 8, quantity: 1 },
        ],
      },
      educationVolumeConsumed: { entitlementId: 'e1', userId: 'u1', documents: 1, photos: 0 },
    }));
    vi.mocked(getStudentDiscountForUser).mockResolvedValue(activeSummary());

    const res = await estimateEduPrint({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'color' });
    if ('error' in res) throw new Error('unexpected analyze_failed');

    expect(res.detectedColor).toBe(true);
    expect(res.appliedColorMode).toBe('color');
    expect(res.pages[0].isColor).toBe(true);
    expect(res.pages[0].catalogPriceRub).toBe(12);
    expect(res.pages[0].eduPriceRub).toBe(4);
  });

  it('min-check: одиночная дешёвая страница не завышается, belowMinimum=true', async () => {
    // 1 страница edu 3₽; result.total с надбавкой минимального чека = 10₽,
    // но waterfall содержит шаг minimum_check на 7₽ — вычитаем его.
    vi.mocked(analyzeCoverageViaService).mockResolvedValue(coverageWithPages([
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
    ]));
    vi.mocked(calculatePriceWaterfall).mockResolvedValue(waterfallResult({
      subtotal: 10,
      total: 10,
      waterfall: [{ step: 'minimum_check', description: '', amount: 7, runningTotal: 10 }],
      accountDiscount: {
        accountType: 'education', label: 'Образование', source: 'education_verification',
        percent: 70, amount: 7, description: '',
        lines: [
          { serviceOptionId: DOC_OPTION_ID, name: 'doc', kind: 'document_print', label: '', percent: 70, amount: 7, quantity: 1 },
        ],
      },
      educationVolumeConsumed: { entitlementId: 'e1', userId: 'u1', documents: 1, photos: 0 },
    }));
    vi.mocked(getStudentDiscountForUser).mockResolvedValue(activeSummary());

    const res = await estimateEduPrint({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });
    if ('error' in res) throw new Error('unexpected analyze_failed');

    expect(res.summary.eduTotalRub).toBe(3); // 10 (с min-check) − 7 (надбавка) = 3
    expect(res.summary.minimumCheckRub).toBe(10);
    expect(res.summary.belowMinimum).toBe(true);
  });

  it('per-page edu сумма == eduTotalRub (rounding-инвариант для документной печати)', async () => {
    vi.mocked(analyzeCoverageViaService).mockResolvedValue(coverageWithPages([
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
    ]));
    vi.mocked(calculatePriceWaterfall).mockResolvedValue(waterfallResult({
      subtotal: 30,
      total: 9, // 3×3
      accountDiscount: {
        accountType: 'education', label: 'Образование', source: 'education_verification',
        percent: 70, amount: 21, description: '',
        lines: Array.from({ length: 3 }, () => ({
          serviceOptionId: DOC_OPTION_ID, name: 'doc', kind: 'document_print' as const, label: '', percent: 70, amount: 7, quantity: 1,
        })),
      },
      educationVolumeConsumed: { entitlementId: 'e1', userId: 'u1', documents: 3, photos: 0 },
    }));
    vi.mocked(getStudentDiscountForUser).mockResolvedValue(activeSummary());

    const res = await estimateEduPrint({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });
    if ('error' in res) throw new Error('unexpected analyze_failed');

    const perPageSum = res.pages.reduce((s, p) => s + p.eduPriceRub, 0);
    expect(perPageSum).toBe(res.summary.eduTotalRub);
    expect(perPageSum).toBe(9);
  });

  it('cache hit: повторный вызов (s3Key,colorMode) НЕ зовёт Rust (тумблер туда-обратно)', async () => {
    const cachedDto = {
      pageCount: 1,
      documentType: 'pdf',
      detectedColor: false,
      appliedColorMode: 'auto',
      pages: [],
      summary: {
        catalogTotalRub: 10, eduTotalRub: 3, savingsRub: 7,
        documentsConsumed: 1, documentsOverLimit: 0, minimumCheckRub: 10, belowMinimum: true,
      },
      allowance: null,
      subscription: { active: true },
    };
    vi.mocked(cacheGet).mockResolvedValue(cachedDto);

    const res = await estimateEduPrint({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });

    expect(res).toEqual(cachedDto);
    // На cache hit — никакого тяжёлого Rust-вызова и расхода лимита.
    expect(vi.mocked(analyzeCoverageViaService)).not.toHaveBeenCalled();
    expect(vi.mocked(calculatePriceWaterfall)).not.toHaveBeenCalled();
  });

  it('line с quantity>1: covered распределяется на N страниц тира (не только на первую)', async () => {
    // Защита от CODE P1-1: если waterfall сгруппирует позиции (line.quantity=2),
    // покрытие должно лечь на 2 страницы из 3, а не на 1.
    vi.mocked(analyzeCoverageViaService).mockResolvedValue(coverageWithPages([
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
      { slug: DOC_SLUG, price: 10, fill: 8, tier: 'document' },
    ]));
    vi.mocked(calculatePriceWaterfall).mockResolvedValue(waterfallResult({
      subtotal: 30,
      total: 26, // 2×3 (covered) + 1×10 (over) + ... ; значение не проверяем здесь
      accountDiscount: {
        accountType: 'education', label: 'Образование', source: 'education_verification',
        percent: 70, amount: 14, description: '',
        // Одна строка покрывает 2 единицы (скидка 7₽/стр × 2 = 14₽).
        lines: [
          { serviceOptionId: DOC_OPTION_ID, name: 'doc', kind: 'document_print', label: '', percent: 70, amount: 14, quantity: 2 },
        ],
      },
      educationVolumeConsumed: { entitlementId: 'e1', userId: 'u1', documents: 2, photos: 0 },
    }));
    vi.mocked(getStudentDiscountForUser).mockResolvedValue(activeSummary({ print_sheets_remaining: 2 }));

    const res = await estimateEduPrint({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });
    if ('error' in res) throw new Error('unexpected analyze_failed');

    const within = res.pages.filter(p => p.withinLimit);
    expect(within).toHaveLength(2); // не 1 — covered=line.quantity=2
    expect(within.every(p => p.eduPriceRub === 3)).toBe(true); // 10 − 14/2 = 3
    expect(res.pages.filter(p => !p.withinLimit)).toHaveLength(1);
    expect(res.summary.documentsOverLimit).toBe(1);
  });
});
