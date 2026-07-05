import crypto from 'crypto';
import db from '../database/db.js';
import { initSubscription } from './subscription.service.js';
import type { SubscriptionOffersId } from '../types/generated/public/SubscriptionOffers.js';
import type { SubscriptionPlansId } from '../types/generated/public/SubscriptionPlans.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type { ConversationsId } from '../types/generated/public/Conversations.js';
import type { MessagesId } from '../types/generated/public/Messages.js';
import type { UserSubscriptionsId } from '../types/generated/public/UserSubscriptions.js';
import type SubscriptionPlans from '../types/generated/public/SubscriptionPlans.js';
import type Conversations from '../types/generated/public/Conversations.js';

// ─── TYPES ────────────────────────────────────────────

export interface SubscriptionOffer {
  id: SubscriptionOffersId;
  plan_id: SubscriptionPlansId;
  employee_id: UsersId;
  chat_session_id: ConversationsId;
  customer_phone: string | null;
  customer_name: string | null;
  token: string;
  status: string;
  monthly_price: number;
  message_id: MessagesId | null;
  subscription_id: UserSubscriptionsId | null;
  expires_at: string;
  opened_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OfferWithPlan extends SubscriptionOffer {
  plan_name: string;
  plan_slug: string;
  plan_description: string | null;
  subscriber_discount_percent: number;
  credits_rollover_months: number;
  plan_category: string;
  plan_features: string[];
  items: OfferPlanItem[];
}

export interface OfferPlanItem {
  product_id: string;
  product_name: string;
  included_quantity: number;
  credit_price: number | null;
}

export interface AcceptOfferResult {
  subscription_id: UserSubscriptionsId;
  monthly_price: number;
  plan_name: string;
}

// ─── CREATE OFFER ─────────────────────────────────────

export async function createOffer(
  planId: string,
  employeeId: string,
  chatSessionId: string,
): Promise<SubscriptionOffer> {
  // Load plan to get monthly_price
  const plan = await db.queryOne<Pick<SubscriptionPlans, 'base_price'>>(
    `SELECT base_price FROM subscription_plans WHERE id = $1 AND is_active = true`,
    [planId],
  );
  if (!plan) {
    throw new Error('Plan not found or inactive');
  }

  // Get customer info from conversation
  const conv = await db.queryOne<Pick<Conversations, 'visitor_phone' | 'visitor_name'>>(
    `SELECT visitor_phone, visitor_name FROM conversations WHERE id = $1`,
    [chatSessionId],
  );

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  const offer = await db.queryOne<SubscriptionOffer>(
    `INSERT INTO subscription_offers
       (plan_id, employee_id, chat_session_id, customer_phone, customer_name,
        token, monthly_price, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      planId,
      employeeId,
      chatSessionId,
      conv?.visitor_phone || null,
      conv?.visitor_name || null,
      token,
      plan.base_price,
      expiresAt.toISOString(),
    ],
  );

  return offer!;
}

// ─── GET OFFER BY TOKEN ───────────────────────────────

export async function getOfferByToken(token: string): Promise<OfferWithPlan | null> {
  const offer = await db.queryOne<OfferWithPlan>(
    `SELECT so.*,
            sp.name AS plan_name,
            sp.slug AS plan_slug,
            sp.description AS plan_description,
            sp.subscriber_discount_percent,
            sp.credits_rollover_months,
            sp.category AS plan_category,
            sp.features AS plan_features
     FROM subscription_offers so
     JOIN subscription_plans sp ON so.plan_id = sp.id
     WHERE so.token = $1
       AND so.status IN ('sent', 'opened')
       AND so.expires_at > NOW()`,
    [token],
  );

  if (!offer) return null;

  // Load plan items
  offer.items = await db.query<OfferPlanItem>(
    `SELECT spi.product_id, p.name AS product_name,
            spi.included_quantity, spi.credit_price
     FROM subscription_plan_items spi
     JOIN products p ON spi.product_id = p.id
     WHERE spi.plan_id = $1
     ORDER BY spi.sort_order`,
    [offer.plan_id],
  );

  return offer;
}

// ─── MARK OPENED ──────────────────────────────────────

export async function markOfferOpened(token: string): Promise<void> {
  await db.query(
    `UPDATE subscription_offers
     SET status = 'opened', opened_at = NOW(), updated_at = NOW()
     WHERE token = $1 AND status = 'sent'`,
    [token],
  );
}

// ─── ACCEPT OFFER ─────────────────────────────────────

export async function acceptOffer(
  token: string,
  userId?: string,
): Promise<AcceptOfferResult> {
  const offer = await getOfferByToken(token);
  if (!offer) {
    throw new Error('Offer not found, expired, or already used');
  }

  // Init subscription (pending, awaiting payment)
  const phone = offer.customer_phone || '';
  const subscription = await initSubscription({
    user_id: userId,
    phone,
    customer_name: offer.customer_name || undefined,
    plan_id: offer.plan_id,
    monthly_price: offer.monthly_price,
  });

  // Update offer status
  await db.query(
    `UPDATE subscription_offers
     SET status = 'accepted',
         accepted_at = NOW(),
         subscription_id = $2,
         updated_at = NOW()
     WHERE token = $1`,
    [token, subscription.id],
  );

  return {
    subscription_id: subscription.id,
    monthly_price: offer.monthly_price,
    plan_name: offer.plan_name,
  };
}

// ─── UPDATE MESSAGE ID ───────────────────────────────

export async function updateOfferMessageId(
  offerId: SubscriptionOffersId,
  messageId: MessagesId,
): Promise<void> {
  await db.query(
    `UPDATE subscription_offers SET message_id = $2, updated_at = NOW() WHERE id = $1`,
    [offerId, messageId],
  );
}
