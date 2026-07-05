import express, { Response } from 'express';
import { authenticateToken, requirePermission, requireUser, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import type { MarketingCampaignsId } from '../types/generated/public/MarketingCampaigns.js';
import type { PromotionsId } from '../types/generated/public/Promotions.js';
import type { UsersId } from '../types/generated/public/Users.js';
import {
  getCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  updateCampaignStatus,
  linkPromoCode,
  unlinkPromoCode,
  getCampaignStats,
  getCampaignRedemptions,
} from '../services/campaign.service.js';

const router = express.Router();

// All routes require authentication + campaigns:manage permission
router.use(authenticateToken, requirePermission('campaigns:manage'));

// ============================================================================
// GET /api/campaigns — список кампаний с фильтрами
// ============================================================================
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { status, campaign_type, active, limit, offset } = req.query;

  const result = await getCampaigns({
    status: typeof status === 'string' ? status : undefined,
    campaign_type: typeof campaign_type === 'string' ? campaign_type : undefined,
    active: active === 'true' ? true : active === 'false' ? false : undefined,
    limit: limit ? parseInt(String(limit), 10) : undefined,
    offset: offset ? parseInt(String(offset), 10) : undefined,
  });

  res.json({ success: true, campaigns: result.items, total: result.total });
});

// ============================================================================
// GET /api/campaigns/:id — детали кампании + привязанные промокоды
// ============================================================================
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const id = req.params['id'] as MarketingCampaignsId;
  const campaign = await getCampaignById(id);
  const stats = await getCampaignStats(id);

  res.json({ success: true, campaign, stats });
});

// ============================================================================
// POST /api/campaigns — создать кампанию
// ============================================================================
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { name, campaign_type } = req.body;
  if (!name || !campaign_type) {
    throw new AppError(400, 'name и campaign_type обязательны');
  }

  const validTypes = ['flyer', 'email', 'sms', 'social', 'paid_ads', 'partner'];
  if (!validTypes.includes(campaign_type)) {
    throw new AppError(400, `campaign_type должен быть одним из: ${validTypes.join(', ')}`);
  }

  const campaign = await createCampaign(req.body, req.user.id as UsersId);
  res.status(201).json({ success: true, campaign });
});

// ============================================================================
// PUT /api/campaigns/:id — обновить кампанию
// ============================================================================
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const id = req.params['id'] as MarketingCampaignsId;
  const campaign = await updateCampaign(id, req.body);

  res.json({ success: true, campaign });
});

// ============================================================================
// PATCH /api/campaigns/:id/status — сменить статус
// ============================================================================
router.patch('/:id/status', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const id = req.params['id'] as MarketingCampaignsId;
  const { status } = req.body;

  if (!status) throw new AppError(400, 'status обязателен');

  const campaign = await updateCampaignStatus(id, status);
  res.json({ success: true, campaign });
});

// ============================================================================
// POST /api/campaigns/:id/promo-codes — привязать промокод к кампании
// ============================================================================
router.post('/:id/promo-codes', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const campaignId = req.params['id'] as MarketingCampaignsId;
  const { promotion_id } = req.body;

  if (!promotion_id) throw new AppError(400, 'promotion_id обязателен');

  const link = await linkPromoCode(campaignId, promotion_id as PromotionsId);
  res.status(201).json({ success: true, link });
});

// ============================================================================
// DELETE /api/campaigns/:id/promo-codes/:promotionId — отвязать промокод
// ============================================================================
router.delete('/:id/promo-codes/:promotionId', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const campaignId = req.params['id'] as MarketingCampaignsId;
  const promotionId = req.params['promotionId'] as PromotionsId;

  await unlinkPromoCode(campaignId, promotionId);
  res.json({ success: true });
});

// ============================================================================
// GET /api/campaigns/:id/redemptions — список использований промокодов
// ============================================================================
router.get('/:id/redemptions', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const campaignId = req.params['id'] as MarketingCampaignsId;
  const { limit, offset } = req.query;

  const result = await getCampaignRedemptions(campaignId, {
    limit: limit ? parseInt(String(limit), 10) : undefined,
    offset: offset ? parseInt(String(offset), 10) : undefined,
  });

  res.json({ success: true, redemptions: result.items, total: result.total });
});

// ============================================================================
// GET /api/campaigns/:id/stats — ROI, конверсия, выручка
// ============================================================================
router.get('/:id/stats', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const id = req.params['id'] as MarketingCampaignsId;
  const stats = await getCampaignStats(id);

  res.json({ success: true, stats });
});

export default router;
