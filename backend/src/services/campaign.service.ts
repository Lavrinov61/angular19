import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import type MarketingCampaigns from '../types/generated/public/MarketingCampaigns.js';
import type { MarketingCampaignsId } from '../types/generated/public/MarketingCampaigns.js';
import type CampaignPromoCodes from '../types/generated/public/CampaignPromoCodes.js';
import type PromoRedemptions from '../types/generated/public/PromoRedemptions.js';
import type { PromotionsId } from '../types/generated/public/Promotions.js';
import type Promotions from '../types/generated/public/Promotions.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type {
  CountResult, IdResult,
  CampaignStatsRow, CampaignPromoCodeWithPromo, CampaignLinkLookup,
} from '../types/views/index.js';

// ─── VIEW TYPES ──────────────────────────────────────

/** Campaign row with aggregated promo codes info */
export interface CampaignWithCodes extends MarketingCampaigns {
  promo_codes: CampaignPromoCodeWithPromo[];
  created_by_name: string | null;
}

/** Stats for a single campaign */
export interface CampaignStats {
  redemptions_count: number;
  total_discount: number;
  orders_count: number;
  estimated_revenue: number;
  unique_customers: number;
}

/** Redemption row enriched with promo title */
export interface RedemptionRow extends PromoRedemptions {
  promotion_title: string | null;
}

// ─── FILTERS ─────────────────────────────────────────

export interface CampaignFilters {
  status?: string;
  campaign_type?: string;
  active?: boolean;
  limit?: number;
  offset?: number;
}

// ─── STATUS TRANSITIONS ──────────────────────────────

const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

// ─── SERVICE ─────────────────────────────────────────

export async function getCampaigns(
  filters: CampaignFilters,
): Promise<{ items: MarketingCampaigns[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`mc.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.campaign_type) {
    conditions.push(`mc.campaign_type = $${idx++}`);
    params.push(filters.campaign_type);
  }
  if (filters.active !== undefined) {
    if (filters.active) {
      conditions.push(`mc.status = 'active'`);
    } else {
      conditions.push(`mc.status != 'active'`);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filters.limit || 50, 200);
  const offset = filters.offset || 0;

  const [items, countResult] = await Promise.all([
    db.query<MarketingCampaigns>(
      `SELECT mc.id, mc.name, mc.description, mc.campaign_type, mc.channel,
              mc.status, mc.budget, mc.spent, mc.start_date, mc.end_date,
              mc.utm_source, mc.utm_campaign, mc.utm_medium,
              mc.target_location, mc.target_audience,
              mc.print_quantity, mc.distributed_quantity, mc.notes,
              mc.created_by, mc.created_at, mc.updated_at
       FROM marketing_campaigns mc
       ${where}
       ORDER BY mc.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    ),
    db.queryOne<CountResult>(
      `SELECT COUNT(*) AS count FROM marketing_campaigns mc ${where}`,
      params,
    ),
  ]);

  return { items, total: parseInt(countResult?.count || '0', 10) };
}

export async function getCampaignById(
  id: MarketingCampaignsId,
): Promise<CampaignWithCodes> {
  const campaign = await db.queryOne<CampaignWithCodes>(
    `SELECT mc.*,
            u.display_name AS created_by_name
     FROM marketing_campaigns mc
     LEFT JOIN users u ON mc.created_by = u.id
     WHERE mc.id = $1`,
    [id],
  );
  if (!campaign) throw new AppError(404, 'Кампания не найдена');

  const codes = await db.query<CampaignPromoCodeWithPromo>(
    `SELECT cpc.id, cpc.promotion_id, p.promo_code, p.title
     FROM campaign_promo_codes cpc
     JOIN promotions p ON cpc.promotion_id = p.id
     WHERE cpc.campaign_id = $1`,
    [id],
  );

  campaign.promo_codes = codes;
  return campaign;
}

