/** View types for review dashboard endpoints — aggregate DTOs and JOIN projections. */

// ── Dashboard Stats (GET /api/reviews/dashboard-stats) ──────────────────────

export interface ReviewRequestStats {
  total: number;
  sent: number;
  clicked: number;
  sent7d: number;
  clicked7d: number;
}

export interface NpsAggregateStats {
  total: number;
  average: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  r5: number;
}

// ── Public Review Stats (GET /api/reviews/stats) ───────────────────────────

export interface ReviewPlatformStatsRow {
  platform: string;
  location_slug: string;
  location_name: string | null;
  rating: string | null;
  review_count: number | null;
  last_synced_at: string | null;
}

// ── Review Requests List (GET /api/reviews/requests) ────────────────────────

export interface ReviewRequestListItem {
  id: string;
  order_id: string | null;
  chat_session_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  channel: string;
  status: string;
  source: string;
  created_at: string | null;
  sent_at: string | null;
  clicked_at: string | null;
  click_platform: string | null;
  nps_rating: number | null;
  error_message: string | null;
  location_slug: string | null;
  review_token: string | null;
  employee_name: string | null;
}

export interface ReviewRequestCountRow {
  total: number;
}

// ── NPS Feed (GET /api/reviews/nps-feed) ────────────────────────────────────

export interface NpsFeedRow {
  id: string;
  client_name: string | null;
  client_phone: string | null;
  nps_rating: number;
  channel: string;
  comment: string | null;
  created_at: string;
  employee_name: string | null;
  click_platform: string | null;
  location_slug: string | null;
}
