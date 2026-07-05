/**
 * Prometheus Metrics Service (Stage 7: Monitoring)
 *
 * Central registry for all application metrics.
 * Exposed via GET /api/metrics (admin-only, Prometheus scrape target).
 *
 * Metric categories:
 * - HTTP: request duration histogram, request counter
 * - DB: query duration histogram, pool gauges (total/idle/waiting)
 * - BullMQ: queue depth gauges (waiting/active/delayed/failed)
 * - WebSocket: connected clients gauge
 * - Node.js: default runtime metrics (GC, event loop, memory)
 */

import client from 'prom-client';

// ─── Registry ───────────────────────────────────────────────────────────────

const register = new client.Registry();
const appLabel = process.env['PROCESS_ROLE'] === 'telephony'
  ? 'magnus-photo-telephony'
  : 'magnus-photo-api';

register.setDefaultLabels({ app: appLabel });

// Node.js default metrics (GC, event loop lag, memory, active handles, etc.)
client.collectDefaultMetrics({ register, prefix: 'node_' });

// ─── HTTP Metrics ───────────────────────────────────────────────────────────

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

export const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Number of HTTP requests currently being processed',
  registers: [register],
});

// ─── DB Metrics ─────────────────────────────────────────────────────────────

export const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'PostgreSQL query duration in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const dbQueryErrors = new client.Counter({
  name: 'db_query_errors_total',
  help: 'Total PostgreSQL query errors',
  registers: [register],
});

export const dbPoolTotal = new client.Gauge({
  name: 'db_pool_connections_total',
  help: 'Total connections in PG pool',
  registers: [register],
});

export const dbPoolIdle = new client.Gauge({
  name: 'db_pool_connections_idle',
  help: 'Idle connections in PG pool',
  registers: [register],
});

export const dbPoolWaiting = new client.Gauge({
  name: 'db_pool_connections_waiting',
  help: 'Clients waiting for a PG connection',
  registers: [register],
});

// ─── BullMQ Metrics ─────────────────────────────────────────────────────────

export const bullmqQueueDepth = new client.Gauge({
  name: 'bullmq_queue_depth',
  help: 'BullMQ queue depth by state',
  labelNames: ['queue', 'state'] as const,
  registers: [register],
});

