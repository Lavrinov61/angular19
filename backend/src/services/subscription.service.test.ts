import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetMockDb } from '../test-utils/index.js';
import type { SubscriptionQueryClient } from './subscription.service.js';

vi.mock('../database/db.js', () => ({
  default: mockDb,
}));

const {
  activateOrRenewSubscriptionPayment,
  getSubscriptionCreditMapping,
  printPackageCreditMultiplierForCoveragePercent,
  redeemGiftSubscriptionPromo,
  restoreCreditsForPosReceiptItemsWithClient,
  restoreCreditsForPosReceiptWithClient,
  initCardChange,
  confirmCardChange,
  adoptOrphanCardChange,
  storeVerifiedCard,
  cancelCloudPaymentsRecurrentChecked,
  billingPeriodToCp,
  reconcileEducationEntitlements,
} = await import('./subscription.service.js');

const A4_BW_PRINT_PRODUCT_ID = 'a2000001-0000-0000-0000-000000000001';
const A4_COLOR_PRINT_PRODUCT_ID = 'a2000001-0000-0000-0000-000000000002';

function fakeRows<Row extends object = object>(rows: object[]): { rows: Row[] } {
  return { rows: rows as Row[] };
}

type FakeSubscription = {
  id: string;
  user_id: string | null;
  phone: string | null;
  customer_name: string | null;
  plan_id: string | null;
  custom_items: unknown[];
  monthly_price: number;
  status: string;
  cloudpayments_subscription_id: string | null;
  cloudpayments_token: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_payment_date: string | null;
  trial_period_days: number;
  trial_end: string | null;
  promo_code_used: string | null;
  credits_rollover_months: number | null;
  plan_billing_period: 'monthly' | 'quarterly' | 'yearly' | null;
  plan_slug: string | null;
};

type FakePayment = {
  id: string;
  subscription_id: string;
  provider: 'cloudpayments';
  provider_subscription_id: string | null;
  provider_transaction_id: string | null;
  amount: number;
  currency: string;
  status: string;
  kind: string;
  period_start: string | null;
  period_end: string | null;
  raw_payload: unknown;
  created_at: string;
};

type FakeCredit = {
  id: string;
  subscription_id: string;
  product_id: string;
  period_start: string;
  period_end: string;
  total_credits: number;
  used_credits: number;
  rolled_over_from: string | null;
  expires_at: string;
};

type FakeGiftPromo = {
  id: string;
  promo_code: string;
  trial_days: number;
  usage_limit: number | null;
  usage_count: number;
  service_slug: string | null;
  ends_at: string | null;
  is_active: boolean;
};

type FakeGiftPlan = {
  id: string;
  name: string;
  slug: string;
  category: string;
  base_price: number;
  billing_period: 'monthly';
  credits_rollover_months: number;
  is_active: boolean;
};

type FakeStudentAccount = {
  id: string;
  user_id: string;
  status: string;
  expires_at: string | null;
};

type FakeStudentEntitlement = {
  id: string;
  user_id: string;
  status: string;
  source_token: string;
  student_account_id: string | null;
  expires_at: string;
};

function baseSubscription(overrides: Partial<FakeSubscription> = {}): FakeSubscription {
  return {
    id: 'sub-1',
    user_id: null,
    phone: '79001112233',
    customer_name: 'Client',
    plan_id: 'plan-1',
    custom_items: [],
    monthly_price: 990,
    status: 'pending',
    cloudpayments_subscription_id: null,
    cloudpayments_token: null,
    current_period_start: null,
    current_period_end: null,
    next_payment_date: null,
    trial_period_days: 0,
    trial_end: null,
    promo_code_used: null,
    credits_rollover_months: 3,
    plan_billing_period: 'monthly',
    plan_slug: null,
    ...overrides,
  };
}

