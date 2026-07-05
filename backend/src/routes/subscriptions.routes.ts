import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  getPlans, getPlanById, createPlan,
  subscribe, initSubscription, activateSubscription,
  pauseSubscription, resumeSubscription, cancelSubscription,
  getCredits, useCredits, checkSubscription, checkSubscriptionByUserId,
  getMySubscriptions, renewSubscription,
  getActiveSubscription, provisionCredits, consumeCredits,
  rolloverCredits, getAvailableCredits, getSubscriberDiscount,
  getCreditUsageHistory, normalizePhone, validatePromoCode,
  getGiftSubscriptionPromoInfo, createGiftSubscriptionPromo, redeemGiftSubscriptionPromo,
  isEducationSubscriptionPlan, EDUCATION_ACCESS_PLAN_SLUGS,
  initCardChange, confirmCardChange, getCardChangeStatus,
} from '../services/subscription.service.js';
import { findUserByChannel } from '../services/channel-linking.service.js';
import { authenticateToken, optionalAuth, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import { validate } from '../middleware/validate.js';
import {
  createPlanSchema,
  calculatePackageSchema,
  initSubscriptionSchema,
  createGiftSubscriptionPromoSchema,
  redeemGiftSubscriptionPromoSchema,
  sendAccountAccessInfoSchema,
  type SendAccountAccessInfoInput,
} from '../schemas/subscriptions.schema.js';
import { config } from '../config/index.js';
import db from '../database/db.js';
import type Users from '../types/generated/public/Users.js';
import type Conversations from '../types/generated/public/Conversations.js';
import type { MessagesId } from '../types/generated/public/Messages.js';
import { createOffer, getOfferByToken, markOfferOpened, acceptOffer, updateOfferMessageId } from '../services/subscription-offer.service.js';
import { getSocketServer } from './chat/chat-shared.js';
import { broadcastChatMessage } from '../services/chat-broadcast.service.js';
import { enqueueOutbound } from '../services/connectors/pipeline/outbound-worker.js';
import { createLogger } from '../utils/logger.js';
import { type SubscriptionOwnershipRow } from '../types/views/subscription-views.js';

const log = createLogger('subscriptions.routes');
const router = Router();

interface TrialPromoRow {
  id: string;
  trial_days: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  usage_limit: number | null;
  usage_count: number;
}

const salePlanSlugsByCategory: Readonly<Record<string, readonly string[]>> = {
  'doc-print': [
    'launch-printscan-lite',
    'launch-printscan-biz',
    'launch-printscan-pro',
    'doc-print-student',
    'doc-print-business',
    'doc-print-office',
  ],
  'photo-print': [
    'photoprint-fan',
    'photoprint-family',
    'photoprint-photographer',
    'launch-photoprint-lite',
    'launch-photoprint-standard',
    'launch-photoprint-pro',
    'photo-print-fan',
    'photo-print-family',
    'photo-print-pro',
  ],
};
const educationSalePlanSlugs = EDUCATION_ACCESS_PLAN_SLUGS;
const PERSONAL_ACCOUNT_PLAN_SLUG = 'doc-print-student';
const PERSONAL_ACCOUNT_DISCOUNT_TEXT = 'Скидка на печать документов — 20%, на печать фотографий — 10%.';

function isPlanAvailableForSale(plan: { is_active: boolean; category: string; slug: string }): boolean {
  const saleCategorySlugs = plan.category === 'education'
    ? educationSalePlanSlugs
    : salePlanSlugsByCategory[plan.category];
  return plan.is_active && Boolean(saleCategorySlugs?.some(slug => slug === plan.slug));
}

interface EducationEligibilityRow {
  id: string;
}

interface UserSubscriptionExistsRow {
  id: string;
}

interface PendingEducationSubscriptionRow {
  id: string;
  plan_name: string;
  amount: string | number;
  billing_period: string;
  trial_period_days: number | null;
  trial_end: string | null;
}

function canManageSubscriptions(req: AuthRequest): boolean {
  return req.user?.role === 'admin' || Boolean(req.user?.permissions?.includes('subscriptions:manage'));
}

async function assertCanReadSubscription(req: AuthRequest, subscriptionId: string): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'Authentication required');
  }

  const subscription = await db.queryOne<SubscriptionOwnershipRow>(
    `SELECT id, user_id
     FROM user_subscriptions
     WHERE id = $1`,
    [subscriptionId],
  );

  if (!subscription) {
    throw new AppError(404, 'Subscription not found');
  }

  if (subscription.user_id === req.user.id || canManageSubscriptions(req)) {
    return;
  }

  throw new AppError(403, 'Subscription does not belong to current user');
}

