/**
 * scheduler.ts — entry-point for the PM2 `scheduler` worker process.
 *
 * Runs ALL singleton cron/periodic tasks previously launched inside server.ts
 * under the leader-election callback. In monolith fallback the same work is
 * performed in server.ts guarded by `config.role === 'monolith'`.
 *
 * Responsibilities:
 *  - Acquire PG advisory lock (scheduler-leader) — only one scheduler wins.
 *  - Start ~30 schedulers + BullMQ listeners that must not duplicate.
 *  - Emit envelopes to `ws:broadcast:v1` via `wsPubSub.publish(...)` — the
 *    api-process re-emits them to Socket.IO rooms.
 *  - Graceful shutdown through `registerShutdownHandlers('scheduler', cleanup)`.
 *
 * This process DOES NOT hold a Socket.IO server; any broadcastToRoom call
 * lands in the publish-side of `wsPubSub`.
 */

import { config } from './config/index.js';
import db from './database/db.js';
import { createLogger } from './utils/logger.js';
import { registerShutdownHandlers } from './bootstrap/shutdown.js';
import { runHealthCheck } from './bootstrap/health.js';
import { recoverPendingWebhooks } from './bootstrap/recover-webhooks.js';
import { wsPubSub } from './websocket/ws-pubsub.service.js';
import { getLeaderStatus, initLeaderElection, stopLeaderElection } from './services/scheduler-leader.js';
import { initializeAdapters } from './services/connectors/core/adapter-registry.js';

// Schedulers
import { startBookingReminderScheduler, stopBookingReminderScheduler } from './services/booking-reminder.service.js';
import { startReviewSyncScheduler, stopReviewSyncScheduler } from './services/review-sync.service.js';
import { startChatCleanupScheduler, stopChatCleanupScheduler } from './services/chat-session-cleanup.service.js';
import { startTaskDeadlineScheduler, stopTaskDeadlineScheduler } from './services/task-deadline-scheduler.service.js';
import { startFollowupScheduler, stopFollowupScheduler } from './services/followup-scheduler.service.js';
import { startReviewRequestScheduler, stopReviewRequestScheduler } from './services/review-request-scheduler.service.js';
import { startInboxMVRefresh, stopInboxMVRefresh } from './services/inbox-mv.service.js';
import { startImapService, stopImapService } from './services/imap.service.js';
import { startWorkflowScheduler, stopWorkflowScheduler } from './services/workflow-engine.service.js';
import { startPartnerTierScheduler, stopPartnerTierScheduler } from './services/partner-tier-cron.service.js';
import { startShiftAutoCloseScheduler, stopShiftAutoCloseScheduler } from './services/shift-auto-close.service.js';
import { startProductionDeadlineScheduler, stopProductionDeadlineScheduler } from './services/production-deadline-scheduler.service.js';
import { startApprovalScheduler, stopApprovalScheduler } from './services/approval-scheduler.service.js';
import { startChatArchiveScheduler, stopChatArchiveScheduler } from './services/chat-archive.service.js';
import { startChatEmailDigestScheduler, stopChatEmailDigestScheduler } from './services/chat-email-digest.service.js';
import { startRetouchSLAScheduler, stopRetouchSLAScheduler } from './services/retouch-sla-scheduler.service.js';
import { startMetricsCollector, stopMetricsCollector } from './services/metrics-collector.service.js';
import { startMetricsAlerting, stopMetricsAlerting } from './services/metrics-alerting.service.js';
import { startInfraAlertDispatcher, stopInfraAlertDispatcher } from './services/infra-alert-dispatcher.service.js';
import { startSubscriptionScheduler, stopSubscriptionScheduler } from './services/subscription-scheduler.service.js';
import { startStudentDiscountScheduler, stopStudentDiscountScheduler } from './services/student-discount-scheduler.service.js';
import { startTunnelHealthScheduler, stopTunnelHealthScheduler } from './services/tunnel-health.service.js';
import { startScheduledMessagesScheduler, stopScheduledMessagesScheduler } from './services/scheduled-messages.service.js';
import { startInPersonConfirmScheduler, stopInPersonConfirmScheduler } from './services/student-inperson-confirm-send.service.js';
import { startPaymentSchedulers, stopPaymentSchedulers } from './services/payment-scheduler.service.js';
import { startStudioSchedulers, stopStudioSchedulers } from './services/studio-scheduler.service.js';
import { startPhotoWorkspaceScheduler, stopPhotoWorkspaceScheduler } from './services/photo-workspace/photo-workspace-scheduler.service.js';
import {
  startTelegramPollingFallback,
  stopTelegramPollingFallback,
} from './services/telegram-polling-fallback.service.js';
import { startSnmpPoller, stopSnmpPoller } from './services/fleet/snmp-poller.service.js';
import { startCupsPageLogParser, stopCupsPageLogParser } from './services/fleet/cups-page-log-parser.service.js';
import { startCanonRemoteUiScraper, stopCanonRemoteUiScraper } from './services/fleet/canon-remote-ui-scraper.service.js';
import { startAlertsEngine, stopAlertsEngine } from './services/fleet/alerts-engine.service.js';
import { stopAIChatService } from './services/ai-chat.service.js';
import { startResendCooldownCleanup, stopResendCooldownCleanup } from './services/auth.service.js';
import { startPriorityCacheCleanup, stopPriorityCacheCleanup } from './services/task-ai.service.js';
import { recordAbandonedPhoneOtpEvents } from './services/phone-otp-event.service.js';
import { closeAllTransporters } from './services/connectors/email/email.adapter.js';
import { closeChannelMetrics } from './services/channel-metrics.service.js';
import { closePaymentsRedis } from './routes/payments.routes.js';
import { closeCrmRedis } from './services/redis-cache.service.js';
import {
  createRedisHealthCheck,
  startWorkerHealthServer,
  type RedisHealthCheck,
  type WorkerHealthServer,
} from './bootstrap/worker-health-server.js';

