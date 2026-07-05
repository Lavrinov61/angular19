/** View types for tracking & attribution domain. */

// ── Ad Clicks ────────────────────────────────────────────────────────────

export interface AdClickRow {
  id: number;
  tracking_id: string;
  visitor_id: string | null;
  fingerprint_visitor_id: string | null;
  session_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ad_platform: string | null;
  banner_id: string | null;
  keyword: string | null;
  search_phrase: string | null;
  campaign_id: string | null;
  landing_page: string | null;
  referrer: string | null;
  clicked_at: Date;
}

/** Projection for attribution lookups. */
export type AdClickAttribution = Pick<AdClickRow, 'id' | 'campaign_id' | 'utm_source' | 'ad_platform'>;

/** Projection for session/tracking display. */
export type AdClickSession = Pick<AdClickRow,
  'id' | 'tracking_id' | 'visitor_id' | 'fingerprint_visitor_id' |
  'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term' |
  'ad_platform' | 'landing_page' | 'clicked_at'>;

/** Projection for multi-touch attribution. */
export type AdClickForAttribution = Pick<AdClickRow,
  'id' | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term' |
  'ad_platform' | 'clicked_at'>;

// ── Unified Customers ────────────────────────────────────────────────────

export interface UnifiedCustomerRow {
  id: number;
  fingerprint_visitor_id: string | null;
  telegram_user_id: string | null;
  telegram_username: string | null;
  max_user_id: string | null;
  phone: string | null;
  phone_normalized: string | null;
  bitrix24_contact_id: string | null;
  first_click_id: number | null;
  first_utm_source: string | null;
  first_utm_campaign: string | null;
  last_click_id: number | null;
  last_utm_source: string | null;
  last_utm_campaign: string | null;
  total_revenue: number;
  total_purchases: number;
  status: 'visitor' | 'lead' | 'client';
  created_at: Date;
  updated_at: Date;
}

/** Projection for save-payment lookup. */
export type UnifiedCustomerPaymentLookup = Pick<UnifiedCustomerRow,
  'id' | 'fingerprint_visitor_id' | 'total_revenue' | 'total_purchases' |
  'first_click_id' | 'first_utm_source' | 'first_utm_campaign' | 'status'>;

/** Projection for check-phone. */
export type UnifiedCustomerPhoneLookup = Pick<UnifiedCustomerRow,
  'id' | 'phone' | 'status' | 'bitrix24_contact_id'>;

/** Projection for save-phone merge scenarios. */
export type UnifiedCustomerMergeLookup = Pick<UnifiedCustomerRow,
  'id' | 'telegram_user_id' | 'max_user_id' | 'fingerprint_visitor_id' |
  'total_revenue' | 'total_purchases' | 'status'>;

/** Projection for save-phone result (after update/insert). */
export interface UnifiedCustomerPhoneResult {
  id: number;
  phone: string;
  status: string;
  bitrix24_contact_id: string | null;
  total_revenue: number;
}

/** Projection for link-fingerprint result. */
export interface UnifiedCustomerLinkResult {
  id: number;
  fingerprint_visitor_id: string;
  telegram_user_id: string;
  first_utm_source: string | null;
  first_utm_campaign: string | null;
  status: string;
}

// ── Visitor Sessions ─────────────────────────────────────────────────────

export interface VisitorSessionRow {
  id: string;
  visitor_id: string | null;
  fingerprint_visitor_id: string | null;
  total_clicks: number;
}

export type VisitorSessionLookup = Pick<VisitorSessionRow, 'id' | 'total_clicks'>;

// ── Purchases ────────────────────────────────────────────────────────────

export interface PurchaseInsertResult {
  id: number;
}

// ── Customer Touchpoints ─────────────────────────────────────────────────

export interface TouchpointInsertResult {
  id: number;
}

// ── Conversions ──────────────────────────────────────────────────────────

export interface ConversionInsertResult {
  id: number;
}

// ── Fingerprints ─────────────────────────────────────────────────────────

export interface FingerprintLookup {
  fingerprint_visitor_id: string;
}

// ── Analytics aggregates ─────────────────────────────────────────────────

export interface TrackingStatsRow {
  total_clicks: number;
  unique_visitors: number;
  unique_fingerprints: number;
  sources_count: number;
}

export interface SourceClicksRow {
  source: string;
  clicks: number;
}

export interface CustomerJourneyCustomerRow {
  id: number;
  telegram_user_id: string | null;
  telegram_username: string | null;
  phone: string | null;
  bitrix24_contact_id: string | null;
  status: string;
  total_purchases: number;
  total_revenue: number;
}

export interface CustomerJourneyClickRow {
  tracking_id: string;
  utm_source: string | null;
  utm_campaign: string | null;
  ad_platform: string | null;
  landing_page: string | null;
  clicked_at: string;
}

export interface CustomerJourneyTouchpointRow {
  type: string;
  channel: string | null;
  source: string | null;
  occurred_at: string;
  metadata: unknown;
}

export interface CustomerJourneyPurchaseRow {
  source_id: string | null;
  amount: number;
  purchased_at: string;
  items_count: number;
  attribution_model: string | null;
}

export interface AttributionOverview {
  total_purchases: number;
  attributed_purchases: number;
  total_revenue: number;
  attributed_revenue: number;
}

export interface PlatformAttributionRow {
  ad_platform: string;
  purchases: number;
  revenue: number;
}

export interface FunnelMetrics {
  total: number;
}

export interface FunnelRevenueMetrics {
  total: number;
  revenue: number;
}

export interface TopSourceRow {
  utm_source: string;
  clicks: number;
}

export interface RoiGroupRow {
  group_name: string;
  purchases: number;
  revenue: number;
  cost: number;
}
