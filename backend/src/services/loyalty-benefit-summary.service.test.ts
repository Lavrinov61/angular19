import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, mockQueryOne, mockQueryRows, resetMockDb } from '../test-utils/index.js';

vi.mock('../database/db.js', () => ({
  default: mockDb,
}));

const { getBenefitSummary } = await import('./loyalty.service.js');

describe('getBenefitSummary', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('returns current balance, monthly bars, and earned/spent breakdowns', async () => {
    mockQueryOne({ points: 245 });
    mockQueryRows([
      {
        period_month: '2026-04-01',
        earned_points: 0,
        spent_points: 0,
        cashback_points: 0,
        referral_points: 0,
        other_earned_points: 0,
        order_spent_points: 0,
        adjustment_spent_points: 0,
        other_spent_points: 0,
      },
      {
        period_month: '2026-05-01',
        earned_points: 700,
        spent_points: 120,
        cashback_points: 80,
        referral_points: 200,
        other_earned_points: 420,
        order_spent_points: 100,
        adjustment_spent_points: 20,
        other_spent_points: 0,
      },
    ]);

    const summary = await getBenefitSummary('profile-1', 2);

    expect(summary.currentBalancePoints).toBe(245);
    expect(summary.currentBalanceRubles).toBe(245);
    expect(summary.currentMonth.periodMonth).toBe('2026-05-01');
    expect(summary.currentMonth.earned).toBe(700);
    expect(summary.currentMonth.spent).toBe(120);
    expect(summary.months).toEqual([
      expect.objectContaining({ periodMonth: '2026-04-01', label: 'Апр', earned: 0, spent: 0 }),
      expect.objectContaining({ periodMonth: '2026-05-01', label: 'Май', earned: 700, spent: 120 }),
    ]);
    expect(summary.earnedBreakdown).toEqual([
      { key: 'cashback', label: 'Кэшбэк', amount: 80, color: '#34c38f' },
      { key: 'referrals', label: 'Рекомендации друзьям', amount: 200, color: '#b45ee8' },
      { key: 'other', label: 'Остальное', amount: 420, color: '#ff9f2e' },
    ]);
    expect(summary.spentBreakdown).toEqual([
      { key: 'orders', label: 'Оплата заказов бонусами', amount: 100, color: '#8067f5' },
      { key: 'adjustments', label: 'Корректировки', amount: 20, color: '#ef4444' },
      { key: 'other', label: 'Остальное', amount: 0, color: '#9ca3af' },
    ]);
    expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('generate_series'), ['profile-1', 2]);
  });
});
