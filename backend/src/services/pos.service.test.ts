import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetMockDb } from '../test-utils/index.js';

vi.mock('../database/db.js', () => ({
  default: mockDb,
}));

const mockApplyConsumption = vi.fn().mockResolvedValue(undefined);
const mockReverseConsumption = vi.fn().mockResolvedValue(undefined);
vi.mock('./consumable-rules.service.js', () => ({
  applyConsumption: mockApplyConsumption,
  reverseConsumption: mockReverseConsumption,
}));

const mockRecordSale = vi.fn().mockResolvedValue(undefined);
const mockReverseEmployeeSale = vi.fn().mockResolvedValue(undefined);
vi.mock('./employee-sales.service.js', () => ({
  recordSale: mockRecordSale,
  reverseSale: mockReverseEmployeeSale,
}));

vi.mock('./loyalty.service.js', () => ({
  findProfile: vi.fn().mockResolvedValue(null),
}));

const mockGetStudentDiscountForPhone = vi.fn().mockResolvedValue(null);
const mockRecordStudentDiscountUsageForReceiptWithClient = vi.fn().mockResolvedValue(null);
const mockRestoreStudentDiscountUsageForReceiptWithClient = vi.fn().mockResolvedValue(null);
const mockRestoreStudentDiscountUsageForReceiptItemsWithClient = vi.fn().mockResolvedValue(null);
vi.mock('./student-discount.service.js', () => ({
  getStudentDiscountForPhone: mockGetStudentDiscountForPhone,
  recordStudentDiscountUsageForReceiptWithClient: mockRecordStudentDiscountUsageForReceiptWithClient,
  restoreStudentDiscountUsageForReceiptWithClient: mockRestoreStudentDiscountUsageForReceiptWithClient,
  restoreStudentDiscountUsageForReceiptItemsWithClient: mockRestoreStudentDiscountUsageForReceiptItemsWithClient,
}));

const mockUseCreditsWithClient = vi.fn().mockResolvedValue({ used: 0, remaining: 0 });
const mockRestoreCreditsForPosReceiptWithClient = vi.fn().mockResolvedValue({ restored: 0, entries: 0 });
const mockRestoreCreditsForPosReceiptItemsWithClient = vi.fn().mockResolvedValue({ restored: 0, entries: 0 });
const A4_BW_PRINT_PRODUCT_ID = 'a2000001-0000-0000-0000-000000000001';
const A4_COLOR_PRINT_PRODUCT_ID = 'a2000001-0000-0000-0000-000000000002';
vi.mock('./subscription.service.js', () => ({
  useCreditsWithClient: mockUseCreditsWithClient,
  restoreCreditsForPosReceiptWithClient: mockRestoreCreditsForPosReceiptWithClient,
  restoreCreditsForPosReceiptItemsWithClient: mockRestoreCreditsForPosReceiptItemsWithClient,
  getSubscriptionCreditMapping: (productId: string) => productId === A4_COLOR_PRINT_PRODUCT_ID
    ? { creditProductId: A4_BW_PRINT_PRODUCT_ID, creditMultiplier: 1.2 }
    : { creditProductId: productId, creditMultiplier: 1 },
  printPackageCreditMultiplierForCoveragePercent: (value: number | string | null | undefined) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 15) return 1;
    if (numeric <= 50) return 2;
    if (numeric <= 75) return 3;
    return 4;
  },
}));

const {
  calculateSubscriptionCoverage,
  createReceipt,
  getReceipts,
  getCashControl,
  openShift,
  partialRefund,
  voidReceipt,
  findOrphanPayments,
  findFiscalRetryCandidates,
} = await import('./pos.service.js');

interface FakeClient {
  query: ReturnType<typeof vi.fn>;
}

