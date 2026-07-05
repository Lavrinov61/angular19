import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: vi.fn(),
    queryOne: vi.fn(),
  },
}));

vi.mock('../database/db.js', () => ({ default: mockDb }));
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

const { getDashboard, getHistory } = await import('./employee-sales.service.js');

describe('employee sales service', () => {
  beforeEach(() => {
    vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
    vi.mocked(mockDb.queryOne).mockReset();
  });

  it('separates invoices issued and paid on the selected day from overall sales', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      receipts_count: '7',
      total_sales: '5000.5',
      avg_receipt: '714.357',
      total_commission: '250',
      paid_invoices_count: '2',
      paid_invoices_total: '2840',
      paid_invoices_avg: '1420',
      pending_links_count: '1',
      pending_links_total: '300',
      issued_invoices_count: '3',
      issued_invoices_total: '4400',
    });

    const dashboard = await getDashboard(
      '00000000-0000-0000-0000-000000000001',
      '2026-05-12',
    );

    expect(dashboard).toMatchObject({
      receipts_count: 7,
      total_sales: 5000.5,
      avg_receipt: 714.36,
      total_commission: 250,
      paid_invoices_count: 2,
      paid_invoices_total: 2840,
      paid_invoices_avg: 1420,
      pending_links_count: 1,
      pending_links_total: 300,
      issued_invoices_count: 3,
      issued_invoices_total: 4400,
    });

    const queryOneCall = vi.mocked(mockDb.queryOne).mock.calls[0];
    const sql = String(queryOneCall?.[0] ?? '');

    expect(queryOneCall?.[1]).toEqual([
      '00000000-0000-0000-0000-000000000001',
      '2026-05-12',
    ]);
    expect(sql).toContain('paid_invoices AS');
    expect(sql).toContain('pl.created_by = p.employee_id');
    expect(sql).toContain("(pl.created_at AT TIME ZONE 'Europe/Moscow')::date = p.target_date");
    expect(sql).toContain("(COALESCE(pl.paid_at, pl.updated_at, pl.created_at) AT TIME ZONE 'Europe/Moscow')::date = p.target_date");
    expect(sql).toContain("(ppo.created_at AT TIME ZONE 'Europe/Moscow')::date = p.target_date");
    expect(sql).toContain("(COALESCE(ppo.paid_at, ppo.updated_at, ppo.created_at) AT TIME ZONE 'Europe/Moscow')::date = p.target_date");
    expect(sql).toContain("ppo.status IN ('pending_payment', 'payment_failed', 'paid')");
    expect(sql).toContain("COALESCE(ppo.payment_status, 'none') IN ('none', 'pending', 'failed', 'paid', 'confirmed')");
    expect(sql).not.toContain("ppo.status IN ('new', 'pending_payment', 'payment_failed', 'processing', 'paid')");
    expect(sql).toContain('linked.order_ref_linked = ppo.order_id');
    expect(sql).not.toContain('assigned_operator_id = p.employee_id');
    expect(sql).toContain('assigned_employee_id = p.employee_id');
  });

  it('loads personal history from receipts, payment links and print orders', async () => {
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([{ id: 'receipt-1' }])
      .mockResolvedValueOnce([{ id: 'link-1' }])
      .mockResolvedValueOnce([{ id: 'order-1' }]);

    const history = await getHistory(
      '00000000-0000-0000-0000-000000000001',
      '2026-05-13T00:00:00.000Z',
      '2026-05-13T23:59:59.999Z',
      50,
    );

    expect(history).toEqual({
      receipts: [{ id: 'receipt-1' }],
      links: [{ id: 'link-1' }],
      orders: [{ id: 'order-1' }],
    });

    expect(mockDb.query).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(mockDb.query).mock.calls) {
      expect(call[1]).toEqual([
        '00000000-0000-0000-0000-000000000001',
        '2026-05-13T00:00:00.000Z',
        '2026-05-13T23:59:59.999Z',
        50,
      ]);
    }

    const sql = vi.mocked(mockDb.query).mock.calls.map((call) => String(call[0])).join('\n');
    expect(sql).toContain('r.employee_id = $1::uuid');
    expect(sql).toContain('pl.created_by = $1::uuid');
    expect(sql).toContain('own_shift.employee_id = $1::uuid');
    expect(sql).toContain('p.assigned_employee_id = $1::uuid');
    expect(sql).toContain(') = ($1::uuid)::text');
  });
});
