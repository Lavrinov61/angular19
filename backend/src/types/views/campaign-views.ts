/** View types for marketing campaigns domain. */

import type CampaignPromoCodes from '../generated/public/CampaignPromoCodes.js';

/** Stats aggregation row from promo_redemptions for a campaign */
export interface CampaignStatsRow {
  redemptions_count: string;
  total_discount: string;
  orders_count: string;
  estimated_revenue: string;
  unique_customers: string;
}

/** Campaign promo code JOIN with promotion details */
export interface CampaignPromoCodeWithPromo extends Pick<CampaignPromoCodes, 'id' | 'promotion_id'> {
  promo_code: string;
  title: string;
}

/** campaign_promo_codes JOIN lookup for redemption tracking */
export interface CampaignLinkLookup {
  campaign_id: string;
}

/** Promotion fields needed for redemption calculation */
export interface PromoRedemptionLookup {
  id: string;
  discount_percent: number | null;
  discount_amount: string | null;
}
