import db from '../database/db.js';
import { randomBytes, randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import type { SubscriptionPlansId } from '../types/generated/public/SubscriptionPlans.js';
import type { UserSubscriptionsId } from '../types/generated/public/UserSubscriptions.js';
import type { ProductsId } from '../types/generated/public/Products.js';
import type { SubscriptionCreditsId } from '../types/generated/public/SubscriptionCredits.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type { PhotoPrintOrdersId } from '../types/generated/public/PhotoPrintOrders.js';
import type { CreditUsageHistoryRow, CreditUsageCountRow } from '../types/views/subscription-views.js';
import type { IdOnly } from '../types/db-common.types.js';
import type { PrintPackageCoverageTier, SubscriptionPlanUsagePolicy } from '../types/jsonb/subscription-plan-jsonb.js';
import { ensureCurrentStudentAllowancePeriodWithClient } from './student-discount.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { isCloudPaymentsCancelResponse } from '../types/views/subscription-views.js';

const subLog = createLogger('subscription.service');

/**
 * Останавливает рекуррентную подписку в CloudPayments. Best-effort: ошибки логируются,
 * но не роняют отмену в нашей системе. Вызывается из cancelSubscription, чтобы ЛЮБОЙ путь
 * отмены (клиентский /my/cancel и операторский /:id/cancel) останавливал списания.
 */
async function cancelCloudPaymentsRecurrent(cpSubscriptionId: string, subscriptionId: string): Promise<void> {
  try {
    const cpAuth = Buffer
      .from(`${config.cloudPayments.publicId}:${config.cloudPayments.apiSecret}`)
      .toString('base64');
    const cpResponse = await fetch('https://api.cloudpayments.ru/subscriptions/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${cpAuth}` },
      body: JSON.stringify({ Id: cpSubscriptionId }),
      signal: AbortSignal.timeout(10000),
    });
    const cpBody: unknown = await cpResponse.json();
    if (isCloudPaymentsCancelResponse(cpBody) && !cpBody.Success) {
      subLog.warn('[Subscriptions] CloudPayments cancel returned error', {
        subscriptionId, cpId: cpSubscriptionId, message: cpBody.Message,
      });
    }
  } catch (err: unknown) {
    subLog.error('[Subscriptions] Failed to cancel CloudPayments subscription', {
      subscriptionId, error: String(err),
    });
  }
}

// ─── TYPES ────────────────────────────────────────────

export interface SubscriptionPlan {
  id: SubscriptionPlansId;
  name: string;
  slug: string;
  description: string | null;
  base_price: number;
  is_customizable: boolean;
  min_price: number | null;
  billing_period: SubscriptionBillingPeriod;
  subscriber_discount_percent: number;
  credits_rollover_months: number;
  is_active: boolean;
  sort_order: number;
  features: string[];
  category: string;
  icon: string;
  savings_label: string | null;
  is_popular: boolean;
  is_recommended: boolean;
  usage_policy: SubscriptionPlanUsagePolicy;
  items?: SubscriptionPlanItem[];
}

export interface SubscriptionPlanItem {
  id: string;
  plan_id: SubscriptionPlansId;
  product_id: ProductsId;
  product_name?: string;
  product_price?: number;
  included_quantity: number;
  credit_price: number | null;
  is_required: boolean;
}

export interface UserSubscription {
  id: UserSubscriptionsId;
  user_id: UsersId | null;
  phone: string | null;
  customer_name: string | null;
  plan_id: SubscriptionPlansId | null;
  plan_name?: string;
  plan_slug?: string | null;
  plan_category?: string | null;
  custom_items: CustomItem[];
  monthly_price: number;
  status: string;
  cloudpayments_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_payment_date: string | null;
  trial_period_days: number;
  trial_end: string | null;
  promo_code_used: string | null;
}

export interface CustomItem {
  product_id: ProductsId;
  product_name?: string;
  quantity: number;
  credit_price: number;
}

export interface SubscriptionCredit {
  id: SubscriptionCreditsId;
  subscription_id: UserSubscriptionsId;
  product_id: ProductsId;
  product_name?: string;
  period_start: string;
  period_end: string;
  total_credits: number;
  used_credits: number;
  remaining: number;
  rolled_over_from: SubscriptionCreditsId | null;
  expires_at: string;
}

export interface AvailableCredit {
  product_id: ProductsId;
  product_name: string;
  available: number;
}

export type SubscriptionPaymentStatus = 'paid' | 'failed' | 'refunded' | 'cancelled';
export type SubscriptionPaymentKind = 'initial' | 'renewal' | 'manual';
export type SubscriptionBillingPeriod = 'monthly' | 'quarterly' | 'yearly';

export interface SubscriptionPayment {
  id: string;
  subscription_id: UserSubscriptionsId;
  provider: 'cloudpayments';
  provider_subscription_id: string | null;
  provider_transaction_id: string | null;
  amount: number;
  currency: string;
  status: SubscriptionPaymentStatus;
  kind: SubscriptionPaymentKind;
  period_start: string | null;
  period_end: string | null;
  raw_payload: unknown;
  created_at: string;
}

export interface ActivateOrRenewSubscriptionPaymentInput {
  subscriptionId: string;
  providerSubscriptionId?: string | null;
  transactionId?: string | null;
  amount: number;
  currency?: string | null;
  status?: SubscriptionPaymentStatus;
  kind: SubscriptionPaymentKind;
  paidAt?: Date | string | null;
  nextPaymentDate?: Date | string | null;
  providerToken?: string | null;
  rawPayload?: unknown;
}

export interface ActivateOrRenewSubscriptionPaymentResult {
  subscription: UserSubscription | null;
  payment: SubscriptionPayment | null;
  creditsIssued: boolean;
  duplicate: boolean;
  reason: 'processed' | 'duplicate_transaction' | 'duplicate_period' | 'ignored_status' | 'subscription_not_found' | 'subscription_cancelled';
}

type SubscriptionWithPlan = UserSubscription & {
  credits_rollover_months: number | null;
  plan_billing_period: SubscriptionBillingPeriod | null;
  plan_slug: string | null;
  plan_category: string | null;
};

interface EducationAccountEntitlementRow {
  id: string;
  user_id: string;
}

export interface SubscriptionQueryClient {
  query<Row extends object = object>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

interface CreditUsageLogRestoreRow {
  id: string;
  subscription_id: string;
  credit_id: string | null;
  product_id: string;
  quantity: number | string;
  credit_multiplier: number | string;
  credits_consumed: number | string;
  credits_restored: number | string;
}

interface SubscriptionProductPricingRow {
  sell_price: number;
  name: string;
  subscription_credit_value: number;
}

interface PromoCodeRow {
  id: string;
  trial_days: number;
  discount_percent: number | null;
  discount_amount: string | null;
  usage_limit: number | null;
  usage_count: number;
}

interface SubscriptionMonthlyPriceRow {
  monthly_price: string | number;
}

interface CreditRemainingRow {
  remaining: string;
}

interface CreatedUsageLogRow {
  id: string;
}

interface SubscriptionRolloverMonthsRow {
  credits_rollover_months: number;
  plan_category: string | null;
  plan_slug: string | null;
}

interface ExpiringSubscriptionCreditRow {
  id: string;
  product_id: string;
  total_credits: number;
  used_credits: number;
  period_end: string;
}

interface SubscriberDiscountRow {
  subscriber_discount_percent: number;
}

interface RenewableSubscriptionRow {
  monthly_price: string | number;
  cloudpayments_subscription_id: string | null;
}

interface CreatedGiftPromoRow {
  id: string;
  promo_code: string;
  ends_at: string | null;
}

interface GiftPromoRow {
  id: string;
  promo_code: string;
  trial_days: number;
  usage_limit: number | null;
  usage_count: number;
  service_slug: string | null;
  ends_at: string | null;
}

interface GiftPlanRow {
  id: SubscriptionPlansId;
  name: string;
  slug: string;
  category: string;
  base_price: number | string;
  billing_period: SubscriptionBillingPeriod | null;
  credits_rollover_months: number | null;
  is_active: boolean;
}

interface GiftRedeemUserRow {
  phone: string | null;
  email: string | null;
  display_name: string | null;
}

interface ActiveSubscriptionRow {
  id: string;
}

export interface GiftSubscriptionPromoInfo {
  promo_code: string;
  plan_id: SubscriptionPlansId;
  plan_name: string;
  trial_days: number;
  expires_at: string | null;
}

export interface CreatedGiftSubscriptionPromo extends GiftSubscriptionPromoInfo {
  redeem_url: string;
}

export interface CreateGiftSubscriptionPromoData {
  plan_id: string;
  employee_id: string;
  expires_in_days?: number;
}

export interface RedeemGiftSubscriptionPromoData {
  promo_code: string;
  user_id?: string;
  phone?: string;
  customer_name?: string;
  email?: string;
}

// ─── PLANS ────────────────────────────────────────────

export const EDUCATION_ACCESS_PLAN_SLUG = 'education-monthly-199';
export const EDUCATION_YEARLY_PLAN_SLUG = 'education-yearly-1999';
const EDUCATION_LEGACY_YEARLY_PLAN_SLUG = 'education-yearly-199';
export const EDUCATION_ACCESS_PLAN_SLUGS = [
  EDUCATION_ACCESS_PLAN_SLUG,
  EDUCATION_YEARLY_PLAN_SLUG,
  EDUCATION_LEGACY_YEARLY_PLAN_SLUG,
] as const;
const EDUCATION_ACCESS_PLAN_SLUG_SET = new Set<string>(EDUCATION_ACCESS_PLAN_SLUGS);

const docPrintSalePlanSlugs = [
  'launch-printscan-lite',
  'launch-printscan-biz',
  'launch-printscan-pro',
  'doc-print-student',
  'doc-print-business',
  'doc-print-office',
] as const;
const photoPrintSalePlanSlugs = [
  'photoprint-fan',
  'photoprint-family',
  'photoprint-photographer',
  'launch-photoprint-lite',
  'launch-photoprint-standard',
  'launch-photoprint-pro',
  'photo-print-fan',
  'photo-print-family',
  'photo-print-pro',
] as const;
const fixedCreditPackagePlanSlugs = new Set<string>([
  'launch-printscan-lite',
  'launch-printscan-biz',
  'launch-printscan-pro',
  'launch-photoprint-lite',
  'launch-photoprint-standard',
  'launch-photoprint-pro',
]);
const educationSalePlanSlugs = EDUCATION_ACCESS_PLAN_SLUGS;
const salePlanSlugsByCategory: Readonly<Record<string, readonly string[]>> = {
  'doc-print': docPrintSalePlanSlugs,
  'photo-print': photoPrintSalePlanSlugs,
  education: educationSalePlanSlugs,
};
const GIFT_SUBSCRIPTION_PROMO_PREFIX = 'subscription:';
const GIFT_SUBSCRIPTION_TRIAL_DAYS = 31;
const GIFT_SUBSCRIPTION_DEFAULT_EXPIRY_DAYS = 30;
const defaultSaleCategories = ['doc-print', 'photo-print'] as const;
const A4_BW_PRINT_PRODUCT_ID = 'a2000001-0000-0000-0000-000000000001';
const A4_COLOR_PRINT_PRODUCT_ID = 'a2000001-0000-0000-0000-000000000002';
const COLOR_A4_CREDIT_MULTIPLIER = 1.2;

export const PRINT_PACKAGE_COVERAGE_TIERS: readonly PrintPackageCoverageTier[] = [
  {
    min_percent: 0,
    max_percent: 15,
    credit_multiplier: 1,
    title: 'До 15%',
    description: '1 лист A4 списывает 1 лист из пакета.',
  },
  {
    min_percent: 15.01,
    max_percent: 50,
    credit_multiplier: 2,
    title: '15-50%',
    description: '1 лист A4 списывает 2 листа из пакета.',
  },
  {
    min_percent: 50.01,
    max_percent: 75,
    credit_multiplier: 3,
    title: '50-75%',
    description: '1 лист A4 списывает 3 листа из пакета.',
  },
  {
    min_percent: 75.01,
    max_percent: 100,
    credit_multiplier: 4,
    title: '75-100%',
    description: '1 лист A4 списывает 4 листа из пакета.',
  },
];

export async function getPlans(category?: string): Promise<SubscriptionPlan[]> {
  const categories = category ? [category] : [...defaultSaleCategories];
  const plans: SubscriptionPlan[] = [];

  for (const planCategory of categories) {
    const salePlanSlugs = salePlanSlugsByCategory[planCategory];
    if (!salePlanSlugs) continue;

    const params: unknown[] = [planCategory, [...salePlanSlugs]];
    const categoryPlans = await db.query<SubscriptionPlan>(
      `SELECT id, name, slug, description, base_price, is_customizable, min_price, billing_period, subscriber_discount_percent, credits_rollover_months, is_active, sort_order, features, category, icon, savings_label, is_popular, is_recommended, usage_policy, created_at, updated_at FROM subscription_plans WHERE is_active = true AND category = $1 AND slug = ANY($2::text[]) ORDER BY sort_order, name`,
      params,
    );

    for (const plan of categoryPlans) {
      plan.items = await db.query<SubscriptionPlanItem>(
        `SELECT spi.*, p.name as product_name, p.sell_price as product_price
         FROM subscription_plan_items spi
         JOIN products p ON spi.product_id = p.id
         WHERE spi.plan_id = $1
         ORDER BY spi.sort_order`,
        [plan.id]
      );
    }

    plans.push(...categoryPlans);
  }

  return plans;
}

export function isEducationSubscriptionPlan(plan: Pick<SubscriptionPlan, 'category' | 'slug'>): boolean {
  return plan.category === 'education' && EDUCATION_ACCESS_PLAN_SLUG_SET.has(plan.slug);
}

function isSubscriptionPlanAvailableForSale(plan: Pick<SubscriptionPlan, 'is_active' | 'category' | 'slug'>): boolean {
  const saleCategorySlugs = salePlanSlugsByCategory[plan.category];
  return plan.is_active && Boolean(saleCategorySlugs?.some(slug => slug === plan.slug));
}

export async function getPlanById(id: string): Promise<SubscriptionPlan | null> {
  const plan = await db.queryOne<SubscriptionPlan>(
    `SELECT id, name, slug, description, base_price, is_customizable, min_price, billing_period, subscriber_discount_percent, credits_rollover_months, is_active, sort_order, features, category, icon, savings_label, is_popular, is_recommended, usage_policy, created_at, updated_at FROM subscription_plans WHERE id = $1`,
    [id]
  );
  if (!plan) return null;

  plan.items = await db.query<SubscriptionPlanItem>(
    `SELECT spi.*, p.name as product_name, p.sell_price as product_price
     FROM subscription_plan_items spi
     JOIN products p ON spi.product_id = p.id
     WHERE spi.plan_id = $1
     ORDER BY spi.sort_order`,
    [id]
  );

  return plan;
}

export async function createPlan(data: {
  name: string;
  slug: string;
  description?: string;
  base_price: number;
  is_customizable?: boolean;
  min_price?: number;
  billing_period?: string;
  subscriber_discount_percent?: number;
  credits_rollover_months?: number;
  features?: string[];
  items?: { product_id: string; included_quantity: number; credit_price?: number; is_required?: boolean }[];
}): Promise<SubscriptionPlan> {
  return db.transaction(async (client: PoolClient) => {
    const planResult = await client.query(
      `INSERT INTO subscription_plans (
        name, slug, description, base_price, is_customizable,
        min_price, billing_period, subscriber_discount_percent,
        credits_rollover_months, features
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        data.name, data.slug, data.description || null, data.base_price,
        data.is_customizable ?? true, data.min_price || null,
        data.billing_period || 'monthly', data.subscriber_discount_percent || 0,
        data.credits_rollover_months ?? 3, JSON.stringify(data.features || []),
      ]
    );
    const plan = planResult.rows[0] as SubscriptionPlan;

    if (data.items?.length) {
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        await client.query(
          `INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [plan.id, item.product_id, item.included_quantity, item.credit_price || null, item.is_required || false, i]
        );
      }
    }

    return plan;
  });
}

