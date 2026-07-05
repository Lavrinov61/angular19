import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: vi.fn(),
    queryOne: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../database/db.js', () => ({ default: mockDb }));

const {
  confirmReferral,
  getPartnerPromoDiscount,
  recordReferral,
} = await import('./partners.service.js');

function resetMocks(): void {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockDb.transaction).mockReset();
}

function setupUniquePartnerRecordReferralMock(existingPositivePhones: string[]): void {
  vi.mocked(mockDb.query).mockImplementation(async (sql: string) => {
    if (sql.includes('FROM partners WHERE id = $1 AND status =')) {
      return [{ tier_slug: 'start', payout_details: { unique_phone_commission: true } }];
    }
    if (sql.includes('FROM partner_tiers')) {
      return [{
        slug: 'start',
        commission_first_percent: 15,
        commission_repeat_percent: 10,
        commission_lifetime_percent: 5,
        client_discount_percent: 5,
      }];
    }
    if (sql.includes('SELECT id, client_phone') && sql.includes('FROM partner_referrals')) {
      return existingPositivePhones.map((client_phone, index) => ({ id: index + 1, client_phone }));
    }
    if (sql.includes('COUNT(*) AS cnt')) {
      return [{ cnt: '0' }];
    }
    return [];
  });

  vi.mocked(mockDb.queryOne).mockImplementation(async (sql: string) => {
    if (sql.includes('FROM partner_commission_rules')) {
      return {
        id: 42,
        partner_id: 1,
        service_category_slug: 'photo-docs',
        order_type: 'pos',
        commission_percent: null,
        commission_fixed: '100.00',
        min_order_amount: '0',
        is_active: true,
        priority: 10,
        created_at: '2026-07-04T00:00:00.000Z',
        updated_at: '2026-07-04T00:00:00.000Z',
      };
    }
    return null;
  });
}

describe('partners.service offline partner attribution', () => {
  beforeEach(resetMocks);

  it('keeps partner promo validation valid but disables client discount when payout_details opts out', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([{
      partner_id: 1,
      partner_name: 'Владимир Мигаль',
      tier_slug: 'start',
      client_discount_percent: 0,
    }]);

    const result = await getPartnerPromoDiscount('MIGA');

    const sql = String(vi.mocked(mockDb.query).mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('client_discount_enabled');
    expect(result).toEqual({
      discount_percent: 0,
      partner_id: 1,
      partner_name: 'Владимир Мигаль',
      tier_slug: 'start',
    });
  });

  it('skips a payable confirmed referral when a unique-phone partner already has that normalized phone', async () => {
    setupUniquePartnerRecordReferralMock(['+7 (900) 111-22-33']);

    await recordReferral({
      partner_id: 1,
      order_id: 'receipt-2',
      order_type: 'pos',
      order_amount: 700,
      promo_code: 'MIGA',
      client_phone: '8 900 111-22-33',
      service_category_slug: 'photo-docs',
      status: 'confirmed',
    });

    const sqls = vi.mocked(mockDb.query).mock.calls.map(([sql]) => String(sql));
    expect(sqls.some(sql => sql.includes('INSERT INTO partner_referrals'))).toBe(false);
    expect(sqls.some(sql => sql.includes('UPDATE partners SET balance'))).toBe(false);
  });

  it('does not create a payable unique-phone referral without a phone number', async () => {
    setupUniquePartnerRecordReferralMock([]);

    await recordReferral({
      partner_id: 1,
      order_id: 'receipt-3',
      order_type: 'pos',
      order_amount: 700,
      promo_code: 'MIGA',
      service_category_slug: 'photo-docs',
      status: 'confirmed',
    });

    const sqls = vi.mocked(mockDb.query).mock.calls.map(([sql]) => String(sql));
    expect(sqls.some(sql => sql.includes('INSERT INTO partner_referrals'))).toBe(false);
    expect(sqls.some(sql => sql.includes('UPDATE partners SET balance'))).toBe(false);
  });

  it('cancels duplicate pending referrals at confirmation without adding balance', async () => {
    vi.mocked(mockDb.queryOne).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM partner_referrals') && sql.includes("status = 'pending'")) {
        return {
          id: 55,
          partner_id: 1,
          commission_amount: '100.00',
          status: 'pending',
          client_phone: '8 900 111-22-33',
        };
      }
      if (sql.includes('FROM partners') && sql.includes('WHERE id = $1')) {
        return { id: 1, name: 'Владимир Мигаль', payout_details: { unique_phone_commission: true } };
      }
      return null;
    });
    vi.mocked(mockDb.query).mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, client_phone') && sql.includes('FROM partner_referrals')) {
        return [{ id: 12, client_phone: '+7 (900) 111-22-33' }];
      }
      return [];
    });

    await confirmReferral('SF-ORDER-1', 'print');

    const sqls = vi.mocked(mockDb.query).mock.calls.map(([sql]) => String(sql));
    expect(sqls.some(sql => sql.includes("SET status = 'cancelled'"))).toBe(true);
    expect(sqls.some(sql => sql.includes('UPDATE partners SET balance'))).toBe(false);
  });
});