function createFakeClient(options: {
  subscription?: Partial<FakeSubscription>;
  planItems?: Array<{ product_id: string; quantity: number }>;
  credits?: FakeCredit[];
  studentAccount?: FakeStudentAccount | null;
  studentEntitlements?: FakeStudentEntitlement[];
} = {}) {
  const state = {
    subscription: baseSubscription(options.subscription),
    planItems: options.planItems ?? [{ product_id: 'product-1', quantity: 5 }],
    payments: [] as FakePayment[],
    credits: [...(options.credits ?? [])],
    studentAccount: options.studentAccount ?? null,
    studentEntitlements: [...(options.studentEntitlements ?? [])],
    studentAllowancePeriods: [] as Array<{ id: string; entitlement_id: string; user_id: string }>,
    paymentSeq: 1,
    creditSeq: 1,
    studentEntitlementSeq: 1,
    studentAllowanceSeq: 1,
  };

  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.includes('FROM user_subscriptions us') && normalized.includes('FOR UPDATE OF us')) {
        const [subscriptionId, providerSubscriptionId] = params as [string, string | null];
        const sub = state.subscription.id === subscriptionId
          || (!!providerSubscriptionId && state.subscription.cloudpayments_subscription_id === providerSubscriptionId)
          ? state.subscription
          : null;
        return { rows: sub ? [{ ...sub }] : [] };
      }

      if (normalized.includes('FROM subscription_payments') && normalized.includes('provider_transaction_id = $2')) {
        const [provider, tx] = params as ['cloudpayments', string];
        return {
          rows: state.payments
            .filter(p => p.provider === provider && p.provider_transaction_id === tx)
            .map(p => ({ ...p })),
        };
      }

      if (normalized.includes('FROM subscription_payments') && normalized.includes('period_start = $2')) {
        const [subscriptionId, periodStart, periodEnd] = params as [string, string, string];
        const payment = state.payments.find(p =>
          p.subscription_id === subscriptionId
          && p.status === 'paid'
          && p.period_start === periodStart
          && p.period_end === periodEnd
        );
        return { rows: payment ? [{ ...payment }] : [] };
      }

      if (normalized.startsWith('UPDATE subscription_payments SET provider_transaction_id')) {
        const [id, tx, providerSubscriptionId, raw] = params as [string, string, string | null, string];
        const payment = state.payments.find(p => p.id === id);
        if (!payment) return { rows: [] };
        payment.provider_transaction_id = tx;
        payment.provider_subscription_id = providerSubscriptionId || payment.provider_subscription_id;
        payment.raw_payload = JSON.parse(raw);
        return { rows: [{ ...payment }] };
      }

      if (normalized.startsWith('UPDATE subscription_payments SET subscription_id')) {
        const [id, subscriptionId, providerSubscriptionId, amount, currency, kind, periodStart, periodEnd, raw] =
          params as [string, string, string | null, number, string, string, string, string, string];
        const payment = state.payments.find(p => p.id === id);
        if (!payment) return { rows: [] };
        Object.assign(payment, {
          subscription_id: subscriptionId,
          provider_subscription_id: providerSubscriptionId || payment.provider_subscription_id,
          amount,
          currency,
          status: 'paid',
          kind,
          period_start: periodStart,
          period_end: periodEnd,
          raw_payload: JSON.parse(raw),
        });
        return { rows: [{ ...payment }] };
      }

      if (normalized.startsWith('INSERT INTO subscription_payments')) {
        const isPaidInsert = normalized.includes("VALUES ($1,$2,$3,$4,$5,$6,'paid'");
        const provider = params[1] as 'cloudpayments';
        const providerTransactionId = params[3] as string | null;
        const existingByTx = providerTransactionId
          ? state.payments.find(p => p.provider === provider && p.provider_transaction_id === providerTransactionId)
          : null;
        if (existingByTx) return { rows: [] };

        const periodStart = isPaidInsert ? params[7] as string : null;
        const periodEnd = isPaidInsert ? params[8] as string : null;
        const existingByPeriod = isPaidInsert
          ? state.payments.find(p =>
              p.subscription_id === params[0]
              && p.status === 'paid'
              && p.period_start === periodStart
              && p.period_end === periodEnd
            )
          : null;
        if (existingByPeriod) return { rows: [] };

        const payment: FakePayment = isPaidInsert
          ? {
              id: `payment-${state.paymentSeq++}`,
              subscription_id: params[0] as string,
              provider,
              provider_subscription_id: params[2] as string | null,
              provider_transaction_id: providerTransactionId,
              amount: params[4] as number,
              currency: params[5] as string,
              status: 'paid',
              kind: params[6] as string,
              period_start: periodStart,
              period_end: periodEnd,
              raw_payload: JSON.parse(params[9] as string),
              created_at: new Date().toISOString(),
            }
          : {
              id: `payment-${state.paymentSeq++}`,
              subscription_id: params[0] as string,
              provider,
              provider_subscription_id: params[2] as string | null,
              provider_transaction_id: providerTransactionId,
              amount: params[4] as number,
              currency: params[5] as string,
              status: params[6] as string,
              kind: params[7] as string,
              period_start: null,
              period_end: null,
              raw_payload: JSON.parse(params[8] as string),
              created_at: new Date().toISOString(),
            };
        state.payments.push(payment);
        return { rows: [{ ...payment }] };
      }

      if (normalized.startsWith('UPDATE user_subscriptions SET')) {
        const [id, providerSubscriptionId, providerToken, periodStart, periodEnd, nextPaymentDate, trialEnd] =
          params as [string, string | null, string | null, string, string, string, string | null];
        if (state.subscription.id !== id) return { rows: [] };
        state.subscription.status = 'active';
        state.subscription.cloudpayments_subscription_id = providerSubscriptionId || state.subscription.cloudpayments_subscription_id;
        state.subscription.cloudpayments_token = providerToken || state.subscription.cloudpayments_token;
        state.subscription.current_period_start = periodStart;
        state.subscription.current_period_end = periodEnd;
        state.subscription.next_payment_date = nextPaymentDate;
        state.subscription.trial_end = trialEnd || state.subscription.trial_end;
        return { rows: [{ ...state.subscription }] };
      }

      if (normalized.startsWith('UPDATE student_accounts SET status')) {
        const [userId, periodEnd] = params as [string, string];
        const account = state.studentAccount;
        if (!account || account.user_id !== userId || account.status !== 'verified') {
          return { rows: [] };
        }
        account.expires_at = !account.expires_at || new Date(account.expires_at) < new Date(periodEnd)
          ? periodEnd
          : account.expires_at;
        return { rows: [{ id: account.id, user_id: account.user_id }] };
      }

      if (normalized.startsWith('INSERT INTO student_discount_entitlements')) {
        const [userId, studentAccountId, periodEnd] = params as [string, string, string];
        let entitlement = state.studentEntitlements.find(item => item.user_id === userId);
        if (!entitlement) {
          entitlement = {
            id: `student-entitlement-${state.studentEntitlementSeq++}`,
            user_id: userId,
            status: 'active',
            source_token: 'education_subscription',
            student_account_id: studentAccountId,
            expires_at: periodEnd,
          };
          state.studentEntitlements.push(entitlement);
        } else {
          const previousSourceToken = entitlement.source_token;
          entitlement.status = 'active';
          entitlement.source_token = 'education_subscription';
          entitlement.student_account_id = studentAccountId;
          entitlement.expires_at = previousSourceToken === 'education_subscription'
            && new Date(entitlement.expires_at) > new Date(periodEnd)
            ? entitlement.expires_at
            : periodEnd;
        }
        return { rows: [{ id: entitlement.id, user_id: entitlement.user_id }] };
      }

      if (normalized.includes('FROM subscription_plan_items')) {
        return { rows: state.planItems.map(i => ({ product_id: i.product_id, quantity: i.quantity })) };
      }

      if (normalized.includes('INSERT INTO student_allowance_periods')) {
        const [entitlementId, userId] = params as [string, string];
        const allowance = {
          id: `student-allowance-${state.studentAllowanceSeq++}`,
          entitlement_id: entitlementId,
          user_id: userId,
          period_start: '2026-04-01T10:00:00.000Z',
          period_end: '2026-05-01T10:00:00.000Z',
          sheet_limit: 500,
          sheet_price: 3,
          sheets_used: 0,
          created_at: '2026-04-01T10:00:00.000Z',
          updated_at: '2026-04-01T10:00:00.000Z',
        };
        state.studentAllowancePeriods.push(allowance);
        return { rows: [allowance] };
      }

      if (normalized.startsWith('SELECT id, product_id, total_credits, used_credits, period_end FROM subscription_credits')) {
        const [subscriptionId, referenceDate] = params as [string, string];
        const ref = new Date(referenceDate).getTime();
        return {
          rows: state.credits.filter(c =>
            c.subscription_id === subscriptionId
            && new Date(c.expires_at).getTime() > ref
            && c.used_credits < c.total_credits
            && c.rolled_over_from === null
            && new Date(c.period_end).getTime() <= ref
          ).map(c => ({ ...c })),
        };
      }

      if (normalized.startsWith('INSERT INTO subscription_credits') && normalized.includes('rolled_over_from')) {
        const [subscriptionId, productId, periodStart, periodEnd, totalCredits, rolledOverFrom, expiresAt] =
          params as [string, string, string, string, number, string, string];
        if (state.credits.some(c => c.rolled_over_from === rolledOverFrom)) return { rows: [] };
        state.credits.push({
          id: `credit-${state.creditSeq++}`,
          subscription_id: subscriptionId,
          product_id: productId,
          period_start: periodStart,
          period_end: periodEnd,
          total_credits: totalCredits,
          used_credits: 0,
          rolled_over_from: rolledOverFrom,
          expires_at: expiresAt,
        });
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO subscription_credits')) {
        const [subscriptionId, productId, periodStart, periodEnd, totalCredits, expiresAt] =
          params as [string, string, string, string, number, string];
        const exists = state.credits.some(c =>
          c.subscription_id === subscriptionId
          && c.product_id === productId
          && c.period_start === periodStart
          && c.period_end === periodEnd
          && c.rolled_over_from === null
        );
        if (!exists) {
          state.credits.push({
            id: `credit-${state.creditSeq++}`,
            subscription_id: subscriptionId,
            product_id: productId,
            period_start: periodStart,
            period_end: periodEnd,
            total_credits: totalCredits,
            used_credits: 0,
            rolled_over_from: null,
            expires_at: expiresAt,
          });
        }
        return { rows: [] };
      }

      if (normalized.startsWith('UPDATE subscription_credits SET used_credits = total_credits')) {
        const [id] = params as [string];
        const credit = state.credits.find(c => c.id === id);
        if (credit) credit.used_credits = credit.total_credits;
        return { rows: [] };
      }

      throw new Error(`Unhandled fake SQL: ${normalized}`);
    }),
  };

  vi.mocked(mockDb.transaction).mockImplementation(async (fn: (client: unknown) => unknown) => {
    return fn(client);
  });

  return { client, state };
}