const log = createLogger('scheduler-entry');
let healthServer: WorkerHealthServer | null = null;
let redisHealth: RedisHealthCheck | null = null;

// ─── Interval cleanups previously in server.ts ────────────────────────────────

let verificationCleanupInterval: ReturnType<typeof setInterval> | undefined;
let replayCleanupInterval: ReturnType<typeof setInterval> | undefined;
let appLogsCleanupInterval: ReturnType<typeof setInterval> | undefined;
let refreshTokenCleanupInterval: ReturnType<typeof setInterval> | undefined;
let instagramTokenRefreshInterval: ReturnType<typeof setInterval> | undefined;

async function cleanupVerificationCodes(): Promise<void> {
  try {
    await recordAbandonedPhoneOtpEvents();
    const result = await db.query(
      `DELETE FROM verification_codes WHERE expires_at < NOW() AND used_at IS NULL RETURNING id`,
    );
    if (result.length > 0) {
      log.info('Cleanup: expired verification codes removed', { count: result.length });
    }
  } catch (err: unknown) {
    log.error('Cleanup: verification_codes failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function cleanupReplayData(): Promise<void> {
  try {
    const result = await db.query(
      `DELETE FROM replay_sessions WHERE started_at < NOW() - INTERVAL '90 days' RETURNING id`,
    );
    if (result.length > 0) {
      log.info('Cleanup: old replay_sessions removed', { count: result.length });
    }
  } catch (err: unknown) {
    log.error('Cleanup: replay_sessions failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function cleanupAppLogs(): Promise<void> {
  try {
    const result = await db.query(
      `DELETE FROM app_logs WHERE created_at < NOW() - INTERVAL '30 days' RETURNING id`,
    );
    if (result.length > 0) {
      log.info('Cleanup: old app_logs removed', { count: result.length });
    }
  } catch (err: unknown) {
    log.error('Cleanup: app_logs failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function cleanupRefreshTokens(): Promise<void> {
  try {
    const result = await db.query(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL '7 days' RETURNING id`,
    );
    if (result.length > 0) {
      log.info('Cleanup: expired refresh_tokens removed', { count: result.length });
    }
  } catch (err: unknown) {
    log.error('Cleanup: refresh_tokens failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

// ─── Leader/follower ─────────────────────────────────────────────────────────

function onBecomeLeader(): void {
  log.info('scheduler leader: starting all schedulers');

  startBookingReminderScheduler();
  startReviewSyncScheduler();
  startChatCleanupScheduler();
  startTaskDeadlineScheduler();
  startFollowupScheduler();
  startReviewRequestScheduler();
  startInboxMVRefresh();
  startImapService();
  startWorkflowScheduler();
  startPartnerTierScheduler();
  startShiftAutoCloseScheduler();
  startProductionDeadlineScheduler();
  startApprovalScheduler();
  startChatArchiveScheduler();
  startChatEmailDigestScheduler();
  startMetricsCollector();
  startMetricsAlerting();
  startInfraAlertDispatcher();
  startSubscriptionScheduler();
  startStudentDiscountScheduler();
  startTunnelHealthScheduler();
  startRetouchSLAScheduler();
  startPhotoWorkspaceScheduler();
  startScheduledMessagesScheduler();
  startInPersonConfirmScheduler();
  startPaymentSchedulers();
  startStudioSchedulers();
  startResendCooldownCleanup();
  startPriorityCacheCleanup();
  startSnmpPoller();
  startCupsPageLogParser();
  startCanonRemoteUiScraper();
  startAlertsEngine();

  // Interval-based cleanups (not exposed as services)
  cleanupVerificationCodes().catch(() => { /* logged inside */ });
  verificationCleanupInterval = setInterval(cleanupVerificationCodes, 60 * 60 * 1000);
  cleanupReplayData().catch(() => { /* logged inside */ });
  replayCleanupInterval = setInterval(cleanupReplayData, 24 * 60 * 60 * 1000);
  cleanupAppLogs().catch(() => { /* logged inside */ });
  appLogsCleanupInterval = setInterval(cleanupAppLogs, 24 * 60 * 60 * 1000);
  cleanupRefreshTokens().catch(() => { /* logged inside */ });
  refreshTokenCleanupInterval = setInterval(cleanupRefreshTokens, 24 * 60 * 60 * 1000);

  // Instagram token refresh (every 50 days; token valid 60)
  if (config.instagram.enabled) {
    const FIFTY_DAYS_MS = 50 * 24 * 60 * 60 * 1000;
    instagramTokenRefreshInterval = setInterval(async () => {
      try {
        const { refreshInstagramToken } = await import('./services/connectors/instagram/instagram.token-refresh.js');
        const { getAccountByChannel } = await import('./services/connectors/core/account-store.js');
        const account = await getAccountByChannel('instagram');
        if (account) {
          refreshInstagramToken(account).catch((err: unknown) =>
            log.error('IG token refresh error', { error: err instanceof Error ? err.message : String(err) }),
          );
        }
      } catch (err: unknown) {
        log.error('IG token refresh loader failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }, FIFTY_DAYS_MS);
  }

  // Recover webhook-events stuck in 'pending' from a prior crashed leader.
  recoverPendingWebhooks().catch((err: unknown) =>
    log.error('recoverPendingWebhooks failed', { error: err instanceof Error ? err.message : String(err) }),
  );
  startTelegramPollingFallback();

  log.info('scheduler leader: all schedulers started');
}

function onLoseLeadership(): void {
  log.warn('scheduler follower: stopping all schedulers (leadership lost)');

  if (verificationCleanupInterval) { clearInterval(verificationCleanupInterval); verificationCleanupInterval = undefined; }
  if (replayCleanupInterval) { clearInterval(replayCleanupInterval); replayCleanupInterval = undefined; }
  if (appLogsCleanupInterval) { clearInterval(appLogsCleanupInterval); appLogsCleanupInterval = undefined; }
  if (refreshTokenCleanupInterval) { clearInterval(refreshTokenCleanupInterval); refreshTokenCleanupInterval = undefined; }
  if (instagramTokenRefreshInterval) { clearInterval(instagramTokenRefreshInterval); instagramTokenRefreshInterval = undefined; }

  stopWorkflowScheduler();
  stopPartnerTierScheduler();
  stopShiftAutoCloseScheduler();
  stopProductionDeadlineScheduler();
  stopImapService();
  stopBookingReminderScheduler();
  stopReviewSyncScheduler();
  stopChatCleanupScheduler();
  stopTaskDeadlineScheduler();
  stopFollowupScheduler();
  stopReviewRequestScheduler();
  stopInboxMVRefresh();
  stopApprovalScheduler();
  stopChatArchiveScheduler();
  stopChatEmailDigestScheduler();
  stopPaymentSchedulers();
  stopStudioSchedulers();
  stopScheduledMessagesScheduler();
  stopInPersonConfirmScheduler();
  stopSubscriptionScheduler();
  stopStudentDiscountScheduler();
  stopMetricsCollector();
  stopMetricsAlerting();
  stopInfraAlertDispatcher();
  stopTunnelHealthScheduler();
  stopRetouchSLAScheduler();
  stopPhotoWorkspaceScheduler();
  stopTelegramPollingFallback().catch((err: unknown) => {
    log.warn('stopTelegramPollingFallback failed', { error: err instanceof Error ? err.message : String(err) });
  });
  stopAIChatService();
  stopResendCooldownCleanup();
  stopPriorityCacheCleanup();
  stopSnmpPoller();
  stopCupsPageLogParser();
  stopCanonRemoteUiScraper();
  stopAlertsEngine();
  closeAllTransporters();
}

// ─── Cleanup for registerShutdownHandlers ─────────────────────────────────────

async function shutdownStep(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    log.info(`shutdown step OK: ${label}`);
  } catch (err: unknown) {
    log.error(`shutdown step FAILED: ${label}`, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function cleanup(): Promise<void> {
  if (healthServer) {
    await shutdownStep('health-server', () => healthServer?.close());
    healthServer = null;
  }

  // Release leader lock first so a follower can pick up quickly.
  await shutdownStep('leader-election', () => stopLeaderElection());

  // Stop local schedulers & interval timers (idempotent — onLoseLeadership may
  // have already done it).
  try {
    onLoseLeadership();
  } catch (err: unknown) {
    log.warn('onLoseLeadership during cleanup threw', { error: err instanceof Error ? err.message : String(err) });
  }

  // ws-pubsub publisher client shutdown.
  await shutdownStep('ws-pubsub', () => wsPubSub.shutdown());
  await shutdownStep('telegram-polling-fallback', () => stopTelegramPollingFallback());

  // Redis caches used by scheduler-side code.
  await shutdownStep('channel-metrics-redis', () => closeChannelMetrics());
  await shutdownStep('payments-redis', () => closePaymentsRedis());
  await shutdownStep('crm-redis', () => closeCrmRedis());
  if (redisHealth) {
    await shutdownStep('health-redis', () => redisHealth?.close());
    redisHealth = null;
  }

  await shutdownStep('pg-pool', () => db.close());
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.argv.includes('--health') || process.argv.includes('--health-check')) {
    await runHealthCheck(async () => {
      await db.query('SELECT 1');
    });
    return; // runHealthCheck never returns, for TS control flow.
  }

  if (config.role !== 'scheduler' && config.role !== 'monolith') {
    log.error('scheduler.ts started with unexpected PROCESS_ROLE', { role: config.role });
    process.exit(78); // EX_CONFIG
  }

  try {
    await db.query('SELECT NOW()');
    log.info('Database connected (scheduler)');

    // Telegram long-polling feeds updates through handleWebhook(), which
    // requires the process-local adapter registry to be initialized.
    await initializeAdapters();

    // Register shutdown before any async work so SIGTERM is never lost.
    registerShutdownHandlers('scheduler', cleanup, config.server.shutdownTimeoutMs);

    // ws-pubsub in scheduler is publisher-only. No bindIO() — api-process
    // owns Socket.IO and subscribes for re-emit.
    log.info('ws-pubsub publisher ready (no bindIO in scheduler)');

    await initLeaderElection(onBecomeLeader, onLoseLeadership);
    redisHealth = createRedisHealthCheck('health-scheduler');
    healthServer = await startWorkerHealthServer({
      role: config.role,
      port: config.server.port,
      checks: {
        db: async () => {
          await db.query('SELECT 1');
          return 'ok';
        },
        redis: redisHealth.check,
      },
      extra: () => ({ leader: getLeaderStatus() }),
    });

    // PM2 wait_ready handshake.
    process.send?.('ready');
    log.info('scheduler entry started', { role: config.role, pid: process.pid });
  } catch (err: unknown) {
    log.error('scheduler failed to start', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  log.error('scheduler main crashed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