async function assertEducationPlanEligibility(
  userId: string | undefined,
  plan: { category: string; slug: string },
): Promise<void> {
  if (!isEducationSubscriptionPlan(plan)) return;
  if (!userId) {
    throw new AppError(401, 'Войдите в аккаунт, чтобы оформить образовательный доступ');
  }

  const verifiedAccount = await db.queryOne<EducationEligibilityRow>(
    `SELECT id
     FROM student_accounts
     WHERE user_id = $1
       AND status = 'verified'
       AND (expires_at IS NULL OR expires_at >= NOW())
     LIMIT 1`,
    [userId],
  );

  if (!verifiedAccount) {
    throw new AppError(403, 'Образовательный доступ можно оформить после подтверждения статуса.');
  }
}

async function assertNoDuplicateEducationSubscription(
  userId: string,
  plan: { id: string; category: string; slug: string },
): Promise<void> {
  if (!isEducationSubscriptionPlan(plan)) return;

  const existingSubscription = await db.queryOne<UserSubscriptionExistsRow>(
    `SELECT id
     FROM user_subscriptions
     WHERE user_id = $1
       AND plan_id = $2
       AND status IN ('active', 'paused')
     LIMIT 1`,
    [userId, plan.id],
  );

  if (existingSubscription) {
    throw new AppError(409, 'Образовательный доступ уже оформлен.');
  }
}

async function findReusablePendingEducationSubscription(
  userId: string,
  plan: { id: string; category: string; slug: string },
): Promise<PendingEducationSubscriptionRow | null> {
  if (!isEducationSubscriptionPlan(plan)) return null;

  return db.queryOne<PendingEducationSubscriptionRow>(
    `SELECT us.id,
            sp.name AS plan_name,
            us.monthly_price AS amount,
            sp.billing_period,
            us.trial_period_days,
            us.trial_end
     FROM user_subscriptions us
     JOIN subscription_plans sp ON sp.id = us.plan_id
     WHERE us.user_id = $1
       AND us.plan_id = $2
       AND us.status = 'pending'
       AND us.created_at >= NOW() - INTERVAL '24 hours'
     ORDER BY us.created_at DESC
     LIMIT 1`,
    [userId, plan.id],
  );
}

// ─── PLANS (public) ───────────────────────────────────

router.get('/plans', async (req: Request, res: Response) => {
  const category = req.query['category'] as string | undefined;
  const plans = await getPlans(category);
  res.json({ success: true, plans });
});

router.get('/plans/:id', async (req: Request, res: Response) => {
  const plan = await getPlanById(req.params['id']);
  if (!plan || !isPlanAvailableForSale(plan)) {
    throw new AppError(404, 'Plan not found');
  }
  res.json({ success: true, plan });
});

// ─── PLANS (admin) ────────────────────────────────────

router.post('/plans', authenticateToken, requirePermission('subscriptions:manage'), validate(createPlanSchema), async (req: AuthRequest, res: Response) => {
  const plan = await createPlan(req.body);
  res.status(201).json({ success: true, plan });
});

// ─── CALCULATE ────────────────────────────────────────

router.post('/calculate', validate(calculatePackageSchema), async () => {
  throw new AppError(400, 'Custom subscriptions are temporarily unavailable');
});

// ─── INIT (create pending subscription before payment) ─

router.post('/init', optionalAuth, validate(initSubscriptionSchema), async (req: AuthRequest, res: Response) => {
  const { phone, plan_id } = req.body;

  const cleanPhone = normalizePhone(phone);

  if (!plan_id) {
    throw new AppError(400, 'Custom subscriptions are temporarily unavailable');
  }

  const plan = await getPlanById(plan_id);
  if (!plan || !isPlanAvailableForSale(plan)) throw new AppError(404, 'Plan not found');
  await assertEducationPlanEligibility(req.user?.id, plan);
  if (req.user?.id) {
    await assertNoDuplicateEducationSubscription(req.user.id, plan);
  }

  const subscription = await initSubscription({
    user_id: req.user?.id,
    phone: cleanPhone,
    customer_name: req.body.customer_name,
    email: req.body.email,
    plan_id,
    custom_items: [],
    monthly_price: plan.base_price,
    promo_code: req.body.promo_code,
  });

  res.status(201).json({
    success: true,
    subscription_id: subscription.id,
    monthly_price: plan.base_price,
    trial_period_days: subscription.trial_period_days,
    trial_end: subscription.trial_end,
  });
});

// ─── PURCHASE (client-facing: JWT user buys a plan → init pending subscription) ─