// ─── CALCULATE CUSTOM PACKAGE ─────────────────────────

export async function calculateCustomPackage(items: CustomItem[]): Promise<{
  monthly_price: number;
  savings_percent: number;
  items_with_prices: (CustomItem & { regular_price: number; subscription_price: number })[];
}> {
  let totalRegular = 0;
  let totalSubscription = 0;
  const detailed: (CustomItem & { regular_price: number; subscription_price: number })[] = [];

  for (const item of items) {
    const product = await db.queryOne<SubscriptionProductPricingRow>(
      `SELECT sell_price, name, subscription_credit_value FROM products WHERE id = $1 AND is_subscription_eligible = true`,
      [item.product_id]
    );

    if (!product) continue;

    const regularPrice = product.sell_price * item.quantity;
    const creditPrice = item.credit_price || product.subscription_credit_value || product.sell_price * 0.85;
    const subscriptionPrice = creditPrice * item.quantity;

    totalRegular += regularPrice;
    totalSubscription += subscriptionPrice;

    detailed.push({
      ...item,
      product_name: product.name,
      regular_price: regularPrice,
      subscription_price: subscriptionPrice,
    });
  }

  return {
    monthly_price: Math.round(totalSubscription * 100) / 100,
    savings_percent: totalRegular > 0 ? Math.round((1 - totalSubscription / totalRegular) * 100) : 0,
    items_with_prices: detailed,
  };
}

// ─── PROMO CODE VALIDATION ──────────────────────────

interface PromoValidation { promo_id: string; trial_days: number; discount_percent: number | null; discount_amount: number | null }

export async function validatePromoCode(code: string): Promise<PromoValidation | null> {
  const promo = await db.queryOne<PromoCodeRow>(
    `SELECT id, trial_days, discount_percent, discount_amount, usage_limit, usage_count FROM promotions WHERE UPPER(promo_code) = UPPER($1) AND is_active = true AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW())`, [code]);
  if (!promo) return null;
  if (promo.usage_limit && promo.usage_count >= promo.usage_limit) return null;
  return { promo_id: promo.id, trial_days: promo.trial_days || 0, discount_percent: promo.discount_percent, discount_amount: promo.discount_amount ? parseFloat(promo.discount_amount) : null };
}

export async function incrementPromoUsage(promoId: string): Promise<void> {
  await db.query(`UPDATE promotions SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = $1`, [promoId]);
}

function makeGiftSubscriptionServiceSlug(planId: string): string {
  return `${GIFT_SUBSCRIPTION_PROMO_PREFIX}${planId}`;
}

function extractGiftSubscriptionPlanId(serviceSlug: string | null | undefined): string | null {
  if (!serviceSlug?.startsWith(GIFT_SUBSCRIPTION_PROMO_PREFIX)) return null;
  const planId = serviceSlug.slice(GIFT_SUBSCRIPTION_PROMO_PREFIX.length).trim();
  return planId || null;
}

function makeGiftPromoCode(): string {
  return `SVF-GIFT-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return Reflect.get(error, 'code') === '23505';
}

function makeGiftRedeemUrl(code: string): string {
  return `https://svoefoto.ru/subscriptions?promo=${encodeURIComponent(code)}`;
}

export async function getGiftSubscriptionPromoInfo(code: string): Promise<GiftSubscriptionPromoInfo | null> {
  const promo = await db.queryOne<GiftPromoRow>(
    `SELECT id, promo_code, trial_days, usage_limit, usage_count, service_slug, ends_at
     FROM promotions
     WHERE UPPER(promo_code) = UPPER($1)
       AND is_active = true
       AND kind = 'personal'
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())`,
    [code],
  );

  if (!promo) return null;
  if (promo.trial_days < GIFT_SUBSCRIPTION_TRIAL_DAYS) return null;
  if (promo.usage_limit !== null && promo.usage_count >= promo.usage_limit) return null;

  const planId = extractGiftSubscriptionPlanId(promo.service_slug);
  if (!planId) return null;

  const plan = await getPlanById(planId);
  if (!plan || !isSubscriptionPlanAvailableForSale(plan) || isEducationSubscriptionPlan(plan)) return null;

  return {
    promo_code: promo.promo_code,
    plan_id: plan.id,
    plan_name: plan.name,
    trial_days: promo.trial_days,
    expires_at: promo.ends_at,
  };
}

export async function createGiftSubscriptionPromo(
  data: CreateGiftSubscriptionPromoData,
): Promise<CreatedGiftSubscriptionPromo> {
  const plan = await getPlanById(data.plan_id);
  if (!plan || !isSubscriptionPlanAvailableForSale(plan)) {
    throw new AppError(404, 'Plan not found');
  }
  if (isEducationSubscriptionPlan(plan)) {
    throw new AppError(400, 'Образовательный доступ нельзя подарить промокодом.');
  }

  const expiresInDays = data.expires_in_days ?? GIFT_SUBSCRIPTION_DEFAULT_EXPIRY_DAYS;
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeGiftPromoCode();
    const slug = `gift-subscription-${code.toLowerCase()}`;
    try {
      const created = await db.queryOne<CreatedGiftPromoRow>(
        `INSERT INTO promotions (
           slug, title, description, promo_code, discount_percent, discount_amount,
           trial_days, usage_limit, usage_count, is_active, starts_at, ends_at,
           service_slug, cta_text, cta_url, conditions, kind
         )
         VALUES ($1,$2,$3,$4,NULL,NULL,$5,1,0,true,$6,$7,$8,$9,$10,$11,'personal')
         RETURNING id, promo_code, ends_at`,
        [
          slug,
          `Подарочная подписка «${plan.name}»`,
          'Одноразовый подарок: личная подписка на печать на 1 месяц.',
          code,
          GIFT_SUBSCRIPTION_TRIAL_DAYS,
          now.toISOString(),
          expiresAt.toISOString(),
          makeGiftSubscriptionServiceSlug(plan.id),
          'Активировать подарок',
          makeGiftRedeemUrl(code),
          `Подарок создан сотрудником ${data.employee_id}. Код действует один раз до ${expiresAt.toLocaleDateString('ru-RU')}.`,
        ],
      );

      if (!created) {
        throw new AppError(500, 'Не удалось создать подарочный промокод');
      }

      return {
        promo_code: created.promo_code,
        plan_id: plan.id,
        plan_name: plan.name,
        trial_days: GIFT_SUBSCRIPTION_TRIAL_DAYS,
        expires_at: created.ends_at ?? expiresAt.toISOString(),
        redeem_url: makeGiftRedeemUrl(created.promo_code),
      };
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 4) continue;
      throw error;
    }
  }

  throw new AppError(500, 'Не удалось создать уникальный подарочный промокод');
}

/**
 * Locks a gift promo row (FOR UPDATE) and resolves its plan inside an open
 * transaction. Shared by {@link redeemGiftSubscriptionPromo} (legacy) and
 * {@link finalizeGiftActivation} (account-first) so both paths apply the same
 * validation. `errorMode` controls the not-found status: legacy uses 404,
 * the account-first finalize uses 409 because the promo was already known
 * valid at /start and only races (concurrent burn / expiry) reach here.
 */
async function resolveGiftPromoAndPlanTx(
  client: PoolClient,
  rawCode: string,
  errorMode: 'legacy' | 'finalize',
): Promise<{ promo: GiftPromoRow; plan: GiftPlanRow }> {
  const code = rawCode.trim().toUpperCase();
  const notFoundStatus = errorMode === 'finalize' ? 409 : 404;
  const notFoundCode = errorMode === 'finalize' ? 'GIFT_PROMO_INVALID' : undefined;

  const promoResult = await client.query<GiftPromoRow>(
    `SELECT id, promo_code, trial_days, usage_limit, usage_count, service_slug, ends_at
     FROM promotions
     WHERE UPPER(promo_code) = UPPER($1)
       AND is_active = true
       AND kind = 'personal'
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())
     FOR UPDATE`,
    [code],
  );
  const promo = promoResult.rows[0] ?? null;
  if (!promo || promo.trial_days < GIFT_SUBSCRIPTION_TRIAL_DAYS) {
    throw new AppError(notFoundStatus, 'Подарочный промокод не найден или уже использован', notFoundCode);
  }
  if (promo.usage_limit !== null && promo.usage_count >= promo.usage_limit) {
    throw new AppError(409, 'Подарочный промокод уже использован', notFoundCode);
  }

  const planId = extractGiftSubscriptionPlanId(promo.service_slug);
  if (!planId) {
    throw new AppError(400, 'Промокод не относится к подарочной подписке', notFoundCode);
  }

  const planResult = await client.query<GiftPlanRow>(
    `SELECT id, name, slug, category, base_price, billing_period, credits_rollover_months, is_active
     FROM subscription_plans
     WHERE id = $1`,
    [planId],
  );
  const plan = planResult.rows[0] ?? null;
  if (!plan || !isSubscriptionPlanAvailableForSale(plan)) {
    throw new AppError(404, 'Тариф подарочной подписки недоступен', notFoundCode);
  }
  if (isEducationSubscriptionPlan(plan)) {
    throw new AppError(400, 'Образовательный доступ нельзя активировать подарочным кодом.', notFoundCode);
  }

  return { promo, plan };
}

export async function redeemGiftSubscriptionPromo(
  input: RedeemGiftSubscriptionPromoData,
): Promise<UserSubscription> {
  return db.transaction(async (client: PoolClient) => {
    const { promo, plan } = await resolveGiftPromoAndPlanTx(client, input.promo_code, 'legacy');

    const user = input.user_id
      ? (await client.query<GiftRedeemUserRow>(
          `SELECT phone, email, display_name
           FROM users
           WHERE id = $1`,
          [input.user_id],
        )).rows[0] ?? null
      : null;

    const cleanPhone = normalizePhone(user?.phone || input.phone || '');
    if (cleanPhone.length < 10) {
      throw new AppError(400, 'Для активации подарка нужен телефон');
    }

    const existingResult = await client.query<ActiveSubscriptionRow>(
      `SELECT us.id
       FROM user_subscriptions us
       LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
       WHERE us.status = 'active'
         AND (us.user_id = $1 OR us.phone = $2)
         AND (us.plan_id IS NULL OR COALESCE(sp.category, 'doc-print') IN ('doc-print', 'photo-print'))
       LIMIT 1`,
      [input.user_id ?? null, cleanPhone],
    );
    if (existingResult.rows[0]) {
      throw new AppError(409, 'У вас уже есть активная подписка');
    }

    const now = new Date();
    const periodEnd = addMonths(now, 1);
    const nowIso = now.toISOString();
    const periodEndIso = periodEnd.toISOString();
    const customerName = input.customer_name?.trim() || user?.display_name || null;

    const subscriptionResult = await client.query<UserSubscription>(
      `INSERT INTO user_subscriptions (
         user_id, phone, customer_name, plan_id, custom_items, monthly_price,
         status, current_period_start, current_period_end, next_payment_date,
         trial_period_days, trial_end, promo_code_used
       )
       VALUES ($1,$2,$3,$4,$5,0,'active',$6,$7,NULL,$8,$7,$9)
       RETURNING *`,
      [
        input.user_id ?? null,
        cleanPhone,
        customerName,
        plan.id,
        JSON.stringify([]),
        nowIso,
        periodEndIso,
        GIFT_SUBSCRIPTION_TRIAL_DAYS,
        promo.promo_code.toUpperCase(),
      ],
    );
    const subscription = subscriptionResult.rows[0];
    if (!subscription) {
      throw new AppError(500, 'Не удалось активировать подарочную подписку');
    }

    const rolloverMonths = plan.credits_rollover_months ?? 3;
    if (shouldProvisionCreditsForPlan(plan.slug, plan.category, rolloverMonths)) {
      await issueCredits(client, subscription.id, plan.id, [], now, periodEnd, rolloverMonths);
    }

    await burnGiftPromoTx(client, promo.id);

    return {
      ...subscription,
      plan_name: plan.name,
      plan_slug: plan.slug,
      plan_category: plan.category,
    };
  });
}

/** Marks a one-shot gift promo as consumed (usage_count++ and deactivated). */
async function burnGiftPromoTx(client: PoolClient, promoId: string): Promise<void> {
  await client.query(
    `UPDATE promotions
     SET usage_count = usage_count + 1,
         is_active = false,
         updated_at = NOW()
     WHERE id = $1`,
    [promoId],
  );
}

// ─── ACCOUNT-FIRST GIFT ACTIVATION ────────────────────

const GIFT_CATEGORY_FALLBACK = 'doc-print';

export interface FinalizeGiftActivationInput {
  promo_code: string;
  phone: string;
  email: string;
  /** Already-validated display name (full ФИО). */
  full_name: string;
  /** YYYY-MM-DD, optional. Stored in users.personal_data.dateOfBirth. */
  date_of_birth?: string;
  phone_verified: boolean;
}

export interface FinalizeGiftActivationResult {
  user: {
    id: string;
    displayName: string | null;
    phone: string | null;
    email: string | null;
    role: string;
  };
  account: { already_existed: boolean };
  subscription: {
    id: string;
    plan_name: string;
    current_period_end: string | null;
    status: string;
    /** 'created' for a brand-new subscription, 'extended' when a matching one was prolonged. */
    mode: 'created' | 'extended';
  };
  /** True when the supplied email already belongs to a different account. */
  emailLinkedElsewhere: boolean;
}

interface GiftActivationUserRow {
  id: string;
  email: string | null;
  phone: string | null;
  role: string;
  display_name: string | null;
}

interface GiftActivationSubscriptionRow {
  id: string;
  custom_items: unknown;
  current_period_end: string | null;
  promo_code_used: string | null;
}

/** Parses "Фамилия Имя Отчество" best-effort. Surname-first, like the studio. */
function parseFullName(fullName: string): { lastName: string | null; firstName: string | null; middleName: string | null } {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { lastName: null, firstName: null, middleName: null };
  if (tokens.length === 1) return { lastName: null, firstName: tokens[0], middleName: null };
  return {
    lastName: tokens[0],
    firstName: tokens[1],
    middleName: tokens.length > 2 ? tokens.slice(2).join(' ') : null,
  };
}

function buildGiftActivationPersonalData(input: FinalizeGiftActivationInput): string {
  const parsed = parseFullName(input.full_name);
  const patch: Record<string, string> = {};
  if (parsed.firstName) patch['firstName'] = parsed.firstName;
  if (parsed.lastName) patch['lastName'] = parsed.lastName;
  if (parsed.middleName) patch['middleName'] = parsed.middleName;
  if (input.date_of_birth) patch['dateOfBirth'] = input.date_of_birth;
  return JSON.stringify(patch);
}

/**
 * Finalizes account-first gift activation inside an already-open transaction.
 * Caller MUST run this in db.transaction and is responsible for the privacy
 * consent record + auth-cookie issuance in the SAME transaction.
 *
 * Steps:
 *   1. Lock + validate promo/plan (FOR UPDATE on promotions).
 *   2. Find-or-create account, phone-first dedup (last-10 digits). On
 *      phone↔email ownership conflict, phone wins and the foreign email is
 *      NOT relinked (emailLinkedElsewhere=true).
 *   3. Create OR extend a print subscription of the promo's category
 *      (FOR UPDATE on the existing subscription row).
 *   4. Burn the one-shot promo.
 */
