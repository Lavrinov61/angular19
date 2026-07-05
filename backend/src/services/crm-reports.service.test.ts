import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CashReconciliationQueryRow } from '../types/views/crm-views.js';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: vi.fn(),
  },
}));

vi.mock('../database/db.js', () => ({ default: mockDb }));

const { getCashReconciliationReport, getDailySummary } = await import('./crm-reports.service.js');

function makeCashRow(overrides: Partial<CashReconciliationQueryRow> = {}): CashReconciliationQueryRow {
  return {
    shift_id: 'shift-1',
    shift_date: '2026-05-16',
    employee_id: 'employee-1',
    employee_name: 'Employee',
    studio_id: 'studio-1',
    studio_name: '2-ая Баррикадная 4',
    workday_status: 'completed',
    checked_in_at: '2026-05-16 08:45:00+03',
    checked_out_at: '2026-05-16 19:45:00+03',
    cash_at_open: '1000',
    cash_at_close: '3000',
    cash_payments: '2000',
    cash_pos_fiscal_payments: '1500',
    cash_pos_non_fiscal_payments: '300',
    cash_chat_fiscal_payments: '100',
    cash_chat_non_fiscal_payments: '100',
    cash_withdrawals: '0',
    receipts_count: '8',
    ...overrides,
  };
}

describe('crm reports service', () => {
  beforeEach(() => {
    vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  });

  it('splits today cash sales by fiscal mode and chat origin', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([{
      today_revenue: '2270',
      today_refunds: '0',
      today_receipts: '4',
      cash: '2270',
      cash_pos_fiscal: '1000',
      cash_pos_non_fiscal: '500',
      cash_chat_fiscal: '600',
      cash_chat_non_fiscal: '170',
      card: '0',
      sbp: '0',
      online: '0',
      subscription: '0',
      today_orders: '0',
      yesterday_revenue: '0',
      yesterday_receipts: '0',
      yesterday_orders: '0',
      week_avg_revenue: '0',
      week_avg_receipts: '0',
      week_avg_orders: '0',
      pending_orders: '0',
    }]);

    const summary = await getDailySummary();

    const sql = vi.mocked(mockDb.query).mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('chat_cash_receipts');
    expect(summary.today.payments).toMatchObject({
      cash: 2270,
      cash_pos_fiscal: 1000,
      cash_pos_non_fiscal: 500,
      cash_chat_fiscal: 600,
      cash_chat_non_fiscal: 170,
    });
  });

  it('classifies a small positive cash difference as possible tips', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      makeCashRow({ cash_at_close: '3100' }),
    ]);

    const report = await getCashReconciliationReport('2026-05-16', '2026-05-16');

    expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('FROM employee_shifts es'), [
      '2026-05-16',
      '2026-05-16',
    ]);
    expect(report.rows[0]).toMatchObject({
      cash_at_open: 1000,
      cash_payments: 2000,
      cash_withdrawals: 0,
      expected_cash: 3000,
      cash_at_close: 3100,
      difference: 100,
      status: 'possible_tip',
      status_label: 'Возможно чаевые',
    });
    expect(report.summary.possible_tip).toBe(1);
    expect(report.possible_tip_limit).toBe(500);
  });

  it('counts no-fiscal cash receipts created inside the employee workday', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      makeCashRow({ cash_payments: '2500' }),
    ]);

    await getCashReconciliationReport('2026-05-16', '2026-05-16');

    const sql = vi.mocked(mockDb.query).mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('r.shift_id = es.pos_shift_id');
    expect(sql).toContain('r.shift_id IS NULL');
    expect(sql).toContain('r.employee_id = es.employee_id');
    expect(sql).toContain('r.studio_id = es.studio_id');
    expect(sql).toContain('r.created_at >= COALESCE(es.checked_in_at');
  });

  it('summarizes balanced shifts, missing close counts and shortages', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      makeCashRow({ shift_id: 'balanced', cash_at_close: '3000' }),
      makeCashRow({ shift_id: 'missing-close', cash_at_close: null }),
      makeCashRow({ shift_id: 'shortage', cash_at_close: '2500' }),
    ]);

    const report = await getCashReconciliationReport('2026-05-10', '2026-05-16');

    expect(report.rows.map((row) => row.status)).toEqual([
      'balanced',
      'missing_close',
      'shortage',
    ]);
    expect(report.summary).toMatchObject({
      total: 3,
      balanced: 1,
      missing_close: 1,
      shortage: 1,
      issues: 2,
    });
  });
});
