/** View types for dashboard statistics — aggregate DTOs. */

// ── Booking Stats ──────────────────────────────────────────────────────────

export interface DashboardBookingStats {
  total_bookings: string;
  pending_bookings: string;
  confirmed_bookings: string;
  completed_bookings: string;
  cancelled_bookings: string;
  upcoming_bookings: string;
  today_bookings: string;
}

export interface DashboardAdminBookingStats {
  total_bookings: string;
  pending: string;
  confirmed: string;
  completed: string;
  cancelled: string;
  new_bookings_last_month: string;
  total_revenue: string;
  monthly_revenue: string;
}

export interface RecentAdminBooking {
  id: string;
  booking_date: string;
  start_time: string;
  status: string;
  client_name: string | null;
  photographer_name: string | null;
}

export interface UpcomingBooking {
  id: string;
  booking_date: string;
  start_time: string;
  status: string;
  client_name: string | null;
  client_avatar: string | null;
}

// ── Revenue Stats ──────────────────────────────────────────────────────────

export interface DashboardRevenueStats {
  total_revenue: string;
  monthly_revenue: string;
  weekly_revenue: string;
}

export interface RevenueChartRow {
  period: string;
  bookings_count: string;
  revenue: string;
}

// ── Photo Stats ────────────────────────────────────────────────────────────

export interface DashboardPhotoStats {
  total_sessions: string;
  pending_sessions: string;
  in_progress_sessions: string;
  completed_sessions: string;
  total_photos: string;
}

export interface DashboardApprovalStats {
  total_approvals: string;
  pending_approvals: string;
  approved_approvals: string;
  rejected_approvals: string;
  changes_requested: string;
}

// ── User Stats ─────────────────────────────────────────────────────────────

export interface DashboardUserStats {
  total_users: string;
  regular_users: string;
  photographers: string;
  admins: string;
  new_users_last_month: string;
}

// ── Order Stats ────────────────────────────────────────────────────────────

export interface DashboardOrderStats {
  total_orders: string;
  pending: string;
  completed: string;
  paid_orders: string;
  total_order_amount: string;
}

// ── Studio Stats ───────────────────────────────────────────────────────────

export interface DashboardStudioStats {
  total_studios: string;
  featured_studios: string;
  average_rating: string;
  total_reviews: string;
}

// ── Photographer ───────────────────────────────────────────────────────────

export interface PhotographerId {
  user_id: string;
}

export interface PhotographerServiceRow {
  id: string;
  photographer_id: string;
  service_type: string;
  service_name: string;
  description: string | null;
  base_price: number;
  duration_hours: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Operator Dashboard Metrics (F69) ──────────────────────────────────────

export interface OrderAggregateRow {
  count: string;
  revenue: string;
  avg_check: string;
}

export interface PosAggregateRow {
  count: string;
  revenue: string;
}

// ── Revenue Attribution (F73) ─────────────────────────────────────────────

export interface RevenueByChannelRow {
  channel: string;
  orders: string;
  revenue: string;
  avg_check: string;
}

export interface PosRevenueByStudioRow {
  studio: string;
  count: string;
  revenue: string;
}