function createGiftRedeemFakeClient() {
  const promo: FakeGiftPromo = {
    id: 'promo-1',
    promo_code: 'SVF-GIFT-1234',
    trial_days: 31,
    usage_limit: 1,
    usage_count: 0,
    service_slug: 'subscription:plan-gift',
    ends_at: '2026-06-18T00:00:00.000Z',
    is_active: true,
  };
  const plan: FakeGiftPlan = {
    id: 'plan-gift',
    name: 'Базовый',
    slug: 'doc-print-student',
    category: 'doc-print',
    base_price: 199,
    billing_period: 'monthly',
    credits_rollover_months: 0,
    is_active: true,
  };
  const state = {
    promo,
    plan,
    subscriptions: [] as FakeSubscription[],
  };

  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('SELECT id, promo_code, trial_days') && normalized.includes('FROM promotions')) {
        const [code] = params as [string];
        const promo = state.promo.is_active && state.promo.promo_code.toUpperCase() === code.toUpperCase()
          ? state.promo
          : null;
        return { rows: promo ? [{ ...promo }] : [] };
      }

      if (normalized.startsWith('SELECT id, name, slug, category, base_price')) {
        const [planId] = params as [string];
        return { rows: state.plan.id === planId ? [{ ...state.plan }] : [] };
      }

      if (normalized.startsWith('SELECT us.id FROM user_subscriptions us')) {
        const [, phone] = params as [string | null, string];
        const existingSubscription = state.subscriptions.some(sub => sub.status === 'active' && sub.phone === phone);
        return { rows: existingSubscription ? [{ id: 'existing-sub' }] : [] };
      }

      if (normalized.startsWith('INSERT INTO user_subscriptions')) {
        const [
          userId,
          phone,
          customerName,
          planId,
          customItems,
          periodStart,
          periodEnd,
          trialDays,
          promoCode,
        ] = params as [string | null, string, string | null, string, string, string, string, number, string];
        const parsedCustomItems: unknown = JSON.parse(customItems);
        const subscription: FakeSubscription = baseSubscription({
          id: `gift-sub-${state.subscriptions.length + 1}`,
          user_id: userId,
          phone,
          customer_name: customerName,
          plan_id: planId,
          custom_items: Array.isArray(parsedCustomItems) ? parsedCustomItems : [],
          monthly_price: 0,
          status: 'active',
          current_period_start: periodStart,
          current_period_end: periodEnd,
          next_payment_date: null,
          trial_period_days: trialDays,
          trial_end: periodEnd,
          promo_code_used: promoCode,
          credits_rollover_months: state.plan.credits_rollover_months,
          plan_billing_period: state.plan.billing_period,
          plan_slug: state.plan.slug,
        });
        state.subscriptions.push(subscription);
        return { rows: [{ ...subscription }] };
      }

      if (normalized.startsWith('UPDATE promotions SET usage_count = usage_count + 1')) {
        const [promoId] = params as [string];
        if (state.promo.id === promoId) {
          state.promo.usage_count += 1;
          state.promo.is_active = false;
        }
        return { rows: [] };
      }

      throw new Error(`Unhandled fake SQL: ${normalized}`);
    }),
  };

  vi.mocked(mockDb.transaction).mockImplementation(async (fn: (client: unknown) => unknown) => {
    return fn(client);
  });

  return { client, state };
}

describe('print package credit mapping', () => {
  it('maps color A4 to the shared A4 package with a base x1.2 multiplier', () => {
    expect(getSubscriptionCreditMapping(A4_COLOR_PRINT_PRODUCT_ID)).toEqual({
      creditProductId: A4_BW_PRINT_PRODUCT_ID,
      creditMultiplier: 1.2,
    });
  });

  it('keeps the fill coverage multiplier separate from the color base multiplier', () => {
    const colorBase = getSubscriptionCreditMapping(A4_COLOR_PRINT_PRODUCT_ID);
    const denseCoverage = printPackageCreditMultiplierForCoveragePercent(80);

    expect(denseCoverage).toBe(4);
    expect(colorBase.creditMultiplier * denseCoverage).toBeCloseTo(4.8, 6);
  });
});

describe('restoreCreditsForPosReceiptWithClient', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('restores consumed credits and writes a linked reversal log row', async () => {
    const credit = { id: 'credit-1', used_credits: 3 };
    const usage = {
      id: 'usage-1',
      subscription_id: 'sub-1',
      credit_id: 'credit-1',
      product_id: 'product-1',
      quantity: 3,
      credit_multiplier: '1.00',
      credits_consumed: 3,
      reversed_by_usage_log_id: null as string | null,
    };
    const insertCalls: unknown[][] = [];
    const query = async <Row extends object = object>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: Row[] }> => {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('SELECT id, subscription_id, credit_id, product_id')) {
        return fakeRows<Row>(usage.reversed_by_usage_log_id ? [] : [{ ...usage }]);
      }

      if (normalized.startsWith('UPDATE subscription_credits SET used_credits')) {
        const [, creditsConsumed] = params as [string, number];
        credit.used_credits = Math.max(0, credit.used_credits - creditsConsumed);
        return fakeRows<Row>([]);
      }

      if (normalized.startsWith('INSERT INTO subscription_credit_usage_log')) {
        insertCalls.push(params);
        return fakeRows<Row>([{ id: 'usage-reversal-1' }]);
      }

      if (normalized.startsWith('UPDATE subscription_credit_usage_log SET reversed_by_usage_log_id')) {
        const [, reversalId] = params as [string, string];
        usage.reversed_by_usage_log_id = reversalId;
        return fakeRows<Row>([]);
      }

      throw new Error(`Unhandled fake SQL: ${normalized}`);
    };
    const client: SubscriptionQueryClient = {
      query,
    };

    const result = await restoreCreditsForPosReceiptWithClient(client, {
      pos_receipt_id: 'receipt-1',
      employee_id: 'employee-1',
      description: 'Void receipt',
      reversal_reason: 'mistake',
    });

    expect(result).toEqual({ restored: 3, entries: 1 });
    expect(credit.used_credits).toBe(0);
    expect(insertCalls[0]).toEqual([
      'sub-1',
      'credit-1',
      'product-1',
      -3,
      '1.00',
      -3,
      'receipt-1',
      null,
      'employee-1',
      'Void receipt',
      'usage-1',
      'mistake',
    ]);
    expect(usage.reversed_by_usage_log_id).toBe('usage-reversal-1');
  });

  it('restores only requested product quantity for partial receipt refund', async () => {
    const credit = { id: 'credit-1', used_credits: 5 };
    const usage = {
      id: 'usage-1',
      subscription_id: 'sub-1',
      credit_id: 'credit-1',
      product_id: 'product-1',
      quantity: 5,
      credit_multiplier: '1.00',
      credits_consumed: 5,
      credits_restored: 1,
      reversed_by_usage_log_id: null as string | null,
    };
    const insertCalls: unknown[][] = [];
    const query = async <Row extends object = object>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: Row[] }> => {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('SELECT id, subscription_id, credit_id, product_id')) {
        return fakeRows<Row>([{ ...usage }]);
      }

      if (normalized.startsWith('UPDATE subscription_credits SET used_credits')) {
        const [, creditsConsumed] = params as [string, number];
        credit.used_credits = Math.max(0, credit.used_credits - creditsConsumed);
        return fakeRows<Row>([]);
      }

      if (normalized.startsWith('INSERT INTO subscription_credit_usage_log')) {
        insertCalls.push(params);
        return fakeRows<Row>([{ id: 'usage-reversal-2' }]);
      }

      if (normalized.startsWith('UPDATE subscription_credit_usage_log SET reversed_by_usage_log_id')) {
        const [, reversalId] = params as [string, string];
        usage.reversed_by_usage_log_id = reversalId;
        return fakeRows<Row>([]);
      }

      throw new Error(`Unhandled fake SQL: ${normalized}`);
    };
    const client: SubscriptionQueryClient = {
      query,
    };

    const result = await restoreCreditsForPosReceiptItemsWithClient(client, {
      pos_receipt_id: 'receipt-1',
      items: [{ product_id: 'product-1', quantity: 2 }],
      employee_id: 'employee-1',
      description: 'Partial refund',
      reversal_reason: 'partial',
    });

    expect(result).toEqual({ restored: 2, entries: 1 });
    expect(credit.used_credits).toBe(3);
    expect(insertCalls[0]).toEqual([
      'sub-1',
      'credit-1',
      'product-1',
      -2,
      '1.00',
      -2,
      'receipt-1',
      null,
      'employee-1',
      'Partial refund',
      'usage-1',
      'partial',
    ]);
    expect(usage.reversed_by_usage_log_id).toBeNull();
  });
});