export async function finalizeGiftActivation(
  client: PoolClient,
  input: FinalizeGiftActivationInput,
): Promise<FinalizeGiftActivationResult> {
  const { promo, plan } = await resolveGiftPromoAndPlanTx(client, input.promo_code, 'finalize');

  const cleanPhone = normalizePhone(input.phone);
  if (cleanPhone.length < 11) {
    throw new AppError(400, 'Некорректный номер телефона', 'PHONE_INVALID');
  }
  const last10 = cleanPhone.slice(-10);
  const email = input.email.trim().toLowerCase();
  const personalDataPatch = buildGiftActivationPersonalData(input);
  const planCategory = plan.category || GIFT_CATEGORY_FALLBACK;

  // ── 1. find-or-create account (phone-first) ──────────
  // byPhone: normalized last-10 match, locked so concurrent activations of the
  // same person serialize on the same row.
  const byPhone =
    (await client.query<GiftActivationUserRow>(
      `SELECT id, email, phone, role, display_name
       FROM users
       WHERE phone IS NOT NULL
         AND RIGHT(regexp_replace(phone, '\\D', '', 'g'), 10) = $1
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE`,
      [last10],
    )).rows[0] ?? null;

  let account: GiftActivationUserRow;
  let alreadyExisted: boolean;
  let emailLinkedElsewhere = false;

  // Does the email already belong to someone? (partial unique on email)
  const byEmail =
    (await client.query<GiftActivationUserRow>(
      `SELECT id, email, phone, role, display_name
       FROM users
       WHERE email IS NOT NULL AND LOWER(email) = $1
       LIMIT 1`,
      [email],
    )).rows[0] ?? null;

  if (byPhone) {
    // Phone wins. Update name/DOB; attach email only if free (i.e. nobody else
    // owns it, or it already belongs to this same account).
    alreadyExisted = true;
    const emailFree = !byEmail || byEmail.id === byPhone.id;
    if (!emailFree) emailLinkedElsewhere = true;

    const updated = (await client.query<GiftActivationUserRow>(
      `UPDATE users
          SET display_name = COALESCE(NULLIF($2, ''), display_name),
              first_name = COALESCE(first_name, $3),
              last_name = COALESCE(last_name, $4),
              email = CASE WHEN $5::boolean AND email IS NULL THEN $6 ELSE email END,
              phone = $7,
              phone_verified = CASE WHEN $8::boolean THEN true ELSE phone_verified END,
              personal_data = COALESCE(personal_data, '{}'::jsonb) || $9::jsonb,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, phone, role, display_name`,
      [
        byPhone.id,
        input.full_name.trim(),
        // best-effort: only fill if column empty (COALESCE keeps existing)
        parseFullName(input.full_name).firstName,
        parseFullName(input.full_name).lastName,
        emailFree,
        email,
        cleanPhone,
        input.phone_verified,
        personalDataPatch,
      ],
    )).rows[0];
    if (!updated) throw new AppError(500, 'Не удалось обновить аккаунт');
    account = updated;
  } else if (byEmail && (byEmail.phone == null || byEmail.phone.trim() === '')) {
    // No phone account, but the email matches an account with no phone yet →
    // attach this phone to that account.
    alreadyExisted = true;
    const parsed = parseFullName(input.full_name);
    const updated = (await client.query<GiftActivationUserRow>(
      `UPDATE users
          SET display_name = COALESCE(NULLIF($2, ''), display_name),
              first_name = COALESCE(first_name, $3),
              last_name = COALESCE(last_name, $4),
              phone = $5,
              phone_verified = CASE WHEN $6::boolean THEN true ELSE phone_verified END,
              personal_data = COALESCE(personal_data, '{}'::jsonb) || $7::jsonb,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, phone, role, display_name`,
      [
        byEmail.id,
        input.full_name.trim(),
        parsed.firstName,
        parsed.lastName,
        cleanPhone,
        input.phone_verified,
        personalDataPatch,
      ],
    )).rows[0];
    if (!updated) throw new AppError(500, 'Не удалось обновить аккаунт');
    account = updated;
  } else {
    // Nothing by phone. Create a fresh account. Attach the email only if it is
    // free; otherwise it belongs to a different account (phone wins, no relink).
    alreadyExisted = false;
    const parsed = parseFullName(input.full_name);
    const emailFree = !byEmail;
    if (!emailFree) emailLinkedElsewhere = true;

    const created = (await client.query<GiftActivationUserRow>(
      `INSERT INTO users
         (phone, phone_verified, email, email_verified, role, is_active,
          display_name, first_name, last_name, personal_data, created_at, updated_at)
       VALUES ($1, $2, $3, false, 'client', true, $4, $5, $6, $7::jsonb, NOW(), NOW())
       RETURNING id, email, phone, role, display_name`,
      [
        cleanPhone,
        input.phone_verified,
        emailFree ? email : null,
        input.full_name.trim(),
        parsed.firstName,
        parsed.lastName,
        personalDataPatch,
      ],
    )).rows[0];
    if (!created) throw new AppError(500, 'Не удалось создать аккаунт');
    account = created;
  }

  // ── 2. create OR extend subscription (same category) ──
  const now = new Date();
  const existing = (await client.query<GiftActivationSubscriptionRow>(
    `SELECT us.id, us.custom_items, us.current_period_end, us.promo_code_used
     FROM user_subscriptions us
     LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.status = 'active'
       AND (us.user_id = $1 OR RIGHT(regexp_replace(COALESCE(us.phone, ''), '\\D', '', 'g'), 10) = $2)
       AND COALESCE(sp.category, $3) = $4
     ORDER BY us.current_period_end DESC NULLS LAST
     LIMIT 1
     FOR UPDATE`,
    [account.id, last10, GIFT_CATEGORY_FALLBACK, planCategory],
  )).rows[0] ?? null;

  const promoCode = promo.promo_code.toUpperCase();
  let subscriptionId: string;
  let periodEndIso: string | null;
  let mode: 'created' | 'extended';

  if (existing) {
    // EXTEND: base off whichever is later (current end vs now), +1 month.
    mode = 'extended';
    const base = existing.current_period_end
      ? toDateOrDefault(existing.current_period_end, now)
      : now;
    const effectiveBase = base.getTime() > now.getTime() ? base : now;
    const newEnd = addMonths(effectiveBase, 1);
    const newEndIso = newEnd.toISOString();

    // Append a non-destructive extension record to custom_items (history),
    // since promo_code_used is varchar(50) and cannot hold a comma-list.
    const history = normalizeCustomItems(existing.custom_items);
    history.push({
      // marker entry — distinguishable by `kind`, ignored by credit issuance
      // (issueCredits only reads product_id/quantity > 0).
      kind: 'gift_extension',
      promo_code: promoCode,
      extended_at: now.toISOString(),
      new_period_end: newEndIso,
    } as unknown as CustomItem);

    await client.query(
      `UPDATE user_subscriptions
          SET current_period_end = $2,
              trial_end = $2,
              promo_code_used = $3,
              custom_items = $4::jsonb,
              user_id = COALESCE(user_id, $5),
              status = 'active',
              updated_at = NOW()
        WHERE id = $1`,
      [existing.id, newEndIso, promoCode, JSON.stringify(history), account.id],
    );
    subscriptionId = existing.id;
    periodEndIso = newEndIso;
  } else {
    // CREATE: same shape as redeemGiftSubscriptionPromo, but user_id is required.
    mode = 'created';
    const periodEnd = addMonths(now, 1);
    periodEndIso = periodEnd.toISOString();
    const created = (await client.query<{ id: string }>(
      `INSERT INTO user_subscriptions (
         user_id, phone, customer_name, plan_id, custom_items, monthly_price,
         status, current_period_start, current_period_end, next_payment_date,
         trial_period_days, trial_end, promo_code_used
       )
       VALUES ($1,$2,$3,$4,$5,0,'active',$6,$7,NULL,$8,$7,$9)
       RETURNING id`,
      [
        account.id,
        cleanPhone,
        account.display_name,
        plan.id,
        JSON.stringify([]),
        now.toISOString(),
        periodEndIso,
        GIFT_SUBSCRIPTION_TRIAL_DAYS,
        promoCode,
      ],
    )).rows[0];
    if (!created) throw new AppError(500, 'Не удалось активировать подарочную подписку');
    subscriptionId = created.id;

    const rolloverMonths = plan.credits_rollover_months ?? 3;
    if (shouldProvisionCreditsForPlan(plan.slug, plan.category, rolloverMonths)) {
      await issueCredits(client, subscriptionId, plan.id, [], now, periodEnd, rolloverMonths);
    }
  }

  // ── 3. burn the one-shot promo ───────────────────────
  await burnGiftPromoTx(client, promo.id);

  return {
    user: {
      id: account.id,
      displayName: account.display_name,
      phone: account.phone,
      email: account.email,
      role: account.role,
    },
    account: { already_existed: alreadyExisted },
    subscription: {
      id: subscriptionId,
      plan_name: plan.name,
      current_period_end: periodEndIso,
      status: 'active',
      mode,
    },
    emailLinkedElsewhere,
  };
}

// ─── INIT SUBSCRIPTION (pending, before payment) ─────

export async function initSubscription(data: {
  user_id?: string;
  phone: string;
  customer_name?: string;
  email?: string;
  plan_id?: string;
  custom_items?: CustomItem[];
  monthly_price: number;
  promo_code?: string;
}): Promise<UserSubscription> {
  let trialDays = 0;
  let promoCodeUsed: string | null = null;
  let promoId: string | null = null;

  if (data.promo_code) {
    const promo = await validatePromoCode(data.promo_code);
    if (!promo) throw new Error('Промокод недействителен или исчерпан');
    trialDays = promo.trial_days;
    promoCodeUsed = data.promo_code.toUpperCase();
    promoId = promo.promo_id;
  }

  const subResult = await db.queryOne<UserSubscription>(
    `INSERT INTO user_subscriptions (
      user_id, phone, customer_name, plan_id, custom_items,
      monthly_price, status, trial_period_days, promo_code_used
    ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8) RETURNING *`,
    [
      data.user_id || null, data.phone, data.customer_name || null,
      data.plan_id || null, JSON.stringify(data.custom_items || []),
      data.monthly_price, trialDays, promoCodeUsed,
    ]
  );

  if (promoId) await incrementPromoUsage(promoId);

  return subResult!;
}

// ─── ACTIVATE SUBSCRIPTION (after successful payment) ─

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function billingPeriodMonths(period: SubscriptionBillingPeriod | string | null | undefined): number {
  switch (period) {
    case 'yearly':
      return 12;
    case 'quarterly':
      return 3;
    default:
      return 1;
  }
}