router.post('/purchase', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { plan_id } = req.body;
  if (!plan_id) {
    throw new AppError(400, 'plan_id is required');
  }

  const plan = await getPlanById(plan_id);
  if (!plan || !isPlanAvailableForSale(plan)) {
    throw new AppError(404, 'Plan not found or inactive');
  }
  await assertEducationPlanEligibility(req.user!.id, plan);

  const existing = isEducationSubscriptionPlan(plan)
    ? null
    : await getActiveSubscription(req.user!.id);
  if (existing) {
    throw new AppError(409, 'У вас уже есть активная подписка. Отмените текущую перед оформлением новой.');
  }
  await assertNoDuplicateEducationSubscription(req.user!.id, plan);

  const user = await db.queryOne<Pick<Users, 'phone' | 'email' | 'display_name'>>(
    'SELECT phone, email, display_name FROM users WHERE id = $1',
    [req.user!.id],
  );

  if (!user?.phone) {
    throw new AppError(400, 'Для оформления подписки нужен номер телефона в профиле');
  }

  const cleanUserPhone = normalizePhone(user.phone);
  const pendingEducationSubscription = await findReusablePendingEducationSubscription(
    req.user!.id,
    plan,
  );
  if (pendingEducationSubscription) {
    res.status(200).json({
      success: true,
      subscription_id: pendingEducationSubscription.id,
      plan_name: pendingEducationSubscription.plan_name,
      amount: Number(pendingEducationSubscription.amount),
      billing_period: pendingEducationSubscription.billing_period,
      phone: cleanUserPhone,
      email: user.email,
      trial_period_days: pendingEducationSubscription.trial_period_days,
      trial_end: pendingEducationSubscription.trial_end,
    });
    return;
  }

  const subscription = await initSubscription({
    user_id: req.user!.id,
    phone: cleanUserPhone,
    customer_name: user.display_name || undefined,
    email: user.email || undefined,
    plan_id,
    monthly_price: plan.base_price,
    promo_code: req.body.promo_code,
  });

  res.status(201).json({
    success: true,
    subscription_id: subscription.id,
    plan_name: plan.name,
    amount: plan.base_price,
    billing_period: plan.billing_period,
    phone: cleanUserPhone,
    email: user.email,
    trial_period_days: subscription.trial_period_days,
    trial_end: subscription.trial_end,
  });
});

// ─── TRIAL INFO (public: get trial details by promo code) ─

router.get('/trial-info/:code', async (req: Request, res: Response) => {
  const code = (req.params['code'] || '').trim();
  if (!code) throw new AppError(400, 'Промокод не указан');

  const giftPromo = await getGiftSubscriptionPromoInfo(code);
  if (giftPromo) {
    res.json({
      success: true,
      redeem_mode: 'gift_subscription',
      trial_days: giftPromo.trial_days,
      plan_id: giftPromo.plan_id,
      plan_name: giftPromo.plan_name,
      starts_at: null,
      ends_at: giftPromo.expires_at,
      plans: [{
        id: giftPromo.plan_id,
        name: giftPromo.plan_name,
        slug: null,
        base_price: 0,
        category: 'doc-print',
        icon: 'card_giftcard',
      }],
    });
    return;
  }

  const promo = await db.queryOne<TrialPromoRow>(
    `SELECT id, trial_days, starts_at, ends_at, is_active, usage_limit, usage_count FROM promotions WHERE UPPER(promo_code) = UPPER($1)`, [code]);
  if (!promo || promo.trial_days <= 0 || !promo.is_active) {
    throw new AppError(404, 'Промокод не найден или не предоставляет пробный период');
  }
  if (promo.usage_limit && promo.usage_count >= promo.usage_limit) {
    throw new AppError(404, 'Промокод не найден или не предоставляет пробный период');
  }

  const plans = await getPlans();
  res.json({
    success: true,
    trial_days: promo.trial_days,
    starts_at: promo.starts_at,
    ends_at: promo.ends_at,
    plans: plans.map(p => ({ id: p.id, name: p.name, slug: p.slug, base_price: p.base_price, category: p.category, icon: p.icon })),
  });
});

// ─── GIFT PROMO: admin sends one-month personal subscription code ─

router.post(
  '/gift-promos',
  authenticateToken,
  requirePermission('subscriptions:manage'),
  validate(createGiftSubscriptionPromoSchema),
  async (req: AuthRequest, res: Response) => {
    const { plan_id, chat_session_id, expires_in_days } = req.body;
    const employeeId = req.user?.id;
    if (!employeeId) {
      throw new AppError(401, 'Authentication required');
    }

    const plan = await getPlanById(plan_id);
    if (!plan || !isPlanAvailableForSale(plan)) throw new AppError(404, 'Plan not found');
    if (isEducationSubscriptionPlan(plan)) {
      throw new AppError(400, 'Образовательный доступ нельзя подарить промокодом.');
    }

    const gift = await createGiftSubscriptionPromo({
      plan_id,
      employee_id: employeeId,
      expires_in_days,
    });

    const categoryLabels: Record<string, string> = {
      'doc-print': 'Печать документов A4',
      'photo-print': 'Печать фотографий',
    };
    const categoryLabel = categoryLabels[plan.category] || plan.category;
    const benefitLines = buildGiftSubscriptionBenefitLines(plan);
    const content = [
      buildGiftSubscriptionTitle(plan),
      '',
      categoryLabel,
      ...benefitLines,
      '',
      `Промокод: ${gift.promo_code}`,
      `Активировать подарок: ${gift.redeem_url}`,
      gift.expires_at ? `Код действует до ${new Date(gift.expires_at).toLocaleDateString('ru-RU')}` : '',
    ].filter(Boolean).join('\n');

    const msgRow = await db.queryOne<InsertedMessage>(
      `INSERT INTO messages
         (conversation_id, sender_type, sender_name, message_type, content)
       VALUES ($1, 'bot', 'Своё Фото', 'text', $2)
       RETURNING id`,
      [chat_session_id, content],
    );

    await db.query(
      `UPDATE conversations
       SET last_message_content = $1, last_message_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [content, chat_session_id],
    );

    const socketServer = getSocketServer(req.app);
    if (socketServer) {
      const msgPayload = {
        sessionId: chat_session_id,
        content,
        senderName: 'Своё Фото',
        senderType: 'bot',
        messageType: 'text',
        timestamp: new Date(),
      };
      socketServer.getIO().to(`visitor:${chat_session_id}`).emit('operator:message', msgPayload);
      await broadcastChatMessage({ sessionId: chat_session_id, message: msgPayload });
    }

    const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
      `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
      [chat_session_id],
    );
    if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
      await enqueueOutbound({
        channel: conv.channel,
        externalChatId: conv.external_chat_id,
        content,
        messageType: 'text',
        conversationId: chat_session_id,
      });
    }

    res.status(201).json({
      success: true,
      promo_code: gift.promo_code,
      redeem_url: gift.redeem_url,
      expires_at: gift.expires_at,
      plan_id: gift.plan_id,
      plan_name: gift.plan_name,
      message_id: msgRow?.id ?? null,
    });
  },
);