describe('activateOrRenewSubscriptionPayment', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('activates subscription and issues first-period credits on first payment', async () => {
    const { state } = createFakeClient();

    const result = await activateOrRenewSubscriptionPayment({
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'cp-sub-1',
      transactionId: 'tx-1',
      amount: 990,
      kind: 'initial',
      paidAt: '2026-04-01T10:00:00.000Z',
      rawPayload: { webhook: 'pay' },
    });

    expect(result.reason).toBe('processed');
    expect(result.creditsIssued).toBe(true);
    expect(state.subscription.status).toBe('active');
    expect(state.subscription.current_period_start).toBe('2026-04-01T10:00:00.000Z');
    expect(state.payments).toHaveLength(1);
    expect(state.credits).toHaveLength(1);
    expect(state.credits[0].total_credits).toBe(5);
  });

  it('uses the plan billing period when calculating the paid period', async () => {
    const { state } = createFakeClient({
      subscription: {
        plan_billing_period: 'yearly',
      },
    });

    const result = await activateOrRenewSubscriptionPayment({
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'cp-sub-1',
      transactionId: 'tx-yearly-1',
      amount: 199,
      kind: 'initial',
      paidAt: '2026-04-01T10:00:00.000Z',
      rawPayload: { webhook: 'pay' },
    });

    expect(result.reason).toBe('processed');
    expect(state.subscription.current_period_start).toBe('2026-04-01T10:00:00.000Z');
    expect(state.subscription.current_period_end).toBe('2027-04-01T10:00:00.000Z');
    expect(state.credits[0].period_end).toBe('2027-04-01T10:00:00.000Z');
  });

  it('activates paid education access when an education subscription payment is processed', async () => {
    const { state } = createFakeClient({
      subscription: {
        user_id: 'user-1',
        monthly_price: 199,
        plan_billing_period: 'monthly',
        plan_slug: 'education-monthly-199',
      },
      planItems: [],
      studentAccount: {
        id: 'student-account-1',
        user_id: 'user-1',
        status: 'verified',
        expires_at: '2026-12-10T20:59:59.000Z',
      },
      studentEntitlements: [{
        id: 'legacy-entitlement-1',
        user_id: 'user-1',
        status: 'active',
        source_token: 'photo_verification',
        student_account_id: 'student-account-1',
        expires_at: '2026-12-10T20:59:59.000Z',
      }],
    });

    const result = await activateOrRenewSubscriptionPayment({
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'cp-education-1',
      transactionId: 'tx-education-1',
      amount: 199,
      kind: 'initial',
      paidAt: '2026-04-01T10:00:00.000Z',
      rawPayload: { webhook: 'pay' },
    });

    expect(result.reason).toBe('processed');
    expect(state.studentEntitlements).toHaveLength(1);
    expect(state.studentEntitlements[0]).toMatchObject({
      id: 'legacy-entitlement-1',
      user_id: 'user-1',
      status: 'active',
      source_token: 'education_subscription',
      student_account_id: 'student-account-1',
      expires_at: '2026-05-01T10:00:00.000Z',
    });
    expect(state.studentAllowancePeriods).toHaveLength(1);
    expect(state.studentAllowancePeriods[0]).toMatchObject({
      entitlement_id: 'legacy-entitlement-1',
      user_id: 'user-1',
    });
  });

  it('does not duplicate ledger or credits when /pay webhook is repeated', async () => {
    const { state } = createFakeClient();
    const input = {
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'cp-sub-1',
      transactionId: 'tx-1',
      amount: 990,
      kind: 'initial' as const,
      paidAt: '2026-04-01T10:00:00.000Z',
      rawPayload: { webhook: 'pay' },
    };

    await activateOrRenewSubscriptionPayment(input);
    const duplicate = await activateOrRenewSubscriptionPayment(input);

    expect(duplicate.reason).toBe('duplicate_transaction');
    expect(duplicate.creditsIssued).toBe(false);
    expect(state.payments).toHaveLength(1);
    expect(state.credits).toHaveLength(1);
  });

  it('keeps one credit period when recurrent Active arrives before or after /pay', async () => {
    const beforePay = createFakeClient();
    await activateOrRenewSubscriptionPayment({
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'cp-sub-1',
      amount: 990,
      kind: 'initial',
      paidAt: '2026-04-01T10:00:00.000Z',
      rawPayload: { webhook: 'recurrent', Status: 'Active' },
    });
    const payAfterActive = await activateOrRenewSubscriptionPayment({
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'cp-sub-1',
      transactionId: 'tx-real-1',
      amount: 990,
      kind: 'initial',
      paidAt: '2026-04-01T10:00:05.000Z',
      rawPayload: { webhook: 'pay' },
    });

    expect(payAfterActive.reason).toBe('duplicate_period');
    expect(beforePay.state.payments).toHaveLength(1);
    expect(beforePay.state.payments[0].provider_transaction_id).toBe('tx-real-1');
    expect(beforePay.state.credits).toHaveLength(1);

    const afterPay = createFakeClient();
    await activateOrRenewSubscriptionPayment({
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'cp-sub-1',
      transactionId: 'tx-real-2',
      amount: 990,
      kind: 'initial',
      paidAt: '2026-04-01T10:00:00.000Z',
      rawPayload: { webhook: 'pay' },
    });
    const activeAfterPay = await activateOrRenewSubscriptionPayment({
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'cp-sub-1',
      amount: 990,
      kind: 'initial',
      paidAt: '2026-04-01T10:00:05.000Z',
      rawPayload: { webhook: 'recurrent', Status: 'Active' },
    });

    expect(activeAfterPay.reason).toBe('duplicate_period');
    expect(afterPay.state.payments).toHaveLength(1);
    expect(afterPay.state.credits).toHaveLength(1);
  });

  it('rolls over and issues renewal credits only once', async () => {
    const oldCredit: FakeCredit = {
      id: 'old-credit-1',
      subscription_id: 'sub-1',
      product_id: 'product-1',
      period_start: '2026-03-01T10:00:00.000Z',
      period_end: '2026-04-01T10:00:00.000Z',
      total_credits: 5,
      used_credits: 2,
      rolled_over_from: null,
      expires_at: '2026-07-01T10:00:00.000Z',
    };
    const { state } = createFakeClient({
      subscription: {
        status: 'active',
        cloudpayments_subscription_id: 'cp-sub-1',
        current_period_start: '2026-03-01T10:00:00.000Z',
        current_period_end: '2026-04-01T10:00:00.000Z',
      },
      credits: [oldCredit],
    });

    const input = {
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'cp-sub-1',
      transactionId: 'tx-renew-1',
      amount: 990,
      kind: 'renewal' as const,
      paidAt: '2026-04-02T10:00:00.000Z',
      rawPayload: { webhook: 'recurrent', Status: 'Active' },
    };
    const first = await activateOrRenewSubscriptionPayment(input);
    const duplicate = await activateOrRenewSubscriptionPayment(input);

    expect(first.reason).toBe('processed');
    expect(duplicate.reason).toBe('duplicate_transaction');
    expect(state.payments).toHaveLength(1);
    expect(state.credits).toHaveLength(3);
    expect(state.credits.filter(c => c.rolled_over_from === 'old-credit-1')).toHaveLength(1);
    expect(state.credits.filter(c => c.period_start === '2026-04-02T10:00:00.000Z' && c.rolled_over_from === null)).toHaveLength(1);
  });

  it('records failed and cancelled events without issuing credits', async () => {
    const { state } = createFakeClient();

    const failed = await activateOrRenewSubscriptionPayment({
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'cp-sub-1',
      transactionId: 'tx-failed-1',
      amount: 990,
      status: 'failed',
      kind: 'initial',
      paidAt: '2026-04-01T10:00:00.000Z',
      rawPayload: { webhook: 'recurrent', Status: 'PastDue' },
    });
    const cancelled = await activateOrRenewSubscriptionPayment({
      subscriptionId: 'sub-1',
      providerSubscriptionId: 'cp-sub-1',
      transactionId: 'tx-cancelled-1',
      amount: 0,
      status: 'cancelled',
      kind: 'initial',
      paidAt: '2026-04-01T10:05:00.000Z',
      rawPayload: { webhook: 'recurrent', Status: 'Cancelled' },
    });

    expect(failed.reason).toBe('ignored_status');
    expect(cancelled.reason).toBe('ignored_status');
    expect(state.subscription.status).toBe('pending');
    expect(state.payments.map(p => p.status)).toEqual(['failed', 'cancelled']);
    expect(state.credits).toHaveLength(0);
  });
});