function createReceiptClient(options: {
  activeSubscription?: boolean;
  eligibleProducts?: Record<string, boolean>;
  credits?: { product_id: string; remaining: number }[];
  existingRefund?: boolean;
} = {}): FakeClient {
  const activeSubscription = options.activeSubscription ?? true;
  const eligibleProducts = options.eligibleProducts ?? { 'product-1': true };
  const credits = options.credits ?? [{ product_id: 'product-1', remaining: 2 }];
  const existingRefund = options.existingRefund ?? false;

  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('SELECT id FROM user_subscriptions')) {
        return { rows: activeSubscription ? [{ id: params[0] }] : [] };
      }

      if (normalized.startsWith('SELECT id, is_refund, voided_at FROM pos_receipts WHERE id = $1')) {
        return { rows: [{ id: params[0], is_refund: false, voided_at: null }] };
      }

      if (normalized.startsWith('SELECT id FROM pos_receipts WHERE refund_receipt_id = $1')) {
        return { rows: existingRefund ? [{ id: 'existing-refund-1' }] : [] };
      }

      if (normalized.startsWith('SELECT id, is_subscription_eligible FROM products')) {
        const ids = params[0] as string[];
        return {
          rows: ids.map(id => ({
            id,
            is_subscription_eligible: eligibleProducts[id] ?? false,
          })),
        };
      }

      if (normalized.startsWith('SELECT id, product_id, total_credits')) {
        return {
          rows: credits.map((credit, index) => ({
            id: `credit-${index + 1}`,
            product_id: credit.product_id,
            total_credits: credit.remaining,
            used_credits: 0,
            remaining: credit.remaining,
          })),
        };
      }

      if (normalized.startsWith("SELECT nextval('pos_receipt_seq')")) {
        return { rows: [{ num: 1 }] };
      }

      if (normalized.startsWith('INSERT INTO pos_receipts')) {
        return {
          rows: [{
            id: 'receipt-1',
            receipt_number: params[0],
            shift_id: params[1],
            employee_id: params[2],
            studio_id: params[3],
            customer_phone: params[4],
            customer_name: params[5],
            loyalty_profile_id: params[6],
            subscription_id: params[7],
            is_refund: params[8],
            refund_receipt_id: params[9],
            subtotal: params[10],
            discount_total: params[11],
            points_discount: params[12],
            subscription_credit_used: params[13],
            total: params[14],
            created_at: new Date().toISOString(),
          }],
        };
      }

      return { rows: [] };
    }),
  };
}