function toDateOrDefault(value: Date | string | null | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function normalizeCustomItems(value: unknown): CustomItem[] {
  if (Array.isArray(value)) return value as CustomItem[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as CustomItem[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeAmount(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function shouldProvisionCreditsForPlan(
  planSlug: string | null | undefined,
  planCategory: string | null | undefined,
  rolloverMonths: number,
): boolean {
  if (rolloverMonths <= 0) return false;
  if (planSlug && fixedCreditPackagePlanSlugs.has(planSlug)) return true;
  return planCategory !== 'doc-print' && planCategory !== 'photo-print';
}

function resolveBillingPeriod(
  sub: SubscriptionWithPlan,
  kind: SubscriptionPaymentKind,
  paidAt: Date,
): { periodStart: Date; periodEnd: Date } {
  const currentStart = sub.current_period_start ? new Date(sub.current_period_start) : null;
  const currentEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
  const hasCurrentPeriod = currentStart && currentEnd
    && !Number.isNaN(currentStart.getTime())
    && !Number.isNaN(currentEnd.getTime());

  if (hasCurrentPeriod && kind === 'initial') {
    return { periodStart: currentStart, periodEnd: currentEnd };
  }

  if (hasCurrentPeriod && paidAt >= currentStart && paidAt < currentEnd) {
    return { periodStart: currentStart, periodEnd: currentEnd };
  }

  const periodStart = paidAt;
  return { periodStart, periodEnd: addMonths(periodStart, billingPeriodMonths(sub.plan_billing_period)) };
}

async function extendEducationEntitlementForSubscription(
  client: PoolClient,
  sub: SubscriptionWithPlan,
  periodEnd: Date,
): Promise<void> {
  if (!sub.plan_slug || !EDUCATION_ACCESS_PLAN_SLUG_SET.has(sub.plan_slug) || !sub.user_id) return;

  const periodEndIso = periodEnd.toISOString();
  const accountResult = await client.query<EducationAccountEntitlementRow>(
    `UPDATE student_accounts
        SET status = 'verified',
            expires_at = GREATEST(COALESCE(expires_at, $2::timestamptz), $2::timestamptz),
            updated_at = NOW()
      WHERE user_id = $1
        AND status = 'verified'
        AND (expires_at IS NULL OR expires_at >= NOW())
      RETURNING id, user_id`,
    [sub.user_id, periodEndIso],
  );
  const account = accountResult.rows[0];
  if (!account) return;

  const entitlementResult = await client.query<EducationAccountEntitlementRow>(
    `INSERT INTO student_discount_entitlements (
       user_id, status, source_token, source_url, student_account_id, activated_at, expires_at
     )
     VALUES ($1, 'active', 'education_subscription', NULL, $2, NOW(), $3::timestamptz)
     ON CONFLICT (user_id) DO UPDATE SET
       status = 'active',
       source_token = 'education_subscription',
       student_account_id = EXCLUDED.student_account_id,
       expires_at = CASE
         WHEN student_discount_entitlements.source_token = 'education_subscription'
           THEN GREATEST(
             COALESCE(student_discount_entitlements.expires_at, EXCLUDED.expires_at),
             EXCLUDED.expires_at
           )
         ELSE EXCLUDED.expires_at
       END,
       updated_at = NOW()
     RETURNING id, user_id`,
    [account.user_id, account.id, periodEndIso],
  );
  const entitlement = entitlementResult.rows[0];
  if (!entitlement) return;

  await ensureCurrentStudentAllowancePeriodWithClient(client, {
    entitlementId: entitlement.id,
    userId: entitlement.user_id,
    lock: false,
  });
}

export async function activateOrRenewSubscriptionPayment(
  input: ActivateOrRenewSubscriptionPaymentInput,
  existingClient?: PoolClient,
): Promise<ActivateOrRenewSubscriptionPaymentResult> {
  const run = async (client: PoolClient): Promise<ActivateOrRenewSubscriptionPaymentResult> => {
    const provider = 'cloudpayments' as const;
    const status = input.status ?? 'paid';
    const transactionId = input.transactionId ? String(input.transactionId) : null;
    const providerSubscriptionId = input.providerSubscriptionId ? String(input.providerSubscriptionId) : null;
    const paidAt = toDateOrDefault(input.paidAt, new Date());
    const amount = normalizeAmount(input.amount);
    const currency = input.currency || 'RUB';
    const rawPayload = input.rawPayload ?? {};

    const subResult = await client.query<SubscriptionWithPlan>(
      `SELECT us.*,
              COALESCE(sp.credits_rollover_months, 3) AS credits_rollover_months,
              sp.billing_period AS plan_billing_period,
              sp.slug AS plan_slug,
              sp.category AS plan_category
       FROM user_subscriptions us
       LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
       WHERE us.id::text = $1 OR ($2::text IS NOT NULL AND us.cloudpayments_subscription_id = $2)
       FOR UPDATE OF us`,
      [input.subscriptionId, providerSubscriptionId],
    );
    const sub = subResult.rows[0];
    if (!sub) {
      return {
        subscription: null,
        payment: null,
        creditsIssued: false,
        duplicate: false,
        reason: 'subscription_not_found',
      };
    }

    // Подписка отменена в нашей системе, но CloudPayments прислал рекуррентный платёж.
    // НЕ реактивируем (иначе отмена «отваливается» на следующем списании). Пишем платёж
    // для аудита и пытаемся повторно остановить рекуррент (значит прошлая отмена не дошла до CP).
    if (sub.status === 'cancelled') {
      subLog.warn('[Subscriptions] Recurrent payment for CANCELLED subscription — not reactivating', {
        subscriptionId: sub.id, cpId: providerSubscriptionId, transactionId,
      });
      if (transactionId) {
        await client.query(
          `INSERT INTO subscription_payments (
             subscription_id, provider, provider_subscription_id, provider_transaction_id,
             amount, currency, status, kind, raw_payload
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           ON CONFLICT DO NOTHING`,
          [sub.id, provider, providerSubscriptionId, transactionId, amount, currency, status, input.kind, JSON.stringify(rawPayload)],
        );
      }
      const cpId = providerSubscriptionId ?? sub.cloudpayments_subscription_id;
      if (cpId) {
        void cancelCloudPaymentsRecurrent(String(cpId), sub.id);
      }
      return {
        subscription: sub,
        payment: null,
        creditsIssued: false,
        duplicate: false,
        reason: 'subscription_cancelled',
      };
    }

    if (transactionId) {
      const existingByTransaction = await client.query<SubscriptionPayment>(
        `SELECT *
         FROM subscription_payments
         WHERE provider = $1 AND provider_transaction_id = $2
         FOR UPDATE`,
        [provider, transactionId],
      );
      const existing = existingByTransaction.rows[0];
      if (existing?.status === 'paid' || (existing && status !== 'paid')) {
        return {
          subscription: sub,
          payment: existing,
          creditsIssued: false,
          duplicate: true,
          reason: 'duplicate_transaction',
        };
      }
    }

    if (status !== 'paid') {
      const paymentResult = await client.query<SubscriptionPayment>(
        `INSERT INTO subscription_payments (
           subscription_id, provider, provider_subscription_id, provider_transaction_id,
           amount, currency, status, kind, raw_payload
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          sub.id, provider, providerSubscriptionId, transactionId,
          amount, currency, status, input.kind, JSON.stringify(rawPayload),
        ],
      );

      return {
        subscription: sub,
        payment: paymentResult.rows[0] ?? null,
        creditsIssued: false,
        duplicate: paymentResult.rows.length === 0,
        reason: paymentResult.rows.length === 0 ? 'duplicate_transaction' : 'ignored_status',
      };
    }

    const { periodStart, periodEnd } = resolveBillingPeriod(sub, input.kind, paidAt);

    const existingPeriodPayment = await client.query<SubscriptionPayment>(
      `SELECT *
       FROM subscription_payments
       WHERE subscription_id = $1
         AND status = 'paid'
         AND period_start = $2
         AND period_end = $3
       FOR UPDATE`,
      [sub.id, periodStart.toISOString(), periodEnd.toISOString()],
    );
    if (existingPeriodPayment.rows[0]) {
      const existing = existingPeriodPayment.rows[0];
      if (transactionId && !existing.provider_transaction_id) {
        const updatedPayment = await client.query<SubscriptionPayment>(
          `UPDATE subscription_payments
           SET provider_transaction_id = $2,
               provider_subscription_id = COALESCE($3, provider_subscription_id),
               raw_payload = $4::jsonb
           WHERE id = $1
           RETURNING *`,
          [existing.id, transactionId, providerSubscriptionId, JSON.stringify(rawPayload)],
        );
        existingPeriodPayment.rows[0] = updatedPayment.rows[0] ?? existing;
      }

      return {
        subscription: sub,
        payment: existingPeriodPayment.rows[0],
        creditsIssued: false,
        duplicate: true,
        reason: 'duplicate_period',
      };
    }

    const existingByTx = transactionId
      ? (await client.query<SubscriptionPayment>(
          `SELECT *
           FROM subscription_payments
           WHERE provider = $1 AND provider_transaction_id = $2
           FOR UPDATE`,
          [provider, transactionId],
        )).rows[0]
      : null;

    const paymentResult = existingByTx
      ? await client.query<SubscriptionPayment>(
          `UPDATE subscription_payments
           SET subscription_id = $2,
               provider_subscription_id = COALESCE($3, provider_subscription_id),
               amount = $4,
               currency = $5,
               status = 'paid',
               kind = $6,
               period_start = $7,
               period_end = $8,
               raw_payload = $9::jsonb
           WHERE id = $1
           RETURNING *`,
          [
            existingByTx.id, sub.id, providerSubscriptionId, amount, currency,
            input.kind, periodStart.toISOString(), periodEnd.toISOString(),
            JSON.stringify(rawPayload),
          ],
        )
      : await client.query<SubscriptionPayment>(
          `INSERT INTO subscription_payments (
             subscription_id, provider, provider_subscription_id, provider_transaction_id,
             amount, currency, status, kind, period_start, period_end, raw_payload
           )
           VALUES ($1,$2,$3,$4,$5,$6,'paid',$7,$8,$9,$10::jsonb)
           RETURNING *`,
          [
            sub.id, provider, providerSubscriptionId, transactionId,
            amount, currency, input.kind, periodStart.toISOString(),
            periodEnd.toISOString(), JSON.stringify(rawPayload),
          ],
        );
    const payment = paymentResult.rows[0];

    let trialEnd: Date | null = sub.trial_end ? new Date(sub.trial_end) : null;
    let nextPayment = toDateOrDefault(input.nextPaymentDate, periodEnd);
    if (input.kind === 'initial' && !sub.trial_end && (sub.trial_period_days || 0) > 0) {
      trialEnd = new Date(periodStart);
      trialEnd.setDate(trialEnd.getDate() + sub.trial_period_days);
      nextPayment = trialEnd;
    }

    const updatedSubResult = await client.query<UserSubscription>(
      `UPDATE user_subscriptions SET
         status = 'active',
         cloudpayments_subscription_id = COALESCE($2, cloudpayments_subscription_id),
         cloudpayments_token = COALESCE($3, cloudpayments_token),
         current_period_start = $4,
         current_period_end = $5,
         next_payment_date = $6,
         trial_end = COALESCE($7, trial_end),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        sub.id, providerSubscriptionId, input.providerToken || null,
        periodStart.toISOString(), periodEnd.toISOString(), nextPayment.toISOString(),
        trialEnd && !Number.isNaN(trialEnd.getTime()) ? trialEnd.toISOString() : null,
      ],
    );
    const updatedSub = updatedSubResult.rows[0] as UserSubscription;

    const rolloverMonths = sub.credits_rollover_months ?? 3;
    const shouldIssueCredits = shouldProvisionCreditsForPlan(sub.plan_slug, sub.plan_category, rolloverMonths);
    if (shouldIssueCredits && input.kind === 'renewal') {
      await performRollover(client, sub.id, rolloverMonths, periodStart);
    }
    if (shouldIssueCredits) {
      await issueCredits(
        client, sub.id, sub.plan_id || null,
        normalizeCustomItems(sub.custom_items), periodStart, periodEnd, rolloverMonths,
      );
    }
    await extendEducationEntitlementForSubscription(client, sub, periodEnd);

    return {
      subscription: updatedSub,
      payment,
      creditsIssued: shouldIssueCredits,
      duplicate: false,
      reason: 'processed',
    };
  };

  if (existingClient) return run(existingClient);
  return db.transaction(run);
}

export async function activateSubscription(subscriptionId: string, cloudpaymentsSubscriptionId?: string, cloudpaymentsToken?: string): Promise<UserSubscription | null> {
  const existing = await db.queryOne<SubscriptionMonthlyPriceRow>(
    `SELECT monthly_price FROM user_subscriptions WHERE id = $1`,
    [subscriptionId],
  );
  if (!existing) return null;

  const result = await activateOrRenewSubscriptionPayment({
    subscriptionId,
    providerSubscriptionId: cloudpaymentsSubscriptionId || null,
    providerToken: cloudpaymentsToken || null,
    amount: Number(existing.monthly_price) || 0,
    kind: 'initial',
    paidAt: new Date(),
    rawPayload: { source: 'activateSubscription' },
  });
  return result.subscription;
}

// ─── SUBSCRIBE (legacy, for POS/admin direct creation) ─

export async function subscribe(data: {
  user_id?: string;
  phone: string;
  customer_name?: string;
  plan_id?: string;
  custom_items?: CustomItem[];
  monthly_price: number;
  cloudpayments_subscription_id?: string;
  cloudpayments_token?: string;
}): Promise<UserSubscription> {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  return db.transaction(async (client: PoolClient) => {
    // Create subscription
    const subResult = await client.query(
      `INSERT INTO user_subscriptions (
        user_id, phone, customer_name, plan_id, custom_items,
        monthly_price, status, cloudpayments_subscription_id, cloudpayments_token,
        current_period_start, current_period_end, next_payment_date
      ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$10) RETURNING *`,
      [
        data.user_id || null, data.phone, data.customer_name || null,
        data.plan_id || null, JSON.stringify(data.custom_items || []),
        data.monthly_price, data.cloudpayments_subscription_id || null,
        data.cloudpayments_token || null,
        now.toISOString(), periodEnd.toISOString(),
      ]
    );
    const subscription = subResult.rows[0] as UserSubscription;

    const plan = data.plan_id
      ? await client.query<Pick<SubscriptionWithPlan, 'plan_slug' | 'plan_category' | 'credits_rollover_months'>>(
          `SELECT slug AS plan_slug, category AS plan_category, COALESCE(credits_rollover_months, 3) AS credits_rollover_months
           FROM subscription_plans
           WHERE id = $1`,
          [data.plan_id],
        )
      : null;
    const planInfo = plan?.rows[0] ?? null;
    const rolloverMonths = planInfo?.credits_rollover_months ?? 3;
    if (shouldProvisionCreditsForPlan(planInfo?.plan_slug, planInfo?.plan_category, rolloverMonths)) {
      await issueCredits(client, subscription.id, data.plan_id || null, data.custom_items || [], now, periodEnd, rolloverMonths);
    }

    return subscription;
  });
}

async function issueCredits(
  client: PoolClient,
  subscriptionId: string,
  planId: string | null,
  customItems: CustomItem[],
  periodStart: Date,
  periodEnd: Date,
  rolloverMonths: number
): Promise<void> {
  const expiresAt = new Date(periodEnd);
  expiresAt.setMonth(expiresAt.getMonth() + rolloverMonths);

  let items: { product_id: string; quantity: number }[] = [];

  if (planId) {
    const planItems = await client.query(
      `SELECT product_id, included_quantity as quantity FROM subscription_plan_items WHERE plan_id = $1`,
      [planId]
    );
    items = planItems.rows;
  }

  if (customItems.length > 0) {
    items = customItems.map(ci => ({ product_id: ci.product_id, quantity: ci.quantity }));
  }

  const byProduct = new Map<string, number>();
  for (const item of items) {
    const quantity = Number(item.quantity) || 0;
    if (!item.product_id || quantity <= 0) continue;
    byProduct.set(item.product_id, (byProduct.get(item.product_id) || 0) + quantity);
  }

  for (const [productId, quantity] of byProduct.entries()) {
    await client.query(
      `INSERT INTO subscription_credits (subscription_id, product_id, period_start, period_end, total_credits, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [subscriptionId, productId, periodStart.toISOString(), periodEnd.toISOString(), quantity, expiresAt.toISOString()]
    );
  }
}

// ─── MANAGE ───────────────────────────────────────────

export async function pauseSubscription(id: string, until?: Date): Promise<UserSubscription | null> {
  return db.queryOne<UserSubscription>(
    `UPDATE user_subscriptions SET status = 'paused', pause_until = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'active' RETURNING *`,
    [id, until?.toISOString() || null]
  );
}

export async function resumeSubscription(id: string): Promise<UserSubscription | null> {
  return db.queryOne<UserSubscription>(
    `UPDATE user_subscriptions SET status = 'active', pause_until = NULL, updated_at = NOW()
     WHERE id = $1 AND status = 'paused' RETURNING *`,
    [id]
  );
}

export async function cancelSubscription(id: string, reason?: string): Promise<UserSubscription | null> {
  const cancelled = await db.queryOne<UserSubscription>(
    `UPDATE user_subscriptions SET status = 'cancelled', cancel_reason = $2, updated_at = NOW()
     WHERE id = $1 AND status IN ('active', 'paused') RETURNING *`,
    [id, reason || null]
  );
  // Останавливаем рекуррент CloudPayments для ЛЮБОГО пути отмены, иначе списания продолжатся.
  if (cancelled?.cloudpayments_subscription_id) {
    await cancelCloudPaymentsRecurrent(cancelled.cloudpayments_subscription_id, id);
  }
  // Отмена education-подписки: сразу понижаем льготу до тарифа «без подписки» (если статус
  // ещё подтверждён), чтобы кап остался активным и не было «бесконечной» education-скидки.
  if (cancelled?.user_id) {
    try {
      await reconcileEducationEntitlements(cancelled.user_id);
    } catch (err) {
      subLog.error('reconcileEducationEntitlements after cancel failed', { error: String(err), userId: cancelled.user_id });
    }
  }
  return cancelled;
}

/**
 * Сверка education-льгот по КОНЕЧНОМУ состоянию подписки. Любой teardown подписки
 * (отмена, истечение, CP-expire, abandoned) оставляет user_subscriptions не-active, и эта
 * сверка переводит «застрявшую» льготу source_token='education_subscription':
 *  1) если у пользователя ещё есть верифицированный непросроченный student_account, то
 *     в 'education_verified' (тариф «без подписки», expires_at = срок аккаунта), чтобы
 *     rolling-30 кап (studentState) остался активным;
 *  2) иначе в 'expired'.
 * has_sub намеренно сверяется ТОЛЬКО по status='active' education-плану (без current_period_end),
 * чтобы НЕ понижать активного подписчика в окне продления CP. Идемпотентно: повторный
 * прогон даёт no-op. Без этого экс-подписчик сохранял бы 'education_subscription' с прошедшим
 * expires_at, studentState стал бы null, и защита pricing-engine обнулила бы education-скидку.
 *
 * @param userId ограничить пользователем (синхронный путь отмены); без него обрабатываются все.
 * @returns число изменённых льгот.
 */
export async function reconcileEducationEntitlements(userId?: string): Promise<number> {
  const params: unknown[] = [[...EDUCATION_ACCESS_PLAN_SLUGS]];
  if (userId) params.push(userId);
  const rows = await db.query<IdOnly>(
    `WITH ent AS (
       SELECT
         e.id,
         (SELECT a.id FROM student_accounts a
            WHERE a.user_id = e.user_id
              AND a.status = 'verified'
              AND (a.expires_at IS NULL OR a.expires_at >= NOW())
            ORDER BY a.expires_at DESC NULLS LAST
            LIMIT 1) AS acct_id,
         (SELECT a.expires_at FROM student_accounts a
            WHERE a.user_id = e.user_id
              AND a.status = 'verified'
              AND (a.expires_at IS NULL OR a.expires_at >= NOW())
            ORDER BY a.expires_at DESC NULLS LAST
            LIMIT 1) AS acct_expires,
         EXISTS (
           SELECT 1
           FROM user_subscriptions us
           JOIN subscription_plans sp ON sp.id = us.plan_id
           WHERE us.user_id = e.user_id
             AND us.status = 'active'
             AND sp.slug = ANY($1::text[])
         ) AS has_sub
       FROM student_discount_entitlements e
       WHERE e.status = 'active'
         AND e.source_token = 'education_subscription'
         ${userId ? 'AND e.user_id = $2' : ''}
     )
     UPDATE student_discount_entitlements e
        SET source_token = CASE WHEN ent.acct_id IS NOT NULL THEN 'education_verified' ELSE e.source_token END,
            status       = CASE WHEN ent.acct_id IS NOT NULL THEN 'active' ELSE 'expired' END,
            expires_at   = CASE WHEN ent.acct_id IS NOT NULL THEN COALESCE(ent.acct_expires, e.expires_at)
                                ELSE LEAST(e.expires_at, NOW()) END,
            student_account_id = COALESCE(ent.acct_id, e.student_account_id),
            updated_at = NOW()
       FROM ent
      WHERE e.id = ent.id
        AND ent.has_sub = false
      RETURNING e.id`,
    params,
  );
  return rows.length;
}

// ─── CREDITS ──────────────────────────────────────────

export async function getCredits(subscriptionId: string): Promise<SubscriptionCredit[]> {
  return db.query<SubscriptionCredit>(
    `SELECT sc.*, p.name as product_name,
            (sc.total_credits - sc.used_credits) as remaining
     FROM subscription_credits sc
     JOIN products p ON sc.product_id = p.id
     WHERE sc.subscription_id = $1
       AND sc.expires_at > NOW()
       AND sc.used_credits < sc.total_credits
     ORDER BY sc.expires_at ASC`,
    [subscriptionId]
  );
}

// Credit multiplier: some products cost more credits per unit
// e.g. Super paper costs 2 credits per photo (vs 1 for Premium)
// Key = product_id being consumed, value = { base_product_id, multiplier }
const CREDIT_MULTIPLIERS: Record<string, { baseProductId: string; multiplier: number }> = {
  // Фотобумага 10x15 Super → consumes credits from Premium pool at 2x rate
  '361b90ff-aca3-492a-a3f1-5f380e1f229e': {
    baseProductId: '81476759-8e40-4d50-a15b-556f3f8a3368', // Premium product
    multiplier: 2,
  },
  // Цветная A4 печать расходует общий A4-пакет с базовым множителем x1.2.
  [A4_COLOR_PRINT_PRODUCT_ID]: {
    baseProductId: A4_BW_PRINT_PRODUCT_ID,
    multiplier: COLOR_A4_CREDIT_MULTIPLIER,
  },
};

export function getSubscriptionCreditMapping(productId: string): { creditProductId: string; creditMultiplier: number } {
  const mapping = CREDIT_MULTIPLIERS[productId];
  return {
    creditProductId: mapping?.baseProductId ?? productId,
    creditMultiplier: mapping?.multiplier ?? 1,
  };
}

function normalizeCreditMultiplier(value: number | string | null | undefined): number {
  const numeric = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value) : NaN);
  if (!Number.isFinite(numeric) || !numeric || numeric < 1) return 1;
  return Math.round(Math.min(numeric, 20) * 100) / 100;
}

function normalizeCoveragePercent(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(100, Math.max(0, numeric));
}

export function printPackageCreditMultiplierForCoveragePercent(value: number | string | null | undefined): number {
  const coveragePercent = normalizeCoveragePercent(value);
  if (coveragePercent === null) return 1;
  const tier = PRINT_PACKAGE_COVERAGE_TIERS.find((candidate) =>
    coveragePercent >= candidate.min_percent && coveragePercent <= candidate.max_percent
  );
  return tier?.credit_multiplier ?? PRINT_PACKAGE_COVERAGE_TIERS[PRINT_PACKAGE_COVERAGE_TIERS.length - 1]?.credit_multiplier ?? 1;
}

function resolveCreditConsumptionMapping(data: {
  product_id: string;
  coverage_multiplier?: number | string | null;
  coverage_percent?: number | string | null;
  quantity: number;
}): { creditProductId: string; creditMultiplier: number; creditQuantity: number } {
  const { creditProductId, creditMultiplier: productMultiplier } = getSubscriptionCreditMapping(data.product_id);
  const coverageMultiplier = normalizeCreditMultiplier(
    data.coverage_multiplier ?? printPackageCreditMultiplierForCoveragePercent(data.coverage_percent),
  );
  const creditMultiplier = normalizeCreditMultiplier(productMultiplier * coverageMultiplier);
  return {
    creditProductId,
    creditMultiplier,
    creditQuantity: data.quantity * creditMultiplier,
  };
}

export async function useCredits(data: {
  subscription_id: string;
  product_id: string;
  quantity: number;
  coverage_multiplier?: number | string | null;
  coverage_percent?: number | string | null;
  pos_receipt_id?: string;
  print_order_id?: string;
  employee_id?: string;
  description?: string;
}): Promise<{ used: number; remaining: number }> {
  return db.transaction(async (client: PoolClient) => {
    const { creditProductId, creditMultiplier, creditQuantity } = resolveCreditConsumptionMapping(data);

    // Get available credits for the base product, oldest first (FIFO)
    const credits = await client.query<SubscriptionCredit>(
      `SELECT id, total_credits, used_credits,
              (total_credits - used_credits) as remaining
       FROM subscription_credits
       WHERE subscription_id = $1 AND product_id = $2
         AND expires_at > NOW() AND used_credits < total_credits
       ORDER BY expires_at ASC
       FOR UPDATE`,
      [data.subscription_id, creditProductId]
    );

    let toUse = creditQuantity;
    let totalUsed = 0;

    for (const credit of credits.rows) {
      if (toUse <= 0) break;

      const available = credit.total_credits - credit.used_credits;
      const use = Math.min(available, toUse);

      await client.query(
        `UPDATE subscription_credits SET used_credits = used_credits + $2 WHERE id = $1`,
        [credit.id, use]
      );

      // Log each credit deduction for audit trail
      await client.query(
        `INSERT INTO subscription_credit_usage_log
           (subscription_id, credit_id, product_id, quantity, credit_multiplier, credits_consumed,
            pos_receipt_id, print_order_id, employee_id, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          data.subscription_id, credit.id, data.product_id,
          data.quantity, creditMultiplier, use,
          data.pos_receipt_id || null, data.print_order_id || null, data.employee_id || null,
          data.description || null,
        ]
      );

      toUse -= use;
      totalUsed += use;
    }

    // Calculate remaining credits
    const remainingResult = await client.query<CreditRemainingRow>(
      `SELECT COALESCE(SUM(total_credits - used_credits), 0) as remaining
       FROM subscription_credits
       WHERE subscription_id = $1 AND product_id = $2
         AND expires_at > NOW() AND used_credits < total_credits`,
      [data.subscription_id, creditProductId]
    );

    return {
      used: totalUsed,
      remaining: parseFloat(remainingResult.rows[0]?.remaining || '0'),
    };
  });
}

/**
 * Use credits within an existing transaction (shared PoolClient).
 * Same logic as useCredits() but does NOT create its own transaction.
 * Used by pos.service.createReceipt() for atomic credit deduction.
 */
export async function useCreditsWithClient(
  client: PoolClient,
  data: {
    subscription_id: string;
    product_id: string;
    quantity: number;
    coverage_multiplier?: number | string | null;
    coverage_percent?: number | string | null;
    pos_receipt_id?: string;
    print_order_id?: string;
    employee_id?: string;
    description?: string;
  },
): Promise<{ used: number; remaining: number }> {
  const { creditProductId, creditMultiplier, creditQuantity } = resolveCreditConsumptionMapping(data);

  const credits = await client.query<SubscriptionCredit>(
    `SELECT id, total_credits, used_credits,
            (total_credits - used_credits) as remaining
     FROM subscription_credits
     WHERE subscription_id = $1 AND product_id = $2
       AND expires_at > NOW() AND used_credits < total_credits
     ORDER BY expires_at ASC
     FOR UPDATE`,
    [data.subscription_id, creditProductId]
  );

  let toUse = creditQuantity;
  let totalUsed = 0;

  for (const credit of credits.rows) {
    if (toUse <= 0) break;

    const available = credit.total_credits - credit.used_credits;
    const use = Math.min(available, toUse);

    await client.query(
      `UPDATE subscription_credits SET used_credits = used_credits + $2 WHERE id = $1`,
      [credit.id, use]
    );

    await client.query(
      `INSERT INTO subscription_credit_usage_log
         (subscription_id, credit_id, product_id, quantity, credit_multiplier, credits_consumed,
          pos_receipt_id, print_order_id, employee_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        data.subscription_id, credit.id, data.product_id,
        data.quantity, creditMultiplier, use,
        data.pos_receipt_id || null, data.print_order_id || null, data.employee_id || null,
        data.description || null,
      ]
    );

    toUse -= use;
    totalUsed += use;
  }

  const remainingResult = await client.query<CreditRemainingRow>(
    `SELECT COALESCE(SUM(total_credits - used_credits), 0) as remaining
     FROM subscription_credits
     WHERE subscription_id = $1 AND product_id = $2
       AND expires_at > NOW() AND used_credits < total_credits`,
    [data.subscription_id, creditProductId]
  );

  return {
    used: totalUsed,
    remaining: parseFloat(remainingResult.rows[0]?.remaining || '0'),
  };
}

export async function restoreCreditsForPosReceiptWithClient(
  client: SubscriptionQueryClient,
  data: {
    pos_receipt_id: string;
    employee_id?: string;
    description?: string;
    reversal_reason?: string;
  },
): Promise<{ restored: number; entries: number }> {
  const usageRows = await client.query<CreditUsageLogRestoreRow>(
    `SELECT id, subscription_id, credit_id, product_id, quantity,
            credit_multiplier, credits_consumed,
            COALESCE((
              SELECT SUM(ABS(rev.credits_consumed))
              FROM subscription_credit_usage_log rev
              WHERE rev.reversal_of_usage_log_id = subscription_credit_usage_log.id
            ), 0) AS credits_restored
     FROM subscription_credit_usage_log
     WHERE pos_receipt_id = $1
       AND credits_consumed > 0
       AND reversal_of_usage_log_id IS NULL
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [data.pos_receipt_id],
  );

  let restored = 0;
  let entries = 0;
  for (const usage of usageRows.rows) {
    const creditsConsumed = Number(usage.credits_consumed);
    const creditsRestored = Number(usage.credits_restored);
    const creditsToRestore = creditsConsumed - (Number.isFinite(creditsRestored) ? creditsRestored : 0);
    const result = await restoreCreditUsageRow(client, usage, creditsToRestore, data);
    restored += result.restored;
    entries += result.entries;
  }

  return { restored, entries };
}

export async function restoreCreditsForPrintOrderWithClient(
  client: SubscriptionQueryClient,
  data: {
    print_order_id: PhotoPrintOrdersId | string;
    employee_id?: string;
    description?: string;
    reversal_reason?: string;
  },
): Promise<{ restored: number; entries: number }> {
  const usageRows = await client.query<CreditUsageLogRestoreRow>(
    `SELECT id, subscription_id, credit_id, product_id, quantity,
            credit_multiplier, credits_consumed,
            COALESCE((
              SELECT SUM(ABS(rev.credits_consumed))
              FROM subscription_credit_usage_log rev
              WHERE rev.reversal_of_usage_log_id = subscription_credit_usage_log.id
            ), 0) AS credits_restored
     FROM subscription_credit_usage_log
     WHERE print_order_id = $1
       AND credits_consumed > 0
       AND reversal_of_usage_log_id IS NULL
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [data.print_order_id],
  );

  let restored = 0;
  let entries = 0;
  for (const usage of usageRows.rows) {
    const creditsConsumed = Number(usage.credits_consumed);
    const creditsRestored = Number(usage.credits_restored);
    const creditsToRestore = creditsConsumed - (Number.isFinite(creditsRestored) ? creditsRestored : 0);
    const result = await restoreCreditUsageRow(client, usage, creditsToRestore, data);
    restored += result.restored;
    entries += result.entries;
  }

  return { restored, entries };
}

export async function restoreCreditsForPosReceiptItemsWithClient(
  client: SubscriptionQueryClient,
  data: {
    pos_receipt_id: string;
    items: Array<{ product_id: string; quantity: number }>;
    employee_id?: string;
    description?: string;
    reversal_reason?: string;
  },
): Promise<{ restored: number; entries: number }> {
  const quantityByProduct = new Map<string, number>();
  for (const item of data.items) {
    if (!item.product_id || item.quantity <= 0) continue;
    quantityByProduct.set(item.product_id, (quantityByProduct.get(item.product_id) ?? 0) + item.quantity);
  }

  const productIds = [...quantityByProduct.keys()];
  if (productIds.length === 0) return { restored: 0, entries: 0 };

  const usageRows = await client.query<CreditUsageLogRestoreRow>(
    `SELECT id, subscription_id, credit_id, product_id, quantity,
            credit_multiplier, credits_consumed,
            COALESCE((
              SELECT SUM(ABS(rev.credits_consumed))
              FROM subscription_credit_usage_log rev
              WHERE rev.reversal_of_usage_log_id = subscription_credit_usage_log.id
            ), 0) AS credits_restored
     FROM subscription_credit_usage_log
     WHERE pos_receipt_id = $1
       AND product_id = ANY($2)
       AND credits_consumed > 0
       AND reversal_of_usage_log_id IS NULL
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [data.pos_receipt_id, productIds],
  );

  let restored = 0;
  let entries = 0;
  for (const usage of usageRows.rows) {
    const remainingQuantity = quantityByProduct.get(usage.product_id) ?? 0;
    if (remainingQuantity <= 0) continue;

    const creditsConsumed = Number(usage.credits_consumed);
    const creditsRestored = Number(usage.credits_restored);
    const creditsRemaining = creditsConsumed - (Number.isFinite(creditsRestored) ? creditsRestored : 0);
    const creditMultiplier = Number(usage.credit_multiplier) || 1;
    const creditsToRestore = Math.min(creditsRemaining, remainingQuantity * creditMultiplier);
    const result = await restoreCreditUsageRow(client, usage, creditsToRestore, data);
    restored += result.restored;
    entries += result.entries;

    quantityByProduct.set(
      usage.product_id,
      Math.max(0, remainingQuantity - (result.restored / creditMultiplier)),
    );
  }

  return { restored, entries };
}

async function restoreCreditUsageRow(
  client: SubscriptionQueryClient,
  usage: CreditUsageLogRestoreRow,
  creditsToRestore: number,
  data: {
    pos_receipt_id?: string;
    print_order_id?: PhotoPrintOrdersId | string | null;
    employee_id?: string;
    description?: string;
    reversal_reason?: string;
  },
): Promise<{ restored: number; entries: number }> {
  if (!Number.isFinite(creditsToRestore) || creditsToRestore <= 0) return { restored: 0, entries: 0 };
  if (!usage.credit_id) {
    throw new Error(`Cannot restore subscription credit usage ${usage.id}: credit_id is missing`);
  }

  const creditMultiplier = Number(usage.credit_multiplier) || 1;
  const quantityToRestore = Math.max(1, Math.ceil(creditsToRestore / creditMultiplier));

  await client.query(
    `UPDATE subscription_credits
     SET used_credits = GREATEST(0, used_credits - $2)
     WHERE id = $1`,
    [usage.credit_id, creditsToRestore],
  );

  const reversal = await client.query<CreatedUsageLogRow>(
    `INSERT INTO subscription_credit_usage_log (
       subscription_id, credit_id, product_id, quantity, credit_multiplier, credits_consumed,
       pos_receipt_id, print_order_id, employee_id, description, reversal_of_usage_log_id, reversal_reason
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      usage.subscription_id,
      usage.credit_id,
      usage.product_id,
      -quantityToRestore,
      usage.credit_multiplier,
      -creditsToRestore,
      data.pos_receipt_id ?? null,
      data.print_order_id ?? null,
      data.employee_id || null,
      data.description || null,
      usage.id,
      data.reversal_reason || null,
    ],
  );

  const creditsConsumed = Number(usage.credits_consumed);
  const creditsRestored = Number(usage.credits_restored);
  const restoredBefore = Number.isFinite(creditsRestored) ? creditsRestored : 0;
  if (creditsConsumed - restoredBefore - creditsToRestore <= 0.0001) {
    await client.query(
      `UPDATE subscription_credit_usage_log
       SET reversed_by_usage_log_id = $2
       WHERE id = $1`,
      [usage.id, reversal.rows[0]?.id ?? null],
    );
  }

  return { restored: creditsToRestore, entries: 1 };
}

// ─── PHONE NORMALIZATION ─────────────────────────────

/** Normalize phone: strip non-digits, convert leading 8 → 7, prepend 7 for 10-digit */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('8') && digits.length === 11) digits = '7' + digits.slice(1);
  if (digits.length === 10) digits = '7' + digits;
  return digits;
}

// ─── LOOKUP BY PHONE ──────────────────────────────────

export async function checkSubscription(phone: string): Promise<UserSubscription | null> {
  const cleanPhone = normalizePhone(phone);
  const sub = await db.queryOne<UserSubscription>(
    `SELECT us.*, sp.name as plan_name, sp.slug as plan_slug, sp.category as plan_category
     FROM user_subscriptions us
     LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.phone = $1 AND us.status = 'active'
       AND (us.plan_id IS NULL OR COALESCE(sp.category, 'doc-print') IN ('doc-print', 'photo-print'))
     ORDER BY us.created_at DESC LIMIT 1`,
    [cleanPhone]
  );

  return sub;
}

// ─── LOOKUP BY USER ID ──────────────────────────────────

export async function checkSubscriptionByUserId(userId: string): Promise<UserSubscription | null> {
  return db.queryOne<UserSubscription>(
    `SELECT us.*, sp.name as plan_name, sp.slug as plan_slug, sp.category as plan_category
     FROM user_subscriptions us
     LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.user_id = $1 AND us.status = 'active'
       AND (us.plan_id IS NULL OR COALESCE(sp.category, 'doc-print') IN ('doc-print', 'photo-print'))
     ORDER BY us.created_at DESC LIMIT 1`,
    [userId],
  );
}

export async function getMySubscriptions(userId: string): Promise<UserSubscription[]> {
  return db.query<UserSubscription>(
    `SELECT us.*, sp.name as plan_name, sp.slug as plan_slug, sp.category as plan_category
     FROM user_subscriptions us
     LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.user_id = $1
     ORDER BY us.created_at DESC`,
    [userId]
  );
}

// ─── ACTIVE SUBSCRIPTION BY USER ID ──────────────────

export async function getActiveSubscription(customerId: string): Promise<UserSubscription | null> {
  return db.queryOne<UserSubscription>(
    `SELECT us.*, sp.name as plan_name, sp.slug as plan_slug, sp.category as plan_category
     FROM user_subscriptions us
     LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.user_id = $1 AND us.status = 'active'
       AND (us.plan_id IS NULL OR COALESCE(sp.category, 'doc-print') IN ('doc-print', 'photo-print'))
     ORDER BY us.created_at DESC LIMIT 1`,
    [customerId]
  );
}

// ─── PROVISION CREDITS (new period) ──────────────────

export async function provisionCredits(subscriptionId: string): Promise<SubscriptionCredit[]> {
  const sub = await db.queryOne<UserSubscription & {
    credits_rollover_months: number;
    plan_billing_period: SubscriptionBillingPeriod | null;
    plan_category: string | null;
    plan_slug: string | null;
  }>(
    `SELECT us.*,
            sp.credits_rollover_months,
            sp.billing_period AS plan_billing_period,
            sp.slug AS plan_slug,
            sp.category AS plan_category
     FROM user_subscriptions us
     LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.id = $1 AND us.status = 'active'`,
    [subscriptionId]
  );
  if (!sub) {
    throw new Error(`Active subscription ${subscriptionId} not found`);
  }

  const now = new Date();
  const periodEnd = addMonths(now, billingPeriodMonths(sub.plan_billing_period));
  const rolloverMonths = sub.credits_rollover_months ?? 3;

  if (!shouldProvisionCreditsForPlan(sub.plan_slug, sub.plan_category, rolloverMonths)) {
    return getCredits(subscriptionId);
  }

  return db.transaction(async (client: PoolClient) => {
    // Rollover unexpired credits from previous periods
    await performRollover(client, subscriptionId, rolloverMonths);

    // Issue new credits
    await issueCredits(
      client, subscriptionId, sub.plan_id,
      sub.custom_items || [], now, periodEnd, rolloverMonths
    );

    // Return all current credits
    const credits = await client.query<SubscriptionCredit>(
      `SELECT sc.*, p.name as product_name,
              (sc.total_credits - sc.used_credits) as remaining
       FROM subscription_credits sc
       JOIN products p ON sc.product_id = p.id
       WHERE sc.subscription_id = $1
         AND sc.expires_at > NOW()
         AND sc.used_credits < sc.total_credits
       ORDER BY sc.expires_at ASC`,
      [subscriptionId]
    );
    return credits.rows;
  });
}

// ─── ROLLOVER CREDITS ────────────────────────────────

export async function rolloverCredits(subscriptionId: string): Promise<void> {
  const sub = await db.queryOne<SubscriptionRolloverMonthsRow>(
    `SELECT COALESCE(sp.credits_rollover_months, 3) AS credits_rollover_months,
            sp.slug AS plan_slug,
            sp.category AS plan_category
     FROM user_subscriptions us
     LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.id = $1 AND us.status = 'active'`,
    [subscriptionId]
  );
  if (!sub || !shouldProvisionCreditsForPlan(sub.plan_slug, sub.plan_category, sub.credits_rollover_months)) return;

  await db.transaction(async (client: PoolClient) => {
    await performRollover(client, subscriptionId, sub.credits_rollover_months);
  });
}

async function performRollover(
  client: PoolClient,
  subscriptionId: string,
  rolloverMonths: number,
  referenceDate = new Date(),
): Promise<void> {
  if (rolloverMonths <= 0) return;

  // Find unexpired credits with remaining balance that have not already been rolled over
  const expiring = await client.query<ExpiringSubscriptionCreditRow>(
    `SELECT id, product_id, total_credits, used_credits, period_end
     FROM subscription_credits
     WHERE subscription_id = $1
       AND expires_at > $2
       AND used_credits < total_credits
       AND rolled_over_from IS NULL
       AND period_end <= $2
     FOR UPDATE`,
    [subscriptionId, referenceDate.toISOString()]
  );

  for (const credit of expiring.rows) {
    const remaining = credit.total_credits - credit.used_credits;
    if (remaining <= 0) continue;

    const expiresAt = new Date(referenceDate);
    expiresAt.setMonth(expiresAt.getMonth() + rolloverMonths);

    const newPeriodEnd = new Date(referenceDate);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

    await client.query(
      `INSERT INTO subscription_credits
        (subscription_id, product_id, period_start, period_end,
         total_credits, used_credits, rolled_over_from, expires_at)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
       ON CONFLICT DO NOTHING`,
      [
        subscriptionId, credit.product_id,
        referenceDate.toISOString(), newPeriodEnd.toISOString(),
        remaining, credit.id, expiresAt.toISOString(),
      ]
    );

    // Mark original as fully used so it won't rollover again
    await client.query(
      `UPDATE subscription_credits SET used_credits = total_credits WHERE id = $1`,
      [credit.id]
    );
  }
}

// ─── CONSUME CREDITS (alias for useCredits with different signature) ─

export async function consumeCredits(
  subscriptionId: string,
  productId: string,
  quantity: number
): Promise<{ consumed: number; remaining: number }> {
  const result = await useCredits({
    subscription_id: subscriptionId,
    product_id: productId,
    quantity,
  });
  return { consumed: result.used, remaining: result.remaining };
}

// ─── AVAILABLE CREDITS (summary per product) ─────────

export async function getAvailableCredits(subscriptionId: string): Promise<AvailableCredit[]> {
  return db.query<AvailableCredit>(
    `SELECT sc.product_id, p.name as product_name,
            COALESCE(SUM(sc.total_credits - sc.used_credits), 0)::int as available
     FROM subscription_credits sc
     JOIN products p ON sc.product_id = p.id
     WHERE sc.subscription_id = $1
       AND sc.expires_at > NOW()
       AND sc.used_credits < sc.total_credits
     GROUP BY sc.product_id, p.name
     ORDER BY p.name`,
    [subscriptionId]
  );
}

// ─── CREDIT USAGE HISTORY ────────────────────────────

export async function getCreditUsageHistory(
  subscriptionId: string,
  limit = 20,
  offset = 0,
): Promise<{ items: CreditUsageHistoryRow[]; total: number }> {
  const [items, countResult] = await Promise.all([
    db.query<CreditUsageHistoryRow>(
      `SELECT cul.id, cul.subscription_id, cul.credit_id, cul.product_id,
              p.name AS product_name,
              cul.quantity, cul.credit_multiplier::numeric AS credit_multiplier,
              cul.credits_consumed,
              cul.pos_receipt_id,
              pr.receipt_number,
              cul.employee_id,
              u.display_name AS employee_name,
              cul.description,
              cul.created_at
       FROM subscription_credit_usage_log cul
       JOIN products p ON cul.product_id = p.id
       LEFT JOIN pos_receipts pr ON cul.pos_receipt_id = pr.id
       LEFT JOIN users u ON cul.employee_id = u.id
       WHERE cul.subscription_id = $1
       ORDER BY cul.created_at DESC
       LIMIT $2 OFFSET $3`,
      [subscriptionId, limit, offset]
    ),
    db.queryOne<CreditUsageCountRow>(
      `SELECT COUNT(*) AS count FROM subscription_credit_usage_log WHERE subscription_id = $1`,
      [subscriptionId]
    ),
  ]);

  return {
    items,
    total: parseInt(countResult?.count || '0', 10),
  };
}

// ─── SUBSCRIBER DISCOUNT ─────────────────────────────

export async function getSubscriberDiscount(customerId: string): Promise<number> {
  const result = await db.queryOne<SubscriberDiscountRow>(
    `SELECT COALESCE(sp.subscriber_discount_percent, 0) as subscriber_discount_percent
     FROM user_subscriptions us
     JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.user_id = $1 AND us.status = 'active'
       AND COALESCE(sp.category, 'doc-print') = 'doc-print'
     ORDER BY us.created_at DESC LIMIT 1`,
    [customerId]
  );
  return result?.subscriber_discount_percent ?? 0;
}

// ─── RENEWAL (called from CloudPayments webhook) ──────

export async function renewSubscription(subscriptionId: string): Promise<void> {
  const existing = await db.queryOne<RenewableSubscriptionRow>(
    `SELECT monthly_price, cloudpayments_subscription_id
     FROM user_subscriptions
     WHERE id = $1 AND status = 'active'`,
    [subscriptionId],
  );
  if (!existing) return;

  await activateOrRenewSubscriptionPayment({
    subscriptionId,
    providerSubscriptionId: existing.cloudpayments_subscription_id,
    amount: Number(existing.monthly_price) || 0,
    kind: 'renewal',
    paidAt: new Date(),
    rawPayload: { source: 'renewSubscription' },
  });
}

// ─── CARD CHANGE (self-service смена карты рекуррента) ─────────────────
//
// Флоу: клиент привязывает НОВУЮ карту через виджет CP (1₽ Single+tokenize, без recurrent),
// мы клонируем старую CP-подписку из источника истины (/subscriptions/get) на новый токен через
// /subscriptions/create, атомарно свапаем cp_subscription_id/token на запись подписки и гасим
// старый рекуррент. Guard-флаг card_change_in_progress защищает от гонки Cancelled-вебхука старого
// рекуррента (lookup в вебхуках матчит по AccountId = наш subscription_id — swap не прячет запись).
// Деньги: create/swap — строго; refund 1₽ и cancel старого — best-effort (reconciler дочистит).

const CLOUDPAYMENTS_API_BASE = 'https://api.cloudpayments.ru';

/** Тип карточного периода для CloudPayments /subscriptions/create. */
export interface CloudPaymentsBillingPeriod {
  Interval: 'Month' | 'Day' | 'Week';
  Period: number;
}

/** Параметры создания рекуррентной подписки CloudPayments (клон старой на новый токен). */
export interface CreateCloudPaymentsSubscriptionParams {
  token: string;
  accountId: string;
  amount: number;
  currency: string;
  interval: CloudPaymentsBillingPeriod['Interval'];
  period: number;
  startDateIso: string;
  description: string;
  email?: string | null;
  maxPeriods?: number | null;
}

/** Модель подписки из ответов CP /subscriptions/get|create|find. */
export interface CloudPaymentsSubscriptionModel {
  Id?: string;
  AccountId?: string;
  Amount?: number;
  Currency?: string;
  Interval?: string;
  Period?: number;
  StartDateIso?: string | null;
  NextTransactionDateIso?: string | null;
  Description?: string | null;
  MaxPeriods?: number | null;
  Status?: string | null;
}

interface CloudPaymentsModelResponse {
  Success: boolean;
  Message: string | null;
  Model: CloudPaymentsSubscriptionModel | null;
}

interface CloudPaymentsFindResponse {
  Success: boolean;
  Message: string | null;
  Model: CloudPaymentsSubscriptionModel[] | null;
}

interface CloudPaymentsSimpleResponse {
  Success: boolean;
  Message: string | null;
}

function isCloudPaymentsModelResponse(v: unknown): v is CloudPaymentsModelResponse {
  return typeof v === 'object' && v !== null && 'Success' in v
    && typeof Reflect.get(v, 'Success') === 'boolean';
}

function isCloudPaymentsFindResponse(v: unknown): v is CloudPaymentsFindResponse {
  if (typeof v !== 'object' || v === null || !('Success' in v)) return false;
  if (typeof Reflect.get(v, 'Success') !== 'boolean') return false;
  const model = Reflect.get(v, 'Model');
  return model === null || model === undefined || Array.isArray(model);
}

function isCloudPaymentsSimpleResponse(v: unknown): v is CloudPaymentsSimpleResponse {
  return typeof v === 'object' && v !== null && 'Success' in v
    && typeof Reflect.get(v, 'Success') === 'boolean';
}

function cloudPaymentsAuthHeader(): string {
  return Buffer
    .from(`${config.cloudPayments.publicId}:${config.cloudPayments.apiSecret}`)
    .toString('base64');
}

async function cloudPaymentsPost(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${CLOUDPAYMENTS_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${cloudPaymentsAuthHeader()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return response.json();
}

/**
 * Маппинг billing_period плана → интервал/период CloudPayments (как фронтовый
 * cloud-payments.service.ts: yearly→Period 12, quarterly→3, monthly/прочее→1; Interval всегда Month).
 * Используется как fallback, если /subscriptions/get недоступен.
 */
export function billingPeriodToCp(
  billingPeriod: SubscriptionBillingPeriod | string | null | undefined,
): CloudPaymentsBillingPeriod {
  switch (billingPeriod) {
    case 'yearly':
      return { Interval: 'Month', Period: 12 };
    case 'quarterly':
      return { Interval: 'Month', Period: 3 };
    default:
      return { Interval: 'Month', Period: 1 };
  }
}

function normalizeCpInterval(value: string | null | undefined): CloudPaymentsBillingPeriod['Interval'] {
  if (value === 'Day' || value === 'Week' || value === 'Month') return value;
  return 'Month';
}

/**
 * GET старой подписки из CloudPayments — источник истины для клонирования
 * (Amount/Currency/Interval/Period/NextTransactionDate/Description). Возвращает Model или null.
 */
export async function cloudPaymentsSubscriptionGet(
  cpSubscriptionId: string,
): Promise<CloudPaymentsSubscriptionModel | null> {
  try {
    const body = await cloudPaymentsPost('/subscriptions/get', { Id: cpSubscriptionId });
    if (isCloudPaymentsModelResponse(body) && body.Success && body.Model) {
      return body.Model;
    }
    subLog.warn('[CardChange] CloudPayments /subscriptions/get returned no model', {
      cpId: cpSubscriptionId,
      message: isCloudPaymentsModelResponse(body) ? body.Message : 'unparsable',
    });
    return null;
  } catch (err: unknown) {
    subLog.error('[CardChange] CloudPayments /subscriptions/get failed', {
      cpId: cpSubscriptionId, error: String(err),
    });
    return null;
  }
}

/**
 * FIND подписок CloudPayments по AccountId (наш subscription_id). Для orphan-детектора reconciler'а.
 * Возвращает массив моделей (пустой при ошибке/отсутствии).
 */
export async function cloudPaymentsSubscriptionFind(
  accountId: string,
): Promise<CloudPaymentsSubscriptionModel[]> {
  try {
    const body = await cloudPaymentsPost('/subscriptions/find', { accountId });
    if (isCloudPaymentsFindResponse(body) && body.Success && body.Model) {
      return body.Model;
    }
    return [];
  } catch (err: unknown) {
    subLog.error('[CardChange] CloudPayments /subscriptions/find failed', {
      accountId, error: String(err),
    });
    return [];
  }
}

/**
 * Создаёт новую рекуррентную подписку CloudPayments на новом токене (клон старой).
 * Возвращает новый cpSubscriptionId (Model.Id) или null при неуспехе — НЕ бросает,
 * чтобы вызывающий мог корректно вернуть 502 без частичного состояния.
 */
export async function createCloudPaymentsSubscription(
  params: CreateCloudPaymentsSubscriptionParams,
): Promise<string | null> {
  try {
    const requestBody: Record<string, unknown> = {
      Token: params.token,
      AccountId: params.accountId,
      Amount: params.amount,
      Currency: params.currency,
      Interval: params.interval,
      Period: params.period,
      StartDate: params.startDateIso,
      Description: params.description,
      RequireConfirmation: false,
    };
    if (params.email) requestBody['Email'] = params.email;
    if (params.maxPeriods && params.maxPeriods > 0) requestBody['MaxPeriods'] = params.maxPeriods;

    const body = await cloudPaymentsPost('/subscriptions/create', requestBody);
    if (isCloudPaymentsModelResponse(body) && body.Success && body.Model?.Id) {
      return String(body.Model.Id);
    }
    subLog.error('[CardChange] CloudPayments /subscriptions/create did not return Model.Id', {
      accountId: params.accountId,
      message: isCloudPaymentsModelResponse(body) ? body.Message : 'unparsable',
    });
    return null;
  } catch (err: unknown) {
    subLog.error('[CardChange] CloudPayments /subscriptions/create failed', {
      accountId: params.accountId, error: String(err),
    });
    return null;
  }
}

/**
 * Останавливает рекуррент CloudPayments и ВОЗВРАЩАЕТ результат (в отличие от void
 * cancelCloudPaymentsRecurrent). Success ИЛИ «подписка не найдена» (уже мёртвая) → success=true,
 * чтобы reconciler не зацикливался на удалённой подписке. Иначе success=false (ретраим).
 */
export async function cancelCloudPaymentsRecurrentChecked(
  cpSubscriptionId: string,
): Promise<{ success: boolean; message: string | null }> {
  try {
    const body = await cloudPaymentsPost('/subscriptions/cancel', { Id: cpSubscriptionId });
    if (isCloudPaymentsSimpleResponse(body)) {
      if (body.Success) return { success: true, message: null };
      // CP отдаёт Success=false + Message при отсутствующей/уже отменённой подписке —
      // трактуем «not found»/«не найдена» как идемпотентный успех.
      const message = body.Message ?? '';
      const notFound = /not\s*found|не\s*найден|don't\s*exist|does\s*not\s*exist/i.test(message);
      return { success: notFound, message: body.Message };
    }
    return { success: false, message: 'unparsable_response' };
  } catch (err: unknown) {
    subLog.error('[CardChange] CloudPayments cancel (checked) failed', {
      cpId: cpSubscriptionId, error: String(err),
    });
    return { success: false, message: String(err) };
  }
}

/**
 * Возврат верификационного 1₽-платежа (best-effort). Void до клиринга / refund после.
 * Ошибка не критична — 1₽ потеря допустима, флоу не роняем.
 */
export async function refundVerification(
  transactionId: string | number,
): Promise<{ success: boolean }> {
  try {
    const body = await cloudPaymentsPost('/payments/refund', {
      TransactionId: String(transactionId),
    });
    if (isCloudPaymentsSimpleResponse(body)) {
      if (!body.Success) {
        subLog.warn('[CardChange] 1₽ refund returned error', {
          transactionId: String(transactionId), message: body.Message,
        });
      }
      return { success: body.Success };
    }
    return { success: false };
  } catch (err: unknown) {
    subLog.warn('[CardChange] 1₽ refund failed (best-effort)', {
      transactionId: String(transactionId), error: String(err),
    });
    return { success: false };
  }
}

// ─── Card change: row types ───────────────────────────

interface CardChangeInitSubscriptionRow {
  id: string;
  user_id: string | null;
  phone: string | null;
  status: string;
  monthly_price: string | number;
  cloudpayments_subscription_id: string | null;
  cloudpayments_token: string | null;
  plan_name: string | null;
  plan_billing_period: SubscriptionBillingPeriod | null;
  user_email: string | null;
}

interface CardChangeRow {
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
  expected_amount: string | number;
  verify_transaction_id: string | number | null;
  refunded: boolean;
}

interface CardChangeConfirmSubscriptionRow {
  id: string;
  user_id: string | null;
  status: string;
  monthly_price: string | number;
  cloudpayments_subscription_id: string | null;
  next_payment_date: string | null;
  card_last_four: string | null;
  plan_name: string | null;
  plan_billing_period: SubscriptionBillingPeriod | null;
  user_email: string | null;
}

interface LastPaidAmountRow {
  amount: string | number;
}

interface CardChangeClaimRow {
  id: string;
}

interface CardChangeStatusRow {
  status: string;
  new_card_last_four: string | null;
}

export interface InitCardChangeResult {
  changeId: string;
  externalId: string;
  verifyAmount: number;
  planName: string;
  email: string | null;
  phone: string | null;
}

export type ConfirmCardChangeStatus =
  | 'card_changed'
  | 'pending_payment'
  | 'processing'
  | 'already_changed'
  | 'failed';

export interface ConfirmCardChangeResult {
  status: ConfirmCardChangeStatus;
  cardLastFour?: string | null;
}

export interface CardChangeStatusResult {
  status: string;
  newCardLastFour: string | null;
}

export interface StoreVerifiedCardInput {
  token: string;
  last4?: string | null;
  type?: string | null;
  transactionId?: string | number | null;
}

const CARD_CHANGE_VERIFY_AMOUNT = 1;
const CARD_CHANGE_ACTIVE_STATUSES = ['awaiting_token', 'swapping', 'pending_cancel_old'];

/**
 * Идемпотентно открывает (или возвращает существующую открытую) операцию смены карты.
 * uq_scc_open_per_sub гарантирует ОДНУ открытую запись на подписку. Подписка должна быть
 * active|paused (иначе AppError 409). Не трогает CloudPayments — только готовит запись для виджета.
 */
export async function initCardChange(
  subscriptionId: string,
  actorUserId: string | null,
): Promise<InitCardChangeResult> {
  return db.transaction(async (client) => {
    const subResult = await client.query<CardChangeInitSubscriptionRow>(
      `SELECT us.id, us.user_id, us.phone, us.status, us.monthly_price,
              us.cloudpayments_subscription_id, us.cloudpayments_token,
              sp.name AS plan_name, sp.billing_period AS plan_billing_period,
              u.email AS user_email
         FROM user_subscriptions us
         LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
         LEFT JOIN users u ON us.user_id = u.id
        WHERE us.id = $1
        FOR UPDATE OF us`,
      [subscriptionId],
    );
    const sub = subResult.rows[0];
    if (!sub) {
      throw new AppError(404, 'Подписка не найдена');
    }
    if (sub.status !== 'active' && sub.status !== 'paused') {
      throw new AppError(409, 'Сменить карту можно только у активной подписки');
    }
    if (!sub.cloudpayments_subscription_id) {
      throw new AppError(409, 'У подписки нет привязанного рекуррента CloudPayments');
    }

    // Уже есть открытая операция (uq_scc_open_per_sub) — возвращаем её идемпотентно.
    const existing = await client.query<CardChangeRow>(
      `SELECT * FROM subscription_card_changes
        WHERE subscription_id = $1
          AND status = ANY($2::text[])
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [subscriptionId, CARD_CHANGE_ACTIVE_STATUSES],
    );
    const planName = sub.plan_name ?? 'Подписка';
    if (existing.rows[0]) {
      const change = existing.rows[0];
      return {
        changeId: change.id,
        externalId: `SUBCC-${change.id}`,
        verifyAmount: CARD_CHANGE_VERIFY_AMOUNT,
        planName,
        email: sub.user_email,
        phone: sub.phone,
      };
    }

    // id генерируем в JS, чтобы idempotency_key (NOT NULL) сразу был равен changeId
    // (externalId 'SUBCC-'+changeId) одним INSERT, без второго запроса.
    const newId = randomUUID();
    const created = await client.query<CardChangeRow>(
      `INSERT INTO subscription_card_changes (
         id, subscription_id, user_id, idempotency_key, status,
         old_cp_subscription_id, old_cp_token, expected_amount
       )
       VALUES ($1, $2, $3, $1::text, 'awaiting_token', $4, $5, $6)
       RETURNING *`,
      [
        newId,
        subscriptionId,
        actorUserId,
        sub.cloudpayments_subscription_id,
        sub.cloudpayments_token,
        CARD_CHANGE_VERIFY_AMOUNT,
      ],
    );
    const change = created.rows[0];

    return {
      changeId: change.id,
      externalId: `SUBCC-${change.id}`,
      verifyAmount: CARD_CHANGE_VERIFY_AMOUNT,
      planName,
      email: sub.user_email,
      phone: sub.phone,
    };
  });
}

/**
 * Сохраняет верифицированную новую карту (токен/last4/type/transaction) в запись смены карты.
 * Вызывается из /pay-ветки вебхука (S3). Best-effort обновление; статус не меняет.
 *
 * Гонка /pay↔confirm (P2-fix, UI-only): если /pay пришёл ПОСЛЕ swap (подписка уже на новой карте,
 * change.status дальше awaiting_token), первый UPDATE по change не сработает и last4 не доедет до
 * user_subscriptions — UI покажет пусто. Поэтому второй best-effort UPDATE дозаписывает
 * last4/type в user_subscriptions для уже свапнутого change (COALESCE — не перетирает уже
 * заполненное; идемпотентен).
 */
export async function storeVerifiedCard(
  changeId: string,
  input: StoreVerifiedCardInput,
): Promise<void> {
  const last4 = input.last4 ?? null;
  const cardType = input.type ?? null;
  await db.query(
    `UPDATE subscription_card_changes
        SET new_cp_token = $2,
            new_card_last_four = COALESCE($3, new_card_last_four),
            new_card_type = COALESCE($4, new_card_type),
            verify_transaction_id = COALESCE($5, verify_transaction_id),
            updated_at = NOW()
      WHERE id = $1
        AND status = 'awaiting_token'`,
    [
      changeId,
      input.token,
      last4,
      cardType,
      input.transactionId != null ? String(input.transactionId) : null,
    ],
  );

  // Дозапись last4/type в подписку, если swap уже прошёл (change в pending_cancel_old/completed)
  // и /pay донёс карту с опозданием. COALESCE гарантирует, что не перетрём уже корректные данные.
  if (last4 || cardType) {
    await db.query(
      `UPDATE user_subscriptions us
          SET card_last_four = COALESCE(us.card_last_four, $2),
              card_type = COALESCE(us.card_type, $3),
              updated_at = NOW()
         FROM subscription_card_changes scc
        WHERE scc.id = $1
          AND us.id = scc.subscription_id
          AND scc.status IN ('pending_cancel_old', 'completed')`,
      [changeId, last4, cardType],
    );
  }
}

interface ResolvedClonePlan {
  amount: number;
  currency: string;
  interval: CloudPaymentsBillingPeriod['Interval'];
  period: number;
  nextDateIso: string | null;
  description: string | null;
  maxPeriods: number | null;
}

/**
 * Клонирует параметры старой подписки из источника истины (CloudPayments /subscriptions/get).
 * Fallback при недоступном get: Amount из последнего paid subscription_payments, Interval/Period
 * из billing_period плана. Если Amount определить нечем → null (вызывающий вернёт 502, НЕ создаёт
 * рекуррент с неверной суммой). НЕ хардкодит monthly_price/Month=1 (см. Review P0-2/P0-3).
 */
async function resolveClonePlanForCardChange(
  client: PoolClient,
  oldCpSubscriptionId: string,
  subscriptionId: string,
  fallbackBillingPeriod: SubscriptionBillingPeriod | null,
): Promise<ResolvedClonePlan | null> {
  const cpModel = await cloudPaymentsSubscriptionGet(oldCpSubscriptionId);
  if (cpModel && typeof cpModel.Amount === 'number' && cpModel.Amount > 0) {
    return {
      amount: cpModel.Amount,
      currency: cpModel.Currency || 'RUB',
      interval: normalizeCpInterval(cpModel.Interval),
      period: typeof cpModel.Period === 'number' && cpModel.Period > 0 ? cpModel.Period : 1,
      nextDateIso: cpModel.NextTransactionDateIso ?? cpModel.StartDateIso ?? null,
      description: cpModel.Description ?? null,
      maxPeriods: typeof cpModel.MaxPeriods === 'number' ? cpModel.MaxPeriods : null,
    };
  }

  // Fallback: Amount из последнего успешного списания + период из плана.
  const lastPaid = await client.query<LastPaidAmountRow>(
    `SELECT amount FROM subscription_payments
      WHERE subscription_id = $1 AND status = 'paid'
      ORDER BY created_at DESC
      LIMIT 1`,
    [subscriptionId],
  );
  const amount = lastPaid.rows[0] ? Number(lastPaid.rows[0].amount) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    subLog.error('[CardChange] Cannot resolve clone Amount (no CP get, no paid payment)', {
      subscriptionId, oldCpSubscriptionId,
    });
    return null;
  }
  const cp = billingPeriodToCp(fallbackBillingPeriod);
  return {
    amount,
    currency: 'RUB',
    interval: cp.Interval,
    period: cp.Period,
    nextDateIso: null,
    description: null,
    maxPeriods: null,
  };
}

/**
 * Вычисляет StartDate новой подписки: GREATEST(next из CP, next_payment_date, now()) но
 * НЕ раньше now()+1day — гарантирует будущее (CP не спишет немедленно). Review P1-1.
 */
function resolveCardChangeStartDate(
  cpNextIso: string | null,
  subNextPaymentDate: string | null,
): string {
  const now = Date.now();
  const minStart = now + 24 * 60 * 60 * 1000;
  const candidates: number[] = [];
  for (const iso of [cpNextIso, subNextPaymentDate]) {
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms)) candidates.push(ms);
  }
  const best = candidates.length > 0 ? Math.max(...candidates) : now;
  return new Date(Math.max(best, minStart)).toISOString();
}