describe('redeemGiftSubscriptionPromo', () => {
  beforeEach(() => {
    resetMockDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a real active guest subscription for one month and consumes the gift promo', async () => {
    const { state } = createGiftRedeemFakeClient();

    const subscription = await redeemGiftSubscriptionPromo({
      promo_code: 'svf-gift-1234',
      phone: '+7 (900) 123-45-67',
      customer_name: 'Виктория',
    });

    expect(subscription.status).toBe('active');
    expect(subscription.user_id).toBeNull();
    expect(subscription.phone).toBe('79001234567');
    expect(subscription.customer_name).toBe('Виктория');
    expect(subscription.monthly_price).toBe(0);
    expect(subscription.current_period_start).toBe('2026-05-21T10:00:00.000Z');
    expect(subscription.current_period_end).toBe('2026-06-21T10:00:00.000Z');
    expect(subscription.next_payment_date).toBeNull();
    expect(subscription.trial_period_days).toBe(31);
    expect(subscription.trial_end).toBe('2026-06-21T10:00:00.000Z');
    expect(subscription.promo_code_used).toBe('SVF-GIFT-1234');
    expect(subscription.plan_id).toBe('plan-gift');
    expect(subscription.plan_name).toBe('Базовый');
    expect(state.promo.usage_count).toBe(1);
    expect(state.promo.is_active).toBe(false);
  });
});

// ─── CARD CHANGE ──────────────────────────────────────

interface FakeCardChange {
  id: string;
  subscription_id: string;
  user_id: string | null;
  idempotency_key: string;
  status: string;
  old_cp_subscription_id: string | null;
  old_cp_token: string | null;
  new_cp_subscription_id: string | null;
  new_cp_token: string | null;
  new_card_last_four: string | null;
  new_card_type: string | null;
  expected_amount: number;
  verify_transaction_id: string | number | null;
  cancel_attempts: number;
  refunded: boolean;
  last_error: string | null;
}

interface FakeCardChangeSubscription {
  id: string;
  user_id: string | null;
  phone: string | null;
  status: string;
  monthly_price: number;
  cloudpayments_subscription_id: string | null;
  cloudpayments_token: string | null;
  card_last_four: string | null;
  card_type: string | null;
  card_change_in_progress: boolean;
  next_payment_date: string | null;
  plan_name: string | null;
  plan_billing_period: 'monthly' | 'quarterly' | 'yearly' | null;
  user_email: string | null;
}

interface FakeFetchResponse { ok: boolean; status: number; json: () => Promise<unknown> }

const CC_ACTIVE_STATUSES = ['awaiting_token', 'swapping', 'pending_cancel_old'];

function defaultCardChange(): FakeCardChange {
  return {
    id: 'change-1',
    subscription_id: 'sub-1',
    user_id: 'user-1',
    idempotency_key: 'change-1',
    status: 'awaiting_token',
    old_cp_subscription_id: 'cp-old-1',
    old_cp_token: 'tok-old',
    new_cp_subscription_id: null,
    new_cp_token: 'tok-new',
    new_card_last_four: '4242',
    new_card_type: 'Visa',
    expected_amount: 1,
    verify_transaction_id: 555,
    cancel_attempts: 0,
    refunded: false,
    last_error: null,
  };
}

function defaultCardChangeSubscription(): FakeCardChangeSubscription {
  return {
    id: 'sub-1',
    user_id: 'user-1',
    phone: '79001112233',
    status: 'active',
    monthly_price: 199,
    cloudpayments_subscription_id: 'cp-old-1',
    cloudpayments_token: 'tok-old',
    card_last_four: '1111',
    card_type: 'Visa',
    card_change_in_progress: false,
    next_payment_date: '2026-07-01T00:00:00.000Z',
    plan_name: 'Годовая подписка',
    plan_billing_period: 'yearly',
    user_email: 'client@example.com',
  };
}

/**
 * Общий fake-стейт для card-change: обслуживает db.query/db.queryOne/db.transaction(client).
 * Маршрутизация по нормализованному SQL — подписка + одна запись card-change в памяти.
 */