// ─── GIFT PROMO: customer redeems personal subscription code ─

router.post(
  '/redeem-gift',
  optionalAuth,
  validate(redeemGiftSubscriptionPromoSchema),
  async (req: AuthRequest, res: Response) => {
    // Legacy single-shot redeem — superseded by account-first gift-activation.
    // Disabled by default; keep behind ENABLE_LEGACY_REDEEM_GIFT for rollback.
    if (!config.featureFlags.legacyRedeemGiftEnabled) {
      throw new AppError(
        410,
        'Этот способ активации подарка устарел. Используйте новую активацию подписки.',
        ErrorCode.ACTIVATION_DISABLED,
      );
    }
    const phone = req.body.phone ? normalizePhone(req.body.phone) : undefined;
    const subscription = await redeemGiftSubscriptionPromo({
      promo_code: req.body.promo_code,
      user_id: req.user?.id,
      phone,
      customer_name: req.body.customer_name,
      email: req.body.email,
    });

    res.status(201).json({ success: true, subscription });
  },
);

// ─── SUBSCRIBE (legacy, for POS/admin direct creation) ─

router.post('/subscribe', optionalAuth, async (req: AuthRequest, res: Response) => {
  const { phone, plan_id } = req.body;
  if (!phone || !plan_id) {
    throw new AppError(400, 'phone and plan_id are required');
  }
  const plan = await getPlanById(plan_id);
  if (!plan || !isPlanAvailableForSale(plan)) throw new AppError(404, 'Plan not found');
  if (isEducationSubscriptionPlan(plan)) {
    throw new AppError(400, 'Образовательный доступ оформляется клиентом после проверки статуса.');
  }

  const subscription = await subscribe({
    ...req.body,
    plan_id,
    custom_items: [],
    monthly_price: plan.base_price,
  });
  res.status(201).json({ success: true, subscription });
});

// ─── MANAGE ───────────────────────────────────────────

router.post('/:id/pause', authenticateToken, requirePermission('subscriptions:manage'), async (req: AuthRequest, res: Response) => {
  const until = req.body.until ? new Date(req.body.until) : undefined;
  const sub = await pauseSubscription(req.params['id'], until);
  if (!sub) {
    throw new AppError(404, 'Active subscription not found');
  }
  res.json({ success: true, subscription: sub });
});

router.post('/:id/resume', authenticateToken, requirePermission('subscriptions:manage'), async (req: AuthRequest, res: Response) => {
  const sub = await resumeSubscription(req.params['id']);
  if (!sub) {
    throw new AppError(404, 'Paused subscription not found');
  }
  res.json({ success: true, subscription: sub });
});

router.post('/:id/cancel', authenticateToken, async (req: AuthRequest, res: Response) => {
  // Отменить может владелец своей подписки ИЛИ сотрудник с правом управления (проверка владения = защита от IDOR).
  // Остановка рекуррента CloudPayments выполняется в cancelSubscription (логика — в бэкенде).
  await assertCanReadSubscription(req, req.params['id']!);
  const sub = await cancelSubscription(req.params['id'], req.body.reason);
  if (!sub) {
    throw new AppError(404, 'Subscription not found');
  }
  res.json({ success: true, subscription: sub });
});

// ─── CARD CHANGE (self-service смена карты рекуррента) ─
// Владелец подписки (или сотрудник с правами) может привязать новую карту и перевести
// на неё рекуррент CloudPayments без двойного списания. Денежная логика — в subscription.service.

const confirmCardChangeSchema = z.object({
  changeId: z.string().uuid('changeId должен быть UUID'),
});