/**
 * Атомарный swap внутри транзакции: переносит cp_subscription_id/token/last4/type на НОВУЮ
 * подписку, ставит card_change_in_progress=true и переводит запись смены в pending_cancel_old.
 * FOR UPDATE на обеих строках (single-writer). last4 через COALESCE — не блокирует swap, если
 * вебхук /pay ещё не донёс last4 (Review P2-4).
 */
async function executeCardSwapTx(
  client: PoolClient,
  params: {
    subscriptionId: string;
    changeId: string;
    newCpSubscriptionId: string;
    newToken: string;
    newLast4: string | null;
    newCardType: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE user_subscriptions
        SET cloudpayments_subscription_id = $2,
            cloudpayments_token = $3,
            card_last_four = COALESCE($4, card_last_four),
            card_type = COALESCE($5, card_type),
            card_change_in_progress = true,
            card_change_started_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [
      params.subscriptionId,
      params.newCpSubscriptionId,
      params.newToken,
      params.newLast4,
      params.newCardType,
    ],
  );
  await client.query(
    `UPDATE subscription_card_changes
        SET status = 'pending_cancel_old',
            new_cp_subscription_id = $2,
            updated_at = NOW()
      WHERE id = $1`,
    [params.changeId, params.newCpSubscriptionId],
  );
}

