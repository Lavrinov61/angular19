import { describe, expect, it } from 'vitest';
import {
  formatRestorationAnalysisConfidence,
  formatRestorationAnalysisModel,
  formatRestorationAnalysisScale,
  formatRestorationAnalysisStatusLabel,
  restorationAnalysisScoreChips,
  readRestorationAnalysisMetadata,
} from './restoration-analysis-metadata.util';

describe('restoration analysis metadata helpers', () => {
  it('reads nested CRM restoration analysis metadata and formats the key admin facts', () => {
    const analysis = readRestorationAnalysisMetadata({
      restorationAnalysis: {
        tier: 'complex',
        title: 'Сложная реставрация',
        price: null,
        priceLabel: 'после оценки ретушёром',
        confidence: 0.89,
        humanReviewRequired: true,
        automaticPaymentAllowed: false,
        reviewReason: 'Сильное увеличение при низком качестве исходника: стоимость должен подтвердить ретушёр до оплаты.',
        model: 'google/gemini-2.5-flash',
        scores: {
          scratches: 1,
          fadingContrast: 3,
          stains: 2,
          outputScale: 3,
        },
        sourceMetrics: {
          sourceWidthPx: 420,
          sourceHeightPx: 300,
          targetWidthPx: 2362,
          targetHeightPx: 3543,
          scaleFactor: 8.44,
          score: 3,
        },
      },
    });

    expect(analysis).not.toBeNull();
    expect(analysis?.reviewReason).toContain('Сильное увеличение');
    expect(formatRestorationAnalysisStatusLabel(analysis)).toBe('оценка ретушёром');
    expect(formatRestorationAnalysisConfidence(analysis)).toBe('89%');
    expect(formatRestorationAnalysisModel(analysis)).toBe('gemini-2.5-flash');
    expect(formatRestorationAnalysisScale(analysis)).toBe('x8.44 · 420x300 → 2362x3543 px');
    expect(restorationAnalysisScoreChips(analysis)).toEqual([
      'Масштаб 3/3',
      'Выцветание 3/3',
      'Пятна 2/3',
      'Царапины 1/3',
    ]);
  });

  it('returns null when metadata has no restoration analysis payload', () => {
    expect(readRestorationAnalysisMetadata({ paymentStatus: 'pending' })).toBeNull();
  });

  it('does not render legacy score-only restoration metadata as an AI report', () => {
    expect(readRestorationAnalysisMetadata({
      estimateTier: 'complex',
      scores: { outputScale: 2, scratches: 1 },
    })).toBeNull();
  });
});
