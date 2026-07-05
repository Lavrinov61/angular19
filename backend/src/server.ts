import { createServer, type Server } from 'http';
import sharp from 'sharp';

// Sharp global config — limit memory usage on constrained VM (16 GB / 4 CPU)
sharp.cache(false);
sharp.concurrency(2);

import app from './app.js';
import { config } from './config/index.js';
import db from './database/db.js';
import { SocketServer } from './websocket/socket-server.js';
import { NotificationService } from './services/notification.service.js';
import { bindApiIO } from './websocket/broadcast-to-room.js';
import { wsPubSub } from './websocket/ws-pubsub.service.js';
import { registerShutdownHandlers } from './bootstrap/shutdown.js';
import { recoverPendingWebhooks } from './bootstrap/recover-webhooks.js';
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
import { closePaymentsRedis } from './routes/payments.routes.js';
import { initLeaderElection, stopLeaderElection } from './services/scheduler-leader.js';
// v1 outbound workers removed — fully migrated to v2 pipeline/outbound-worker.ts
import { startApprovalScheduler, stopApprovalScheduler } from './services/approval-scheduler.service.js';
import { startChatArchiveScheduler, stopChatArchiveScheduler } from './services/chat-archive.service.js';
import { startChatEmailDigestScheduler, stopChatEmailDigestScheduler } from './services/chat-email-digest.service.js';
import { startRetouchSLAScheduler, stopRetouchSLAScheduler } from './services/retouch-sla-scheduler.service.js';
import { closeChannelMetrics } from './services/channel-metrics.service.js';
import { initializeAdapters, ensureWebhooks } from './services/connectors/core/adapter-registry.js';
import { startCrmEventWorker, stopCrmEventWorker } from './services/crm-event-queue.service.js';
import { closeCrmRedis } from './services/redis-cache.service.js';
import { startInboundWorker, stopInboundWorker } from './services/connectors/pipeline/inbound-worker.js';
import { startStatusWorker, stopStatusWorker } from './services/connectors/pipeline/status-worker.js';
import { startMediaWorker, stopMediaWorker } from './services/connectors/pipeline/media-worker.js';
import { startOutboundWorker, stopOutboundWorker } from './services/connectors/pipeline/outbound-worker.js';
import { startBroadcastWorker } from './services/broadcast/broadcast-worker.js';
import { startMaxBroadcastWorker } from './services/broadcast/max-broadcast-worker.js';
import { attachDlqListener, stopDlqWorker } from './services/connectors/pipeline/dlq-worker.js';
import { startMetricsCollector, stopMetricsCollector } from './services/metrics-collector.service.js';
import { startMetricsAlerting, stopMetricsAlerting } from './services/metrics-alerting.service.js';
import { startInfraAlertDispatcher, stopInfraAlertDispatcher } from './services/infra-alert-dispatcher.service.js';
import { startPostPaymentWorker, stopPostPaymentWorker } from './services/post-payment-queue.service.js';
import { startOrphanMediaCleanup, stopOrphanMediaCleanup } from './services/orphan-media-cleanup.service.js';
import { startEduPrintEstimateCleanup, stopEduPrintEstimateCleanup } from './services/edu-print-estimate-cleanup.service.js';
import { startInPersonConfirmScheduler, stopInPersonConfirmScheduler } from './services/student-inperson-confirm-send.service.js';
import { startOrphanPaymentSweep, stopOrphanPaymentSweep } from './services/pos-orphan-payment-sweep.service.js';
import { startFiscalRetrySweep, stopFiscalRetrySweep } from './services/pos-fiscal-retry-sweep.service.js';
import { startAvScanWorker, stopAvScanWorker } from './services/av-scan-worker.js';
import { startFiscalWorker, stopFiscalWorker } from './workers/pos-fiscal-worker.js';
import { startLoyaltyWorker, stopLoyaltyWorker } from './workers/loyalty-worker.js';
import { startVisitorSessionWorker, stopVisitorSessionWorker } from './workers/visitor-session-worker.js';
import { startPaymentSchedulers, stopPaymentSchedulers } from './services/payment-scheduler.service.js';
import { startStudioSchedulers, stopStudioSchedulers } from './services/studio-scheduler.service.js';
import { startSnmpPoller, stopSnmpPoller } from './services/fleet/snmp-poller.service.js';
import { startCupsPageLogParser, stopCupsPageLogParser } from './services/fleet/cups-page-log-parser.service.js';
import { startCanonRemoteUiScraper, stopCanonRemoteUiScraper } from './services/fleet/canon-remote-ui-scraper.service.js';
import { startAlertsEngine, stopAlertsEngine } from './services/fleet/alerts-engine.service.js';
import { stopAIChatService } from './services/ai-chat.service.js';
import { startResendCooldownCleanup, stopResendCooldownCleanup } from './services/auth.service.js';
import { startPriorityCacheCleanup, stopPriorityCacheCleanup } from './services/task-ai.service.js';
import { recordAbandonedPhoneOtpEvents } from './services/phone-otp-event.service.js';
import { closeAllTransporters } from './services/connectors/email/email.adapter.js';
import { startScheduledMessagesScheduler, stopScheduledMessagesScheduler } from './services/scheduled-messages.service.js';
import { startSubscriptionScheduler, stopSubscriptionScheduler } from './services/subscription-scheduler.service.js';
import { startStudentDiscountScheduler, stopStudentDiscountScheduler } from './services/student-discount-scheduler.service.js';
import { startTunnelHealthScheduler, stopTunnelHealthScheduler } from './services/tunnel-health.service.js';
import { startPhotoWorkspaceScheduler, stopPhotoWorkspaceScheduler } from './services/photo-workspace/photo-workspace-scheduler.service.js';
import {
  startTelegramPollingFallback,
  stopTelegramPollingFallback,
} from './services/telegram-polling-fallback.service.js';
import {
  shutdownVoiceOtpDispatcher,
  startVoiceOtpDispatchWorker,
  stopVoiceOtpDispatchWorker,
} from './services/voice-otp-dispatcher.service.js';
import { createLogger } from './utils/logger.js';
import { captureException } from './utils/error-tracker.js';