export type AdoptOrphanCardChangeResult = 'adopted' | 'already_swapped' | 'not_orphan';

/**
 * Orphan-adopt для reconciler (S4): claimer (confirm) умер МЕЖДУ ответом
 * createCloudPaymentsSubscription и записью new_cp в БД — CP-подписка создана, но change застрял
 * в status='swapping' с new_cp_subscription_id IS NULL. Reconciler находит её через
 * cloudPaymentsSubscriptionFind(accountId) и зовёт эту обёртку, чтобы ДО-ВЫПОЛНИТЬ swap тем же
 * денежно-критичным путём (executeCardSwapTx), не дублируя SQL. Атомарно и идемпотентно:
 *  - 'adopted'         — был orphan (swapping + new_cp NULL), swap до-выполнен (→ pending_cancel_old);
 *  - 'already_swapped' — new_cp уже записан (свап прошёл) — no-op, reconciler может гасить старый;
 *  - 'not_orphan'      — change не найден / не в swapping / отменён — adopt не нужен.
 * FOR UPDATE на change + sub (single-writer) — гонок с параллельным confirm нет. После 'adopted'
 * reconciler должен погасить старый рекуррент (cancelCloudPaymentsRecurrentChecked).
 */
export async function adoptOrphanCardChange(
  changeId: string,
  newCpSubscriptionId: string,
  newToken: string,
  newLast4: string | null,
  newCardType: string | null,
): Promise<AdoptOrphanCardChangeResult> {
  return db.transaction(async (client) => {
    const changeResult = await client.query<CardChangeRow>(
      `SELECT * FROM subscription_card_changes WHERE id = $1 FOR UPDATE`,
      [changeId],
    );
    const change = changeResult.rows[0];
    if (!change) {
      return 'not_orphan';
    }
    // new_cp уже записан → swap прошёл (либо confirm успел, либо предыдущий adopt). No-op.
    if (change.new_cp_subscription_id) {
      return 'already_swapped';
    }
    // Усыновляем ТОЛЬКО зависший claim (swapping без new_cp). Прочие статусы adopt не требуют.
    if (change.status !== 'swapping') {
      return 'not_orphan';
    }

    const subResult = await client.query<CardChangeConfirmSubscriptionRow>(
      `SELECT us.id, us.user_id, us.status, us.monthly_price,
              us.cloudpayments_subscription_id, us.next_payment_date, us.card_last_four,
              sp.name AS plan_name, sp.billing_period AS plan_billing_period,
              u.email AS user_email
         FROM user_subscriptions us
         LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
         LEFT JOIN users u ON us.user_id = u.id
        WHERE us.id = $1
        FOR UPDATE OF us`,
      [change.subscription_id],
    );
    const sub = subResult.rows[0];
    // Подписку отменили/нет — не свапаем, помечаем failed (reconciler погасит осиротевший new).
    if (!sub || (sub.status !== 'active' && sub.status !== 'paused')) {
      await client.query(
        `UPDATE subscription_card_changes
            SET status = 'failed', last_error = 'orphan_subscription_not_active', updated_at = NOW()
          WHERE id = $1`,
        [changeId],
      );
      return 'not_orphan';
    }

    await executeCardSwapTx(client, {
      subscriptionId: change.subscription_id,
      changeId,
      newCpSubscriptionId,
      newToken,
      newLast4: change.new_card_last_four ?? newLast4,
      newCardType: change.new_card_type ?? newCardType,
    });
    return 'adopted';
  });
}