describe('pos.service subscription coverage', () => {
  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
  });

  it('keeps fiscal_enabled false until the fiscal registrar confirms the shift', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'pos-shift-1',
            employee_id: 'employee-id',
            studio_id: 'studio-id',
            shift_number: 1,
            opened_at: '2026-05-20T10:00:00.000Z',
            closed_at: null,
            cash_at_open: 500,
            cash_at_close: null,
            expected_cash: null,
            status: 'open',
            total_sales: 0,
            total_refunds: 0,
            receipt_count: 0,
            cash_collected: null,
            collection_count: null,
            notes: null,
            fiscal_enabled: false,
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'employee-shift-1' }] }),
    };
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    const result = await openShift({
      employee_id: 'employee-id',
      studio_id: 'studio-id',
      cash_at_open: 500,
      fiscal_enabled: true,
    });

    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO pos_shifts'),
      ['employee-id', 'studio-id', 500, false],
    );
    expect(result.posShift.fiscal_enabled).toBe(false);
  });

  it('keeps terminal payment resolution details in receipt journal payments', async () => {
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([{
        id: 'receipt-1',
        receipt_number: 'SF-POS-000360',
        shift_id: 'shift-1',
        employee_id: 'employee-1',
        employee_name: 'Юлия',
        studio_id: 'studio-1',
        studio_name: 'Соборный',
        customer_phone: null,
        customer_name: 'tanysha',
        loyalty_profile_id: null,
        subscription_id: null,
        is_refund: false,
        refund_receipt_id: null,
        subtotal: '1400.00',
        discount_total: '0',
        points_discount: '0',
        subscription_credit_used: '0',
        total: '1400.00',
        fiscal_receipt_url: null,
        fiscal_receipt_number: null,
        fiscal_sign: null,
        fiscal_source: 'atol',
        fiscal_status: 'success',
        fiscal_attempts: 1,
        fiscal_last_error: null,
        void_reason: null,
        voided_at: null,
        created_at: '2026-06-03T16:40:00.000Z',
        items: [],
        payments: [{
          payment_type: 'card',
          amount: '1400.00',
          card_info: null,
          transaction_id: '1d573666-6ce3-4384-804d-f081f70582e1',
          status: 'completed',
          transaction_status: 'failed',
          payment_resolution: 'resolved_paid',
          effective_status: 'resolved_paid',
          terminal_error_message: 'Connection error',
          terminal_initiated_at: '2026-06-03T14:05:27.000Z',
          terminal_completed_at: '2026-06-03T14:07:27.000Z',
        }],
      }])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await getReceipts({ shift_id: 'shift-1' });
    const receipt = result.items[0];
    if (!receipt) throw new Error('expected one receipt');
    const payment = receipt.payments?.[0];
    if (!payment) throw new Error('expected one receipt payment');

    expect(payment).toMatchObject({
      payment_type: 'card',
      transaction_id: '1d573666-6ce3-4384-804d-f081f70582e1',
      transaction_status: 'failed',
      payment_resolution: 'resolved_paid',
      effective_status: 'resolved_paid',
      terminal_error_message: 'Connection error',
    });
  });

  it('calculates cart coverage server-side', async () => {
    const client = createReceiptClient({ credits: [{ product_id: 'product-1', remaining: 2 }] });
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    const coverage = await calculateSubscriptionCoverage({
      subscription_id: 'sub-1',
      items: [{
        product_id: 'product-1',
        product_name: 'Фото',
        quantity: 3,
        unit_price: 100,
        total: 300,
      }],
    });

    expect(coverage.total_covered_amount).toBe(200);
    expect(coverage.total_credits_consumed).toBe(2);
    expect(coverage.items[0]).toMatchObject({
      covered_quantity: 2,
      remaining_quantity: 1,
      covered_amount: 200,
    });
  });

  it('applies print fill multiplier when calculating coverage', async () => {
    const client = createReceiptClient({ credits: [{ product_id: 'product-1', remaining: 5 }] });
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    const coverage = await calculateSubscriptionCoverage({
      subscription_id: 'sub-1',
      items: [{
        product_id: 'product-1',
        product_name: 'Печать A4',
        quantity: 3,
        unit_price: 100,
        total: 300,
        print_fill_percent: 60,
      }],
    });

    expect(coverage.total_covered_amount).toBe(100);
    expect(coverage.total_credits_consumed).toBe(3);
    expect(coverage.items[0]).toMatchObject({
      covered_quantity: 1,
      remaining_quantity: 2,
      credit_multiplier: 3,
      coverage_multiplier: 3,
      coverage_percent: 60,
    });
  });

  it('deducts color A4 from the shared print package with x1.2 multiplier', async () => {
    const client = createReceiptClient({
      eligibleProducts: { [A4_COLOR_PRINT_PRODUCT_ID]: true },
      credits: [{ product_id: A4_BW_PRINT_PRODUCT_ID, remaining: 5 }],
    });
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    const coverage = await calculateSubscriptionCoverage({
      subscription_id: 'sub-1',
      items: [{
        product_id: A4_COLOR_PRINT_PRODUCT_ID,
        product_name: 'Печать A4 цветная',
        quantity: 3,
        unit_price: 100,
        total: 300,
        print_fill_percent: 15,
      }],
    });

    expect(coverage.total_covered_amount).toBe(300);
    expect(coverage.total_credits_consumed).toBeCloseTo(3.6, 6);
    expect(coverage.items[0]).toMatchObject({
      product_id: A4_COLOR_PRINT_PRODUCT_ID,
      credit_product_id: A4_BW_PRINT_PRODUCT_ID,
      covered_quantity: 3,
      remaining_quantity: 0,
      credit_multiplier: 1.2,
      coverage_multiplier: 1,
      coverage_percent: 15,
    });
  });

  it('creates split receipt and deducts only covered subscription quantity', async () => {
    const client = createReceiptClient({ credits: [{ product_id: 'product-1', remaining: 2 }] });
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    const receipt = await createReceipt({
      shift_id: 'shift-1',
      employee_id: 'employee-1',
      studio_id: 'studio-1',
      subscription_id: 'sub-1',
      items: [{
        product_id: 'product-1',
        product_name: 'Фото',
        quantity: 3,
        unit_price: 100,
        subscription_credits_used: 999,
        total: 300,
      }],
      payments: [
        { payment_type: 'subscription', amount: 200 },
        { payment_type: 'cash', amount: 100 },
      ],
      subtotal: 300,
      total: 300,
    });

    expect(receipt.subscription_credit_used).toBe(200);
    expect(receipt.items?.[0]?.subscription_credits_used).toBe(200);
    expect(receipt.payments).toEqual([
      { payment_type: 'subscription', amount: 200, card_info: undefined, transaction_id: undefined },
      { payment_type: 'cash', amount: 100, card_info: undefined, transaction_id: undefined },
    ]);
    expect(mockUseCreditsWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        subscription_id: 'sub-1',
        product_id: 'product-1',
        quantity: 2,
        pos_receipt_id: 'receipt-1',
      }),
    );
  });

  it('creates a transfer receipt and persists the transfer payment type', async () => {
    const client = createReceiptClient();
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    const receipt = await createReceipt({
      shift_id: 'shift-1',
      employee_id: 'employee-1',
      studio_id: 'studio-1',
      items: [{
        product_id: 'product-1',
        product_name: 'Фото',
        quantity: 1,
        unit_price: 500,
        total: 500,
      }],
      payments: [{ payment_type: 'transfer', amount: 500 }],
      subtotal: 500,
      total: 500,
    });

    expect(receipt.payments).toEqual([
      { payment_type: 'transfer', amount: 500, card_info: undefined, transaction_id: undefined },
    ]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pos_receipt_payments'),
      ['receipt-1', 'transfer', 500, null, null, 'completed'],
    );
  });

  it('rejects receipt when item totals do not match the paid total', async () => {
    const client = createReceiptClient();
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    await expect(createReceipt({
      shift_id: 'shift-1',
      employee_id: 'employee-1',
      studio_id: 'studio-1',
      items: [{
        product_id: 'product-1',
        product_name: 'А4 до 15%',
        quantity: 4,
        unit_price: 10,
        total: 40,
      }],
      payments: [{ payment_type: 'card', amount: 20, transaction_id: 'payment-1' }],
      subtotal: 40,
      total: 20,
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'POS_RECEIPT_ITEMS_MISMATCH',
    });

    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pos_receipts'),
      expect.any(Array),
    );
  });

  it('persists provided metadata into pos_receipts within the receipt transaction', async () => {
    const client = createReceiptClient();
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    const metadata = { retouch_config: { gender: 'female', options: [], notes: null } };
    await createReceipt({
      shift_id: 'shift-1',
      employee_id: 'employee-1',
      studio_id: 'studio-1',
      items: [{ product_id: 'product-1', product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
      payments: [{ payment_type: 'cash', amount: 500 }],
      subtotal: 500,
      total: 500,
      metadata,
    });

    const insertCall = client.query.mock.calls.find(
      call => String(call[0]).replace(/\s+/g, ' ').includes('INSERT INTO pos_receipts'),
    );
    expect(insertCall).toBeDefined();
    // metadata — 19-й позиционный параметр (index 18)
    const insertParams = insertCall![1] as unknown[];
    expect(insertParams[18]).toBe(JSON.stringify(metadata));
  });

  it('passes null metadata when none is provided (backward compatible)', async () => {
    const client = createReceiptClient();
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    await createReceipt({
      shift_id: 'shift-1',
      employee_id: 'employee-1',
      studio_id: 'studio-1',
      items: [{ product_id: 'product-1', product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
      payments: [{ payment_type: 'cash', amount: 500 }],
      subtotal: 500,
      total: 500,
    });

    const insertCall = client.query.mock.calls.find(
      call => String(call[0]).replace(/\s+/g, ' ').includes('INSERT INTO pos_receipts'),
    );
    expect(insertCall).toBeDefined();
    const insertParams = insertCall![1] as unknown[];
    expect(insertParams[18]).toBeNull();
  });

  it('rejects stale subscription payment amount when coverage is lower', async () => {
    const client = createReceiptClient({ credits: [{ product_id: 'product-1', remaining: 1 }] });
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    await expect(createReceipt({
      shift_id: 'shift-1',
      employee_id: 'employee-1',
      studio_id: 'studio-1',
      subscription_id: 'sub-1',
      items: [{
        product_id: 'product-1',
        product_name: 'Фото',
        quantity: 3,
        unit_price: 100,
        total: 300,
      }],
      payments: [
        { payment_type: 'subscription', amount: 200 },
        { payment_type: 'cash', amount: 100 },
      ],
      subtotal: 300,
      total: 300,
    })).rejects.toMatchObject({
      code: 'POS_SUBSCRIPTION_COVERAGE_MISMATCH',
    });

    expect(mockUseCreditsWithClient).not.toHaveBeenCalled();
  });

  it('creates a subscription refund without deducting credits again and restores original usage', async () => {
    const client = createReceiptClient();
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    const receipt = await createReceipt({
      shift_id: 'shift-1',
      employee_id: 'employee-1',
      studio_id: 'studio-1',
      subscription_id: 'sub-1',
      is_refund: true,
      refund_receipt_id: 'original-receipt-1',
      items: [{
        product_id: 'product-1',
        product_name: 'Фото',
        quantity: 2,
        unit_price: 100,
        subscription_credits_used: 200,
        total: -200,
      }],
      payments: [
        { payment_type: 'subscription', amount: -200 },
      ],
      subtotal: -200,
      total: -200,
    });

    expect(receipt.is_refund).toBe(true);
    expect(receipt.subscription_credit_used).toBe(0);
    expect(receipt.items?.[0]?.subscription_credits_used).toBe(0);
    expect(mockUseCreditsWithClient).not.toHaveBeenCalled();
    expect(mockRestoreCreditsForPosReceiptWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        pos_receipt_id: 'original-receipt-1',
        employee_id: 'employee-1',
      }),
    );
  });

  it('rejects a repeated full refund for an already refunded receipt', async () => {
    const client = createReceiptClient({ existingRefund: true });
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    await expect(createReceipt({
      shift_id: 'shift-1',
      employee_id: 'employee-1',
      studio_id: 'studio-1',
      subscription_id: 'sub-1',
      is_refund: true,
      refund_receipt_id: 'original-receipt-1',
      items: [{
        product_id: 'product-1',
        product_name: 'Фото',
        quantity: 2,
        unit_price: 100,
        total: -200,
      }],
      payments: [
        { payment_type: 'subscription', amount: -200 },
      ],
      subtotal: -200,
      total: -200,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'POS_RECEIPT_ALREADY_REFUNDED',
    });

    expect(mockRestoreCreditsForPosReceiptWithClient).not.toHaveBeenCalled();
  });

  it('rejects a repeated void without reversing stock, credits, or sales again', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT r.*, s.opened_at')) {
          return {
            rows: [{
              id: 'receipt-1',
              receipt_number: 'SF-POS-000001',
              shift_id: 'shift-1',
              studio_id: 'studio-1',
              is_refund: false,
              voided_at: new Date().toISOString(),
              subscription_credit_used: 100,
              total: 300,
            }],
          };
        }
        return { rows: [] };
      }),
    };
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    await expect(voidReceipt('receipt-1', 'mistake', 'employee-1', 'shift-1')).rejects.toMatchObject({
      code: 'POS_RECEIPT_ALREADY_VOIDED',
    });

    expect(mockRestoreCreditsForPosReceiptWithClient).not.toHaveBeenCalled();
    expect(mockReverseConsumption).not.toHaveBeenCalled();
    expect(mockReverseEmployeeSale).not.toHaveBeenCalled();
  });

  it('restores subscription credits when voiding a subscription receipt', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT r.*, s.opened_at')) {
          return {
            rows: [{
              id: 'receipt-1',
              receipt_number: 'SF-POS-000001',
              shift_id: 'shift-1',
              studio_id: 'studio-1',
              is_refund: false,
              voided_at: null,
              subscription_credit_used: 100,
              total: 300,
            }],
          };
        }
        if (normalized.startsWith("SELECT id, status FROM pos_shifts WHERE id = $1 AND status = 'open'")) {
          return { rows: [{ id: 'shift-1', status: 'open' }] };
        }
        if (normalized.startsWith('SELECT product_id, quantity FROM pos_receipt_items')) {
          return { rows: [{ product_id: 'product-1', quantity: 2 }] };
        }
        return { rows: [] };
      }),
    };
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    const receipt = await voidReceipt('receipt-1', 'mistake', 'employee-1', 'shift-1');

    expect(receipt.id).toBe('receipt-1');
    expect(mockRestoreCreditsForPosReceiptWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        pos_receipt_id: 'receipt-1',
        employee_id: 'employee-1',
        reversal_reason: 'mistake',
      }),
    );
    expect(mockReverseConsumption).toHaveBeenCalledWith('receipt-1', client);
    expect(mockReverseEmployeeSale).toHaveBeenCalledWith('receipt-1', client);
  });

  it('restores item-level subscription credits on partial refund', async () => {
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT * FROM pos_receipts WHERE id = $1')) {
          return {
            rows: [{
              id: 'receipt-1',
              customer_phone: '79001112233',
              customer_name: 'Client',
              loyalty_profile_id: null,
              subscription_id: 'sub-1',
              is_refund: false,
              subscription_credit_used: 200,
            }],
          };
        }
        if (normalized.startsWith('SELECT EXISTS')) {
          return { rows: [{ exists: true }] };
        }
        if (normalized.startsWith('SELECT * FROM pos_receipt_items')) {
          return {
            rows: [{
              id: 'item-1',
              product_id: 'product-1',
              product_name: 'Фото',
              quantity: 3,
              unit_price: 100,
              total: 300,
              subscription_credits_used: 200,
              vat_rate: 'none',
            }],
          };
        }
        if (normalized.startsWith('SELECT * FROM pos_receipt_payments')) {
          return {
            rows: [
              { payment_type: 'subscription', amount: 200 },
              { payment_type: 'cash', amount: 100 },
            ],
          };
        }
        if (normalized.startsWith("SELECT nextval('pos_receipt_seq')")) {
          return { rows: [{ num: 2 }] };
        }
        if (normalized.startsWith('INSERT INTO pos_receipts')) {
          return {
            rows: [{
              id: 'refund-receipt-1',
              receipt_number: params[0],
              shift_id: params[1],
              employee_id: params[2],
              studio_id: params[3],
              is_refund: true,
              refund_receipt_id: params[9],
              total: params[15],
            }],
          };
        }
        return { rows: [] };
      }),
    };
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    const receipt = await partialRefund(
      'receipt-1',
      [{ product_id: 'product-1', quantity: 1, amount: 100 }],
      'shift-1',
      'employee-1',
      'studio-1',
    );

    expect(receipt.id).toBe('refund-receipt-1');
    expect(receipt.payments).toEqual([{ payment_type: 'subscription', amount: -100 }]);
    expect(mockRestoreCreditsForPosReceiptItemsWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        pos_receipt_id: 'receipt-1',
        items: [{ product_id: 'product-1', quantity: 1 }],
        employee_id: 'employee-1',
      }),
    );
    expect(mockRestoreStudentDiscountUsageForReceiptItemsWithClient).toHaveBeenCalledWith(
      client,
      {
        receiptId: 'receipt-1',
        items: [{ product_id: 'product-1', quantity: 1 }],
      },
    );
  });

  it('rejects partial refund after a full refund restored the original quantity', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT * FROM pos_receipts WHERE id = $1')) {
          return {
            rows: [{
              id: 'receipt-1',
              customer_phone: '79001112233',
              customer_name: 'Client',
              loyalty_profile_id: null,
              subscription_id: 'sub-1',
              is_refund: false,
              subscription_credit_used: 0,
            }],
          };
        }
        if (normalized.startsWith('SELECT EXISTS')) {
          return { rows: [{ exists: false }] };
        }
        if (normalized.startsWith('SELECT * FROM pos_receipt_items')) {
          return {
            rows: [{
              id: 'item-1',
              product_id: 'product-1',
              product_name: 'Фото',
              quantity: 3,
              unit_price: 100,
              total: 300,
              subscription_credits_used: 0,
              vat_rate: 'none',
            }],
          };
        }
        if (normalized.startsWith('SELECT ri.product_id')) {
          return { rows: [{ product_id: 'product-1', refunded_quantity: 3 }] };
        }
        return { rows: [] };
      }),
    };
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    await expect(partialRefund(
      'receipt-1',
      [{ product_id: 'product-1', quantity: 1, amount: 100 }],
      'shift-1',
      'employee-1',
      'studio-1',
    )).rejects.toMatchObject({
      code: 'POS_REFUND_QTY_EXCEEDED',
    });

    expect(mockRestoreCreditsForPosReceiptItemsWithClient).not.toHaveBeenCalled();
    expect(mockRestoreStudentDiscountUsageForReceiptItemsWithClient).not.toHaveBeenCalled();
  });

  it('rejects partial refund that exceeds remaining refundable quantity', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT * FROM pos_receipts WHERE id = $1')) {
          return {
            rows: [{
              id: 'receipt-1',
              customer_phone: '79001112233',
              customer_name: 'Client',
              loyalty_profile_id: null,
              subscription_id: 'sub-1',
              is_refund: false,
              subscription_credit_used: 0,
            }],
          };
        }
        if (normalized.startsWith('SELECT EXISTS')) {
          return { rows: [{ exists: false }] };
        }
        if (normalized.startsWith('SELECT * FROM pos_receipt_items')) {
          return {
            rows: [{
              id: 'item-1',
              product_id: 'product-1',
              product_name: 'Фото',
              quantity: 3,
              unit_price: 100,
              total: 300,
              subscription_credits_used: 0,
              vat_rate: 'none',
            }],
          };
        }
        if (normalized.startsWith('SELECT ri.product_id')) {
          return { rows: [{ product_id: 'product-1', refunded_quantity: 2 }] };
        }
        return { rows: [] };
      }),
    };
    vi.mocked(mockDb.transaction).mockImplementationOnce(async fn => fn(client));

    await expect(partialRefund(
      'receipt-1',
      [{ product_id: 'product-1', quantity: 2, amount: 200 }],
      'shift-1',
      'employee-1',
      'studio-1',
    )).rejects.toMatchObject({
      code: 'POS_REFUND_QTY_EXCEEDED',
    });

    expect(mockRestoreCreditsForPosReceiptItemsWithClient).not.toHaveBeenCalled();
    expect(mockRestoreStudentDiscountUsageForReceiptItemsWithClient).not.toHaveBeenCalled();
  });
});