function createCardChangeStore(options: {
  subscription?: Partial<FakeCardChangeSubscription>;
  change?: Partial<FakeCardChange> | null;
  lastPaidAmount?: number | null;
} = {}) {
  const state = {
    subscription: { ...defaultCardChangeSubscription(), ...options.subscription },
    change: options.change === null ? null : { ...defaultCardChange(), ...options.change },
    lastPaidAmount: options.lastPaidAmount === undefined ? 199 : options.lastPaidAmount,
  };

  const run = async (sql: string, params: unknown[] = []): Promise<{ rows: object[] }> => {
    const n = sql.replace(/\s+/g, ' ').trim();

    if (n.includes('FROM user_subscriptions us') && n.includes('sp.name AS plan_name')) {
      const sub = state.subscription.id === params[0] ? state.subscription : null;
      return { rows: sub ? [{ ...sub }] : [] };
    }
    if (n.startsWith('SELECT * FROM subscription_card_changes') && n.includes('status = ANY')) {
      const c = state.change && CC_ACTIVE_STATUSES.includes(state.change.status) ? state.change : null;
      return { rows: c ? [{ ...c }] : [] };
    }
    if (n === 'SELECT * FROM subscription_card_changes WHERE id = $1 FOR UPDATE') {
      const c = state.change && state.change.id === params[0] ? state.change : null;
      return { rows: c ? [{ ...c }] : [] };
    }
    if (n.startsWith('SELECT * FROM subscription_card_changes') && n.includes('subscription_id = $2')) {
      const c = state.change && state.change.id === params[0] && state.change.subscription_id === params[1]
        ? state.change : null;
      return { rows: c ? [{ ...c }] : [] };
    }
    if (n.startsWith('INSERT INTO subscription_card_changes')) {
      state.change = {
        id: String(params[0]),
        subscription_id: String(params[1]),
        user_id: params[2] === null ? null : String(params[2]),
        idempotency_key: String(params[0]),
        status: 'awaiting_token',
        old_cp_subscription_id: params[3] === null ? null : String(params[3]),
        old_cp_token: params[4] === null ? null : String(params[4]),
        new_cp_subscription_id: null,
        new_cp_token: null,
        new_card_last_four: null,
        new_card_type: null,
        expected_amount: Number(params[5]),
        verify_transaction_id: null,
        cancel_attempts: 0,
        refunded: false,
        last_error: null,
      };
      return { rows: [{ ...state.change }] };
    }
    if (n.startsWith("UPDATE subscription_card_changes SET status = 'swapping'")) {
      if (state.change && state.change.id === params[0]
        && state.change.status === 'awaiting_token' && state.change.new_cp_subscription_id === null) {
        state.change.status = 'swapping';
        return { rows: [{ id: state.change.id }] };
      }
      return { rows: [] };
    }
    if (n.startsWith("UPDATE subscription_card_changes SET status = 'pending_cancel_old'")) {
      if (state.change && state.change.id === params[0]) {
        state.change.status = 'pending_cancel_old';
        state.change.new_cp_subscription_id = String(params[1]);
      }
      return { rows: [] };
    }
    if (n.startsWith("UPDATE subscription_card_changes SET status = 'completed'")) {
      if (state.change && state.change.id === params[0]) state.change.status = 'completed';
      return { rows: [] };
    }
    if (n.startsWith("UPDATE subscription_card_changes SET status = 'failed'")) {
      if (state.change && state.change.id === params[0]) {
        state.change.status = 'failed';
        state.change.last_error = params[1] === undefined ? 'failed' : String(params[1]);
      }
      return { rows: [] };
    }
    if (n.startsWith("UPDATE subscription_card_changes SET status = 'awaiting_token'")) {
      if (state.change && state.change.id === params[0]
        && state.change.status === 'swapping' && state.change.new_cp_subscription_id === null) {
        state.change.status = 'awaiting_token';
        state.change.last_error = params[1] === undefined ? null : String(params[1]);
      }
      return { rows: [] };
    }
    if (n.startsWith('UPDATE subscription_card_changes SET cancel_attempts')) {
      if (state.change && state.change.id === params[0]) {
        state.change.cancel_attempts += 1;
        state.change.last_error = params[1] === undefined ? null : String(params[1]);
      }
      return { rows: [] };
    }
    if (n.startsWith('UPDATE subscription_card_changes SET refunded = true')) {
      if (state.change && state.change.id === params[0]) state.change.refunded = true;
      return { rows: [] };
    }
    if (n.startsWith('UPDATE user_subscriptions') && n.includes('cloudpayments_subscription_id = $2')) {
      state.subscription.cloudpayments_subscription_id = String(params[1]);
      state.subscription.cloudpayments_token = String(params[2]);
      if (params[3]) state.subscription.card_last_four = String(params[3]);
      if (params[4]) state.subscription.card_type = String(params[4]);
      state.subscription.card_change_in_progress = true;
      return { rows: [] };
    }
    if (n.startsWith('UPDATE user_subscriptions') && n.includes('card_change_in_progress = false')) {
      state.subscription.card_change_in_progress = false;
      return { rows: [] };
    }
    // storeVerifiedCard: первый UPDATE по change (только awaiting_token).
    if (n.startsWith('UPDATE subscription_card_changes SET new_cp_token = $2')) {
      if (state.change && state.change.id === params[0] && state.change.status === 'awaiting_token') {
        state.change.new_cp_token = String(params[1]);
        if (params[2] != null) state.change.new_card_last_four = String(params[2]);
        if (params[3] != null) state.change.new_card_type = String(params[3]);
        if (params[4] != null) state.change.verify_transaction_id = String(params[4]);
      }
      return { rows: [] };
    }
    // storeVerifiedCard P2-fix: дозапись last4/type в подписку, если swap уже прошёл.
    if (n.startsWith('UPDATE user_subscriptions us') && n.includes('FROM subscription_card_changes scc')) {
      const change = state.change && state.change.id === params[0] ? state.change : null;
      if (change
        && change.subscription_id === state.subscription.id
        && (change.status === 'pending_cancel_old' || change.status === 'completed')) {
        if (params[1] != null && state.subscription.card_last_four == null) {
          state.subscription.card_last_four = String(params[1]);
        }
        if (params[2] != null && state.subscription.card_type == null) {
          state.subscription.card_type = String(params[2]);
        }
      }
      return { rows: [] };
    }
    if (n.startsWith('SELECT amount FROM subscription_payments')) {
      return { rows: state.lastPaidAmount != null ? [{ amount: state.lastPaidAmount }] : [] };
    }

    throw new Error(`Unhandled card-change SQL: ${n}`);
  };

  vi.mocked(mockDb.transaction).mockImplementation(async (fn: (client: unknown) => unknown) => {
    return fn({ query: vi.fn(run) });
  });
  vi.mocked(mockDb.query).mockImplementation((sql: string, params?: unknown[]) =>
    run(sql, params).then(r => r.rows) as never);
  vi.mocked(mockDb.queryOne).mockImplementation((sql: string, params?: unknown[]) =>
    run(sql, params).then(r => r.rows[0] ?? null) as never);

  return { state, run };
}

type CpFetchHandler = (path: string, body: Record<string, unknown>) => unknown;