// Шаг 1: создаёт (или возвращает открытую) операцию смены карты → externalId для виджета.
router.post('/:id/change-card/init', authenticateToken, async (req: AuthRequest, res: Response) => {
  const subscriptionId = req.params['id']!;
  await assertCanReadSubscription(req, subscriptionId);
  const result = await initCardChange(subscriptionId, req.user!.id);
  res.json({ success: true, ...result });
});

// Шаг 2 (после оплаты 1₽ виджетом): подтверждает смену — клон CP-подписки на новую карту + отмена старого рекуррента.
router.post('/:id/change-card/confirm', authenticateToken, async (req: AuthRequest, res: Response) => {
  const subscriptionId = req.params['id']!;
  await assertCanReadSubscription(req, subscriptionId);
  const parsed = confirmCardChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, 'changeId должен быть UUID', 'VALIDATION_ERROR');
  }
  const result = await confirmCardChange(subscriptionId, parsed.data.changeId);
  res.json({ success: true, ...result });
});

// Поллинг статуса операции смены карты.
router.get('/:id/change-card/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  const subscriptionId = req.params['id']!;
  await assertCanReadSubscription(req, subscriptionId);
  const status = await getCardChangeStatus(subscriptionId);
  res.json({ success: true, status });
});

// ─── CREDITS ──────────────────────────────────────────

router.get('/check/:phone', async (req: Request, res: Response) => {
  const sub = await checkSubscription(req.params['phone']);
  if (!sub) {
    res.json({ success: true, subscription: null });
    return;
  }
  const credits = await getCredits(sub.id);
  res.json({ success: true, subscription: sub, credits });
});

/**
 * Lookup подписки по channel + external_user_id.
 * Flow: channel_users.user_id → user_subscriptions.user_id → credits
 * GET /api/subscriptions/check-by-channel?channel=telegram&external_user_id=123456
 */
router.get('/check-by-channel', authenticateToken, requirePermission('pos:use'), async (req: AuthRequest, res: Response) => {
  const channel = req.query['channel'] as string | undefined;
  const externalUserId = req.query['external_user_id'] as string | undefined;

  if (!channel || !externalUserId) {
    throw new AppError(400, 'channel and external_user_id are required');
  }

  // 1. channel_users → user_id
  const userId = await findUserByChannel(channel, externalUserId);
  if (!userId) {
    res.json({ success: true, subscription: null });
    return;
  }

  // 2. user_subscriptions by user_id
  const sub = await checkSubscriptionByUserId(userId);
  if (!sub) {
    res.json({ success: true, subscription: null, user_id: userId });
    return;
  }

  // 3. credits
  const credits = await getCredits(sub.id);
  res.json({ success: true, subscription: sub, credits, user_id: userId });
});

router.post('/use-credits', authenticateToken, requirePermission('pos:use'), async (req: AuthRequest, res: Response) => {
  const { subscription_id, product_id, quantity } = req.body;
  if (!subscription_id || !product_id || !quantity) {
    throw new AppError(400, 'subscription_id, product_id and quantity are required');
  }
  const result = await useCredits({ subscription_id, product_id, quantity });
  res.json({ success: true, ...result });
});

// ─── MY SUBSCRIPTIONS (client, JWT-aware) ────────────

router.get('/my', authenticateToken, async (req: AuthRequest, res: Response) => {
  const subscriptions = await getMySubscriptions(req.user!.id);
  res.json({ success: true, subscriptions });
});

router.get('/my/credits', authenticateToken, async (req: AuthRequest, res: Response) => {
  const subscriptionId = req.query['subscription_id'] as string;
  if (!subscriptionId) {
    throw new AppError(400, 'subscription_id is required');
  }
  await assertCanReadSubscription(req, subscriptionId);
  const credits = await getCredits(subscriptionId);
  res.json({ success: true, credits });
});

// ─── CREDIT USAGE HISTORY (client, JWT) ─────────────

router.get('/my/credit-history', authenticateToken, async (req: AuthRequest, res: Response) => {
  const sub = await getActiveSubscription(req.user!.id);
  if (!sub) {
    res.json({ success: true, items: [], total: 0, page: 1, limit: 20 });
    return;
  }

  const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string, 10) || 20));
  const offset = (page - 1) * limit;

  const result = await getCreditUsageHistory(sub.id, limit, offset);
  res.json({ success: true, ...result, page, limit });
});

// ─── ACTIVE SUBSCRIPTION (by JWT user) ───────────────

router.get('/active', authenticateToken, async (req: AuthRequest, res: Response) => {
  const sub = await getActiveSubscription(req.user!.id);
  res.json({ success: true, subscription: sub });
});

// ─── SUBSCRIBER DISCOUNT ─────────────────────────────

router.get('/discount', authenticateToken, async (req: AuthRequest, res: Response) => {
  const discount = await getSubscriberDiscount(req.user!.id);
  res.json({ success: true, discount_percent: discount });
});

// ─── MY DISCOUNTS (detailed subscriber benefits) ────