export const bullmqJobDuration = new client.Histogram({
  name: 'bullmq_job_duration_seconds',
  help: 'BullMQ job processing duration in seconds',
  labelNames: ['queue', 'job_name'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

export const bullmqJobsProcessed = new client.Counter({
  name: 'bullmq_jobs_processed_total',
  help: 'Total BullMQ jobs processed',
  labelNames: ['queue', 'job_name', 'status'] as const,
  registers: [register],
});

// ─── WebSocket Metrics ──────────────────────────────────────────────────────

export const wsConnectedClients = new client.Gauge({
  name: 'ws_connected_clients',
  help: 'Number of connected WebSocket clients',
  registers: [register],
});

// ─── WebSocket Observability (Phase 4, pult-notifications-idle) ─────────────

export const notificationsEmitTotal = new client.Counter({
  name: 'notifications_emit_total',
  help: 'Total notification-class emits via logAndEmit (critical WS events only)',
  labelNames: ['event', 'room_type'] as const,
  registers: [register],
});

export const wsEmitEmptyRoomTotal = new client.Counter({
  name: 'ws_emit_empty_room_total',
  help: 'Critical WS emits into rooms with zero sockets (potential delivery loss)',
  labelNames: ['event', 'room_type'] as const,
  registers: [register],
});

export const wsDisconnectTotal = new client.Counter({
  name: 'ws_disconnect_total',
  help: 'Total WebSocket disconnects by reason (Socket.IO disconnect reason string)',
  labelNames: ['reason'] as const,
  registers: [register],
});

export const wsReconnectAttemptsTotal = new client.Counter({
  name: 'ws_reconnect_attempts_total',
  help: 'WebSocket reconnect attempts reported by frontend (via app-logs wsMetric=reconnect)',
  labelNames: ['reason'] as const,
  registers: [register],
});

export const wsHeartbeatRefreshTotal = new client.Counter({
  name: 'ws_heartbeat_refresh_total',
  help: 'ws:online heartbeat refreshes by trigger (periodic tick vs per-event)',
  labelNames: ['trigger'] as const,
  registers: [register],
});

export const wsActiveRoomsSize = new client.Gauge({
  name: 'ws_active_rooms_size',
  help: 'Number of sockets in each classified room type (snapshot)',
  labelNames: ['room_type'] as const,
  registers: [register],
});

export const wsConnectTotal = new client.Counter({
  name: 'ws_connect_total',
  help: 'Total WebSocket connections by role at handshake',
  labelNames: ['role'] as const,
  registers: [register],
});

// ─── WS Pub/Sub (PM2-split worker→api Socket.IO bridge) ────────────────────

export const wsPubsubPublishedTotal = new client.Counter({
  name: 'ws_pubsub_published_total',
  help: 'WS envelope publish attempts accepted by ws-pubsub publish() (per event, source role)',
  labelNames: ['event', 'source_role'] as const,
  registers: [register],
});

export const wsPubsubReceivedTotal = new client.Counter({
  name: 'ws_pubsub_received_total',
  help: 'WS envelope received from Redis pub/sub (pre-emit, per event)',
  labelNames: ['event'] as const,
  registers: [register],
});

export const wsPubsubEmitFailedTotal = new client.Counter({
  name: 'ws_pubsub_emit_failed_total',
  help: 'WS envelope re-emit failures in api process (io unbound, emit threw, …)',
  labelNames: ['event', 'reason'] as const,
  registers: [register],
});

export const wsPubsubDroppedTotal = new client.Counter({
  name: 'ws_pubsub_dropped_total',
  help: 'WS envelope dropped before emit (dedupe, backpressure, schema_mismatch, parse_error, publish_error, shutting_down)',
  labelNames: ['reason'] as const,
  registers: [register],
});

export const wsPubsubLagMs = new client.Histogram({
  name: 'ws_pubsub_lag_ms',
  help: 'Lag in ms between publisher emittedAt and subscriber handleMessage',
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

// ─── Application Metrics ────────────────────────────────────────────────────

export const webhookIdempotencyHits = new client.Counter({
  name: 'webhook_idempotency_hits_total',
  help: 'Webhook idempotency cache hits (duplicate prevented)',
  registers: [register],
});

export const circuitBreakerState = new client.Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['name'] as const,
  registers: [register],
});

export const circuitBreakerTripsTotal = new client.Counter({
  name: 'circuit_breaker_trips_total',
  help: 'Total CLOSED→OPEN transitions (failures hitting threshold)',
  labelNames: ['service'] as const,
  registers: [register],
});

export const circuitBreakerRecoveredTotal = new client.Counter({
  name: 'circuit_breaker_recovered_total',
  help: 'Total HALF_OPEN→CLOSED transitions (successful recovery)',
  labelNames: ['service'] as const,
  registers: [register],
});

export const circuitBreakerFallbackRequestsTotal = new client.Counter({
  name: 'circuit_breaker_fallback_requests_total',
  help: 'Total requests rejected while breaker was OPEN',
  labelNames: ['service'] as const,
  registers: [register],
});

export const circuitBreakerCallDurationSeconds = new client.Histogram({
  name: 'circuit_breaker_call_duration_seconds',
  help: 'Duration of successful CLOSED-state calls',
  labelNames: ['service'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

// ─── Business Observability ────────────────────────────────────────────────

export const businessEventsTotal = new client.Counter({
  name: 'business_events_total',
  help: 'Business-domain events emitted by backend observability layer',
  labelNames: ['domain', 'event', 'outcome', 'severity'] as const,
  registers: [register],
});

export const businessEventDurationSeconds = new client.Histogram({
  name: 'business_event_duration_seconds',
  help: 'Duration of business-domain actions in seconds',
  labelNames: ['domain', 'event', 'outcome'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

export const businessCriticalAlertsTotal = new client.Counter({
  name: 'business_critical_alerts_total',
  help: 'Critical business alerts accepted for delivery by backend observability layer',
  labelNames: ['domain', 'event'] as const,
  registers: [register],
});

// ─── Media Pipeline Metrics ──────────────────────────────────────────────────

export const mediaProcessedTotal = new client.Counter({
  name: 'media_processed_total',
  help: 'Total media files processed',
  labelNames: ['channel', 'media_type', 'status'] as const,
  registers: [register],
});

export const mediaProcessingDuration = new client.Histogram({
  name: 'media_processing_duration_seconds',
  help: 'Media processing duration in seconds',
  labelNames: ['channel', 'media_type'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

export const mediaUploadBytes = new client.Counter({
  name: 'media_upload_bytes_total',
  help: 'Total bytes uploaded to S3',
  labelNames: ['channel'] as const,
  registers: [register],
});

export const mediaOrphansCleanedTotal = new client.Counter({
  name: 'media_orphans_cleaned_total',
  help: 'Total orphan media placeholders cleaned',
  registers: [register],
});

// ─── Sprint #3 tracking counters ────────────────────────────────────────────

export const adClicksTotal = new client.Counter({
  name: 'ad_clicks_total',
  help: 'Total ad clicks processed',
  labelNames: ['platform', 'utm_source', 'status'] as const,
  registers: [register],
});

export const adClicksErrorsTotal = new client.Counter({
  name: 'ad_clicks_errors_total',
  help: 'Ad click processing errors',
  labelNames: ['reason'] as const,
  registers: [register],
});

export const visitorSessionsUpdatedTotal = new client.Counter({
  name: 'visitor_sessions_updated_total',
  help: 'Visitor session update operations',
  labelNames: ['result', 'operation'] as const,
  registers: [register],
});

export const conversionsTotal = new client.Counter({
  name: 'conversions_total',
  help: 'Conversions registered',
  labelNames: ['type', 'channel'] as const,
  registers: [register],
});

export const conversionsSkippedTotal = new client.Counter({
  name: 'conversions_skipped_total',
  help: 'Conversions skipped (bailout reasons for diagnostics)',
  labelNames: ['reason'] as const,
  registers: [register],
});

export const conversionAttributionWeightsTotal = new client.Counter({
  name: 'conversion_attribution_weights_total',
  help: 'Conversion-click attribution weights written',
  labelNames: ['position'] as const,
  registers: [register],
});

export const tgStartEventsTotal = new client.Counter({
  name: 'tg_start_events_total',
  help: 'Telegram /start events received',
  labelNames: ['has_payload'] as const,
  registers: [register],
});

// ─── Payment Links (CRM-created pre-order payment URLs) ─────────────────────

export const paymentLinksCreatedTotal = new client.Counter({
  name: 'payment_links_created_total',
  help: 'Payment links created by CRM operators',
  labelNames: ['channel'] as const,
  registers: [register],
});

export const paymentLinksPaidTotal = new client.Counter({
  name: 'payment_links_paid_total',
  help: 'Payment links successfully paid by clients',
  labelNames: ['method'] as const,
  registers: [register],
});

export const paymentLinksExpiredTotal = new client.Counter({
  name: 'payment_links_expired_total',
  help: 'Payment links expired without payment',
  registers: [register],
});

export const paymentLinksLinkedToOrderTotal = new client.Counter({
  name: 'payment_links_linked_to_order_total',
  help: 'Payment links linked to photo_print_orders (post-paid order creation)',
  labelNames: ['source'] as const,
  registers: [register],
});

export const paymentLinksResentTotal = new client.Counter({
  name: 'payment_links_resent_total',
  help: 'Payment links resent (new link generated) to the client',
  labelNames: ['channel'] as const,
  registers: [register],
});

export const paymentLinksBlockedByFlagTotal = new client.Counter({
  name: 'payment_links_blocked_by_flag_total',
  help: 'POST /create-link requests blocked by ENABLE_PAYMENT_LINKS=false',
  registers: [register],
});

// ─── Pricing / Feature-Level Validation ────────────────────────────────────

export const pricingFeatureValidationRejectTotal = new client.Counter({
  name: 'pricing_feature_validation_reject_total',
  help: 'Feature-level pricing validation rejections (POST /crm-create, PATCH items/:id)',
  labelNames: ['reason'] as const,
  registers: [register],
});

export function getPricingFeatureValidationRejectCounter(): client.Counter<'reason'> {
  return pricingFeatureValidationRejectTotal;
}

// ─── Fleet Management (CUPS page_log, SNMP, Canon Remote UI) ──────────────

export const printerJobsRecordedTotal = new client.Counter({
  name: 'printer_jobs_recorded_total',
  help: 'Total print_jobs rows written by Fleet ingestion pipelines (CUPS parser, Canon Remote UI scraper, Rust print-api bridge)',
  labelNames: ['source'] as const,
  registers: [register],
});

export const printerTelemetryPollsTotal = new client.Counter({
  name: 'printer_telemetry_polls_total',
  help: 'SNMP poll attempts per printer and result (success|timeout|error|offline|circuit_open)',
  labelNames: ['printer', 'result'] as const,
  registers: [register],
});

export const printerTonerPct = new client.Gauge({
  name: 'printer_toner_pct',
  help: 'Current toner/ink level percentage per printer and colorant',
  labelNames: ['printer', 'color'] as const,
  registers: [register],
});

export const printerPaperPct = new client.Gauge({
  name: 'printer_paper_pct',
  help: 'Current paper tray level percentage per printer and tray',
  labelNames: ['printer', 'tray'] as const,
  registers: [register],
});

export const printerIsOnline = new client.Gauge({
  name: 'printer_is_online',
  help: 'Whether the printer responded to the last SNMP poll (1=online, 0=offline)',
  labelNames: ['printer'] as const,
  registers: [register],
});

export const printerPollDurationSeconds = new client.Histogram({
  name: 'printer_poll_duration_seconds',
  help: 'SNMP poll duration per printer in seconds',
  labelNames: ['printer'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30],
  registers: [register],
});

export const printerAlertsRaisedTotal = new client.Counter({
  name: 'printer_alerts_raised_total',
  help: 'Fleet alerts raised by the Alerts Engine (labeled by alert type and severity)',
  labelNames: ['type', 'severity'] as const,
  registers: [register],
});

export const canonUiAuthTotal = new client.Counter({
  name: 'canon_ui_auth_total',
  help: 'Canon Remote UI auth/fetch outcomes per printer (success|rsa_fail|http_error|timeout|parse_fail|bad_credentials|nav_http_error|circuit_open)',
  labelNames: ['printer', 'result'] as const,
  registers: [register],
});

export const canonUiJobsMergedTotal = new client.Counter({
  name: 'canon_ui_jobs_merged_total',
  help: 'Number of Canon Remote UI job rows merged with a prior CUPS row (dedup pipeline)',
  labelNames: ['printer'] as const,
  registers: [register],
});

export const printerAlertsActive = new client.Gauge({
  name: 'printer_alerts_active',
  help: 'Currently open (unresolved) printer alerts grouped by severity',
  labelNames: ['severity'] as const,
  registers: [register],
});

export const fleetDashboardSummaryQueriesTotal = new client.Counter({
  name: 'fleet_dashboard_summary_queries_total',
  help: 'Total requests to Fleet dashboard summary endpoint',
  registers: [register],
});

export const fleetPrinterDetailViewsTotal = new client.Counter({
  name: 'fleet_printer_detail_views_total',
  help: 'Total Fleet printer detail page views',
  labelNames: ['printer'] as const,
  registers: [register],
});

export const fleetSuppliesReplaceTotal = new client.Counter({
  name: 'fleet_supplies_replace_total',
  help: 'Total Fleet supply replacement operations',
  labelNames: ['supply_type', 'result'] as const,
  registers: [register],
});

// ─── CRM PULT IP-guard (audit-only by default) ─────────────────────────────

export const crmIpGuardRejectTotal = new client.Counter({
  name: 'crm_ip_guard_reject_total',
  help: 'CRM / admin / employee requests whose client IP was not in TRUSTED_CIDRS (audit or hard mode)',
  labelNames: ['mode', 'path'] as const,
  registers: [register],
});

// ─── Telephony / Voximplant ────────────────────────────────────────────────

// Аутентификация webhook'ов Voximplant. outcome:
//  signed_ok | legacy_ok | grace_unsigned | rejected_bad_sig | rejected_replay
//  | rejected_missing | rejected_misconfig
export const voximplantWebhookAuthTotal = new client.Counter({
  name: 'voximplant_webhook_auth_total',
  help: 'Voximplant webhook authentication outcomes by endpoint',
  labelNames: ['endpoint', 'outcome'] as const,
  registers: [register],
});

// Жизненный цикл голосового OTP-звонка. result:
//  accepted | connected | spoke | not_reached | failed | busy
export const voiceOtpCallsTotal = new client.Counter({
  name: 'voice_otp_calls_total',
  help: 'Voice OTP call lifecycle outcomes',
  labelNames: ['result'] as const,
  registers: [register],
});

export const telephonyIncomingCallsTotal = new client.Counter({
  name: 'telephony_incoming_calls_total',
  help: 'Inbound calls registered via Voximplant /incoming-call webhook',
  registers: [register],
});

export const telephonyMissedCallsTotal = new client.Counter({
  name: 'telephony_missed_calls_total',
  help: 'Missed inbound calls',
  labelNames: ['reason'] as const,
  registers: [register],
});

export const telephonyCallEventsTotal = new client.Counter({
  name: 'telephony_call_events_total',
  help: 'Voximplant /call-event events (answered/ended/failed)',
  labelNames: ['event'] as const,
  registers: [register],
});

export const telephonyServiceSurveyTotal = new client.Counter({
  name: 'telephony_service_survey_total',
  help: 'Service-survey webhook events',
  labelNames: ['event'] as const,
  registers: [register],
});

export const asrEmptyTranscriptTotal = new client.Counter({
  name: 'asr_empty_transcript_total',
  help: 'Service-survey calls completed without a non-empty ASR transcript',
  registers: [register],
});

// ─── Gift activation (account-first) ────────────────────────────────────────

export const giftActivationStartedTotal = new client.Counter({
  name: 'gift_activation_started_total',
  help: 'Gift activation sessions opened via /start',
  labelNames: ['voice_sent'] as const,
  registers: [register],
});

export const giftActivationFinalizedTotal = new client.Counter({
  name: 'gift_activation_finalized_total',
  help: 'Gift activations finalized via /finalize',
  labelNames: ['mode', 'account', 'via'] as const,
  registers: [register],
});

export const giftActivationCodeRejectedTotal = new client.Counter({
  name: 'gift_activation_code_rejected_total',
  help: 'Gift activation code verification rejections',
  labelNames: ['channel', 'reason'] as const,
  registers: [register],
});

export const giftActivationCodeLockedTotal = new client.Counter({
  name: 'gift_activation_code_locked_total',
  help: 'Gift activation codes burned after too many wrong attempts',
  labelNames: ['channel'] as const,
  registers: [register],
});

// ─── Card change reconciler (subscription card swap safety net) ─────────────

export const cardChangeReconcilerCancelRetriesTotal = new client.Counter({
  name: 'card_change_reconciler_cancel_retries_total',
  help: 'Old-recurrent cancel retries attempted by the card-change reconciler',
  labelNames: ['result'] as const,
  registers: [register],
});

export const cardChangeOrphanDetectedTotal = new client.Counter({
  name: 'card_change_orphan_detected_total',
  help: 'Orphan CloudPayments subscriptions detected by the card-change reconciler',
  labelNames: ['action'] as const,
  registers: [register],
});

export const cardChangePendingCancelOpen = new client.Gauge({
  name: 'card_change_pending_cancel_open',
  help: 'Open card-change rows still awaiting old-recurrent cancellation (pending_cancel_old)',
  registers: [register],
});

export const cardChangeTtlFailedTotal = new client.Counter({
  name: 'card_change_ttl_failed_total',
  help: 'Card-change rows failed by the reconciler after exceeding the awaiting_token TTL',
  registers: [register],
});

export const cardChangeIgnoredCancelledTotal = new client.Counter({
  name: 'card_change_ignored_cancelled_total',
  help: 'Stale CloudPayments Cancelled webhooks ignored by the card-change race guard (/recurrent)',
  labelNames: ['reason'] as const, // 'in_progress' | 'id_mismatch'
  registers: [register],
});

// ─── Public API ─────────────────────────────────────────────────────────────

export function getMetricsRegistry(): client.Registry {
  return register;
}

export async function getMetrics(): Promise<string> {
  return register.metrics();
}

export function getContentType(): string {
  return register.contentType;
}