export async function createCampaign(
  data: {
    name: string;
    description?: string;
    campaign_type: string;
    channel?: string;
    budget?: number;
    start_date?: string;
    end_date?: string;
    utm_source?: string;
    utm_campaign?: string;
    utm_medium?: string;
    target_location?: string;
    target_audience?: string;
    print_quantity?: number;
    notes?: string;
  },
  createdBy: UsersId,
): Promise<MarketingCampaigns> {
  const result = await db.queryOne<MarketingCampaigns>(
    `INSERT INTO marketing_campaigns
       (name, description, campaign_type, channel, budget,
        start_date, end_date, utm_source, utm_campaign, utm_medium,
        target_location, target_audience, print_quantity, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      data.name,
      data.description ?? null,
      data.campaign_type,
      data.channel ?? null,
      data.budget ?? null,
      data.start_date ?? null,
      data.end_date ?? null,
      data.utm_source ?? null,
      data.utm_campaign ?? null,
      data.utm_medium ?? null,
      data.target_location ?? null,
      data.target_audience ?? null,
      data.print_quantity ?? null,
      data.notes ?? null,
      createdBy,
    ],
  );
  if (!result) throw new AppError(500, 'Не удалось создать кампанию');
  return result;
}

export async function updateCampaign(
  id: MarketingCampaignsId,
  fields: Record<string, unknown>,
): Promise<MarketingCampaigns> {
  const allowed = [
    'name', 'description', 'campaign_type', 'channel', 'budget',
    'start_date', 'end_date', 'utm_source', 'utm_campaign', 'utm_medium',
    'target_location', 'target_audience', 'print_quantity', 'distributed_quantity',
    'notes', 'spent',
  ];

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = $${idx++}`);
      values.push(fields[key]);
    }
  }

  if (sets.length === 0) throw new AppError(400, 'Нет полей для обновления');

  values.push(id);

  const result = await db.queryOne<MarketingCampaigns>(
    `UPDATE marketing_campaigns SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  if (!result) throw new AppError(404, 'Кампания не найдена');
  return result;
}

export async function updateCampaignStatus(
  id: MarketingCampaignsId,
  newStatus: string,
): Promise<MarketingCampaigns> {
  const campaign = await db.queryOne<Pick<MarketingCampaigns, 'id' | 'status'>>(
    `SELECT id, status FROM marketing_campaigns WHERE id = $1`,
    [id],
  );
  if (!campaign) throw new AppError(404, 'Кампания не найдена');

  const currentStatus = campaign.status || 'draft';
  const allowedTransitions = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];
  if (!allowedTransitions.includes(newStatus)) {
    throw new AppError(
      422,
      `Нельзя перевести кампанию из "${currentStatus}" в "${newStatus}". Допустимо: ${allowedTransitions.join(', ') || 'нет переходов'}`,
    );
  }

  const result = await db.queryOne<MarketingCampaigns>(
    `UPDATE marketing_campaigns SET status = $2 WHERE id = $1 RETURNING *`,
    [id, newStatus],
  );
  return result!;
}

export async function linkPromoCode(
  campaignId: MarketingCampaignsId,
  promotionId: PromotionsId,
): Promise<CampaignPromoCodes> {
  // Verify campaign exists
  const campaign = await db.queryOne<Pick<MarketingCampaigns, 'id'>>(
    `SELECT id FROM marketing_campaigns WHERE id = $1`,
    [campaignId],
  );
  if (!campaign) throw new AppError(404, 'Кампания не найдена');

  // Verify promotion exists
  const promo = await db.queryOne<Pick<Promotions, 'id'>>(
    `SELECT id FROM promotions WHERE id = $1`,
    [promotionId],
  );
  if (!promo) throw new AppError(404, 'Промоакция не найдена');

  try {
    const result = await db.queryOne<CampaignPromoCodes>(
      `INSERT INTO campaign_promo_codes (campaign_id, promotion_id)
       VALUES ($1, $2)
       RETURNING *`,
      [campaignId, promotionId],
    );
    return result!;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('duplicate key') || msg.includes('idx_cpc_campaign_promotion')) {
      throw new AppError(409, 'Этот промокод уже привязан к кампании');
    }
    throw error;
  }
}

export async function unlinkPromoCode(
  campaignId: MarketingCampaignsId,
  promotionId: PromotionsId,
): Promise<void> {
  const deleted = await db.queryOne<IdResult>(
    `DELETE FROM campaign_promo_codes
     WHERE campaign_id = $1 AND promotion_id = $2
     RETURNING id`,
    [campaignId, promotionId],
  );
  if (!deleted) throw new AppError(404, 'Связь промокода с кампанией не найдена');
}

export async function getCampaignStats(
  id: MarketingCampaignsId,
): Promise<CampaignStats> {
  // Verify campaign exists
  const campaign = await db.queryOne<Pick<MarketingCampaigns, 'id'>>(
    `SELECT id FROM marketing_campaigns WHERE id = $1`,
    [id],
  );
  if (!campaign) throw new AppError(404, 'Кампания не найдена');

  const stats = await db.queryOne<CampaignStatsRow>(
    `SELECT
       COUNT(*)::text AS redemptions_count,
       COALESCE(SUM(pr.discount_amount), 0)::text AS total_discount,
       COUNT(DISTINCT pr.order_id) FILTER (WHERE pr.order_id IS NOT NULL)::text AS orders_count,
       COALESCE(SUM(pr.original_amount) FILTER (WHERE pr.original_amount IS NOT NULL), 0)::text AS estimated_revenue,
       COUNT(DISTINCT COALESCE(pr.customer_id::text, pr.customer_phone))::text AS unique_customers
     FROM promo_redemptions pr
     WHERE pr.campaign_id = $1 AND pr.status = 'applied'`,
    [id],
  );

  return {
    redemptions_count: parseInt(stats?.redemptions_count || '0', 10),
    total_discount: parseFloat(stats?.total_discount || '0'),
    orders_count: parseInt(stats?.orders_count || '0', 10),
    estimated_revenue: parseFloat(stats?.estimated_revenue || '0'),
    unique_customers: parseInt(stats?.unique_customers || '0', 10),
  };
}

export async function getCampaignRedemptions(
  campaignId: MarketingCampaignsId,
  filters: { limit?: number; offset?: number },
): Promise<{ items: RedemptionRow[]; total: number }> {
  // Verify campaign exists
  const campaign = await db.queryOne<Pick<MarketingCampaigns, 'id'>>(
    `SELECT id FROM marketing_campaigns WHERE id = $1`,
    [campaignId],
  );
  if (!campaign) throw new AppError(404, 'Кампания не найдена');

  const limit = Math.min(filters.limit || 50, 200);
  const offset = filters.offset || 0;

  const [items, countResult] = await Promise.all([
    db.query<RedemptionRow>(
      `SELECT pr.*, p.title AS promotion_title
       FROM promo_redemptions pr
       LEFT JOIN promotions p ON pr.promotion_id = p.id
       WHERE pr.campaign_id = $1
       ORDER BY pr.redeemed_at DESC
       LIMIT $2 OFFSET $3`,
      [campaignId, limit, offset],
    ),
    db.queryOne<CountResult>(
      `SELECT COUNT(*) AS count FROM promo_redemptions WHERE campaign_id = $1`,
      [campaignId],
    ),
  ]);

  return { items, total: parseInt(countResult?.count || '0', 10) };
}

/**
 * Record a promo code redemption.
 * Called when a promo code is applied in an order (orders.routes, pricing-engine, POS).
 */
export async function recordRedemption(data: {
  promotion_id: string;
  promo_code: string;
  discount_amount: number;
  original_amount?: number;
  order_id?: string;
  order_type?: string;
  customer_id?: string;
  customer_phone?: string;
}): Promise<void> {
  // Find linked campaign (if any) for this promotion
  const link = await db.queryOne<CampaignLinkLookup>(
    `SELECT cpc.campaign_id
     FROM campaign_promo_codes cpc
     JOIN marketing_campaigns mc ON cpc.campaign_id = mc.id
     WHERE cpc.promotion_id = $1 AND mc.status = 'active'
     LIMIT 1`,
    [data.promotion_id],
  );

  await db.query(
    `INSERT INTO promo_redemptions
       (promotion_id, campaign_id, order_id, order_type,
        customer_id, customer_phone, promo_code,
        discount_amount, original_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      data.promotion_id,
      link?.campaign_id ?? null,
      data.order_id ?? null,
      data.order_type ?? null,
      data.customer_id ?? null,
      data.customer_phone ?? null,
      data.promo_code,
      data.discount_amount,
      data.original_amount ?? null,
    ],
  );

  // Update campaign spent if linked
  if (link?.campaign_id) {
    await db.query(
      `UPDATE marketing_campaigns
       SET spent = COALESCE(spent, 0) + $2
       WHERE id = $1`,
      [link.campaign_id, data.discount_amount],
    );
  }
}