describe('pos.service cash control', () => {
  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
  });

  it('computes discrepancy from report cash sales instead of stale shift expected cash', async () => {
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([{
        id: 'shift-61',
        shift_number: '61',
        employee_id: 'employee-butenko',
        employee_name: 'Бутенко Оля',
        studio_id: 'studio-soborny',
        studio_name: 'Соборный',
        opened_at: '2026-06-23T06:01:00.000Z',
        closed_at: '2026-06-23T16:30:00.000Z',
        status: 'closed',
        cash_at_open: '12201',
        cash_sales: '2540',
        withdrawals: '0',
        expected_cash: '12201',
        cash_at_close: '14630',
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ count: 0, sum: '0' });

    const result = await getCashControl({
      date_from: '2026-06-23T00:00:00.000Z',
      date_to: '2026-06-23T23:59:59.999Z',
    });

    const shiftSql = String(vi.mocked(mockDb.query).mock.calls[0]?.[0] ?? '');
    expect(shiftSql).toContain('r.shift_id IS NULL');
    expect(shiftSql).toContain('r.employee_id = s.employee_id');
    expect(shiftSql).toContain('r.created_at >= s.opened_at');

    const orphanSql = String(vi.mocked(mockDb.queryOne).mock.calls[0]?.[0] ?? '');
    expect(orphanSql).toContain('NOT EXISTS');

    expect(result.shifts[0]).toMatchObject({
      cash_sales: 2540,
      expected_cash: 14741,
      cash_at_close: 14630,
      diff: -111,
      reconciled: true,
    });
  });
});

