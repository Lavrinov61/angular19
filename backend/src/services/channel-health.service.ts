/**
 * Channel Health Aggregation Service
 *
 * Surfaces existing data (webhook freshness, token health, queue health)
 * from webhook_events, outbound_queue, channel_accounts + circuit breaker + Redis metrics.
 *
 * Caches result in Redis for 120s to avoid repeated SQL on every poll.
 */

import db from '../database/db.js';
import { getAllBreakers } from '../utils/circuit-breaker.js';
import { getAllChannelMetrics } from './channel-metrics.service.js';
import { isChannelDisabled } from './connectors/core/adapter-registry.js';
import { getAdapter } from './connectors/core/adapter-registry.js';
import { getAccountByChannel } from './connectors/core/account-store.js';
import { createLogger } from '../utils/logger.js';
import { createResilientRedis } from './redis-factory.js';
import { config } from '../config/index.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';
import type { QueueHealthRow, TokenHealthRow } from '../types/views/index.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const log = createLogger('channel-health');
const execFileAsync = promisify(execFile);

const redis = createResilientRedis('channel-health', {
  lazyConnect: true,
  enableOfflineQueue: false,
});
redis.connect().catch((err: Error) => log.warn('Redis connect error', { error: err.message }));

const CACHE_KEY = 'channel:health:all';
const CACHE_TTL = 120; // seconds

const CHANNELS = ['telegram', 'vk', 'max', 'whatsapp', 'instagram'] as const;

export type HealthLevel = 'healthy' | 'degraded' | 'down' | 'idle';

export interface WebhookFreshnessSignal {
  lastReceivedAt: string | null;
  total24h: number;
  errors24h: number;
  errorRate: number;
}

export interface InboundHealthSignal {
  lastReceivedAt: string | null;
  lastProcessedAt: string | null;
  lastMessageAt: string | null;
  received24h: number;
  processed24h: number;
  processedMessages24h: number;
  failed24h: number;
  skipped24h: number;
  errorRate: number;
  lastError: string | null;
}

export interface QueueHealthSignal {
  pendingCount: number;
  failedCount: number;
  deadLetterCount: number;
  oldestPendingAgeSeconds: number | null;
}