const PORT = config.server.port;
const HOST = '127.0.0.1';
const log = createLogger('server');

// Module-scope references for graceful shutdown (monolith mode only)
let httpServer: Server;
let socketServerRef: SocketServer | null = null;
let verificationCleanupInterval: ReturnType<typeof setInterval> | undefined;
let replayCleanupInterval: ReturnType<typeof setInterval> | undefined;
let appLogsCleanupInterval: ReturnType<typeof setInterval> | undefined;
let refreshTokenCleanupInterval: ReturnType<typeof setInterval> | undefined;
let instagramTokenRefreshInterval: ReturnType<typeof setInterval> | undefined;

async function startServer(): Promise<void> {
  // Role guard: server.ts hosts HTTP + Socket.IO. Only 'api' and 'monolith'
  // processes belong here — scheduler/worker-* have their own entry points.
  if (config.role !== 'api' && config.role !== 'monolith') {
    log.error('server.ts started with invalid PROCESS_ROLE — expected api|monolith', {
      role: config.role,
    });
    process.exit(78); // EX_CONFIG
  }

  // Layer 2: Production-only guard — prevent dev server from starting
  if (config.server.nodeEnv !== 'production' || config.server.port !== 3001) {
    log.error('FATAL: server requires NODE_ENV=production + PORT=3001', {
      nodeEnv: config.server.nodeEnv, port: config.server.port,
    });
    process.exit(78); // EX_CONFIG
  }

  try {
    // Test database connection
    await db.query('SELECT NOW()');
    log.info('Database connected successfully');

    // Initialize omnichannel adapters (must happen before first request)
    await initializeAdapters();

    // Create HTTP server
    httpServer = createServer(app);

    // Initialize WebSocket server
    const socketServer = new SocketServer(httpServer);
    socketServerRef = socketServer;
    app.socketServer = socketServer; // HTTP handlers still look up io via app.socketServer
    NotificationService.setSocketServer(socketServer);

    // Wire broadcastToRoom → this process' Socket.IO instance.
    bindApiIO(socketServer.getIO());
    // Subscribe to ws:broadcast:v1 so worker-emitted envelopes are re-emitted
    // through our io. publisher-side (wsPubSub.publish) also works from api.
    await wsPubSub.bindIO(socketServer.getIO());
    log.info('WebSocket server initialized (ws-pubsub bound)');

    // In monolith mode we keep running schedulers/workers under a
    // leader-election advisory lock — same behaviour as pre-split.
    if (config.role === 'monolith') {
      await initLeaderElection(onBecomeLeaderMonolith, onLoseLeadershipMonolith);
    }

    // Register shutdown handlers (replaces the bespoke gracefulShutdown block).
    registerShutdownHandlers('server', gracefulCleanup, config.server.shutdownTimeoutMs);

    // Start server
    httpServer.listen(PORT, HOST, () => {
      log.info('Server listening', { host: HOST, port: PORT, env: config.server.nodeEnv, role: config.role });
      // Log feature flags for production debugging
      log.info('Feature flags', {
        rbacMode: process.env['RBAC_USE_DB'] === 'true' ? 'database' : 'static-map',
        sessionTokenStrict: config.guestSession.strictMode,
      });
      // PM2 wait_ready: true — сигнализируем что сервер готов
      process.send?.('ready');

      // Register webhook URLs for channels that support it (Telegram, etc.)
      const baseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
      ensureWebhooks(baseUrl).catch((err: unknown) =>
        log.error('ensureWebhooks error', { error: err instanceof Error ? err.message : String(err) }),
      );
    });

    httpServer.on('error', (error: NodeJS.ErrnoException) => {
      log.error('HTTP server error — exiting', { code: error.code, message: error.message });
      process.exit(1);
    });
  } catch (error: unknown) {
    captureException(error, { tags: { phase: 'startup' }, level: 'fatal' });
    log.error('Failed to start server', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

// ─── Monolith leader callbacks (parity with pre-split server.ts) ──────────────

async function cleanupVerificationCodes(): Promise<void> {
  try {
    await recordAbandonedPhoneOtpEvents();
    const result = await db.query(
      `DELETE FROM verification_codes WHERE expires_at < NOW() AND used_at IS NULL RETURNING id`,
    );
    if (result.length > 0) log.info('Cleanup: expired verification codes removed', { count: result.length });
  } catch (err: unknown) {
    log.error('Cleanup: verification_codes failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function cleanupReplayData(): Promise<void> {
  try {
    const result = await db.query(
      `DELETE FROM replay_sessions WHERE started_at < NOW() - INTERVAL '90 days' RETURNING id`,
    );
    if (result.length > 0) log.info('Cleanup: old replay_sessions removed', { count: result.length });
  } catch (err: unknown) {
    log.error('Cleanup: replay_sessions failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function cleanupAppLogs(): Promise<void> {
  try {
    const result = await db.query(
      `DELETE FROM app_logs WHERE created_at < NOW() - INTERVAL '30 days' RETURNING id`,
    );
    if (result.length > 0) log.info('Cleanup: old app_logs removed', { count: result.length });
  } catch (err: unknown) {
    log.error('Cleanup: app_logs failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function cleanupRefreshTokens(): Promise<void> {
  try {
    const result = await db.query(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL '7 days' RETURNING id`,
    );
    if (result.length > 0) log.info('Cleanup: expired refresh_tokens removed', { count: result.length });
  } catch (err: unknown) {
    log.error('Cleanup: refresh_tokens failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

function onBecomeLeaderMonolith(): void {
  log.info('monolith leader: starting all schedulers + workers');
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
  startCrmEventWorker();
  startApprovalScheduler();
  startChatArchiveScheduler();
  startChatEmailDigestScheduler();
  startInboundWorker();
  recoverPendingWebhooks().catch((err: unknown) =>
    log.error('recoverPendingWebhooks failed', { error: err instanceof Error ? err.message : String(err) }),
  );
  startStatusWorker();
  const mediaWorker = startMediaWorker();
  attachDlqListener(mediaWorker);
  startOutboundWorker();
  startBroadcastWorker();
  startMaxBroadcastWorker();

  cleanupVerificationCodes().catch(() => { /* logged inside */ });
  verificationCleanupInterval = setInterval(cleanupVerificationCodes, 60 * 60 * 1000);
  cleanupReplayData().catch(() => { /* logged inside */ });
  replayCleanupInterval = setInterval(cleanupReplayData, 24 * 60 * 60 * 1000);
  cleanupAppLogs().catch(() => { /* logged inside */ });
  appLogsCleanupInterval = setInterval(cleanupAppLogs, 24 * 60 * 60 * 1000);
  cleanupRefreshTokens().catch(() => { /* logged inside */ });
  refreshTokenCleanupInterval = setInterval(cleanupRefreshTokens, 24 * 60 * 60 * 1000);

  if (config.instagram.enabled) {
    const FIFTY_DAYS_MS = 50 * 24 * 60 * 60 * 1000;
    instagramTokenRefreshInterval = setInterval(async () => {
      try {
        const { refreshInstagramToken } = await import('./services/connectors/instagram/instagram.token-refresh.js');
        const { getAccountByChannel } = await import('./services/connectors/core/account-store.js');
        const account = await getAccountByChannel('instagram');
        if (account) {
          refreshInstagramToken(account).catch((err: unknown) =>
            log.error('IG token refresh error', { error: err instanceof Error ? err.message : String(err) }));
        }
      } catch (err: unknown) {
        log.error('IG token refresh loader failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }, FIFTY_DAYS_MS);
  }

  startPostPaymentWorker();
  startAvScanWorker();
  startFiscalWorker();
  startLoyaltyWorker();
  startVisitorSessionWorker();
  startVoiceOtpDispatchWorker();
  startOrphanMediaCleanup();
  startEduPrintEstimateCleanup();
  startInPersonConfirmScheduler();
  startOrphanPaymentSweep();
  startFiscalRetrySweep();
  startPaymentSchedulers();
  startStudioSchedulers();
  startScheduledMessagesScheduler();
  startSubscriptionScheduler();
  startStudentDiscountScheduler();
  startMetricsCollector();
  startMetricsAlerting();
  startInfraAlertDispatcher();
  startTunnelHealthScheduler();
  startTelegramPollingFallback();
  startRetouchSLAScheduler();
  startPhotoWorkspaceScheduler();
  startResendCooldownCleanup();
  startPriorityCacheCleanup();

  // Fleet Management: SNMP polling (5m), CUPS PageLog parser, Canon Remote UI Job Log scraper (10m), Alerts engine (1m)
  startSnmpPoller();
  startCupsPageLogParser();
  startCanonRemoteUiScraper();
  startAlertsEngine();

  log.info('monolith leader: all schedulers started');
}

function onLoseLeadershipMonolith(): void {
  log.warn('monolith follower: stopping schedulers (leadership lost)');
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
  stopOrphanMediaCleanup();
  stopEduPrintEstimateCleanup();
  stopInPersonConfirmScheduler();
  stopOrphanPaymentSweep();
  stopFiscalRetrySweep();
  stopPaymentSchedulers();
  stopStudioSchedulers();
  stopScheduledMessagesScheduler();
  stopSubscriptionScheduler();
  stopStudentDiscountScheduler();
  stopMetricsCollector();
  stopMetricsAlerting();
  stopInfraAlertDispatcher();
  stopTunnelHealthScheduler();
  stopTelegramPollingFallback().catch((err: unknown) => {
    log.warn('stopTelegramPollingFallback failed', { error: err instanceof Error ? err.message : String(err) });
  });
  stopRetouchSLAScheduler();
  stopPhotoWorkspaceScheduler();
  stopAIChatService();
  stopResendCooldownCleanup();
  stopPriorityCacheCleanup();
  stopVoiceOtpDispatchWorker().catch((err: unknown) => {
    log.warn('stopVoiceOtpDispatchWorker failed', { error: err instanceof Error ? err.message : String(err) });
  });

  // Fleet Management stop (mirror of onBecomeLeaderMonolith)
  stopSnmpPoller();
  stopCupsPageLogParser();
  stopCanonRemoteUiScraper();
  stopAlertsEngine();

  closeAllTransporters();
}

// ─── Graceful cleanup (SIGTERM/SIGINT) ────────────────────────────────────────

async function shutdownStep(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    log.info(`Shutdown step OK: ${label}`);
  } catch (err: unknown) {
    log.error(`Shutdown step FAILED: ${label}`, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function gracefulCleanup(): Promise<void> {
  const io = socketServerRef?.getIO();

  // ── Step 1: Notify WS clients about maintenance ────────────────────────
  if (io) {
    log.info('Notifying WebSocket clients about maintenance');
    io.emit('server:maintenance', { message: 'Обновление сервера, переподключение через 10 сек' });
    await new Promise(r => setTimeout(r, 2000));
  }

  // ── Step 2: Monolith-only — stop schedulers & intervals ────────────────
  if (config.role === 'monolith') {
    log.info('Stopping schedulers and interval timers (monolith)');
    try { onLoseLeadershipMonolith(); } catch (err: unknown) {
      log.warn('onLoseLeadershipMonolith in cleanup threw', { error: err instanceof Error ? err.message : String(err) });
    }

    // ── Step 3: Stop async workers (BullMQ, outbound, CRM) ────────────
    await shutdownStep('crm-event-worker', () => stopCrmEventWorker());
    await shutdownStep('inbound-worker-v2', () => stopInboundWorker());
    await shutdownStep('status-worker-v2', () => stopStatusWorker());
    await shutdownStep('media-worker-v2', () => stopMediaWorker());
    await shutdownStep('dlq-worker', () => stopDlqWorker());
    await shutdownStep('outbound-worker-v2', () => stopOutboundWorker());
    await shutdownStep('telegram-polling-fallback', () => stopTelegramPollingFallback());
    await shutdownStep('post-payment-worker', () => stopPostPaymentWorker());
    await shutdownStep('av-scan-worker', () => stopAvScanWorker());
    await shutdownStep('pos-fiscal-worker', () => stopFiscalWorker());
    await shutdownStep('loyalty-worker', () => stopLoyaltyWorker());
    await shutdownStep('visitor-session-worker', () => stopVisitorSessionWorker());
    await shutdownStep('voice-otp-dispatcher-worker', () => stopVoiceOtpDispatchWorker());

    // ── Step 4: Release leader election advisory lock ──────────────────
    await shutdownStep('leader-election', () => stopLeaderElection());
  }

  // ── Step 5: Close HTTP server (graceful drain → force-close lingering sockets) ──
  // БАГ, который чиним: httpServer.close() ждёт ЕСТЕСТВЕННОГО закрытия keep-alive
  // (nginx upstream + браузеры) и WS-соединений. Они сами не закрываются → колбэк
  // висит весь kill_timeout (наблюдали ровно 30с до SIGKILL PM2), и каждый деплой
  // backend = ~30с 502 на всём /api/*. Фикс: выгнать WS-клиентов, порвать idle
  // keep-alive сразу, остаток (in-flight) — после короткого грейса.
  if (httpServer) {
    await shutdownStep('http-server', () =>
      new Promise<void>((resolve) => {
        let settled = false;
        const done = (): void => { if (!settled) { settled = true; resolve(); } };
        try { io?.disconnectSockets(true); } catch { /* noop */ }
        httpServer.close(() => done());
        httpServer.closeIdleConnections();
        // Грейс на дренаж активных запросов, затем принудительно рвём всё оставшееся.
        setTimeout(() => { try { httpServer.closeAllConnections(); } catch { /* noop */ } }, 2000).unref();
        // Жёсткая подстраховка — не зависаем дольше этого ни при каком раскладе.
        setTimeout(done, 6000).unref();
      }),
    );
  }

  // ── Step 6: Close Socket.IO (engine-сокеты уже выгнаны выше) ────────────
  if (io) {
    await shutdownStep('socket-io', () =>
      new Promise<void>((resolve) => {
        let settled = false;
        const done = (): void => { if (!settled) { settled = true; resolve(); } };
        io.close(() => done());
        setTimeout(done, 3000).unref();
      }),
    );
  }

  // ── Step 7: ws-pubsub subscriber/publisher shutdown ───────────────────
  await shutdownStep('ws-pubsub', () => wsPubSub.shutdown());

  // ── Step 8: Close Redis connections ────────────────────────────────────
  await shutdownStep('channel-metrics-redis', () => closeChannelMetrics());
  await shutdownStep('payments-redis', () => closePaymentsRedis());
  await shutdownStep('crm-redis', () => closeCrmRedis());
  await shutdownStep('voice-otp-dispatcher', () => shutdownVoiceOtpDispatcher());

  // ── Step 9: Close PG pool ──────────────────────────────────────────────
  await shutdownStep('pg-pool', () => db.close());
}

startServer();
