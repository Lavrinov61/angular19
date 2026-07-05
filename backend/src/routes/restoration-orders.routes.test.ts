import type { NextFunction, Request, Response } from 'express';
import fs from 'fs/promises';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

interface TestAuthRequest extends Request {
  user?: {
    readonly id: string;
    readonly email: string;
    readonly role: string;
    readonly display_name?: string;
    readonly phone?: string;
    readonly permissions?: readonly string[];
  };
}

const {
  mockDb,
  crmMocks,
  storageMocks,
  workloadMocks,
  analysisMocks,
} = vi.hoisted(() => ({
  mockDb: {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
  },
  crmMocks: {
    enqueueCrmEvent: vi.fn().mockResolvedValue(undefined),
  },
  storageMocks: {
    generatePresignedPutUrl: vi.fn().mockResolvedValue({ url: 'https://storage.example/upload' }),
    getPublicUrl: vi.fn((key: string) => `https://storage.example/${key}`),
    headObject: vi.fn().mockResolvedValue({ contentLength: 1_900_000 }),
    downloadToTemp: vi.fn(),
  },
  workloadMocks: {
    getRestorationWorkload: vi.fn().mockResolvedValue({
      activeOrders: 0,
      activeRetouchTasks: 0,
      activeWorkUnits: 0,
      completedToday: 0,
      dayCapacity: 8,
      currentDayLoad: 0,
      loadLevel: 'normal',
      leadTimeLabel: 'в течение дня',
      message: 'normal',
      updatedAt: '2026-05-27T09:00:00.000Z',
      leadTimeByTier: {
        simple: 'в течение дня',
        medium: 'в течение дня',
        complex: '1-2 дня',
        pro: 'после оценки',
      },
    }),
    leadTimeForRestorationTier: vi.fn((tier: 'simple' | 'medium' | 'complex' | 'pro') => ({
      simple: 'в течение дня',
      medium: 'в течение дня',
      complex: '1-2 дня',
      pro: 'после оценки',
    })[tier]),
  },
  analysisMocks: {
    analyzeRestorationImages: vi.fn().mockResolvedValue({
      tier: 'complex',
      title: 'Сложная реставрация',
      price: 2800,
      priceLabel: '2 800₽',
      leadTime: '1-2 дня',
      reason: 'Есть заломы и выцветание, для 20x30 потребуется заметное восстановление деталей.',
      clientReason: 'Есть заломы и выцветание, для 20x30 потребуется заметное восстановление деталей.',
      internalNotes: 'valid model analysis',
      confidence: 0.84,
      humanReviewRequired: false,
      automaticPaymentAllowed: true,
      reviewReason: null,
      model: 'google/gemini-2.5-flash',
      scores: {
        scratches: 1,
        tears: 2,
        missingAreas: 1,
        fadingContrast: 2,
        stains: 1,
        blurDetail: 1,
        faceDamage: 1,
        reconstruction: 0,
        outputScale: 2,
      },
      outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      sourceMetrics: {
        sourceWidthPx: 1800,
        sourceHeightPx: 1400,
        targetWidthPx: 2362,
        targetHeightPx: 3543,
        scaleFactor: 1.97,
        score: 2,
      },
    }),
    getRestorationAnalysisBudgetMs: vi.fn().mockReturnValue(4000),
    buildBudgetFallbackEstimate: vi.fn(() => ({
      tier: 'medium',
      title: 'Реставрация средней сложности',
      price: null,
      priceLabel: 'после оценки ретушёром',
      leadTime: 'в течение дня',
      reason: 'Фото получено. Стоимость подтвердит ретушёр до начала работы.',
      clientReason: 'Фото получено. Стоимость подтвердит ретушёр до начала работы.',
      internalNotes: 'budget fallback: analysis exceeded time budget',
      confidence: 0,
      humanReviewRequired: true,
      automaticPaymentAllowed: false,
      reviewReason: 'Фото получено. Стоимость подтвердит ретушёр до начала работы.',
      model: 'manual_review',
      scores: {
        scratches: 0,
        tears: 0,
        missingAreas: 0,
        fadingContrast: 0,
        stains: 0,
        blurDetail: 0,
        faceDamage: 0,
        reconstruction: 0,
        outputScale: 0,
      },
      outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      sourceMetrics: {
        sourceWidthPx: 1800,
        sourceHeightPx: 1400,
        targetWidthPx: 2362,
        targetHeightPx: 3543,
        scaleFactor: 1.97,
        score: 2,
      },
    })),
  },
}));