/**
 * Подтверждение смены карты (вызывается фронтом-поллингом после оплаты 1₽ в виджете).
 * Идемпотентно и устойчиво к гонкам:
 *  1. payments/find('SUBCC-'+changeId) → проверка оплаты + anti-tamper (Amount≈1, RUB).
 *  2. Атомарный claim (awaiting_token→swapping) — только claimer вызывает /subscriptions/create.
 *  3. Клон старой подписки из CloudPayments → /subscriptions/create на новом токене.
 *  4. Записать new_cp_subscription_id, swap-TX, отмена старого рекуррента (checked).
 * Деньги: create/swap строго; cancel best-effort (остаётся pending_cancel_old → reconciler).
 */
export async function confirmCardChange(
  subscriptionId: string,
  changeId: string,
): Promise<ConfirmCardChangeResult> {
  // ── Шаг A: загрузка change + подписки, идемпотентные ранние выходы (короткая TX) ──
  const loaded = await db.transaction(async (client) => {
    const changeResult = await client.query<CardChangeRow>(
      `SELECT * FROM subscription_card_changes
        WHERE id = $1 AND subscription_id = $2
        FOR UPDATE`,
      [changeId, subscriptionId],
    );
    const change = changeResult.rows[0];
    if (!change) {
      throw new AppError(404, 'Операция смены карты не найдена');
    }

    // Уже завершено/в процессе отмены старого → идемпотентный ответ.
    if (change.status === 'completed' || change.status === 'pending_cancel_old') {
      return { kind: 'already_changed' as const, lastFour: change.new_card_last_four };
    }
    if (change.status === 'failed') {
      return { kind: 'failed' as const, lastFour: null };
    }
    // Параллельный confirm уже захватил claim и создаёт подписку.
    if (change.status === 'swapping') {
      return { kind: 'processing' as const, lastFour: null };
    }

    const subResult = await client.query<CardChangeConfirmSubscriptionRow>(
      `SELECT us.id, us.user_id, us.status, us.monthly_price,
              us.cloudpayments_subscription_id, us.next_payment_date, us.card_last_four,
              sp.name AS plan_name, sp.billing_period AS plan_billing_period,
              u.email AS user_email
         FROM user_subscriptions us
         LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
         LEFT JOIN users u ON us.user_id = u.id
        WHERE us.id = $1
        FOR UPDATE OF us`,
      [subscriptionId],
    );
    const sub = subResult.rows[0];
    if (!sub) {
      throw new AppError(404, 'Подписка не найдена');
    }
    // Подписку отменили во время смены — не свапаем, помечаем failed (reconciler погасит orphan).
    if (sub.status !== 'active' && sub.status !== 'paused') {
      await client.query(
        `UPDATE subscription_card_changes
            SET status = 'failed', last_error = 'subscription_not_active', updated_at = NOW()
          WHERE id = $1`,
        [changeId],
      );
      return { kind: 'failed' as const, lastFour: null };
    }

    return { kind: 'proceed' as const, change, sub };
  });

  if (loaded.kind === 'already_changed') {
    return { status: 'already_changed', cardLastFour: loaded.lastFour };
  }
  if (loaded.kind === 'failed') {
    return { status: 'failed' };
  }
  if (loaded.kind === 'processing') {
    return { status: 'processing' };
  }
  const { change, sub } = loaded;

  // ── Шаг B: верификация оплаты 1₽ + anti-tamper (вне TX — внешний вызов CP) ──
  const expectedAmount = Number(change.expected_amount) || CARD_CHANGE_VERIFY_AMOUNT;
  const verified = await verifyCardChangePayment(`SUBCC-${changeId}`, expectedAmount);
  if (!verified.paid) {
    return { status: 'pending_payment' };
  }
  const newToken = change.new_cp_token ?? verified.token;
  if (!newToken) {
    subLog.warn('[CardChange] No token available after verified payment', { changeId });
    return { status: 'pending_payment' };
  }

  // ── Шаг C: атомарный claim (awaiting_token→swapping). Только claimer создаёт подписку. ──
  const claim = await db.query<CardChangeClaimRow>(
    `UPDATE subscription_card_changes
        SET status = 'swapping', updated_at = NOW()
      WHERE id = $1 AND status = 'awaiting_token' AND new_cp_subscription_id IS NULL
      RETURNING id`,
    [changeId],
  );
  if (claim.length === 0) {
    // Кто-то другой захватил claim (или статус уже сменился) — пусть фронт поллит.
    return { status: 'processing' };
  }

  // ── Шаг D: клонируем старую подписку из CP и создаём новую на новом токене ──
  let clone: ResolvedClonePlan | null = null;
  try {
    clone = await db.transaction((client) =>
      resolveClonePlanForCardChange(
        client,
        change.old_cp_subscription_id ?? sub.cloudpayments_subscription_id ?? '',
        subscriptionId,
        sub.plan_billing_period,
      ),
    );
  } catch (err: unknown) {
    subLog.error('[CardChange] resolveClonePlan failed', { changeId, error: String(err) });
  }
  if (!clone) {
    // Не смогли определить параметры — откатываем claim, НЕ создаём рекуррент. 502 клиенту.
    await releaseCardChangeClaim(changeId, 'clone_params_unresolved');
    throw new AppError(502, 'Не удалось получить параметры подписки CloudPayments');
  }

  const startDateIso = resolveCardChangeStartDate(clone.nextDateIso, sub.next_payment_date);
  const newCpSubscriptionId = await createCloudPaymentsSubscription({
    token: newToken,
    accountId: subscriptionId,
    amount: clone.amount,
    currency: clone.currency,
    interval: clone.interval,
    period: clone.period,
    startDateIso,
    description: clone.description || `Подписка: ${sub.plan_name ?? ''}`.trim(),
    email: sub.user_email,
    maxPeriods: clone.maxPeriods,
  });
  if (!newCpSubscriptionId) {
    await releaseCardChangeClaim(changeId, 'cp_create_failed');
    throw new AppError(502, 'Не удалось создать рекуррент CloudPayments');
  }

  // ── Шаг E: записать new_cp СРАЗУ, затем атомарный swap-TX ──
  await db.transaction(async (client) => {
    await executeCardSwapTx(client, {
      subscriptionId,
      changeId,
      newCpSubscriptionId,
      newToken,
      newLast4: change.new_card_last_four,
      newCardType: change.new_card_type,
    });
  });

  // ── Шаг F: гасим старый рекуррент (checked, best-effort) ──
  const oldCpId = change.old_cp_subscription_id;
  if (oldCpId) {
    const cancelResult = await cancelCloudPaymentsRecurrentChecked(oldCpId);
    if (cancelResult.success) {
      await db.query(
        `UPDATE user_subscriptions
            SET card_change_in_progress = false, updated_at = NOW()
          WHERE id = $1`,
        [subscriptionId],
      );
      await db.query(
        `UPDATE subscription_card_changes
            SET status = 'completed', updated_at = NOW()
          WHERE id = $1`,
        [changeId],
      );
    } else {
      // Остаётся pending_cancel_old + флаг включён → reconciler дочистит cancel.
      await db.query(
        `UPDATE subscription_card_changes
            SET cancel_attempts = cancel_attempts + 1,
                last_error = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [changeId, cancelResult.message ?? 'cancel_failed'],
      );
    }
  } else {
    // Старого рекуррента нет — сразу completed.
    await db.query(
      `UPDATE user_subscriptions
          SET card_change_in_progress = false, updated_at = NOW()
        WHERE id = $1`,
      [subscriptionId],
    );
    await db.query(
      `UPDATE subscription_card_changes
          SET status = 'completed', updated_at = NOW()
        WHERE id = $1`,
      [changeId],
    );
  }

  // 1₽ refund (best-effort) — если /pay-ветка ещё не вернула.
  if (!change.refunded && change.verify_transaction_id) {
    const refund = await refundVerification(change.verify_transaction_id);
    if (refund.success) {
      await db.query(
        `UPDATE subscription_card_changes SET refunded = true, updated_at = NOW() WHERE id = $1`,
        [changeId],
      );
    }
  }

  return { status: 'card_changed', cardLastFour: change.new_card_last_four };
}

/** Откат claim swapping→awaiting_token при провале create (чтобы confirm можно было повторить). */
async function releaseCardChangeClaim(changeId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE subscription_card_changes
        SET status = 'awaiting_token', last_error = $2, updated_at = NOW()
      WHERE id = $1 AND status = 'swapping' AND new_cp_subscription_id IS NULL`,
    [changeId, reason],
  );
}

interface CloudPaymentsFindPaymentModel {
  Amount?: number;
  Currency?: string;
  Status?: string;
  StatusCode?: number;
  Token?: string | null;
  CardLastFour?: string | null;
  CardType?: string | null;
  TransactionId?: number | null;
}

interface CloudPaymentsFindPaymentResponse {
  Success: boolean;
  Message: string | null;
  Model: CloudPaymentsFindPaymentModel | null;
}

function isCloudPaymentsFindPaymentResponse(v: unknown): v is CloudPaymentsFindPaymentResponse {
  return typeof v === 'object' && v !== null && 'Success' in v
    && typeof Reflect.get(v, 'Success') === 'boolean';
}

interface VerifyCardChangePaymentResult {
  paid: boolean;
  token: string | null;
}

/**
 * payments/find по InvoiceId 'SUBCC-'+changeId → проверка оплаты (StatusCode 3 Authorized /
 * StatusCode 4 Completed или Status Completed/Authorized) + anti-tamper: Amount≈expected (±0.01),
 * Currency=RUB. Это вторая точка anti-tamper (первая — /check вебхук, S3).
 */
async function verifyCardChangePayment(
  invoiceId: string,
  expectedAmount: number,
): Promise<VerifyCardChangePaymentResult> {
  try {
    const body = await cloudPaymentsPost('/payments/find', { InvoiceId: invoiceId });
    if (!isCloudPaymentsFindPaymentResponse(body) || !body.Success || !body.Model) {
      return { paid: false, token: null };
    }
    const model = body.Model;
    const status = (model.Status ?? '').toLowerCase();
    const isPaid = model.StatusCode === 3 || model.StatusCode === 4
      || status === 'completed' || status === 'authorized';
    if (!isPaid) {
      return { paid: false, token: null };
    }
    // anti-tamper: сумма ≈ 1₽ и валюта RUB.
    const amount = typeof model.Amount === 'number' ? model.Amount : NaN;
    const currency = (model.Currency || 'RUB').toUpperCase();
    if (!Number.isFinite(amount) || Math.abs(amount - expectedAmount) > 0.01 || currency !== 'RUB') {
      subLog.warn('[CardChange] payments/find anti-tamper mismatch', {
        invoiceId, amount: model.Amount, currency: model.Currency, expectedAmount,
      });
      return { paid: false, token: null };
    }
    return { paid: true, token: model.Token ?? null };
  } catch (err: unknown) {
    subLog.error('[CardChange] payments/find failed', { invoiceId, error: String(err) });
    return { paid: false, token: null };
  }
}

/** Текущий статус операции смены карты (для опционального поллинга/GET status, S3). */
export async function getCardChangeStatus(
  subscriptionId: string,
): Promise<CardChangeStatusResult | null> {
  const row = await db.queryOne<CardChangeStatusRow>(
    `SELECT status, new_card_last_four
       FROM subscription_card_changes
      WHERE subscription_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [subscriptionId],
  );
  if (!row) return null;
  return { status: row.status, newCardLastFour: row.new_card_last_four };
}