router.get('/my/discounts', authenticateToken, async (req: AuthRequest, res: Response) => {
  const sub = await getActiveSubscription(req.user!.id);
  if (!sub) {
    res.json({ success: true, has_subscription: false, discounts: [] });
    return;
  }

  const plan = sub.plan_id ? await getPlanById(sub.plan_id) : null;
  const discountPercent = plan ? parseFloat(String(plan.subscriber_discount_percent)) : 0;
  const coveredProducts = (plan?.items || []).map(item => ({
    product_id: item.product_id,
    product_name: item.product_name,
  }));

  res.json({
    success: true,
    has_subscription: true,
    plan_name: plan?.name || 'Кастомная подписка',
    discount_percent: discountPercent,
    covered_products: coveredProducts,
    volume_discount: discountPercent > 0 ? {
      percent: discountPercent,
      description: `Подписка снижает цену на объемную печать на ${discountPercent}% для услуг плана`,
    } : null,
    discounts: [
      ...(discountPercent > 0 ? [{
        type: 'volume_percent',
        value: discountPercent,
        description: `Скидка ${discountPercent}% на объемную печать по подписке`,
      }] : []),
      ...coveredProducts.map(c => ({
        type: 'covered_product',
        value: 1,
        description: `${c.product_name}: цена ниже по подписке`,
        product_id: c.product_id,
      })),
    ],
  });
});

// ─── MY CANCEL (client cancels own subscription) ────

router.post('/my/cancel', authenticateToken, async (req: AuthRequest, res: Response) => {
  const sub = await getActiveSubscription(req.user!.id);
  if (!sub) {
    throw new AppError(404, 'У вас нет активной подписки');
  }

  // Остановка рекуррента CloudPayments выполняется внутри cancelSubscription (логика в бэкенде).
  const cancelled = await cancelSubscription(sub.id, req.body.reason || 'Отменено клиентом');
  if (!cancelled) {
    throw new AppError(409, 'Не удалось отменить подписку');
  }

  res.json({ success: true, subscription: cancelled });
});

// ─── PROVISION CREDITS (admin: start new billing period) ─

router.post('/:id/provision', authenticateToken, requirePermission('subscriptions:manage'), async (req: AuthRequest, res: Response) => {
  const credits = await provisionCredits(req.params['id']);
  res.json({ success: true, credits });
});

// ─── ROLLOVER CREDITS (admin) ────────────────────────

router.post('/:id/rollover', authenticateToken, requirePermission('subscriptions:manage'), async (req: AuthRequest, res: Response) => {
  await rolloverCredits(req.params['id']);
  res.json({ success: true });
});

// ─── CREDIT USAGE HISTORY (CRM/admin) ───────────────

router.get('/:id/credit-history', authenticateToken, requirePermission('subscriptions:manage'), async (req: AuthRequest, res: Response) => {
  const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string, 10) || 20));
  const offset = (page - 1) * limit;

  const result = await getCreditUsageHistory(req.params['id'], limit, offset);
  res.json({ success: true, ...result, page, limit });
});

// ─── AVAILABLE CREDITS (summary per product) ─────────

router.get('/:id/credits/available', authenticateToken, async (req: AuthRequest, res: Response) => {
  await assertCanReadSubscription(req, req.params['id']);
  const credits = await getAvailableCredits(req.params['id']);
  res.json({ success: true, credits });
});

// ─── CONSUME CREDITS ─────────────────────────────────

router.post('/credits/consume', authenticateToken, requirePermission('pos:use'), async (req: AuthRequest, res: Response) => {
  const { subscription_id, product_id, quantity } = req.body;
  if (!subscription_id || !product_id || !quantity) {
    throw new AppError(400, 'subscription_id, product_id and quantity are required');
  }
  const result = await consumeCredits(subscription_id, product_id, quantity);
  res.json({ success: true, ...result });
});

// ─── LINK subscription to user account by phone ──────

router.post('/link', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { phone } = req.body;

  if (!phone) {
    throw new AppError(400, 'phone is required');
  }

  const cleanPhone = normalizePhone(phone);
  const sub = await checkSubscription(cleanPhone);

  if (!sub) {
    throw new AppError(404, 'Подписка по этому телефону не найдена');
  }

  if (sub.user_id && sub.user_id !== userId) {
    throw new AppError(409, 'Подписка уже привязана к другому аккаунту');
  }

  // Привязываем подписку к аккаунту
  await db.query(
    'UPDATE user_subscriptions SET user_id = $1 WHERE id = $2',
    [userId, sub.id]
  );

  const subscriptions = await getMySubscriptions(userId);
  res.json({ success: true, subscriptions });
});

// ─── OFFER: send subscription link to customer in chat ─

