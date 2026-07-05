/**
 * Channel Health Monitoring — View types for health aggregation queries.
 */

/** Webhook freshness per channel from webhook_events table */
export interface WebhookFreshnessRow {
  channel: string;
  last_received_at: string | null;
  total_24h: number;
  errors_24h: number;
  error_rate: number;
}

/** Queue health per channel from outbound_queue table */
export interface QueueHealthRow {
  channel: string;
  pending_count: number;
  failed_count: number;
  dead_letter_count: number;
  oldest_pending_age_seconds: number | null;
}

/** Token health per channel from channel_accounts table */
export interface TokenHealthRow {
  channel: string;
  account_name: string;
  token_expires_at: string | null;
  token_refreshed_at: string | null;
  days_until_expiry: number | null;
  last_health_check_at: string | null;
  health_check_ok: boolean | null;
  health_check_error: string | null;
}