function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/g, ' ').trim();
}

describe('findOrphanPayments — детектор осиротевших оплат', () => {
  beforeEach(() => resetMockDb());

  it('SQL ловит payment+completed без чека: фильтры payment_resolution/settled_receipt_id/receipt_id NULL + NOT EXISTS pos_receipt_payments по pt.id::text', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ id: 'pay-525', amount: '525.00' }] as never);
    const rows = await findOrphanPayments('studio-1', 5);

    const [sqlArg, params] = vi.mocked(mockDb.query).mock.calls[0];
    const sql = normalizeSql(sqlArg);
    expect(sql).toContain("pt.transaction_type = 'payment'");
    expect(sql).toContain("pt.status = 'completed'");
    expect(sql).toContain('pt.payment_resolution IS NULL');
    expect(sql).toContain('pt.settled_receipt_id IS NULL');
    expect(sql).toContain('pt.receipt_id IS NULL');
    // anti-double: исключает оплаты с обычным чеком (2100₽-кейс)
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('prp.transaction_id = pt.id::text');
    // age-окно по completed_at
    expect(sql).toContain('pt.completed_at <=');
    // studioId-фильтр (NULL → все студии)
    expect(sql).toContain('$1::uuid IS NULL OR pt.studio_id = $1::uuid');
    expect(params).toEqual(['studio-1', 5, 100]);
    expect(rows).toHaveLength(1);
  });

  it('studioId undefined → передаёт NULL (все студии, для sweep)', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([] as never);
    await findOrphanPayments(undefined, 3);
    const [, params] = vi.mocked(mockDb.query).mock.calls[0];
    expect(params).toEqual([null, 3, 100]);
  });
});