function fmtNum(v: string | number): string {
  const n = Number(v);
  return Number.isInteger(n)
    ? n.toLocaleString('ru-RU')
    : n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

interface InsertedMessage { id: MessagesId }

type AccountAccessInfoType = SendAccountAccessInfoInput['account_type'];

interface SubscriptionMessagePlanItem {
  product_name?: string | null;
}

interface SubscriptionMessagePlan {
  name: string;
  slug: string;
  subscriber_discount_percent?: string | number | null;
  items?: readonly SubscriptionMessagePlanItem[];
}

function getPlanDiscountPercent(plan: Pick<SubscriptionMessagePlan, 'subscriber_discount_percent'>): number {
  const discount = Number(plan.subscriber_discount_percent ?? 0);
  return Number.isFinite(discount) ? discount : 0;
}

function isPersonalAccountActivationPlan(
  plan: Pick<SubscriptionMessagePlan, 'slug' | 'subscriber_discount_percent'>,
): boolean {
  return plan.slug === PERSONAL_ACCOUNT_PLAN_SLUG && getPlanDiscountPercent(plan) <= 0;
}

function buildAccountAccessInfoMessage(accountType: AccountAccessInfoType): string {
  switch (accountType) {
    case 'personal':
      return [
        '📋 Личная подписка Своё Фото',
        PERSONAL_ACCOUNT_DISCOUNT_TEXT,
        'Подключить: https://svoefoto.ru/subscriptions',
      ].join('\n');

    case 'business':
      return [
        '💼 Бизнес-аккаунт Своё Фото',
        'Документы А4 −40%, фото 10×15 −15%.',
        'Для организаций: реквизиты, сотрудники, счета и закрывающие документы.',
        'Подключить: https://svoefoto.ru/business',
      ].join('\n');

    case 'education':
      return [
        '🎓 Образовательная подписка Своё Фото',
        'Документы А4 −70%, премиум-фото 10×15 −50%.',
        'Для студентов, преподавателей и образовательных организаций после проверки статуса.',
        'Подключить: https://svoefoto.ru/education',
      ].join('\n');
  }
}

async function sendSubscriptionChatMessage(
  req: AuthRequest,
  chatSessionId: string,
  content: string,
): Promise<MessagesId | null> {
  const msgRow = await db.queryOne<InsertedMessage>(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_name, message_type, content)
     VALUES ($1, 'bot', 'Своё Фото', 'text', $2)
     RETURNING id`,
    [chatSessionId, content],
  );

  await db.query(
    `UPDATE conversations
     SET last_message_content = $1, last_message_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [content, chatSessionId],
  );

  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    const msgPayload = {
      sessionId: chatSessionId,
      content,
      senderName: 'Своё Фото',
      senderType: 'bot',
      messageType: 'text',
      timestamp: new Date(),
    };
    socketServer.getIO().to(`visitor:${chatSessionId}`).emit('operator:message', msgPayload);
    await broadcastChatMessage({ sessionId: chatSessionId, message: msgPayload });
  }

  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
    `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
    [chatSessionId],
  );
  if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
    await enqueueOutbound({
      channel: conv.channel,
      externalChatId: conv.external_chat_id,
      content,
      messageType: 'text',
      conversationId: chatSessionId,
    });
  }

  return msgRow?.id ?? null;
}

function buildGiftSubscriptionTitle(plan: SubscriptionMessagePlan): string {
  if (isPersonalAccountActivationPlan(plan)) {
    return '🎁 Вам подарили личную подписку на 1 месяц';
  }
  return `🎁 Вам подарили личную подписку «${plan.name}» на 1 месяц`;
}

function buildGiftSubscriptionBenefitLines(plan: SubscriptionMessagePlan): string[] {
  if (isPersonalAccountActivationPlan(plan)) {
    return [
      `✅ ${PERSONAL_ACCOUNT_DISCOUNT_TEXT}`,
    ];
  }

  const planDiscountPercent = getPlanDiscountPercent(plan);
  const itemLines = (plan.items ?? [])
    .map(item => item.product_name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 4)
    .map(name => `• ${name}`);

  return [
    planDiscountPercent > 0
      ? `✅ Скидка ${fmtNum(planDiscountPercent)}% на печать по подписке`
      : '✅ Цена подписчика в студии',
    ...itemLines,
  ];
}

router.post(
  '/account-access-info',
  authenticateToken,
  requirePermission('subscriptions:manage'),
  validate(sendAccountAccessInfoSchema),
  async (req: AuthRequest, res: Response) => {
    const { account_type, chat_session_id } = req.body as SendAccountAccessInfoInput;
    const content = buildAccountAccessInfoMessage(account_type);
    const messageId = await sendSubscriptionChatMessage(req, chat_session_id, content);

    res.status(201).json({
      success: true,
      account_type,
      message_id: messageId,
    });
  },
);

router.post('/offer', authenticateToken, requirePermission('subscriptions:manage'), async (req: AuthRequest, res: Response) => {
  const { plan_id, chat_session_id } = req.body;
  if (!plan_id || !chat_session_id) {
    throw new AppError(400, 'plan_id and chat_session_id are required');
  }

  // 1. Load plan + items for message text
  const plan = await getPlanById(plan_id);
  if (!plan || !isPlanAvailableForSale(plan)) throw new AppError(404, 'Plan not found');
  if (isEducationSubscriptionPlan(plan)) {
    throw new AppError(400, 'Образовательный доступ оформляется клиентом после проверки статуса.');
  }

  // 2. Create offer
  const offer = await createOffer(plan_id, req.user!.id, chat_session_id);

  const categoryLabels: Record<string, string> = {
    'doc-print': 'Печать документов A4',
    'photo-print': 'Печать фотографий',
  };
  const categoryLabel = categoryLabels[plan.category] || plan.category;

  // 3. Build message text
  const planDiscountPercent = getPlanDiscountPercent(plan);
  const isAccountActivationPlan = isPersonalAccountActivationPlan(plan);
  const itemLines = (plan.items || []).map(
    (item) => `\u2022 ${item.product_name}`,
  );
  const discountLine = `\u2705 Скидка ${planDiscountPercent}% на объемную печать`;
  const subscribeUrl = `https://svoefoto.ru/subscribe/${offer.token}`;
  const content = isAccountActivationPlan
    ? [
        '\uD83D\uDCCB Личная подписка Своё Фото',
        PERSONAL_ACCOUNT_DISCOUNT_TEXT,
        `Оформить за ${fmtNum(offer.monthly_price)} \u20BD/мес: ${subscribeUrl}`,
      ].join('\n')
    : [
        `\uD83D\uDCCB Подписка \u00AB${plan.name}\u00BB \u2014 ${categoryLabel}`,
        '',
        `\uD83D\uDCB0 ${fmtNum(offer.monthly_price)} \u20BD/мес`,
        '',
        'Что дешевле по подписке:',
        ...itemLines,
        '',
        discountLine,
        '\u2705 Без фиксированных кредитов: оплачиваете фактический объем дешевле',
        '',
        `Оформить: ${subscribeUrl}`,
      ].join('\n');

  // 4. Insert bot message into conversation
  const msgRow = await db.queryOne<InsertedMessage>(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_name, message_type, content)
     VALUES ($1, 'bot', 'Своё Фото', 'text', $2)
     RETURNING id`,
    [chat_session_id, content],
  );

  // 5. Link message to offer
  if (msgRow) {
    await updateOfferMessageId(offer.id, msgRow.id);
  }

  // 6. Update conversation last_message
  await db.query(
    `UPDATE conversations
     SET last_message_content = $1, last_message_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [content, chat_session_id],
  );

  // 7. Socket.IO emit to visitor + admin rooms
  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    const msgPayload = {
      sessionId: chat_session_id,
      content,
      senderName: 'Своё Фото',
      senderType: 'bot',
      messageType: 'text',
      timestamp: new Date(),
    };
    socketServer.getIO().to(`visitor:${chat_session_id}`).emit('operator:message', msgPayload);
    await broadcastChatMessage({ sessionId: chat_session_id, message: msgPayload });
  }

  // 8. If external channel — enqueue outbound delivery
  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
    `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
    [chat_session_id],
  );
  if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
    await enqueueOutbound({
      channel: conv.channel,
      externalChatId: conv.external_chat_id,
      content,
      messageType: 'text',
      conversationId: chat_session_id,
    });
  }

  res.status(201).json({ success: true, offer_id: offer.id, token: offer.token });
});

// ─── OFFER: public landing — get offer details by token ─

router.get('/offer/:token', async (req: Request, res: Response) => {
  const offer = await getOfferByToken(req.params['token']);
  if (!offer) {
    throw new AppError(404, 'Предложение не найдено, истекло или уже использовано');
  }

  // Mark opened (idempotent, only changes 'sent' to 'opened')
  await markOfferOpened(req.params['token']);

  // Get employee name for personalized greeting
  const employee = await db.queryOne<Pick<Users, 'display_name'>>(
    `SELECT display_name FROM users WHERE id = $1`,
    [offer.employee_id],
  );

  res.json({
    success: true,
    offer: {
      plan: {
        id: offer.plan_id,
        name: offer.plan_name,
        description: offer.plan_description,
        base_price: Number(offer.monthly_price),
        billing_period: 'monthly',
        subscriber_discount_percent: parseFloat(String(offer.subscriber_discount_percent)),
        credits_rollover_months: 0,
        features: offer.plan_features || [],
        items: (offer.items || []).map(item => ({
          product_id: item.product_id,
          product_name: item.product_name,
          included_quantity: Number(item.included_quantity),
        })),
      },
      monthly_price: Number(offer.monthly_price),
      expires_at: offer.expires_at,
      employee_name: employee?.display_name || null,
    },
  });
});

// ─── OFFER: accept — customer accepts the subscription offer ─

router.post('/offer/:token/accept', optionalAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id || undefined;

  const result = await acceptOffer(req.params['token'], userId);

  res.json({
    success: true,
    subscription_id: result.subscription_id,
    monthly_price: result.monthly_price,
    plan_name: result.plan_name,
  });
});

export default router;
