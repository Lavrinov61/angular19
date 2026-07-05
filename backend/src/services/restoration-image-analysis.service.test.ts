import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RestorationWorkloadSnapshot } from './restoration-workload.service.js';

const { falMocks } = vi.hoisted(() => ({
  falMocks: {
    enabled: true,
    run: vi.fn(),
  },
}));

vi.mock('./fal-ai.service.js', () => ({
  falAIService: falMocks,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

const workload: RestorationWorkloadSnapshot = {
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
};

describe('restoration image analysis', () => {
  beforeEach(() => {
    falMocks.enabled = true;
    falMocks.run.mockReset();
  });

  it('normalizes print targets and scores output enlargement automatically', async () => {
    const {
      calculateOutputScale,
      normalizeRestorationOutputTarget,
    } = await import('./restoration-image-analysis.service.js');

    const target = normalizeRestorationOutputTarget({
      kind: 'print',
      widthCm: 20,
      heightCm: 30,
      label: '20x30 см',
    });
    const scale = calculateOutputScale([
      {
        s3Key: 'restoration/source.jpg',
        fileName: 'source.jpg',
        fileSize: 1_900_000,
        contentType: 'image/jpeg',
        sourceUrl: 'https://storage.example/restoration/source.jpg',
        width: 1200,
        height: 1800,
      },
    ], target);

    expect(target).toEqual({
      kind: 'print',
      widthCm: 20,
      heightCm: 30,
      dpi: 300,
      label: '20x30 см',
    });
    expect(scale.targetWidthPx).toBe(2362);
    expect(scale.targetHeightPx).toBe(3543);
    expect(scale.scaleFactor).toBeCloseTo(1.97, 2);
    expect(scale.score).toBe(2);
  });

  it('maps valid fal.ai vision JSON to a payable restoration estimate', async () => {
    const { analyzeRestorationImages } = await import('./restoration-image-analysis.service.js');
    falMocks.run.mockResolvedValueOnce({
      output: JSON.stringify({
        confidence: 0.88,
        clientReason: 'Есть заломы и выцветание, но лицо читается.',
        internalNotes: 'Readable portrait, moderate cleanup.',
        humanReviewRecommended: false,
        scores: {
          scratches: 1,
          tears: 2,
          missingAreas: 0,
          fadingContrast: 2,
          stains: 1,
          blurDetail: 1,
          faceDamage: 1,
          reconstruction: 0,
        },
      }),
    });

    const result = await analyzeRestorationImages({
      files: [
        {
          s3Key: 'restoration/old-photo.png',
          fileName: 'old-photo.png',
          fileSize: 1_900_000,
          contentType: 'image/png',
          sourceUrl: 'https://storage.example/restoration/old-photo.png',
          analysisImageUrl: 'data:image/jpeg;base64,preview',
          width: 1800,
          height: 1400,
        },
      ],
      outputTarget: { kind: 'print', widthCm: 15, heightCm: 21, dpi: 300, label: '15x21 см' },
      workload,
    });

    expect(falMocks.run).toHaveBeenCalledWith(
      'openrouter/router/vision',
      expect.objectContaining({
        image_urls: ['data:image/jpeg;base64,preview'],
        model: expect.stringContaining('gemini'),
      }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(result).toMatchObject({
      tier: 'medium',
      title: 'Реставрация средней сложности',
      price: 1600,
      priceLabel: '1 600₽',
      automaticPaymentAllowed: true,
      humanReviewRequired: false,
      reviewReason: null,
      confidence: 0.88,
    });
  });

  it('uses requested print size as a minimum complexity floor', async () => {
    const { analyzeRestorationImages } = await import('./restoration-image-analysis.service.js');
    falMocks.run.mockResolvedValueOnce({
      output: JSON.stringify({
        confidence: 0.9,
        clientReason: 'Видимых повреждений немного.',
        internalNotes: 'Low visual damage, high enlargement.',
        humanReviewRecommended: false,
        scores: {
          scratches: 0,
          tears: 0,
          missingAreas: 0,
          fadingContrast: 0,
          stains: 0,
          blurDetail: 0,
          faceDamage: 0,
          reconstruction: 0,
        },
      }),
    });

    const result = await analyzeRestorationImages({
      files: [
        {
          s3Key: 'restoration/small-source.jpg',
          fileName: 'small-source.jpg',
          fileSize: 120_000,
          contentType: 'image/jpeg',
          sourceUrl: 'https://storage.example/restoration/small-source.jpg',
          analysisImageUrl: 'data:image/jpeg;base64,preview',
          width: 420,
          height: 300,
        },
      ],
      outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      workload,
    });

    expect(result.tier).toBe('complex');
    expect(result.price).toBe(2800);
    expect(result.scores.outputScale).toBe(3);
    expect(result.sourceMetrics.scaleFactor).toBe(8.44);
    expect(result.clientReason).toContain('сильное увеличение x8.44');
  });

  it('blocks automatic payment for strong enlargement with low source quality', async () => {
    const { analyzeRestorationImages } = await import('./restoration-image-analysis.service.js');
    falMocks.run.mockResolvedValueOnce({
      output: JSON.stringify({
        confidence: 0.89,
        clientReason: 'Фото сильно выцвело, детали читаются неравномерно.',
        internalNotes: 'Strong print enlargement, faded low-detail source.',
        humanReviewRecommended: false,
        scores: {
          scratches: 1,
          tears: 0,
          missingAreas: 0,
          fadingContrast: 3,
          stains: 2,
          blurDetail: 0,
          faceDamage: 0,
          reconstruction: 0,
        },
      }),
    });

    const result = await analyzeRestorationImages({
      files: [
        {
          s3Key: 'restoration/faded-small.jpg',
          fileName: 'faded-small.jpg',
          fileSize: 100_000,
          contentType: 'image/jpeg',
          sourceUrl: 'https://storage.example/restoration/faded-small.jpg',
          analysisImageUrl: 'data:image/jpeg;base64,preview',
          width: 420,
          height: 300,
        },
      ],
      outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      workload,
    });

    expect(result.tier).toBe('complex');
    expect(result.humanReviewRequired).toBe(true);
    expect(result.automaticPaymentAllowed).toBe(false);
    expect(result.price).toBeNull();
    expect(result.priceLabel).toBe('после оценки ретушёром');
    expect(result.reviewReason).toContain('Сильное увеличение');
    expect(result.reviewReason).toContain('ретушёр');
  });

  it('requires human review when model output is invalid twice', async () => {
    const { analyzeRestorationImages } = await import('./restoration-image-analysis.service.js');
    falMocks.run
      .mockResolvedValueOnce({ output: 'not json' })
      .mockResolvedValueOnce({ text: 'still not json' });

    const result = await analyzeRestorationImages({
      files: [
        {
          s3Key: 'restoration/broken.jpg',
          fileName: 'broken.jpg',
          fileSize: 900_000,
          contentType: 'image/jpeg',
          sourceUrl: 'https://storage.example/restoration/broken.jpg',
          width: 900,
          height: 1200,
        },
      ],
      outputTarget: { kind: 'digital', label: 'Цифровой файл' },
      workload,
    });

    expect(falMocks.run).toHaveBeenCalledTimes(2);
    expect(result.humanReviewRequired).toBe(true);
    expect(result.automaticPaymentAllowed).toBe(false);
    expect(result.price).toBeNull();
    expect(result.priceLabel).toBe('после оценки ретушёром');
    expect(result.clientReason).toContain('ретушёр');
    expect(result.reviewReason).toContain('автоматический анализ');
  });

  it('clamps out-of-range confidence into [0,1] (95 -> 0.95, 150 -> 1, 0.4 as is)', async () => {
    const { analyzeRestorationImages } = await import('./restoration-image-analysis.service.js');

    const baseScores = {
      scratches: 1,
      tears: 1,
      missingAreas: 0,
      fadingContrast: 1,
      stains: 1,
      blurDetail: 1,
      faceDamage: 1,
      reconstruction: 0,
    };
    const file = {
      s3Key: 'restoration/conf.jpg',
      fileName: 'conf.jpg',
      fileSize: 900_000,
      contentType: 'image/jpeg',
      sourceUrl: 'https://storage.example/restoration/conf.jpg',
      analysisImageUrl: 'data:image/jpeg;base64,preview',
      width: 1500,
      height: 2100,
    } as const;
    const target = { kind: 'digital', label: 'Цифровой файл' } as const;

    falMocks.run.mockResolvedValueOnce({
      output: JSON.stringify({
        confidence: 95,
        clientReason: 'Лёгкие повреждения, лицо читается.',
        internalNotes: 'n',
        humanReviewRecommended: false,
        scores: baseScores,
      }),
    });
    const high = await analyzeRestorationImages({ files: [file], outputTarget: target, workload });
    expect(high.confidence).toBe(0.95);
    expect(high.automaticPaymentAllowed).toBe(true);

    falMocks.run.mockResolvedValueOnce({
      output: JSON.stringify({
        confidence: 150,
        clientReason: 'Лёгкие повреждения, лицо читается.',
        internalNotes: 'n',
        humanReviewRecommended: false,
        scores: baseScores,
      }),
    });
    const over = await analyzeRestorationImages({ files: [file], outputTarget: target, workload });
    expect(over.confidence).toBe(1);

    falMocks.run.mockResolvedValueOnce({
      output: JSON.stringify({
        confidence: 0.4,
        clientReason: 'Лёгкие повреждения, лицо читается.',
        internalNotes: 'n',
        humanReviewRecommended: false,
        scores: baseScores,
      }),
    });
    const low = await analyzeRestorationImages({ files: [file], outputTarget: target, workload });
    expect(low.confidence).toBe(0.4);
    // confidence < 0.75 -> ручная проверка, без авто-оплаты
    expect(low.automaticPaymentAllowed).toBe(false);
  });

  it('coerces non-numeric/invalid confidence to 0 instead of failing the analysis', async () => {
    const { analyzeRestorationImages } = await import('./restoration-image-analysis.service.js');

    const baseScores = {
      scratches: 1,
      tears: 1,
      missingAreas: 0,
      fadingContrast: 1,
      stains: 1,
      blurDetail: 1,
      faceDamage: 1,
      reconstruction: 0,
    };
    const file = {
      s3Key: 'restoration/conf-bad.jpg',
      fileName: 'conf-bad.jpg',
      fileSize: 900_000,
      contentType: 'image/jpeg',
      sourceUrl: 'https://storage.example/restoration/conf-bad.jpg',
      analysisImageUrl: 'data:image/jpeg;base64,preview',
      width: 1500,
      height: 2100,
    } as const;
    const target = { kind: 'digital', label: 'Цифровой файл' } as const;

    // 1) confidence: NaN — раньше валил modelAnalysisSchema.parse → обе попытки в catch
    falMocks.run.mockReset();
    falMocks.run.mockResolvedValueOnce({
      output: JSON.stringify({
        confidence: Number.NaN,
        clientReason: 'Лёгкие повреждения.',
        internalNotes: 'n',
        humanReviewRecommended: false,
        scores: baseScores,
      }),
    });
    const nan = await analyzeRestorationImages({ files: [file], outputTarget: target, workload });
    expect(nan.confidence).toBe(0);
    // невалидный confidence не валит анализ → одна успешная попытка, не fallback на 2-ю
    expect(falMocks.run).toHaveBeenCalledTimes(1);
    expect(nan.humanReviewRequired).toBe(true);
    expect(nan.automaticPaymentAllowed).toBe(false);
    expect(nan.model).not.toBe('manual_review');

    // 2) confidence: -5 (отрицательное)
    falMocks.run.mockReset();
    falMocks.run.mockResolvedValueOnce({
      output: JSON.stringify({
        confidence: -5,
        clientReason: 'Лёгкие повреждения.',
        internalNotes: 'n',
        humanReviewRecommended: false,
        scores: baseScores,
      }),
    });
    const neg = await analyzeRestorationImages({ files: [file], outputTarget: target, workload });
    expect(neg.confidence).toBe(0);
    expect(falMocks.run).toHaveBeenCalledTimes(1);

    // 3) confidence: "N/A" (нечисловая строка)
    falMocks.run.mockReset();
    falMocks.run.mockResolvedValueOnce({
      output: JSON.stringify({
        confidence: 'N/A',
        clientReason: 'Лёгкие повреждения.',
        internalNotes: 'n',
        humanReviewRecommended: false,
        scores: baseScores,
      }),
    });
    const na = await analyzeRestorationImages({ files: [file], outputTarget: target, workload });
    expect(na.confidence).toBe(0);
    expect(falMocks.run).toHaveBeenCalledTimes(1);

    // 4) confidence отсутствует
    falMocks.run.mockReset();
    falMocks.run.mockResolvedValueOnce({
      output: JSON.stringify({
        clientReason: 'Лёгкие повреждения.',
        internalNotes: 'n',
        humanReviewRecommended: false,
        scores: baseScores,
      }),
    });
    const missing = await analyzeRestorationImages({ files: [file], outputTarget: target, workload });
    expect(missing.confidence).toBe(0);
    expect(falMocks.run).toHaveBeenCalledTimes(1);
  });

  it('falls back to digital output target for malformed outputTarget without throwing', async () => {
    const { normalizeRestorationOutputTarget } = await import('./restoration-image-analysis.service.js');

    expect(() => normalizeRestorationOutputTarget('totally-broken')).not.toThrow();
    expect(normalizeRestorationOutputTarget('totally-broken')).toEqual({
      kind: 'digital',
      label: 'Цифровой файл',
    });
    expect(normalizeRestorationOutputTarget({ kind: 'print' })).toEqual({
      kind: 'digital',
      label: 'Цифровой файл',
    });
  });

  it('builds a consistent manual-review fallback estimate without calling fal.ai', async () => {
    const { buildBudgetFallbackEstimate } = await import('./restoration-image-analysis.service.js');

    const result = buildBudgetFallbackEstimate({
      files: [
        {
          s3Key: 'restoration/budget.jpg',
          fileName: 'budget.jpg',
          fileSize: 1_200_000,
          contentType: 'image/jpeg',
          sourceUrl: 'https://storage.example/restoration/budget.jpg',
          width: 1200,
          height: 1800,
        },
      ],
      outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      workload,
    });

    expect(falMocks.run).not.toHaveBeenCalled();
    expect(result.model).toBe('manual_review');
    expect(result.humanReviewRequired).toBe(true);
    expect(result.automaticPaymentAllowed).toBe(false);
    expect(result.price).toBeNull();
    expect(result.priceLabel).toBe('после оценки ретушёром');
    expect(result.outputTarget).toEqual({ kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' });
    expect(result.sourceMetrics.sourceWidthPx).toBe(1200);
    expect(result.sourceMetrics.targetWidthPx).toBe(2362);
    expect(result.reviewReason).toContain('ретушёр');
  });

  it('blocks automatic payment for severe face damage even with valid JSON', async () => {
    const { analyzeRestorationImages } = await import('./restoration-image-analysis.service.js');
    falMocks.run.mockResolvedValueOnce({
      output: JSON.stringify({
        confidence: 0.91,
        clientReason: 'Лицо повреждено, нужна ручная реконструкция.',
        internalNotes: 'Face area has critical missing detail.',
        humanReviewRecommended: false,
        scores: {
          scratches: 2,
          tears: 2,
          missingAreas: 2,
          fadingContrast: 2,
          stains: 1,
          blurDetail: 2,
          faceDamage: 3,
          reconstruction: 2,
        },
      }),
    });

    const result = await analyzeRestorationImages({
      files: [
        {
          s3Key: 'restoration/face.jpg',
          fileName: 'face.jpg',
          fileSize: 1_200_000,
          contentType: 'image/jpeg',
          sourceUrl: 'https://storage.example/restoration/face.jpg',
          width: 1500,
          height: 2100,
        },
      ],
      outputTarget: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
      workload,
    });

    expect(result.tier).toBe('pro');
    expect(result.humanReviewRequired).toBe(true);
    expect(result.automaticPaymentAllowed).toBe(false);
    expect(result.price).toBeNull();
    expect(result.reviewReason).toContain('Критичные повреждения');
  });
});
