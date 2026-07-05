/**
 * Unified loyalty routes — JWT (client + admin) + Telegram auth.
 *
 * Replaces both old loyalty.routes.ts (TG only) and app-loyalty.routes.ts (JWT only).
 */
import { Router, Request, Response } from 'express';
import { authenticateToken, requirePermission, requireUser, AuthRequest } from '../middleware/auth.js';
import { requireTelegramAuth, type TelegramUser } from '../middleware/telegramAuth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  getTransactionsQuery,
  getBenefitSummaryQuery,
  applyReferralBody,
  cashbackSelectionBody,
  adminAdjustBody,
  adminProfilesQuery,
  adminProfileIdParam,
} from '../schemas/loyalty.schemas.js';
import * as loyaltyService from '../services/loyalty.service.js';

const router = Router();

// ============================================================================
// Helper: typed TG request
// ============================================================================

type TgRequest = Request & { telegramUser: TelegramUser };

// ============================================================================
// Client routes (JWT auth) — /api/loyalty/*
// ============================================================================

const clientRouter = Router();
clientRouter.use(authenticateToken);

/**
 * GET /api/loyalty/profile
 */
clientRouter.get('/profile', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const result = await loyaltyService.getOrCreateByUserId(req.user.id);
  res.json({ success: true, data: result });
});

/**
 * POST /api/loyalty/daily-claim
 */
clientRouter.post('/daily-claim', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const { profile } = await loyaltyService.getOrCreateByUserId(req.user.id);
  const result = await loyaltyService.claimDailyReward(profile.id);

  if (!result) {
    res.json({ success: false, error: 'already_claimed', message: 'Ежедневный бонус уже получен сегодня' });
    return;
  }

  res.json({ success: true, data: result });
});

/**
 * GET /api/loyalty/transactions
 */
clientRouter.get('/transactions', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const parsed = getTransactionsQuery.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'Invalid query parameters', 'VALIDATION_ERROR');

  const { profile } = await loyaltyService.getOrCreateByUserId(req.user.id);
  const transactions = await loyaltyService.getTransactions(profile.id, parsed.data.limit, parsed.data.offset);
  res.json({ success: true, data: { transactions } });
});

/**
 * GET /api/loyalty/benefit-summary
 */
clientRouter.get('/benefit-summary', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const parsed = getBenefitSummaryQuery.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'Invalid query parameters', 'VALIDATION_ERROR');

  const { profile } = await loyaltyService.getOrCreateByUserId(req.user.id);
  const summary = await loyaltyService.getBenefitSummary(profile.id, parsed.data.months);
  res.json({ success: true, data: summary });
});

/**
 * GET /api/loyalty/cashback
 */
clientRouter.get('/cashback', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const { profile } = await loyaltyService.getOrCreateByUserId(req.user.id);
  const state = await loyaltyService.getCashbackState(profile.id);
  res.json({ success: true, data: state });
});

/**
 * POST /api/loyalty/cashback/selection
 */
clientRouter.post('/cashback/selection', validate(cashbackSelectionBody), async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const { categoryKey } = cashbackSelectionBody.parse(req.body);
  const { profile } = await loyaltyService.getOrCreateByUserId(req.user.id);
  const state = await loyaltyService.selectCashbackCategory(profile.id, categoryKey);
  res.json({ success: true, data: state });
});

/**
 * POST /api/loyalty/referral/apply
 */
clientRouter.post('/referral/apply', validate(applyReferralBody), async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const { code } = applyReferralBody.parse(req.body);
  const { profile } = await loyaltyService.getOrCreateByUserId(req.user.id);
  const result = await loyaltyService.applyReferralCode(profile.id, code);

  if (!result.success) {
    res.json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, data: { pointsAwarded: result.pointsAwarded } });
});

/**
 * GET /api/loyalty/referral/stats
 */
clientRouter.get('/referral/stats', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const profile = await loyaltyService.findProfile({ userId: req.user.id });

  if (!profile) {
    res.json({ success: true, data: { referralCode: null, invitedCount: 0 } });
    return;
  }

  res.json({
    success: true,
    data: {
      referralCode: profile.referralCode,
      invitedCount: profile.invitedCount,
    },
  });
});

// ============================================================================
// Telegram routes — /api/loyalty/tg/*
// ============================================================================

const tgRouter = Router();
tgRouter.use(requireTelegramAuth);

/**
 * GET /api/loyalty/tg/profile
 */