describe('findFiscalRetryCandidates — авто-ретрай фискализации', () => {
  beforeEach(() => resetMockDb());

  it('includeStuck=false → статусы только pending/failed (P1.2 окно + анти-дубль + стоп по COUNT)', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([] as never);
    await findFiscalRetryCandidates({ maxAttempts: 5, maxAgeMinutes: 1440, includeStuck: false, staleMinutes: 15 });

    const [sqlArg, params] = vi.mocked(mockDb.query).mock.calls[0];
    const sql = normalizeSql(sqlArg);
    expect(params[0]).toEqual(['pending', 'failed']);
    expect(params).toEqual([['pending', 'failed'], 1440, 15, 5, 50]);
    // окно свежести (P1.2): legacy не трогаем
    expect(sql).toContain('pr.created_at >');
    // анти-дубль: нет завершённой fiscal_sale/refund
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("ft.transaction_type IN ('fiscal_sale','fiscal_refund')");
    expect(sql).toContain("ft.status = 'completed'");
    // стоп-зацикливание по числу fiscal-tx < maxAttempts
    expect(sql).toContain('< $4::int');
  });

  it('includeStuck=true → добавляет queued/processing в набор статусов', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([] as never);
    await findFiscalRetryCandidates({ maxAttempts: 5, maxAgeMinutes: 1440, includeStuck: true, staleMinutes: 15 });
    const [, params] = vi.mocked(mockDb.query).mock.calls[0];
    expect(params[0]).toEqual(['pending', 'failed', 'queued', 'processing']);
  });
});