vi.mock('../database/db.js', () => ({
  default: mockDb,
}));

vi.mock('../middleware/auth.js', () => ({
  optionalAuth: (req: Request, _res: Response, next: NextFunction) => {
    const authReq = req as TestAuthRequest;
    authReq.user = {
      id: 'client-id',
      email: 'client@example.com',
      role: 'client',
      display_name: 'Иван Иванов',
      phone: '+79001234567',
      permissions: [],
    };
    next();
  },
}));

vi.mock('../middleware/upload-limiter.js', () => ({
  createUploadLimiter: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../services/storage.service.js', () => ({
  storageService: storageMocks,
}));

vi.mock('../services/av-scan-worker.js', () => ({
  enqueueAvScan: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/crm-event-queue.service.js', () => crmMocks);

vi.mock('../services/restoration-workload.service.js', () => workloadMocks);

vi.mock('../services/restoration-image-analysis.service.js', () => analysisMocks);

vi.mock('../utils/secure-random.js', () => ({
  generateOrderId: vi.fn().mockReturnValue('REST-TEST-001'),
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

let app: import('express').Express;
const testPreviewSourcePath = '/tmp/restoration-route-preview-source.jpg';

beforeAll(async () => {
  await sharp({
    create: {
      width: 40,
      height: 30,
      channels: 3,
      background: '#d7c3a4',
    },
  }).jpeg().toFile(testPreviewSourcePath);

  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./restoration-orders.routes.js');
  app = createTestApp(router);
});

afterAll(async () => {
  await fs.rm(testPreviewSourcePath, { force: true });
});

function resetMocks(): void {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockImplementation(async (sql: unknown) => {
    const query = String(sql);
    if (query.includes('INSERT INTO conversations')) {
      return { id: 'conversation-id' };
    }
    if (query.includes('INSERT INTO photo_print_orders')) {
      return { order_id: 'REST-TEST-001' };
    }
    return null;
  });
  crmMocks.enqueueCrmEvent.mockReset().mockResolvedValue(undefined);
  storageMocks.headObject.mockReset().mockResolvedValue({ contentLength: 1_900_000 });
  storageMocks.downloadToTemp.mockReset().mockResolvedValue(testPreviewSourcePath);
  storageMocks.getPublicUrl.mockClear();
  workloadMocks.getRestorationWorkload.mockClear();
  workloadMocks.leadTimeForRestorationTier.mockClear();
  analysisMocks.analyzeRestorationImages.mockReset().mockResolvedValue({
    tier: 'complex',
    title: 'Сложная реставрация',
    price: 2800,
    priceLabel: '2 800₽',
    leadTime: '1-2 дня',
    reason: 'Есть заломы и выцветание, для 20x30 потребуется заметное восстановление деталей.',
    clientReason: 'Есть заломы и выцветание, для 20x30 потребуется заметное восстановление деталей.',
    internalNotes: 'valid model analysis',
    confidence: 0.84,
    humanReviewRequired: false,
    automaticPaymentAllowed: true,
    reviewReason: null,
    model: 'google/gemini-2.5-flash',
    scores: {
      scratches: 1,
      tears: 2,
      missingAreas: 1,
      fadingContrast: 2,
      stains: 1,
      blurDetail: 1,
      faceDamage: 1,
      reconstruction: 0,
      outputScale: 2,
    },
    outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
    sourceMetrics: {
      sourceWidthPx: 1800,
      sourceHeightPx: 1400,
      targetWidthPx: 2362,
      targetHeightPx: 3543,
      scaleFactor: 1.97,
      score: 2,
    },
  });
  analysisMocks.getRestorationAnalysisBudgetMs.mockClear().mockReturnValue(4000);
  analysisMocks.buildBudgetFallbackEstimate.mockClear();
}

function findDbCall(fragment: string): readonly unknown[] {
  const call = mockDb.queryOne.mock.calls.find(([sql]) => String(sql).includes(fragment));
  expect(call).toBeDefined();
  return call ?? [];
}

function callParams(call: readonly unknown[]): readonly unknown[] {
  const params = call[1];
  expect(Array.isArray(params)).toBe(true);
  return Array.isArray(params) ? params : [];
}

describe('restoration upload completion', () => {
  beforeEach(resetMocks);

  it('creates an authenticated restoration order using schema-compatible fields', async () => {
    const res = await request(app)
      .post('/upload/complete')
      .send({
        pageUrl: 'https://svoefoto.ru/restavratsiya-foto',
        files: [
          {
            s3Key: 'restoration/old-photo.png',
            fileName: 'old-photo.png',
            contentType: 'image/png',
            fileSize: 1_900_000,
            width: 1800,
            height: 1400,
          },
        ],
        outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        orderId: 'REST-TEST-001',
        paymentUrl: '/pay/REST-TEST-001',
        estimate: {
          title: 'Сложная реставрация',
          automaticPaymentAllowed: true,
          outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
        },
      },
    });

    expect(analysisMocks.analyzeRestorationImages).toHaveBeenCalledWith(expect.objectContaining({
      outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      files: [expect.objectContaining({
        s3Key: 'restoration/old-photo.png',
        sourceUrl: 'https://storage.example/restoration/old-photo.png',
        analysisImageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
        width: 1800,
        height: 1400,
      })],
    }));

    const conversationSql = String(findDbCall('INSERT INTO conversations')[0]);
    expect(conversationSql).toContain("'restoration_upload'");
    expect(conversationSql).not.toContain("'restoration_quick_upload'");
    expect('restoration_upload'.length).toBeLessThanOrEqual(20);

    const orderCall = findDbCall('INSERT INTO photo_print_orders');
    const orderSql = String(orderCall[0]);
    const orderParams = callParams(orderCall);
    expect(orderSql).toContain('service_type');
    expect(orderParams[1]).toBe('custom');
    expect(orderParams[6]).toBe(2800);
    expect(orderParams[8]).toBe('pending_payment');
    expect(orderParams[12]).toBe('restoration');
    expect(String(orderParams[7])).toContain('"analysis"');
    expect(String(orderParams[7])).toContain('"outputTarget"');

    expect(crmMocks.enqueueCrmEvent).toHaveBeenCalledWith(
      'order',
      'REST-TEST-001',
      'order_created',
      expect.objectContaining({
        metadata: expect.objectContaining({
          paymentRequired: true,
          confidence: 0.84,
          model: 'google/gemini-2.5-flash',
          reviewReason: null,
          sourceMetrics: expect.objectContaining({
            scaleFactor: 1.97,
            score: 2,
          }),
          scores: expect.objectContaining({
            fadingContrast: 2,
            outputScale: 2,
          }),
          restorationAnalysis: expect.objectContaining({
            confidence: 0.84,
            model: 'google/gemini-2.5-flash',
            reviewReason: null,
            humanReviewRequired: false,
            automaticPaymentAllowed: true,
            sourceMetrics: expect.objectContaining({
              sourceWidthPx: 1800,
              targetHeightPx: 3543,
              scaleFactor: 1.97,
            }),
            scores: expect.objectContaining({
              tears: 2,
              outputScale: 2,
            }),
          }),
        }),
      }),
    );
  });

  it('returns the budget fallback estimate within the budget when analysis is slow', async () => {
    analysisMocks.getRestorationAnalysisBudgetMs.mockReturnValue(40);
    // Анализ зависает дольше бюджета. Промис снабжён .catch в роуте — после
    // ответа он спокойно резолвится, без unhandledRejection.
    let resolveSlow: (() => void) | undefined;
    analysisMocks.analyzeRestorationImages.mockImplementationOnce(
      () => new Promise(resolve => {
        resolveSlow = () => resolve({
          tier: 'complex',
          title: 'Сложная реставрация',
          price: 2800,
          priceLabel: '2 800₽',
          leadTime: '1-2 дня',
          reason: 'late',
          clientReason: 'late',
          internalNotes: 'late',
          confidence: 0.84,
          humanReviewRequired: false,
          automaticPaymentAllowed: true,
          reviewReason: null,
          model: 'google/gemini-2.5-flash',
          scores: {
            scratches: 0, tears: 0, missingAreas: 0, fadingContrast: 0,
            stains: 0, blurDetail: 0, faceDamage: 0, reconstruction: 0, outputScale: 0,
          },
          outputTarget: { kind: 'digital', label: 'Цифровой файл' },
          sourceMetrics: {
            sourceWidthPx: null, sourceHeightPx: null, targetWidthPx: null,
            targetHeightPx: null, scaleFactor: 1, score: 0,
          },
        });
        setTimeout(() => resolveSlow?.(), 3000);
      }),
    );

    const startedAt = Date.now();
    const res = await request(app)
      .post('/upload/complete')
      .send({
        files: [
          {
            s3Key: 'restoration/slow.png',
            fileName: 'slow.png',
            contentType: 'image/png',
            fileSize: 1_500_000,
            width: 1800,
            height: 1400,
          },
        ],
        outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      });
    const elapsed = Date.now() - startedAt;

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        orderId: 'REST-TEST-001',
        paymentUrl: null,
        estimate: {
          model: 'manual_review',
          humanReviewRequired: true,
          automaticPaymentAllowed: false,
          price: null,
        },
      },
    });
    // Бюджет 40мс + сетевой/sharp overhead — должно вернуться кратно быстрее
    // зависшего анализа (3000мс).
    expect(elapsed).toBeLessThan(2500);
    expect(analysisMocks.buildBudgetFallbackEstimate).toHaveBeenCalled();

    // Заказ создан со статусом 'new' (не payable).
    const orderParams = callParams(findDbCall('INSERT INTO photo_print_orders'));
    expect(orderParams[8]).toBe('new');

    // Дать зависшему анализу резолвиться до конца теста (анти-«висящий промис»).
    resolveSlow?.();
    await new Promise(resolve => setImmediate(resolve));
  });

  it('returns the budget fallback when the PRE-AI stage (download+sharp) is slow', async () => {
    analysisMocks.getRestorationAnalysisBudgetMs.mockReturnValue(40);
    // Зависает именно скачивание (buildAnalysisFiles до AI). Бюджет покрывает
    // pre-AI флаг, а не только сам анализ. analyze при этом быстрый, но до него
    // не дойдёт — race выигрывает fallback.
    let resolveDownload: (() => void) | undefined;
    storageMocks.downloadToTemp.mockImplementationOnce(
      () => new Promise<string>(resolve => {
        resolveDownload = () => resolve(testPreviewSourcePath);
        setTimeout(() => resolveDownload?.(), 3000);
      }),
    );

    const startedAt = Date.now();
    const res = await request(app)
      .post('/upload/complete')
      .send({
        files: [
          {
            s3Key: 'restoration/slow-download.png',
            fileName: 'slow-download.png',
            contentType: 'image/png',
            fileSize: 1_500_000,
            width: 1800,
            height: 1400,
          },
        ],
        outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      });
    const elapsed = Date.now() - startedAt;

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        orderId: 'REST-TEST-001',
        paymentUrl: null,
        estimate: { model: 'manual_review', humanReviewRequired: true },
      },
    });
    expect(elapsed).toBeLessThan(2500);
    expect(analysisMocks.buildBudgetFallbackEstimate).toHaveBeenCalled();
    // pre-AI не завершился → AI-анализ даже не вызван
    expect(analysisMocks.analyzeRestorationImages).not.toHaveBeenCalled();
    expect(callParams(findDbCall('INSERT INTO photo_print_orders'))[8]).toBe('new');

    // Резолвим зависший download и ДОЖИДАЕМСЯ, пока «проигравший» enrichment
    // полностью отработает (download→sharp→analyze), иначе его отложенный вызов
    // analyzeRestorationImages протечёт в следующий тест и съест его once-мок.
    resolveDownload?.();
    await vi.waitFor(() => {
      expect(analysisMocks.analyzeRestorationImages).toHaveBeenCalled();
    });
    await new Promise(resolve => setImmediate(resolve));
  });

  it('uses the budget fallback and does not leak unhandledRejection when enrichment rejects', async () => {
    analysisMocks.getRestorationAnalysisBudgetMs.mockReturnValue(40);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    // enrichment REJECT-ится позже бюджета. .catch в роуте должен проглотить
    // отклонение, заказ создаётся через fallback.
    analysisMocks.analyzeRestorationImages.mockImplementationOnce(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('enrichment exploded late')), 200);
      }),
    );

    const res = await request(app)
      .post('/upload/complete')
      .send({
        files: [
          {
            s3Key: 'restoration/reject.png',
            fileName: 'reject.png',
            contentType: 'image/png',
            fileSize: 1_500_000,
            width: 1800,
            height: 1400,
          },
        ],
        outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: { orderId: 'REST-TEST-001', estimate: { model: 'manual_review' } },
    });

    // Дождаться, пока отложенный reject отработает, и убедиться — нет unhandledRejection.
    await new Promise(resolve => setTimeout(resolve, 350));
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });

  it('creates a non-payable restoration request when analysis requires retoucher review', async () => {
    analysisMocks.analyzeRestorationImages.mockResolvedValueOnce({
      tier: 'pro',
      title: 'Реставрация профи',
      price: null,
      priceLabel: 'после оценки ретушёром',
      leadTime: 'после оценки',
      reason: 'Лицо повреждено, стоимость подтвердит ретушёр.',
      clientReason: 'Лицо повреждено, стоимость подтвердит ретушёр.',
      internalNotes: 'face damage score 3',
      confidence: 0.91,
      humanReviewRequired: true,
      automaticPaymentAllowed: false,
      reviewReason: 'Критичные повреждения лица: стоимость должен подтвердить ретушёр до оплаты.',
      model: 'google/gemini-2.5-flash',
      scores: {
        scratches: 2,
        tears: 2,
        missingAreas: 2,
        fadingContrast: 2,
        stains: 1,
        blurDetail: 2,
        faceDamage: 3,
        reconstruction: 2,
        outputScale: 2,
      },
      outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      sourceMetrics: {
        sourceWidthPx: 1500,
        sourceHeightPx: 2100,
        targetWidthPx: 2362,
        targetHeightPx: 3543,
        scaleFactor: 1.69,
        score: 1,
      },
    });

    const res = await request(app)
      .post('/upload/complete')
      .send({
        files: [
          {
            s3Key: 'restoration/face.png',
            fileName: 'face.png',
            contentType: 'image/png',
            fileSize: 1_500_000,
            width: 1500,
            height: 2100,
          },
        ],
        outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        orderId: 'REST-TEST-001',
        paymentUrl: null,
        estimate: {
          price: null,
          priceLabel: 'после оценки ретушёром',
          automaticPaymentAllowed: false,
          humanReviewRequired: true,
        },
      },
    });

    const orderParams = callParams(findDbCall('INSERT INTO photo_print_orders'));
    expect(orderParams[6]).toBeNull();
    expect(orderParams[8]).toBe('new');
    expect(crmMocks.enqueueCrmEvent).toHaveBeenCalledWith(
      'order',
      'REST-TEST-001',
      'order_created',
      expect.objectContaining({
        metadata: expect.objectContaining({
          paymentRequired: false,
          humanReviewRequired: true,
          reviewReason: 'Критичные повреждения лица: стоимость должен подтвердить ретушёр до оплаты.',
          restorationAnalysis: expect.objectContaining({
            price: null,
            priceLabel: 'после оценки ретушёром',
            confidence: 0.91,
            reviewReason: 'Критичные повреждения лица: стоимость должен подтвердить ретушёр до оплаты.',
          }),
        }),
      }),
    );
  });
});