tgRouter.get('/profile', async (req: Request, res: Response) => {
  const tgUser = (req as TgRequest).telegramUser;
  const result = await loyaltyService.getOrCreateByTelegram(tgUser);
  res.json({ success: true, data: result });
});

/**
 * POST /api/loyalty/tg/daily-claim
 */
tgRouter.post('/daily-claim', async (req: Request, res: Response) => {
  const tgUser = (req as TgRequest).telegramUser;
  const { profile } = await loyaltyService.getOrCreateByTelegram(tgUser);
  const result = await loyaltyService.claimDailyReward(profile.id);

  if (!result) {
    res.json({ success: false, error: 'already_claimed', message: 'Ежедневный бонус уже получен сегодня' });
    return;
  }

  res.json({ success: true, data: result });
});

/**
 * GET /api/loyalty/tg/transactions
 */
tgRouter.get('/transactions', async (req: Request, res: Response) => {
  const tgUser = (req as TgRequest).telegramUser;
  const parsed = getTransactionsQuery.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'Invalid query parameters', 'VALIDATION_ERROR');

  const { profile } = await loyaltyService.getOrCreateByTelegram(tgUser);
  const transactions = await loyaltyService.getTransactions(profile.id, parsed.data.limit, parsed.data.offset);
  res.json({ success: true, data: { transactions } });
});

/**
 * POST /api/loyalty/tg/referral/apply
 */
tgRouter.post('/referral/apply', validate(applyReferralBody), async (req: Request, res: Response) => {
  const tgUser = (req as TgRequest).telegramUser;
  const { code } = applyReferralBody.parse(req.body);
  const { profile } = await loyaltyService.getOrCreateByTelegram(tgUser);
  const result = await loyaltyService.applyReferralCode(profile.id, code);

  if (!result.success) {
    res.json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, data: { pointsAwarded: result.pointsAwarded } });
});

/**
 * GET /api/loyalty/tg/orders
 */
tgRouter.get('/orders', async (req: Request, res: Response) => {
  const tgUser = (req as TgRequest).telegramUser;
  const orders = await loyaltyService.getOrdersForTelegramUser(tgUser.id);
  res.json({ success: true, data: orders });
});

// ============================================================================
// Admin routes — /api/loyalty/admin/*
// ============================================================================

const adminRouter = Router();
adminRouter.use(authenticateToken, requirePermission('analytics:view'));

/**
 * GET /api/loyalty/admin/stats
 */
adminRouter.get('/stats', async (_req: Request, res: Response) => {
  const stats = await loyaltyService.getStats();
  res.json({ success: true, data: stats });
});

/**
 * GET /api/loyalty/admin/profiles
 */
adminRouter.get('/profiles', async (req: Request, res: Response) => {
  const parsed = adminProfilesQuery.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'Invalid query parameters', 'VALIDATION_ERROR');

  const { search, level, limit, offset, sort, order } = parsed.data;
  const result = await loyaltyService.getAllProfiles({
    search,
    level,
    limit,
    offset,
    sortBy: sort === 'total_spent' ? 'total_points_earned' : sort,
    sortDir: order,
  });
  res.json({ success: true, data: result });
});

/**
 * GET /api/loyalty/admin/profiles/:id
 */
adminRouter.get('/profiles/:id', async (req: Request, res: Response) => {
  const parsed = adminProfileIdParam.safeParse(req.params);
  if (!parsed.success) throw new AppError(400, 'Invalid profile ID', 'VALIDATION_ERROR');

  const profile = await loyaltyService.findProfile({ profileId: parsed.data.id });
  if (!profile) throw new AppError(404, 'Loyalty profile not found');

  const transactions = await loyaltyService.getTransactions(profile.id, 50, 0);
  res.json({ success: true, data: { profile, transactions } });
});

/**
 * POST /api/loyalty/admin/profiles/:id/adjust
 */
adminRouter.post('/profiles/:id/adjust', validate(adminAdjustBody), async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const paramParsed = adminProfileIdParam.safeParse(req.params);
  if (!paramParsed.success) throw new AppError(400, 'Invalid profile ID', 'VALIDATION_ERROR');

  const { amount, reason } = adminAdjustBody.parse(req.body);
  const result = await loyaltyService.adjustPoints(
    paramParsed.data.id,
    amount,
    reason,
    req.user.id,
  );
  res.json({ success: true, data: result });
});

// ============================================================================
// Mount sub-routers
// ============================================================================

router.use('/', clientRouter);
router.use('/tg', tgRouter);
router.use('/admin', adminRouter);

export default router;
