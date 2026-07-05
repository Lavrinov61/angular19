import { beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../database/db.js';
import {
  activateStudentDiscountForUser,
  assertStudentPrintFillEligible,
  calculateStudentDiscountForItem,
  isStudentPrintFillEligible,
  normalizeStudentPrintFillPercent,
  recordStudentDiscountUsageForReceiptWithClient,
  restoreStudentDiscountUsageForReceiptItemsWithClient,
} from './student-discount.service.js';

vi.mock('../database/db.js', () => ({
  default: {
    query: vi.fn(),
    queryOne: vi.fn(),
    transaction: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('student print fill eligibility', () => {
  it('rejects missing fill values for student print pricing', () => {
    expect(normalizeStudentPrintFillPercent(null)).toBeNull();
    expect(isStudentPrintFillEligible(undefined)).toBe(false);
    expect(() => assertStudentPrintFillEligible('')).toThrow('заливку страницы');
  });

  it('accepts fill values up to 100 percent', () => {
    expect(normalizeStudentPrintFillPercent('12.5')).toBe(12.5);
    expect(isStudentPrintFillEligible(15)).toBe(true);
    expect(() => assertStudentPrintFillEligible('15')).not.toThrow();
    expect(isStudentPrintFillEligible(100)).toBe(true);
    expect(() => assertStudentPrintFillEligible('75')).not.toThrow();
  });

  it('normalizes out-of-range fill values into the supported range', () => {
    expect(normalizeStudentPrintFillPercent(-10)).toBe(0);
    expect(normalizeStudentPrintFillPercent(120)).toBe(100);
    expect(isStudentPrintFillEligible(120)).toBe(true);
  });

  it('does not offer student print pricing without fill percent or when the tier is not cheaper', () => {
    const state = {
      entitlementId: 'entitlement-1',
      userId: 'user-1',
      printSheetsRemaining: 100,
      bindingRemaining: 1,
      photosRemaining: 100,
    };

    expect(calculateStudentDiscountForItem({
      state,
      slug: 'print-a4-bw',
      name: 'Печать А4 ч/б',
      basePrice: 10,
      quantity: 5,
    })).toBeNull();

    expect(calculateStudentDiscountForItem({
      state,
      slug: 'print-a4-bw',
      name: 'Печать А4 ч/б',
      basePrice: 8,
      quantity: 5,
      printFillPercent: 18,
    })).toBeNull();

    expect(calculateStudentDiscountForItem({
      state,
      slug: 'print-a4-bw',
      name: 'Печать А4 ч/б',
      basePrice: 10,
      quantity: 5,
      printFillPercent: 12,
    })?.total).toBe(15);
  });

  it('applies student print pricing to the A4 up to 15 percent copy option', () => {
    const state = {
      entitlementId: 'entitlement-1',
      userId: 'user-1',
      printSheetsRemaining: 100,
      bindingRemaining: 1,
      photosRemaining: 100,
    };

    const pricing = calculateStudentDiscountForItem({
      state,
      slug: 'km-а4-ксерокопия',
      name: 'А4 до 15%',
      basePrice: 10,
      quantity: 10,
      printFillPercent: 15,
    });

    expect(pricing).toMatchObject({
      total: 30,
      units: 10,
      benefitType: 'print_a4_bw',
    });
  });

  it('applies student color print pricing to the A4 up to 15 percent color option', () => {
    const state = {
      entitlementId: 'entitlement-1',
      userId: 'user-1',
      printSheetsRemaining: 100,
      bindingRemaining: 1,
      photosRemaining: 100,
    };

    const pricing = calculateStudentDiscountForItem({
      state,
      slug: 'km-а4-печать-до-15-цвет',
      name: 'А4 Печать до 15% цвет',
      basePrice: 12,
      quantity: 10,
      printFillPercent: 15,
    });

    expect(pricing).toMatchObject({
      total: 40,
      units: 10,
      benefitType: 'print_a4_color',
    });
  });

  it('applies student graphic pricing to A4 fill tiers above 15 percent', () => {
    const state = {
      entitlementId: 'entitlement-1',
      userId: 'user-1',
      printSheetsRemaining: 100,
      bindingRemaining: 1,
      photosRemaining: 100,
    };

    expect(calculateStudentDiscountForItem({
      state,
      slug: 'km-а4-ксерокопия-цветная',
      name: 'А4 до 50% цвет',
      basePrice: 35,
      quantity: 5,
      printFillPercent: 50,
    })).toMatchObject({
      total: 40,
      units: 5,
      benefitType: 'print_a4_color',
    });

    expect(calculateStudentDiscountForItem({
      state,
      slug: 'km-а4-печать-до-75',
      name: 'А4 печать до 75%',
      basePrice: 50,
      quantity: 2,
      printFillPercent: 75,
    })).toMatchObject({
      total: 24,
      units: 2,
      benefitType: 'print_a4_bw',
    });

    expect(calculateStudentDiscountForItem({
      state,
      slug: 'km-а4-фото-документ',
      name: 'А4 фото документ',
      basePrice: 80,
      quantity: 3,
      printFillPercent: 100,
    })).toMatchObject({
      total: 54,
      units: 3,
      benefitType: 'print_a4_color',
    });
  });
});

describe('student discount token activation', () => {
  it('does not create a legacy entitlement and only reads paid education access', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const result = await activateStudentDiscountForUser({
      userId: '00000000-0000-4000-8000-000000000001',
      token: 'student-2026',
      sourceUrl: '/education',
    });

    expect(result).toBeNull();
    expect(db.queryOne).toHaveBeenCalledTimes(1);
    const sql = String(vi.mocked(db.queryOne).mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('FROM student_discount_entitlements s');
    expect(sql).toContain('FROM student_accounts a');
    // Льгота активна для обоих образовательных тарифов: подписка и подтверждён-без-подписки.
    expect(sql).toContain("s.source_token IN ('education_subscription', 'education_verified')");
    expect(sql).not.toContain('INSERT INTO student_discount_entitlements');
  });
});

describe('student discount receipt usage ledger', () => {
  it('stores product metadata when recording student print usage', async () => {
    const insertCalls: unknown[][] = [];
    let allowanceInsertSql = '';
    const query = vi.fn();
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('SELECT s.id') && normalized.includes('FROM student_discount_entitlements s')) {
        return {
          rows: [{
            id: 'entitlement-1',
            user_id: 'user-1',
            status: 'active',
            source_token: 'education_subscription',
            source_url: '/education',
            student_account_id: 'student-account-1',
            activated_at: '2026-04-01T00:00:00.000Z',
            expires_at: '2026-09-30T20:59:59.000Z',
            print_sheets_used: 0,
            binding_uses: 0,
            created_at: '2026-04-01T00:00:00.000Z',
            updated_at: '2026-04-01T00:00:00.000Z',
          }],
        };
      }

      if (normalized.includes('INSERT INTO student_allowance_periods')) {
        allowanceInsertSql = normalized;
        return {
          rows: [{
            id: 'allowance-1',
            entitlement_id: 'entitlement-1',
            user_id: 'user-1',
            period_start: '2026-04-01T00:00:00.000Z',
            period_end: '2026-05-01T00:00:00.000Z',
            sheet_limit: 500,
            sheet_price: 3,
            sheets_used: 0,
            created_at: '2026-04-01T00:00:00.000Z',
            updated_at: '2026-04-01T00:00:00.000Z',
          }],
        };
      }

      if (normalized.startsWith('SELECT p.id AS product_id')) {
        return {
          rows: [{
            product_id: 'product-1',
            service_option_slug: 'print-a4-bw',
            service_option_name: 'Печать А4 ч/б',
          }],
        };
      }

      if (normalized.startsWith('SELECT id, entitlement_id, user_id, period_start')) {
        return {
          rows: [{
            id: 'allowance-1',
            entitlement_id: 'entitlement-1',
            user_id: 'user-1',
            period_start: '2026-04-01T00:00:00.000Z',
            period_end: '2026-05-01T00:00:00.000Z',
            sheet_limit: 500,
            sheet_price: 3,
            sheets_used: 0,
            created_at: '2026-04-01T00:00:00.000Z',
            updated_at: '2026-04-01T00:00:00.000Z',
          }],
        };
      }

      if (normalized.startsWith('UPDATE student_allowance_periods SET sheets_used')) {
        return { rows: [{ id: params[0] }] };
      }

      if (normalized.startsWith('INSERT INTO student_discount_redemptions')) {
        insertCalls.push(params);
        return { rows: [] };
      }

      if (normalized.startsWith('UPDATE pos_receipts')) {
        return { rows: [] };
      }

      throw new Error(`Unhandled fake SQL: ${normalized}`);
    });
    const client = {
      query<Row = unknown>(text: string, params?: unknown[]): Promise<{ rows: Row[] }> {
        return query(text, params);
      },
    };

    const result = await recordStudentDiscountUsageForReceiptWithClient(client, {
      receiptId: 'receipt-1',
      customerPhone: '+7 900 111-22-33',
      items: [{
        product_id: 'product-1',
        product_name: 'Печать А4 ч/б',
        quantity: 2,
        unit_price: 10,
        discount_amount: 14,
        discount_type: 'student',
        print_fill_percent: 10,
      }],
    });

    expect(result).toEqual({
      entitlement_id: 'entitlement-1',
      user_id: 'user-1',
      print_sheets: 2,
      binding_uses: 0,
    });
    expect(allowanceInsertSql).toContain('s.activated_at');
    expect(allowanceInsertSql).toContain("INTERVAL '30 days'");
    expect(allowanceInsertSql).not.toContain("date_trunc('month'");
    expect(insertCalls).toHaveLength(1);
    expect(JSON.parse(String(insertCalls[0]?.[10] ?? '{}'))).toMatchObject({
      product_id: 'product-1',
      product_name: 'Печать А4 ч/б',
      units: 2,
      source: 'pos',
    });
  });

  it('restores only requested product units during a partial refund', async () => {
    const allowanceUpdates: unknown[][] = [];
    const redemptionUpdates: unknown[][] = [];
    const receiptUpdates: unknown[][] = [];
    const query = vi.fn();
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('SELECT id, entitlement_id, user_id, allowance_period_id')) {
        return {
          rows: [{
            id: 'redemption-1',
            entitlement_id: 'entitlement-1',
            user_id: 'user-1',
            allowance_period_id: 'allowance-1',
            benefit_type: 'print_a4_bw',
            units: 3,
            discount_amount: '21.00',
            metadata: {
              product_id: 'product-1',
              product_name: 'Печать А4 ч/б',
              units: 3,
              partial_refunded_units: 1,
            },
          }],
        };
      }

      if (normalized.startsWith('SELECT id FROM student_discount_entitlements')) {
        return { rows: [{ id: 'entitlement-1' }] };
      }

      if (normalized.startsWith('UPDATE student_allowance_periods')) {
        allowanceUpdates.push(params);
        return { rows: [] };
      }

      if (normalized.startsWith('UPDATE student_discount_redemptions')) {
        redemptionUpdates.push(params);
        return { rows: [] };
      }

      if (normalized.startsWith('UPDATE pos_receipts')) {
        receiptUpdates.push(params);
        return { rows: [] };
      }

      throw new Error(`Unhandled fake SQL: ${normalized}`);
    });
    const client = {
      query<Row = unknown>(text: string, params?: unknown[]): Promise<{ rows: Row[] }> {
        return query(text, params);
      },
    };

    const result = await restoreStudentDiscountUsageForReceiptItemsWithClient(client, {
      receiptId: 'receipt-1',
      items: [{ product_id: 'product-1', quantity: 2 }],
    });

    expect(result).toEqual({
      entitlement_id: 'entitlement-1',
      user_id: 'user-1',
      print_sheets: 2,
      binding_uses: 0,
    });
    expect(allowanceUpdates[0]).toEqual(['allowance-1', 2]);
    expect(redemptionUpdates[0]?.slice(0, 3)).toEqual(['redemption-1', 1, 7]);
    expect(JSON.parse(String(redemptionUpdates[0]?.[3] ?? '{}'))).toMatchObject({
      partial_refunded_units: 3,
    });
    expect(receiptUpdates).toHaveLength(1);
  });
});