export interface QueueCountsSignal {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export interface PipelineQueuesSignal {
  inbound: QueueCountsSignal;
  status: QueueCountsSignal;
  outbound: QueueCountsSignal;
  media: QueueCountsSignal;
  mediaDlq: QueueCountsSignal;
  avScan: QueueCountsSignal;
}

export interface TokenHealthSignal {
  accountName: string;
  tokenExpiresAt: string | null;
  tokenRefreshedAt: string | null;
  daysUntilExpiry: number | null;
  lastHealthCheckAt: string | null;
  healthCheckOk: boolean | null;
  healthCheckError: string | null;
}

export interface TelegramBotApiSignal {
  mode: 'webhook' | 'polling';
  getMeOk: boolean | null;
  botUsername: string | null;
  pendingUpdateCount: number | null;
  webhookUrl: string | null;
  webhookUrlSet: boolean;
  expectedWebhookUrl: string | null;
  lastError: string | null;
  checkedAt: string | null;
}

export interface ClamAvSignal {
  available: boolean;
  mode: 'clamdscan' | 'clamscan' | 'unavailable';
  error: string | null;
  checkedAt: string;
}

export interface MediaHealthSignal {
  total24h: number;
  failed24h: number;
  avPendingCount: number;
  avError24h: number;
  avInfected24h: number;
  clamAv: ClamAvSignal;
}

export interface ChannelHealthDetail {
  channel: string;
  health: HealthLevel;
  connectorEnabled: boolean;
  disabled: boolean;
  circuitBreaker: {
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failures: number;
    lastError: string | null;
    lastSuccessAt: number | null;
    lastFailureAt: number | null;
  };
  webhook: WebhookFreshnessSignal;
  inbound: InboundHealthSignal;
  queue: QueueHealthSignal;
  queues: PipelineQueuesSignal;
  token: TokenHealthSignal | null;
  telegram: TelegramBotApiSignal | null;
  media: MediaHealthSignal;
  summary: string;
}

interface InboundHealthRow {
  channel: string;
  last_received_at: string | null;
  last_processed_at: string | null;
  received_24h: number;
  processed_24h: number;
  failed_24h: number;
  skipped_24h: number;
  error_rate: number;
  last_error: string | null;
}

interface InboundMessageRow {
  channel: string;
  last_message_at: string | null;
  processed_messages_24h: number;
}

interface MediaHealthRow {
  channel: string;
  total_24h: number;
  failed_24h: number;
  av_pending_count: number;
  av_error_24h: number;
  av_infected_24h: number;
}

interface QueueLike {
  getJobCounts(...types: Array<'waiting' | 'active' | 'delayed' | 'failed'>): Promise<Record<string, number>>;
}

const EMPTY_QUEUE_COUNTS: QueueCountsSignal = { waiting: 0, active: 0, delayed: 0, failed: 0 };

/** Get inbound webhook processing health for all channels */
async function getInboundWebhookHealth(): Promise<InboundHealthRow[]> {
  return db.query<InboundHealthRow>(`
    SELECT
      channel,
      MAX(received_at)::text AS last_received_at,
      MAX(processed_at) FILTER (WHERE status = 'processed')::text AS last_processed_at,
      COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '24 hours')::int AS received_24h,
      COUNT(*) FILTER (WHERE processed_at > NOW() - INTERVAL '24 hours' AND status = 'processed')::int AS processed_24h,
      COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '24 hours' AND status = 'failed')::int AS failed_24h,
      COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '24 hours' AND status = 'skipped')::int AS skipped_24h,
      CASE
        WHEN COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '24 hours') > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '24 hours' AND status = 'failed')::numeric /
          COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '24 hours') * 100, 1
        )
        ELSE 0
      END AS error_rate,
      (ARRAY_AGG(error_message ORDER BY received_at DESC)
        FILTER (WHERE status = 'failed' AND error_message IS NOT NULL))[1] AS last_error
    FROM webhook_events
    GROUP BY channel
  `);
}

/** Get actually persisted inbound messages for all channels */
async function getInboundMessageHealth(): Promise<InboundMessageRow[]> {
  return db.query<InboundMessageRow>(`
    SELECT
      c.channel,
      MAX(m.created_at)::text AS last_message_at,
      COUNT(*) FILTER (WHERE m.created_at > NOW() - INTERVAL '24 hours')::int AS processed_messages_24h
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.sender_type = 'visitor'
    GROUP BY c.channel
  `);
}

/** Get queue health for all channels */
async function getQueueHealth(): Promise<QueueHealthRow[]> {
  return db.query<QueueHealthRow>(`
    SELECT
      channel,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
      COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter_count,
      EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'pending')))::int AS oldest_pending_age_seconds
    FROM outbound_queue
    WHERE status IN ('pending', 'failed', 'dead_letter')
    GROUP BY channel
  `);
}

/** Get token health for all channels */
async function getTokenHealth(): Promise<TokenHealthRow[]> {
  return db.query<TokenHealthRow>(`
    SELECT
      channel,
      name AS account_name,
      token_expires_at::text,
      token_refreshed_at::text,
      last_health_check_at::text,
      health_check_ok,
      health_check_error,
      CASE
        WHEN token_expires_at IS NOT NULL
        THEN EXTRACT(DAY FROM token_expires_at - NOW())::int
        ELSE NULL
      END AS days_until_expiry
    FROM channel_accounts
    WHERE is_active = true
    ORDER BY channel
  `);
}

/** Get media processing and AV status by channel */
async function getMediaHealth(): Promise<MediaHealthRow[]> {
  return db.query<MediaHealthRow>(`
    SELECT
      c.channel,
      COUNT(*) FILTER (WHERE ma.created_at > NOW() - INTERVAL '24 hours')::int AS total_24h,
      COUNT(*) FILTER (
        WHERE ma.created_at > NOW() - INTERVAL '24 hours'
          AND ma.processing_status = 'failed'
      )::int AS failed_24h,
      COUNT(*) FILTER (WHERE ma.av_status = 'pending')::int AS av_pending_count,
      COUNT(*) FILTER (
        WHERE ma.created_at > NOW() - INTERVAL '24 hours'
          AND ma.av_status = 'error'
      )::int AS av_error_24h,
      COUNT(*) FILTER (
        WHERE ma.created_at > NOW() - INTERVAL '24 hours'
          AND ma.av_status = 'infected'
      )::int AS av_infected_24h
    FROM media_attachments ma
    JOIN messages m ON m.id = ma.message_id
    JOIN conversations c ON c.id = m.conversation_id
    GROUP BY c.channel
  `);
}

function normalizeQueueCounts(counts: Record<string, number> | null | undefined): QueueCountsSignal {
  return {
    waiting: counts?.['waiting'] ?? 0,
    active: counts?.['active'] ?? 0,
    delayed: counts?.['delayed'] ?? 0,
    failed: counts?.['failed'] ?? 0,
  };
}

async function getQueueCounts(loadQueue: () => Promise<QueueLike | null>): Promise<QueueCountsSignal> {
  try {
    const queue = await loadQueue();
    if (!queue) return { ...EMPTY_QUEUE_COUNTS };
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    return normalizeQueueCounts(counts);
  } catch (err) {
    log.warn('Queue health read failed', { error: err instanceof Error ? err.message : String(err) });
    return { ...EMPTY_QUEUE_COUNTS };
  }
}

async function getPipelineQueues(): Promise<PipelineQueuesSignal> {
  const [inbound, status, outbound, media, mediaDlq, avScan] = await Promise.all([
    getQueueCounts(async () => (await import('./connectors/pipeline/webhook-receiver.js')).getInboundQueue()),
    getQueueCounts(async () => (await import('./connectors/pipeline/webhook-receiver.js')).getStatusQueue()),
    getQueueCounts(async () => (await import('./connectors/pipeline/outbound-worker.js')).outboundQueue),
    getQueueCounts(async () => (await import('./connectors/pipeline/inbound-worker.js')).mediaQueue),
    getQueueCounts(async () => (await import('./connectors/pipeline/dlq-worker.js')).dlqQueue),
    getQueueCounts(async () => (await import('./av-scan-worker.js')).getAvScanQueue()),
  ]);

  return { inbound, status, outbound, media, mediaDlq, avScan };
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function telegramApiUrl(token: string, method: string): string {
  return `${config.telegram.apiUrl}/bot${token}/${method}`;
}

function isTelegramPermanentPollingMode(): boolean {
  const mode = (
    process.env['TELEGRAM_POLLING_MODE']
    || process.env['TELEGRAM_POLLING_FALLBACK_MODE']
    || ''
  ).trim().toLowerCase();
  return mode === 'always' || mode === 'polling' || mode === 'permanent' || mode === 'force';
}

function expectedTelegramWebhookUrl(accountWebhookUrl: string | null): string {
  return process.env['TELEGRAM_WEBHOOK_URL']?.trim()
    || accountWebhookUrl
    || `${process.env['BASE_URL'] || 'https://svoefoto.ru'}/api/webhooks/telegram`;
}

interface TelegramJsonResult<T> {
  data: T | null;
  error: string | null;
}

async function fetchTelegramJson<T>(botToken: string, method: string): Promise<TelegramJsonResult<T>> {
  try {
    const response = await fetchWithTimeout(telegramApiUrl(botToken, method), { method: 'GET', timeout: 10_000 });
    const text = await response.text();
    let data: T | null = null;
    try {
      data = text ? JSON.parse(text) as T : null;
    } catch {
      return { data: null, error: `Telegram ${method}: invalid JSON (${text.slice(0, 160)})` };
    }

    if (!response.ok) {
      return { data, error: `Telegram ${method}: HTTP ${response.status} ${text.slice(0, 160)}` };
    }
    return { data, error: null };
  } catch (err) {
    return { data: null, error: `Telegram ${method}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function updateAccountHealthProbe(accountId: string, ok: boolean, error: string | null): Promise<void> {
  try {
    await db.query(
      `UPDATE channel_accounts
       SET last_health_check_at = NOW(),
           health_check_ok = $2,
           health_check_error = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [accountId, ok, error],
    );
  } catch (err) {
    log.warn('Failed to update channel account health probe', {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type TelegramApiResponse<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

type TelegramGetMeResult = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
};

type TelegramWebhookInfoResult = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
};

async function getTelegramBotApiSignal(): Promise<TelegramBotApiSignal> {
  const checkedAt = new Date().toISOString();
  const mode: TelegramBotApiSignal['mode'] = isTelegramPermanentPollingMode() ? 'polling' : 'webhook';
  const empty: TelegramBotApiSignal = {
    mode,
    getMeOk: null,
    botUsername: null,
    pendingUpdateCount: null,
    webhookUrl: null,
    webhookUrlSet: false,
    expectedWebhookUrl: null,
    lastError: null,
    checkedAt,
  };

  const account = await getAccountByChannel('telegram');
  if (!account) {
    return { ...empty, getMeOk: false, lastError: 'Активный Telegram account не найден' };
  }

  const botToken = asString(account.credentials['botToken']);
  if (!botToken) {
    await updateAccountHealthProbe(account.id, false, 'Bot token not configured');
    return {
      ...empty,
      expectedWebhookUrl: mode === 'webhook' ? expectedTelegramWebhookUrl(account.webhookUrl) : null,
      getMeOk: false,
      lastError: 'Bot token not configured',
    };
  }

  const [meResult, webhookResult] = await Promise.all([
    fetchTelegramJson<TelegramApiResponse<TelegramGetMeResult>>(botToken, 'getMe'),
    fetchTelegramJson<TelegramApiResponse<TelegramWebhookInfoResult>>(botToken, 'getWebhookInfo'),
  ]);

  const me = meResult.data;
  const webhook = webhookResult.data;
  const getMeOk = !!me?.ok;
  const webhookInfo = webhook?.result;
  const webhookUrl = asString(webhookInfo?.url);
  const telegramApiError = meResult.error
    || (me && me.ok === false ? me.description || `Telegram getMe error ${me.error_code ?? ''}` : null)
    || webhookResult.error
    || (webhook && webhook.ok === false ? webhook.description || `Telegram getWebhookInfo error ${webhook.error_code ?? ''}` : null)
    || (mode === 'webhook' ? asString(webhookInfo?.last_error_message) : null);

  await updateAccountHealthProbe(account.id, getMeOk, getMeOk ? null : telegramApiError || 'Telegram getMe failed');

  return {
    mode,
    getMeOk,
    botUsername: asString(me?.result?.username),
    pendingUpdateCount: typeof webhookInfo?.pending_update_count === 'number'
      ? webhookInfo.pending_update_count
      : null,
    webhookUrl,
    webhookUrlSet: mode === 'webhook' && !!webhookUrl,
    expectedWebhookUrl: mode === 'webhook' ? expectedTelegramWebhookUrl(account.webhookUrl) : null,
    lastError: telegramApiError,
    checkedAt,
  };
}

async function getClamAvSignal(): Promise<ClamAvSignal> {
  const checkedAt = new Date().toISOString();
  try {
    await execFileAsync('/usr/bin/clamdscan', ['--version'], { timeout: 3000 });
    return { available: true, mode: 'clamdscan', error: null, checkedAt };
  } catch (clamdErr) {
    try {
      await execFileAsync('/usr/bin/clamscan', ['--version'], { timeout: 3000 });
      return { available: true, mode: 'clamscan', error: null, checkedAt };
    } catch (clamscanErr) {
      const error = clamscanErr instanceof Error
        ? clamscanErr.message
        : String(clamscanErr || clamdErr);
      return { available: false, mode: 'unavailable', error, checkedAt };
    }
  }
}

function buildInboundSignal(
  webhookRow: InboundHealthRow | undefined,
  messageRow: InboundMessageRow | undefined,
): InboundHealthSignal {
  return {
    lastReceivedAt: webhookRow?.last_received_at ?? null,
    lastProcessedAt: webhookRow?.last_processed_at ?? null,
    lastMessageAt: messageRow?.last_message_at ?? null,
    received24h: toNumber(webhookRow?.received_24h),
    processed24h: toNumber(webhookRow?.processed_24h),
    processedMessages24h: toNumber(messageRow?.processed_messages_24h),
    failed24h: toNumber(webhookRow?.failed_24h),
    skipped24h: toNumber(webhookRow?.skipped_24h),
    errorRate: webhookRow ? Number(webhookRow.error_rate) : 0,
    lastError: webhookRow?.last_error ?? null,
  };
}

function buildMediaSignal(row: MediaHealthRow | undefined, clamAv: ClamAvSignal): MediaHealthSignal {
  return {
    total24h: toNumber(row?.total_24h),
    failed24h: toNumber(row?.failed_24h),
    avPendingCount: toNumber(row?.av_pending_count),
    avError24h: toNumber(row?.av_error_24h),
    avInfected24h: toNumber(row?.av_infected_24h),
    clamAv,
  };
}

function hasQueuePressure(queues: PipelineQueuesSignal): boolean {
  return queues.inbound.failed > 0
    || queues.inbound.waiting > 50
    || queues.media.failed > 0
    || queues.mediaDlq.waiting > 0
    || queues.mediaDlq.failed > 0
    || queues.avScan.failed > 0;
}

/** Compute health level from signals */
function computeHealthLevel(
  cbState: 'CLOSED' | 'OPEN' | 'HALF_OPEN',
  disabled: boolean,
  connectorEnabled: boolean,
  webhook: WebhookFreshnessSignal,
  queue: QueueHealthSignal,
  token: TokenHealthSignal | null,
  inbound: InboundHealthSignal,
  queues: PipelineQueuesSignal,
  media: MediaHealthSignal,
  telegram: TelegramBotApiSignal | null,
): HealthLevel {
  // Down conditions — only real failures
  if (cbState === 'OPEN') return 'down';
  if (disabled || !connectorEnabled) return 'down';
  if (telegram?.getMeOk === false) return 'down';

  // Degraded conditions
  if (cbState === 'HALF_OPEN') return 'degraded';
  if (webhook.errorRate > 10) return 'degraded';
  if (inbound.failed24h > 0) return 'degraded';
  if (hasQueuePressure(queues)) return 'degraded';
  if (media.failed24h > 0 || media.avError24h > 0 || media.avInfected24h > 0) return 'degraded';
  if (!media.clamAv.available && (media.total24h > 0 || media.avPendingCount > 0)) return 'degraded';
  if (queue.deadLetterCount > 10) return 'degraded';
  if (token?.healthCheckOk === false) return 'degraded';
  if (token && token.daysUntilExpiry !== null && token.daysUntilExpiry < 7) return 'degraded';
  if (queue.oldestPendingAgeSeconds !== null && queue.oldestPendingAgeSeconds > 300) return 'degraded'; // >5min
  if (telegram?.mode === 'webhook' && !telegram.webhookUrlSet) return 'degraded';
  // Webhook staleness — soft warning, not a failure (no traffic ≠ broken channel)
  if (webhook.lastReceivedAt) {
    const lastWebhookMs = Date.now() - new Date(webhook.lastReceivedAt).getTime();
    if (lastWebhookMs > 24 * 60 * 60 * 1000) return 'degraded';
  }

  // No activity ever — channel configured but never used
  if (!inbound.lastReceivedAt && inbound.processedMessages24h === 0 && webhook.total24h === 0) return 'idle';

  return 'healthy';
}

/** Build a human-readable summary line */
function buildSummary(
  health: HealthLevel,
  inbound: InboundHealthSignal,
  queue: QueueHealthSignal,
  token: TokenHealthSignal | null,
  queues: PipelineQueuesSignal,
  media: MediaHealthSignal,
  telegram: TelegramBotApiSignal | null,
  cbState: string,
  disabled: boolean,
): string {
  if (disabled) return 'Канал отключён администратором';
  if (cbState === 'OPEN') return 'Circuit Breaker OPEN — канал остановлен';
  if (cbState === 'HALF_OPEN') return 'Circuit Breaker HALF_OPEN — пробная доставка';
  if (telegram?.getMeOk === false) return `Telegram Bot API недоступен${telegram.lastError ? `: ${telegram.lastError}` : ''}`;

  const parts: string[] = [];

  if (telegram) {
    parts.push(telegram.mode === 'polling' ? 'Telegram: polling' : 'Telegram: webhook');
    if (telegram.mode === 'webhook' && !telegram.webhookUrlSet) {
      parts.push('webhook не установлен');
    }
  }

  if (inbound.lastReceivedAt) {
    const agoMs = Date.now() - new Date(inbound.lastReceivedAt).getTime();
    if (agoMs < 60_000) {
      parts.push('Inbound < 1 мин назад');
    } else if (agoMs < 3600_000) {
      parts.push(`Inbound ${Math.round(agoMs / 60_000)} мин назад`);
    } else {
      parts.push(`Inbound ${Math.round(agoMs / 3600_000)} ч назад`);
    }
  }

  if (inbound.processedMessages24h > 0) {
    parts.push(`${inbound.processedMessages24h} входящих/24ч`);
  }

  if (token && token.daysUntilExpiry !== null && token.daysUntilExpiry < 7) {
    parts.push(`Токен истекает через ${token.daysUntilExpiry} дн.`);
  }
  if (token?.healthCheckOk === false) {
    parts.push('health check аккаунта failed');
  }

  if (queue.deadLetterCount > 0) {
    parts.push(`${queue.deadLetterCount} dead letters`);
  }

  if (inbound.failed24h > 0) {
    parts.push(`${inbound.failed24h} inbound failed`);
  }
  if (inbound.errorRate > 10) {
    parts.push(`${inbound.errorRate}% inbound ошибок`);
  }
  if (queues.inbound.waiting > 0 || queues.inbound.failed > 0) {
    parts.push(`omni-inbound ${queues.inbound.waiting}/${queues.inbound.failed}`);
  }
  if (queues.media.failed > 0 || queues.mediaDlq.waiting > 0) {
    parts.push(`media failed ${queues.media.failed + queues.mediaDlq.waiting}`);
  }
  if (queues.avScan.failed > 0) {
    parts.push(`av-scan failed ${queues.avScan.failed}`);
  }
  if (media.failed24h > 0) {
    parts.push(`media failed ${media.failed24h}/24ч`);
  }
  if (media.avError24h > 0 || media.avInfected24h > 0) {
    parts.push(`AV error ${media.avError24h}, infected ${media.avInfected24h}`);
  }
  if (!media.clamAv.available && (media.total24h > 0 || media.avPendingCount > 0)) {
    parts.push('ClamAV недоступен');
  }

  if (parts.length > 0) return parts.join(' · ');
  if (health === 'idle') return 'Нет входящих сообщений';
  return 'Всё в порядке';
}

/** Get aggregated health for all channels (with Redis cache) */
export async function getAggregatedHealth(): Promise<ChannelHealthDetail[]> {
  // Try cache first
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as ChannelHealthDetail[];
  } catch {
    // cache miss, continue
  }

  const [
    inboundWebhookRows,
    inboundMessageRows,
    queueRows,
    tokenRows,
    mediaRows,
    metrics,
    breakers,
    queues,
    telegramBot,
    clamAv,
  ] = await Promise.all([
    getInboundWebhookHealth(),
    getInboundMessageHealth(),
    getQueueHealth(),
    getTokenHealth(),
    getMediaHealth(),
    getAllChannelMetrics(),
    Promise.resolve(getAllBreakers()),
    getPipelineQueues(),
    getTelegramBotApiSignal(),
    getClamAvSignal(),
  ]);

  const inboundWebhookMap = new Map(inboundWebhookRows.map(r => [r.channel, r]));
  const inboundMessageMap = new Map(inboundMessageRows.map(r => [r.channel, r]));
  const queueMap = new Map(queueRows.map(r => [r.channel, r]));
  const tokenMap = new Map(tokenRows.map(r => [r.channel, r]));
  const mediaMap = new Map(mediaRows.map(r => [r.channel, r]));

  const results: ChannelHealthDetail[] = [];

  for (const ch of CHANNELS) {
    const adapter = getAdapter(ch);
    const disabled = await isChannelDisabled(ch);
    const breaker = breakers.get(ch);
    const cbState = breaker?.getState() || 'CLOSED';

    const inbound = buildInboundSignal(inboundWebhookMap.get(ch), inboundMessageMap.get(ch));
    const webhook: WebhookFreshnessSignal = {
      lastReceivedAt: inbound.lastReceivedAt,
      total24h: inbound.received24h,
      errors24h: inbound.failed24h,
      errorRate: inbound.errorRate,
    };

    const q = queueMap.get(ch);
    const queue: QueueHealthSignal = {
      pendingCount: q?.pending_count ?? 0,
      failedCount: q?.failed_count ?? 0,
      deadLetterCount: q?.dead_letter_count ?? 0,
      oldestPendingAgeSeconds: q?.oldest_pending_age_seconds ?? null,
    };

    const t = tokenMap.get(ch);
    let token: TokenHealthSignal | null = t
      ? {
          accountName: t.account_name,
          tokenExpiresAt: t.token_expires_at,
          tokenRefreshedAt: t.token_refreshed_at,
          daysUntilExpiry: t.days_until_expiry !== null ? Number(t.days_until_expiry) : null,
          lastHealthCheckAt: t.last_health_check_at,
          healthCheckOk: t.health_check_ok,
          healthCheckError: t.health_check_error,
        }
      : null;

    const telegram = ch === 'telegram' ? telegramBot : null;
    if (telegram && token && telegram.getMeOk !== null) {
      token = {
        ...token,
        lastHealthCheckAt: telegram.checkedAt,
        healthCheckOk: telegram.getMeOk,
        healthCheckError: telegram.getMeOk ? null : telegram.lastError,
      };
    }

    const media = buildMediaSignal(mediaMap.get(ch), clamAv);
    const connectorEnabled = !!adapter;
    const health = computeHealthLevel(
      cbState,
      disabled,
      connectorEnabled,
      webhook,
      queue,
      token,
      inbound,
      queues,
      media,
      telegram,
    );
    const summary = buildSummary(health, inbound, queue, token, queues, media, telegram, cbState, disabled);

    results.push({
      channel: ch,
      health,
      connectorEnabled,
      disabled,
      circuitBreaker: {
        state: cbState,
        failures: breaker?.getFailures() ?? 0,
        lastError: breaker?.getLastError() ?? null,
        lastSuccessAt: breaker?.getLastSuccessAt() ?? null,
        lastFailureAt: breaker?.getLastFailureAt() ?? null,
      },
      webhook,
      inbound,
      queue,
      queues,
      token,
      telegram,
      media,
      summary,
    });
  }

  // Cache result
  try {
    await redis.set(CACHE_KEY, JSON.stringify(results), 'EX', CACHE_TTL);
  } catch {
    // non-critical
  }

  return results;
}

/** Get health for a single channel (from cache or fresh) */
export async function getChannelHealthDetail(channel: string): Promise<ChannelHealthDetail | null> {
  const all = await getAggregatedHealth();
  return all.find(h => h.channel === channel) ?? null;
}

/** Invalidate cached health data (call on significant state changes) */
export async function invalidateHealthCache(): Promise<void> {
  try {
    await redis.del(CACHE_KEY);
  } catch {
    // non-critical
  }
}