/** Мок fetch для CloudPayments — маршрутизация по пути; запись вызовов. */
function stubCloudPaymentsFetch(handlers: Record<string, CpFetchHandler>) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }): Promise<FakeFetchResponse> => {
    const u = new URL(url);
    const path = u.pathname;
    const parsed: unknown = init?.body ? JSON.parse(init.body) : {};
    const body = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
    calls.push({ path, body });
    const handler = handlers[path];
    const payload = handler ? handler(path, body) : { Success: false, Message: 'unhandled' };
    return { ok: true, status: 200, json: async () => payload };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

describe('initCardChange', () => {
  beforeEach(() => {
    resetMockDb();
    vi.unstubAllGlobals();
  });

  it('creates a new awaiting_token change for an active subscription', async () => {
    const { state } = createCardChangeStore({ change: null });

    const result = await initCardChange('sub-1', 'user-1');

    expect(result.changeId).toBeTruthy();
    expect(result.externalId).toBe(`SUBCC-${result.changeId}`);
    expect(result.verifyAmount).toBe(1);
    expect(result.planName).toBe('Годовая подписка');
    expect(result.email).toBe('client@example.com');
    expect(state.change?.status).toBe('awaiting_token');
    expect(state.change?.old_cp_subscription_id).toBe('cp-old-1');
    expect(state.change?.idempotency_key).toBe(state.change?.id);
  });

  it('is idempotent — returns the existing open change instead of creating a second', async () => {
    const { state } = createCardChangeStore({
      change: { id: 'existing-1', idempotency_key: 'existing-1', status: 'awaiting_token' },
    });

    const result = await initCardChange('sub-1', 'user-1');

    expect(result.changeId).toBe('existing-1');
    expect(result.externalId).toBe('SUBCC-existing-1');
    expect(state.change?.id).toBe('existing-1');
  });

  it('rejects with 409 when the subscription is not active/paused', async () => {
    createCardChangeStore({ subscription: { status: 'cancelled' }, change: null });

    await expect(initCardChange('sub-1', 'user-1')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('confirmCardChange', () => {
  beforeEach(() => {
    resetMockDb();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clones the old subscription from CloudPayments get (NOT monthly_price) and swaps', async () => {
    const { state } = createCardChangeStore({
      subscription: { monthly_price: 199, plan_billing_period: 'yearly' },
      change: { status: 'awaiting_token', new_cp_token: 'tok-new', new_card_last_four: '4242' },
    });
    const { calls } = stubCloudPaymentsFetch({
      '/payments/find': () => ({
        Success: true, Message: null,
        Model: { StatusCode: 3, Amount: 1, Currency: 'RUB', Token: 'tok-new', TransactionId: 555 },
      }),
      // Старая подписка: реальная сумма 2388 (годовая), Period 12 — клон ДОЛЖЕН взять это, не 199.
      '/subscriptions/get': () => ({
        Success: true, Message: null,
        Model: {
          Id: 'cp-old-1', Amount: 2388, Currency: 'RUB', Interval: 'Month', Period: 12,
          NextTransactionDateIso: '2026-07-01T00:00:00.000Z', Description: 'Годовая подписка',
        },
      }),
      '/subscriptions/create': () => ({ Success: true, Message: null, Model: { Id: 'cp-new-9' } }),
      '/subscriptions/cancel': () => ({ Success: true, Message: null }),
      '/payments/refund': () => ({ Success: true, Message: null }),
    });

    const result = await confirmCardChange('sub-1', 'change-1');

    expect(result.status).toBe('card_changed');
    expect(result.cardLastFour).toBe('4242');
    // Новая CP-подписка создана с КЛОНИРОВАННОЙ суммой 2388 и Period 12, не monthly_price=199.
    const createCall = calls.find(c => c.path === '/subscriptions/create');
    expect(createCall?.body['Amount']).toBe(2388);
    expect(createCall?.body['Period']).toBe(12);
    expect(createCall?.body['Token']).toBe('tok-new');
    expect(createCall?.body['AccountId']).toBe('sub-1');
    // swap выполнен: подписка на новом cpId, флаг снят после успешного cancel.
    expect(state.subscription.cloudpayments_subscription_id).toBe('cp-new-9');
    expect(state.subscription.cloudpayments_token).toBe('tok-new');
    expect(state.subscription.card_change_in_progress).toBe(false);
    expect(state.change?.status).toBe('completed');
    // Старый рекуррент отменён.
    expect(calls.some(c => c.path === '/subscriptions/cancel' && c.body['Id'] === 'cp-old-1')).toBe(true);
  });

  it('computes StartDate as GREATEST(cpNext, next_payment_date, now+1d) — never immediate', async () => {
    createCardChangeStore({
      subscription: { next_payment_date: '2026-08-15T00:00:00.000Z' },
      change: { status: 'awaiting_token', new_cp_token: 'tok-new' },
    });
    const { calls } = stubCloudPaymentsFetch({
      '/payments/find': () => ({ Success: true, Message: null, Model: { StatusCode: 3, Amount: 1, Currency: 'RUB', Token: 'tok-new' } }),
      '/subscriptions/get': () => ({ Success: true, Message: null, Model: { Amount: 199, Currency: 'RUB', Interval: 'Month', Period: 1, NextTransactionDateIso: '2026-07-01T00:00:00.000Z' } }),
      '/subscriptions/create': () => ({ Success: true, Message: null, Model: { Id: 'cp-new-1' } }),
      '/subscriptions/cancel': () => ({ Success: true, Message: null }),
      '/payments/refund': () => ({ Success: true, Message: null }),
    });

    await confirmCardChange('sub-1', 'change-1');

    const createCall = calls.find(c => c.path === '/subscriptions/create');
    // GREATEST(cpNext=2026-07-01, sub.next=2026-08-15) → 2026-08-15.
    expect(createCall?.body['StartDate']).toBe('2026-08-15T00:00:00.000Z');
  });

  it('falls back to last paid amount + plan period when CP get is unavailable', async () => {
    createCardChangeStore({
      subscription: { plan_billing_period: 'quarterly' },
      change: { status: 'awaiting_token', new_cp_token: 'tok-new' },
      lastPaidAmount: 540,
    });
    const { calls } = stubCloudPaymentsFetch({
      '/payments/find': () => ({ Success: true, Message: null, Model: { StatusCode: 3, Amount: 1, Currency: 'RUB', Token: 'tok-new' } }),
      '/subscriptions/get': () => ({ Success: false, Message: 'unavailable', Model: null }),
      '/subscriptions/create': () => ({ Success: true, Message: null, Model: { Id: 'cp-new-2' } }),
      '/subscriptions/cancel': () => ({ Success: true, Message: null }),
      '/payments/refund': () => ({ Success: true, Message: null }),
    });

    const result = await confirmCardChange('sub-1', 'change-1');

    expect(result.status).toBe('card_changed');
    const createCall = calls.find(c => c.path === '/subscriptions/create');
    expect(createCall?.body['Amount']).toBe(540);
    expect(createCall?.body['Period']).toBe(3); // quarterly fallback
  });

  it('returns 502 (no recurrent created) when amount cannot be resolved at all', async () => {
    createCardChangeStore({
      change: { status: 'awaiting_token', new_cp_token: 'tok-new' },
      lastPaidAmount: null,
    });
    const { calls } = stubCloudPaymentsFetch({
      '/payments/find': () => ({ Success: true, Message: null, Model: { StatusCode: 3, Amount: 1, Currency: 'RUB', Token: 'tok-new' } }),
      '/subscriptions/get': () => ({ Success: false, Message: 'unavailable', Model: null }),
    });

    await expect(confirmCardChange('sub-1', 'change-1')).rejects.toMatchObject({ statusCode: 502 });
    // Рекуррент НЕ создан — защита от неверного списания.
    expect(calls.some(c => c.path === '/subscriptions/create')).toBe(false);
  });

  it('returns pending_payment when the 1₽ verification is not paid yet', async () => {
    createCardChangeStore({ change: { status: 'awaiting_token', new_cp_token: 'tok-new' } });
    stubCloudPaymentsFetch({
      '/payments/find': () => ({ Success: true, Message: null, Model: { StatusCode: 1, Amount: 1, Currency: 'RUB' } }),
    });

    const result = await confirmCardChange('sub-1', 'change-1');
    expect(result.status).toBe('pending_payment');
  });

  it('rejects verification when anti-tamper amount mismatches (not ≈1₽)', async () => {
    const { state } = createCardChangeStore({ change: { status: 'awaiting_token', new_cp_token: 'tok-new' } });
    const { calls } = stubCloudPaymentsFetch({
      // Подменён Amount=199 вместо 1 — anti-tamper должен отклонить как неоплаченное.
      '/payments/find': () => ({ Success: true, Message: null, Model: { StatusCode: 3, Amount: 199, Currency: 'RUB', Token: 'tok-new' } }),
    });

    const result = await confirmCardChange('sub-1', 'change-1');
    expect(result.status).toBe('pending_payment');
    expect(calls.some(c => c.path === '/subscriptions/create')).toBe(false);
    expect(state.subscription.cloudpayments_subscription_id).toBe('cp-old-1'); // не свапнуто
  });

  it('is idempotent — already pending_cancel_old returns already_changed without CP calls', async () => {
    createCardChangeStore({ change: { status: 'pending_cancel_old', new_card_last_four: '4242' } });
    const { calls } = stubCloudPaymentsFetch({});

    const result = await confirmCardChange('sub-1', 'change-1');
    expect(result.status).toBe('already_changed');
    expect(result.cardLastFour).toBe('4242');
    expect(calls.length).toBe(0); // никаких внешних CP-вызовов
  });

  it('returns processing when another confirm already claimed (status=swapping)', async () => {
    createCardChangeStore({ change: { status: 'swapping', new_cp_token: 'tok-new' } });
    const { calls } = stubCloudPaymentsFetch({});

    const result = await confirmCardChange('sub-1', 'change-1');
    expect(result.status).toBe('processing');
    expect(calls.length).toBe(0);
  });

  it('leaves change in pending_cancel_old when cancel of old recurrent fails (reconciler will retry)', async () => {
    const { state } = createCardChangeStore({ change: { status: 'awaiting_token', new_cp_token: 'tok-new' } });
    stubCloudPaymentsFetch({
      '/payments/find': () => ({ Success: true, Message: null, Model: { StatusCode: 3, Amount: 1, Currency: 'RUB', Token: 'tok-new' } }),
      '/subscriptions/get': () => ({ Success: true, Message: null, Model: { Amount: 199, Currency: 'RUB', Interval: 'Month', Period: 1 } }),
      '/subscriptions/create': () => ({ Success: true, Message: null, Model: { Id: 'cp-new-3' } }),
      '/subscriptions/cancel': () => ({ Success: false, Message: 'CloudPayments timeout' }),
      '/payments/refund': () => ({ Success: true, Message: null }),
    });

    const result = await confirmCardChange('sub-1', 'change-1');

    // swap прошёл (подписка на новой), но cancel упал → остаётся pending_cancel_old + флаг включён.
    expect(result.status).toBe('card_changed');
    expect(state.subscription.cloudpayments_subscription_id).toBe('cp-new-3');
    expect(state.change?.status).toBe('pending_cancel_old');
    expect(state.subscription.card_change_in_progress).toBe(true);
    expect(state.change?.cancel_attempts).toBe(1);
  });

  it('returns 502 and rolls claim back to awaiting_token when /subscriptions/create fails', async () => {
    const { state } = createCardChangeStore({ change: { status: 'awaiting_token', new_cp_token: 'tok-new' } });
    stubCloudPaymentsFetch({
      '/payments/find': () => ({ Success: true, Message: null, Model: { StatusCode: 3, Amount: 1, Currency: 'RUB', Token: 'tok-new' } }),
      '/subscriptions/get': () => ({ Success: true, Message: null, Model: { Amount: 199, Currency: 'RUB', Interval: 'Month', Period: 1 } }),
      '/subscriptions/create': () => ({ Success: false, Message: 'rejected', Model: null }),
    });

    await expect(confirmCardChange('sub-1', 'change-1')).rejects.toMatchObject({ statusCode: 502 });
    // claim откатан — повтор confirm возможен.
    expect(state.change?.status).toBe('awaiting_token');
    expect(state.subscription.cloudpayments_subscription_id).toBe('cp-old-1');
  });
});

describe('cancelCloudPaymentsRecurrentChecked', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns success on CP Success=true', async () => {
    stubCloudPaymentsFetch({ '/subscriptions/cancel': () => ({ Success: true, Message: null }) });
    await expect(cancelCloudPaymentsRecurrentChecked('cp-x')).resolves.toEqual({ success: true, message: null });
  });

  it('treats "not found" as idempotent success (do not loop in reconciler)', async () => {
    stubCloudPaymentsFetch({ '/subscriptions/cancel': () => ({ Success: false, Message: 'Subscription not found' }) });
    const res = await cancelCloudPaymentsRecurrentChecked('cp-dead');
    expect(res.success).toBe(true);
  });

  it('returns failure on a real CP error (so reconciler retries)', async () => {
    stubCloudPaymentsFetch({ '/subscriptions/cancel': () => ({ Success: false, Message: 'Internal error' }) });
    const res = await cancelCloudPaymentsRecurrentChecked('cp-y');
    expect(res.success).toBe(false);
  });
});

describe('billingPeriodToCp', () => {
  it('maps billing periods to CP interval/period', () => {
    expect(billingPeriodToCp('yearly')).toEqual({ Interval: 'Month', Period: 12 });
    expect(billingPeriodToCp('quarterly')).toEqual({ Interval: 'Month', Period: 3 });
    expect(billingPeriodToCp('monthly')).toEqual({ Interval: 'Month', Period: 1 });
    expect(billingPeriodToCp(null)).toEqual({ Interval: 'Month', Period: 1 });
  });
});

describe('adoptOrphanCardChange', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('completes the swap for an orphaned swapping change (claimer died after CP create)', async () => {
    // Сценарий: confirm создал CP-подписку cp-new-7, но умер до записи new_cp → status='swapping', new_cp=NULL.
    const { state } = createCardChangeStore({
      change: { status: 'swapping', new_cp_subscription_id: null, new_card_last_four: '4242', new_card_type: 'Visa' },
    });

    const result = await adoptOrphanCardChange('change-1', 'cp-new-7', 'tok-new', null, null);

    expect(result).toBe('adopted');
    // swap до-выполнен тем же путём: подписка на новом cpId + флаг + change→pending_cancel_old.
    expect(state.subscription.cloudpayments_subscription_id).toBe('cp-new-7');
    expect(state.subscription.cloudpayments_token).toBe('tok-new');
    expect(state.subscription.card_change_in_progress).toBe(true);
    expect(state.change?.status).toBe('pending_cancel_old');
    expect(state.change?.new_cp_subscription_id).toBe('cp-new-7');
    // last4 взят из уже сохранённого в change (приоритет над переданным null).
    expect(state.subscription.card_last_four).toBe('4242');
  });

  it('is a no-op when new_cp is already recorded (swap already happened)', async () => {
    const { state } = createCardChangeStore({
      change: { status: 'pending_cancel_old', new_cp_subscription_id: 'cp-new-5' },
    });

    const result = await adoptOrphanCardChange('change-1', 'cp-new-7', 'tok-new', null, null);

    expect(result).toBe('already_swapped');
    // ничего не свапнуто заново.
    expect(state.subscription.cloudpayments_subscription_id).toBe('cp-old-1');
  });

  it('returns not_orphan when the change is not in swapping status', async () => {
    createCardChangeStore({ change: { status: 'awaiting_token', new_cp_subscription_id: null } });

    const result = await adoptOrphanCardChange('change-1', 'cp-new-7', 'tok-new', null, null);
    expect(result).toBe('not_orphan');
  });

  it('marks the change failed (not_orphan) when the subscription is no longer active', async () => {
    const { state } = createCardChangeStore({
      subscription: { status: 'cancelled' },
      change: { status: 'swapping', new_cp_subscription_id: null },
    });

    const result = await adoptOrphanCardChange('change-1', 'cp-new-7', 'tok-new', null, null);

    expect(result).toBe('not_orphan');
    expect(state.change?.status).toBe('failed');
    // не свапаем на отменённую подписку.
    expect(state.subscription.cloudpayments_subscription_id).toBe('cp-old-1');
  });
});

describe('storeVerifiedCard', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('writes token/last4 into the change while awaiting_token (does not touch user_subscriptions last4)', async () => {
    const { state } = createCardChangeStore({
      subscription: { card_last_four: null, card_type: null },
      change: { status: 'awaiting_token', new_cp_token: null, new_card_last_four: null, new_card_type: null },
    });

    await storeVerifiedCard('change-1', { token: 'tok-new', last4: '4242', type: 'Visa', transactionId: 555 });

    expect(state.change?.new_cp_token).toBe('tok-new');
    expect(state.change?.new_card_last_four).toBe('4242');
    expect(state.change?.new_card_type).toBe('Visa');
    // swap ещё не прошёл (awaiting_token) → подписку не трогаем.
    expect(state.subscription.card_last_four).toBeNull();
  });

  it('P2-fix: back-fills last4/type into user_subscriptions when /pay races AFTER swap', async () => {
    // Гонка: swap уже прошёл (change=pending_cancel_old), подписка БЕЗ last4 (swap не нашёл его в change),
    // /pay приходит с опозданием → должен дозаписать last4/type в user_subscriptions.
    const { state } = createCardChangeStore({
      subscription: { card_last_four: null, card_type: null },
      change: { status: 'pending_cancel_old', new_cp_subscription_id: 'cp-new-9' },
    });

    await storeVerifiedCard('change-1', { token: 'tok-new', last4: '4242', type: 'Visa', transactionId: 555 });

    expect(state.subscription.card_last_four).toBe('4242');
    expect(state.subscription.card_type).toBe('Visa');
  });

  it('P2-fix: COALESCE does not overwrite an already-populated last4 after swap', async () => {
    const { state } = createCardChangeStore({
      subscription: { card_last_four: '4242', card_type: 'Visa' },
      change: { status: 'completed', new_cp_subscription_id: 'cp-new-9' },
    });

    await storeVerifiedCard('change-1', { token: 'tok-new', last4: '9999', type: 'MasterCard', transactionId: 555 });

    // уже заполнено корректно — не перетираем.
    expect(state.subscription.card_last_four).toBe('4242');
    expect(state.subscription.card_type).toBe('Visa');
  });
});

describe('reconcileEducationEntitlements', () => {
  beforeEach(() => {
    resetMockDb();
  });

  const EDU_SLUGS = ['education-monthly-199', 'education-yearly-1999', 'education-yearly-199'];

  it('понижает «застрявшие» education_subscription и фильтрует по пользователю', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ id: 'e1' }] as never);

    const changed = await reconcileEducationEntitlements('user-1');

    expect(changed).toBe(1);
    const [sql, params] = vi.mocked(mockDb.query).mock.calls[0]!;
    const text = String(sql);
    // Только записи оплаченной подписки, понижаем в 'education_verified' при верифиц. статусе.
    expect(text).toContain("e.source_token = 'education_subscription'");
    expect(text).toContain("THEN 'education_verified'");
    expect(text).toContain("us.status = 'active'");
    // Сверка has_sub НЕ привязана к current_period_end (окно продления CP).
    expect(text).not.toContain('current_period_end');
    expect(text).toContain('AND e.user_id = $2');
    expect(params).toEqual([EDU_SLUGS, 'user-1']);
  });

  it('без userId обрабатывает всех (без фильтра $2)', async () => {
    const changed = await reconcileEducationEntitlements();

    expect(changed).toBe(0);
    const [sql, params] = vi.mocked(mockDb.query).mock.calls[0]!;
    expect(String(sql)).not.toContain('AND e.user_id = $2');
    expect(params).toEqual([EDU_SLUGS]);
  });
});
