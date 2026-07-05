/**
 * Omnichannel v2 — Outbound Worker
 *
 * Persistent outbound message queue backed by PG + BullMQ scheduling.
 *
 * Flow:
 * 1. Operator/bot inserts into `outbound_queue` (PG table)
 * 2. BullMQ scheduler polls for pending items
 * 3. Circuit breaker check per channel/account
 * 4. adapter.sendText/sendMedia → external platform
 * 5. On success: UPDATE status='delivered', INSERT message_statuses
 * 6. On failure: increment attempts, exponential backoff, schedule retry
 * 7. After max_attempts: status='dead_letter', alert
 *
 * Benefits over old BullMQ-only approach:
 * - Persistent even if Redis restarts
 * - Full SQL queryability (dead letter audit, retry management)
 * - PG LISTEN/NOTIFY for immediate wake-up (no polling delay)
 */

import { Worker, Queue } from 'bullmq';
import type { Job } from 'bullmq';
import db from '../../../database/db.js';
import { config } from '../../../config/index.js';
import { getAdapterOrThrow } from '../core/adapter-registry.js';
import { getAccountById, getAccountByChannel } from '../core/account-store.js';
import { withCircuitBreaker } from '../core/circuit-breaker.js';
import { broadcastStatusUpdate } from './broadcast.js';
import type { ChannelType, DeliveryStatus, MessageType } from '../core/types.js';
import { recordSent, recordFailed } from '../../channel-metrics.service.js';
import { alertDeadLetterThreshold } from '../../alerting.service.js';
import { createLogger } from '../../../utils/logger.js';
import { captureException } from '../../../utils/error-tracker.js';
import { getRequestId, runWithRequestId } from '../../../middleware/request-context.js';
import { storageService } from '../../storage.service.js';
import { isBotPaused, getBotPauseMs, pauseBot } from '../../broadcast/broadcast-governor.js';
import type Conversations from '../../../types/generated/public/Conversations.js';

const log = createLogger('outbound-worker');
const DEFAULT_MAX_ATTEMPTS = 5;
const PAYMENT_LINK_URL_PATTERN = /https:\/\/svoefoto\.ru\/pay\/[\w-]+/;

function extractPaymentUrl(content: string): string | null {
  return content.match(PAYMENT_LINK_URL_PATTERN)?.[0] ?? null;
}

function resolveMaxAttempts(content: string, maxAttempts: number): number {
  if (!extractPaymentUrl(content)) return maxAttempts;
  // Messenger send APIs are not idempotent; an ambiguous timeout can still deliver a visible invoice.
  return Math.min(maxAttempts, 1);
}

/** Telegram bot token from a channel account's credentials (governor pause key). */
function resolveTelegramBotToken(credentials: Record<string, unknown>): string | null {
  const token = credentials['botToken'];
  return typeof token === 'string' && token ? token : null;
}

/**
 * Governor backpressure: re-queue an outbound row without consuming an attempt.
 * Mirrors handleFailure's retry-scheduling but leaves attempts/last_error untouched —
 * the bot is paused, not failing. The retry-scanner re-enqueues at next_retry_at.
 */
async function requeueForGovernorPause(item: OutboundRow, pauseMs: number): Promise<void> {
  const delayMs = pauseMs > 0 ? pauseMs : 1000;
  const nextRetryAt = new Date(Date.now() + delayMs);
  await db.query(
    `UPDATE outbound_queue SET
       status = 'failed',
       next_retry_at = $2,
       updated_at = NOW()
     WHERE id = $1`,
    [item.id, nextRetryAt.toISOString()],
  );
  await outboundQueue.add('send', { queueItemId: item.id }, {
    delay: delayMs,
    attempts: 1,
    removeOnComplete: { count: 5000 },
    removeOnFail: { count: 10000 },
  });
  log.debug('outbound deferred — bot paused (governor)', {
    queueItemId: item.id,
    channel: item.channel,
    pauseMs: delayMs,
  });
}

// ─── BullMQ setup ─────────────────────────────────────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

const outboundQueue = new Queue('omni-outbound', { connection: { ...redisOpts } });

// ─── Enqueue API ──────────────────────────────────────────────────────────────

export interface EnqueueOutboundParams {
  channel: ChannelType;
  accountId?: string;
  externalChatId: string;
  content: string;
  messageType?: MessageType;
  attachmentUrl?: string;
  sourceMessageId?: string;
  conversationId?: string;
  replyToExternalId?: string;
  maxAttempts?: number;
  /** Idempotency key — когда задан, повторный INSERT с тем же ключом
   *  тихо игнорируется (ON CONFLICT DO NOTHING). Используется ai-turn-worker
   *  для защиты от дублей при перезапусках/гонках. */
  dedupKey?: string;
}

/**
 * Enqueue an outbound message.
 * Inserts into PG outbound_queue AND schedules a BullMQ job for immediate processing.
 */
export async function enqueueOutbound(params: EnqueueOutboundParams): Promise<string> {
  const {
    channel,
    accountId,
    externalChatId,
    content,
    messageType = 'text',
    attachmentUrl,
    sourceMessageId,
    conversationId,
    replyToExternalId,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    dedupKey,
  } = params;

  // Resolve account if not provided
  const resolvedAccountId = accountId || (await getAccountByChannel(channel))?.id || null;
  const resolvedMaxAttempts = resolveMaxAttempts(content, maxAttempts);

  const row = await db.queryOne<OutboundQueueIdRow>(
    `INSERT INTO outbound_queue
      (channel, account_id, external_chat_id, content, message_type,
       attachment_url, source_message_id, conversation_id,
       reply_to_external_id, max_attempts, status, next_retry_at, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW(), $11)
     ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      channel,
      resolvedAccountId,
      externalChatId,
      content,
      messageType,
      attachmentUrl || null,
      sourceMessageId || null,
      conversationId || null,
      replyToExternalId || null,
      resolvedMaxAttempts,
      dedupKey || null,
    ],
  );

  // ON CONFLICT DO NOTHING — дубль тихо проигнорирован, возвращаем пустую строку
  if (!row) {
    log.debug('outbound enqueue skipped — dedup key conflict', { dedupKey, channel, externalChatId });
    return '';
  }

  const queueItemId = row.id;

  // Schedule immediate processing via BullMQ (with requestId for tracing)
  await outboundQueue.add('send', { queueItemId, _requestId: getRequestId() }, {
    attempts: 1, // Retry logic is in PG, not BullMQ
    removeOnComplete: { count: 5000 },
    removeOnFail: { count: 10000 },
  });

  log.debug('outbound enqueued', { queueItemId, channel, externalChatId });
  return queueItemId;
}

// ─── Outbound queue row ───────────────────────────────────────────────────────

interface OutboundRow {
  id: string;
  channel: ChannelType;
  account_id: string | null;
  external_chat_id: string;
  content: string;
  message_type: MessageType;
  attachment_url: string | null;
  source_message_id: string | null;
  conversation_id: string | null;
  reply_to_external_id: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  external_response: OutboundExternalResponse | null;
}

interface OutboundQueueIdRow {
  id: string;
}

interface OutboundExternalResponse {
  externalMessageId?: string;
  mediaDelivery?: OutboundMediaDeliveryDebug;
  [key: string]: unknown;
}

interface OutboundMediaDeliveryDebug {
  messageType: MessageType;
  scheme?: string;
  host?: string;
  path?: string;
  hasQuery?: boolean;
  parseError?: boolean;
}

// ─── Worker processor ─────────────────────────────────────────────────────────

// Exported as a test seam: the governor pre-send gate (Telegram) is exercised by
// calling this directly with mocked db/governor/adapter.
export async function processOutbound(job: Job<{ queueItemId: string; _requestId?: string }>): Promise<void> {
  // Restore requestId from job data for distributed tracing
  return runWithRequestId(job.data._requestId, () => processOutboundInner(job));
}

async function processOutboundInner(job: Job<{ queueItemId: string; _requestId?: string }>): Promise<void> {
  const { queueItemId } = job.data;

  // 1. Load queue item — lock it with FOR UPDATE SKIP LOCKED
  const item = await db.queryOne<OutboundRow>(
    `UPDATE outbound_queue SET status = 'processing', updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'failed')
     RETURNING *`,
    [queueItemId],
  );

  if (!item) {
    // Already processing/delivered/cancelled
    return;
  }

  const persistedExternalMessageId = getPersistedExternalMessageId(item);
  if (persistedExternalMessageId) {
    try {
      await finalizeDelivered(item, persistedExternalMessageId);
    } catch (err) {
      await markDeliveredFinalizationError(item.id, String(err));
      captureException(err, {
        tags: { worker: 'outbound', channel: item.channel },
        extra: { queueItemId: item.id, externalMessageId: persistedExternalMessageId },
        level: 'error',
      });
    }
    return;
  }

  // 2. Load account
  const account = item.account_id
    ? await getAccountById(item.account_id)
    : await getAccountByChannel(item.channel);

  if (!account) {
    await markDeadLetter(item.id, item.channel, 'no active account');
    return;
  }

  const adapter = getAdapterOrThrow(item.channel);

  // 2a. Governor pre-send gate (Telegram only): the broadcast bot shares its token with
  // live support. If a broadcast 429 paused the token, do NOT send — re-queue this row
  // (next_retry_at = now + pauseMs) WITHOUT consuming an attempt, so the freeze on the
  // ad line never starves transactional sends of their retries.
  if (item.channel === 'telegram') {
    const botToken = resolveTelegramBotToken(account.credentials);
    if (botToken && (await isBotPaused(botToken))) {
      await requeueForGovernorPause(item, await getBotPauseMs(botToken));
      return;
    }
  }

  // 2b. 24h reply window check (WhatsApp + Instagram)
  if (item.channel === 'whatsapp' || item.channel === 'instagram') {
    const conv = await db.queryOne<Pick<Conversations, 'last_message_at'>>(
      `SELECT last_message_at FROM conversations
       WHERE channel = $1 AND metadata->>'externalChatId' = $2
         AND status NOT IN ('closed')
       ORDER BY last_message_at DESC LIMIT 1`,
      [item.channel, item.external_chat_id],
    );
    if (conv?.last_message_at) {
      const hoursSince = (Date.now() - new Date(conv.last_message_at).getTime()) / (1000 * 60 * 60);
      if (hoursSince > 24) {
        log.warn(`${item.channel} 24h window expired — moving to dead letter`, {
          queueItemId: item.id,
          channel: item.channel,
          externalChatId: item.external_chat_id,
          hoursSince: hoursSince.toFixed(1),
        });
        await markDeadLetter(item.id, item.channel, `${item.channel} 24h window expired (${hoursSince.toFixed(1)}h)`);
        return;
      }
    }
  }

  // 2c. AI-agent suppress gate: если сообщение от бота (sender_type='bot') и оператор
  // успел перехватить диалог пока строка ждала в очереди — отменяем отправку.
  // Подавляем при ЛЮБОМ ai_agent_mode != 'bot' (operator ИЛИ off): кнопка «Взять»
  // во фронте при bot-режиме переводит диалог в 'off', а не в 'operator', и узкая
  // проверка `=== 'operator'` пропустила бы ответ бота уже после перехвата.
  // source_message_id ссылается на запись messages, где хранится sender_type.
  if (item.source_message_id && item.conversation_id) {
    const msgRow = await db.queryOne<{ sender_type: string }>(
      `SELECT sender_type FROM messages WHERE id = $1`,
      [item.source_message_id],
    );
    if (msgRow?.sender_type === 'bot') {
      const convRow = await db.queryOne<{ ai_agent_mode: string }>(
        `SELECT ai_agent_mode FROM conversations WHERE id = $1`,
        [item.conversation_id],
      );
      if (convRow && convRow.ai_agent_mode !== 'bot') {
        await db.query(
          `UPDATE outbound_queue SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
          [item.id],
        );
        log.info('outbound bot message suppressed — conversation no longer in bot mode', {
          queueItemId: item.id,
          conversationId: item.conversation_id,
          channel: item.channel,
          aiAgentMode: convRow.ai_agent_mode,
        });
        return;
      }
    }
  }

  // 3. Send via adapter with circuit breaker
  try {
    // Resolve S3 URL to a provider-fetchable signed URL for external delivery.
    let mediaUrl = item.attachment_url;
    if (mediaUrl && storageService.isS3Url(mediaUrl)) {
      mediaUrl = await resolveOutboundMediaUrl(item, mediaUrl);
    }
    const mediaDelivery = mediaUrl && item.message_type !== 'text'
      ? describeMediaDelivery(mediaUrl, item.message_type)
      : undefined;
    if (mediaDelivery) {
      await persistExternalSendMetadata(item.id, { mediaDelivery });
      log.info('outbound media delivery prepared', {
        queueItemId: item.id,
        channel: item.channel,
        ...mediaDelivery,
      });
    }

    const result = await withCircuitBreaker(item.channel, account.id, async () => {
      if (mediaUrl && item.message_type !== 'text') {
        return adapter.sendMedia(
          account, item.external_chat_id, mediaUrl,
          item.message_type, item.content || undefined,
          item.content || undefined, item.reply_to_external_id || undefined,
        );
      }
      // Payment link detection → inline button if adapter supports it
      const paymentUrl = extractPaymentUrl(item.content);
      if (paymentUrl && adapter.sendWithInlineButton) {
        const cleanText = item.content
          .replace(paymentUrl, '')
          .replace(/Ссылка на оплату:\s*/i, '')
          .trim() || 'Оплата заказа — Своё Фото';
        return adapter.sendWithInlineButton(
          account, item.external_chat_id, cleanText,
          '💳 Оплатить на сайте', paymentUrl,
        );
      }
      // WhatsApp: rich formatting for payment messages (no inline buttons)
      if (paymentUrl && item.channel === 'whatsapp') {
        const cleanText = item.content
          .replace(paymentUrl, '')
          .replace(/Ссылка на оплату:\s*/i, '')
          .trim();
        // Extract amount from text like "💳 К оплате: 1500₽"
        const amountMatch = cleanText.match(/(\d[\d\s]*)\s*₽/);
        const amount = amountMatch ? amountMatch[1].replace(/\s/g, '') : '';
        // Extract description (everything after the first line)
        const lines = cleanText.split('\n').filter(Boolean);
        const description = lines.length > 1 ? lines.slice(1).join('\n') : '';
        const formattedText = [
          amount ? `*💳 К оплате: ${amount}₽*` : '*💳 Оплата заказа*',
          description ? description : 'Своё Фото',
          '',
          `👉 Для оплаты перейдите по ссылке:\n${paymentUrl}`,
        ].join('\n');
        return adapter.sendText(
          account, item.external_chat_id, formattedText,
          item.reply_to_external_id || undefined,
        );
      }
      return adapter.sendText(
        account, item.external_chat_id, item.content,
        item.reply_to_external_id || undefined,
      );
    });

    if (result.success) {
      try {
        await persistExternalSendMarker(item.id, result.externalMessageId);
        await finalizeDelivered(item, result.externalMessageId);
      } catch (err) {
        await markDeliveredFinalizationError(item.id, String(err));
        captureException(err, {
          tags: { worker: 'outbound', channel: item.channel },
          extra: { queueItemId: item.id, externalMessageId: result.externalMessageId },
          level: 'error',
        });
        return;
      }
      recordSent(item.channel);

      log.debug('outbound delivered', {
        queueItemId: item.id,
        channel: item.channel,
        externalMessageId: result.externalMessageId,
      });
    } else {
      // Telegram 429 on the transactional line → arm the shared-token governor pause so
      // the broadcast worker also yields (symmetry). The row still retries via handleFailure.
      if (item.channel === 'telegram' && result.errorCode === '429') {
        const botToken = resolveTelegramBotToken(account.credentials);
        if (botToken) {
          const ms = Math.min(((result.retryAfter ?? 1) * 1000), 30_000);
          await pauseBot(botToken, ms);
        }
      }
      // Non-retryable errors (e.g. expired messaging window) → dead letter immediately
      if (result.errorCode === 'WINDOW_EXPIRED') {
        await markDeadLetter(item.id, item.channel, result.errorMessage || 'messaging window expired');
      } else {
        // Send returned failure (not a throw — API responded with error)
        await handleFailure(item, result.errorMessage || 'send failed');
      }
    }
  } catch (err) {
    // Network/circuit breaker error
    await handleFailure(item, String(err));
  }
}

function getSuccessStatus(channel: ChannelType): DeliveryStatus {
  // Max Bot API does not expose separate delivered/read receipt updates.
  // A successful send with an external mid means the message is present in the chat.
  return channel === 'max' ? 'delivered' : 'sent';
}

function getPersistedExternalMessageId(item: OutboundRow): string | undefined {
  const value = item.external_response?.['externalMessageId'];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

async function resolveOutboundMediaUrl(item: OutboundRow, mediaUrl: string): Promise<string> {
  const whatsappRelayUrl = item.channel === 'whatsapp'
    ? buildWhatsAppMediaDeliveryUrl(mediaUrl, item.id)
    : undefined;

  if (whatsappRelayUrl) {
    return whatsappRelayUrl;
  }

  return storageService.resolveExternalDeliveryUrl(mediaUrl, 24 * 3600, item.id);
}

function buildWhatsAppMediaDeliveryUrl(mediaUrl: string, queueItemId: string): string | undefined {
  const baseUrl = config.whatsapp.mediaDeliveryUrl.trim();
  if (!baseUrl) {
    return undefined;
  }

  const key = storageService.keyFromUrl(mediaUrl);
  if (!key || !key.startsWith('chat/')) {
    return undefined;
  }

  try {
    const url = new URL(baseUrl);
    const basePath = url.pathname.replace(/\/+$/, '');
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    url.pathname = `${basePath}/${encodedKey}`;
    url.searchParams.set('wa_delivery', queueItemId);
    return url.toString();
  } catch {
    log.warn('invalid WHATSAPP_MEDIA_DELIVERY_URL; using default media delivery');
    return undefined;
  }
}

function describeMediaDelivery(mediaUrl: string, messageType: MessageType): OutboundMediaDeliveryDebug {
  try {
    const url = new URL(mediaUrl);
    return {
      messageType,
      scheme: url.protocol.replace(/:$/, ''),
      host: url.host,
      path: url.pathname,
      hasQuery: url.search.length > 0,
    };
  } catch {
    return { messageType, parseError: true };
  }
}

async function persistExternalSendMetadata(
  queueItemId: string,
  metadata: OutboundExternalResponse,
): Promise<void> {
  await db.query(
    `UPDATE outbound_queue
     SET external_response = COALESCE(external_response, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [queueItemId, JSON.stringify(metadata)],
  );
}

async function persistExternalSendMarker(queueItemId: string, externalMessageId?: string): Promise<void> {
  if (!externalMessageId) return;
  await db.query(
    `UPDATE outbound_queue
     SET external_response = COALESCE(external_response, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [queueItemId, JSON.stringify({ externalMessageId })],
  );
}

async function finalizeDelivered(item: OutboundRow, externalMessageId?: string): Promise<void> {
  const successStatus = getSuccessStatus(item.channel);
  await db.query(
    `UPDATE outbound_queue SET
       status = 'delivered',
       delivered_at = COALESCE(delivered_at, NOW()),
       external_response = COALESCE(external_response, '{}'::jsonb) || $2::jsonb,
       last_error = NULL,
       updated_at = NOW()
     WHERE id = $1`,
    [item.id, JSON.stringify(externalMessageId ? { externalMessageId } : {})],
  );

  if (item.source_message_id) {
    if (externalMessageId) {
      await db.query(
        successStatus === 'delivered'
          ? `UPDATE messages SET
               delivery_status = 'delivered',
               delivered_at = COALESCE(delivered_at, NOW()),
               external_message_id = COALESCE(external_message_id, $2)
             WHERE id = $1`
          : `UPDATE messages SET
               delivery_status = 'sent',
               external_message_id = COALESCE(external_message_id, $2)
             WHERE id = $1`,
        [item.source_message_id, externalMessageId],
      );
    } else {
      await db.query(
        successStatus === 'delivered'
          ? `UPDATE messages SET
               delivery_status = 'delivered',
               delivered_at = COALESCE(delivered_at, NOW())
             WHERE id = $1`
          : `UPDATE messages SET delivery_status = 'sent' WHERE id = $1`,
        [item.source_message_id],
      );
    }

    await db.query(
      `INSERT INTO message_statuses (message_id, status) VALUES ($1, $2)`,
      [item.source_message_id, successStatus],
    );
  }

  if (item.conversation_id && item.source_message_id) {
    broadcastStatusUpdate(item.conversation_id, item.source_message_id, successStatus);
  }
}

async function markDeliveredFinalizationError(queueItemId: string, errorMessage: string): Promise<void> {
  await db.query(
    `UPDATE outbound_queue SET
       status = 'delivered',
       delivered_at = COALESCE(delivered_at, NOW()),
       last_error = $2,
       updated_at = NOW()
     WHERE id = $1`,
    [queueItemId, `post-send finalization failed: ${errorMessage}`],
  );
}

// ─── Failure handling ─────────────────────────────────────────────────────────

async function handleFailure(item: OutboundRow, errorMessage: string): Promise<void> {
  const newAttempts = item.attempts + 1;

  if (newAttempts >= item.max_attempts) {
    await markDeadLetter(item.id, item.channel, errorMessage);
    return;
  }

  // Exponential backoff: 5s, 10s, 20s, 40s, 80s
  const delayMs = 5000 * Math.pow(2, newAttempts - 1);
  const nextRetryAt = new Date(Date.now() + delayMs);

  await db.query(
    `UPDATE outbound_queue SET
       status = 'failed',
       attempts = $2,
       last_error = $3,
       next_retry_at = $4,
       updated_at = NOW()
     WHERE id = $1`,
    [item.id, newAttempts, errorMessage, nextRetryAt.toISOString()],
  );

  // Schedule retry via BullMQ
  await outboundQueue.add('send', { queueItemId: item.id }, {
    delay: delayMs,
    attempts: 1,
    removeOnComplete: { count: 5000 },
    removeOnFail: { count: 10000 },
  });

  // Broadcast failure status
  if (item.conversation_id && item.source_message_id) {
    broadcastStatusUpdate(item.conversation_id, item.source_message_id, 'failed', errorMessage);
  }

  recordFailed(item.channel);

  log.warn('outbound failed, scheduled retry', {
    queueItemId: item.id,
    channel: item.channel,
    attempt: newAttempts,
    maxAttempts: item.max_attempts,
    nextRetryAt: nextRetryAt.toISOString(),
    error: errorMessage,
  });
}

async function markDeadLetter(queueItemId: string, channel: ChannelType, errorMessage: string): Promise<void> {
  await db.query(
    `UPDATE outbound_queue SET
       status = 'dead_letter',
       last_error = $2,
       updated_at = NOW()
     WHERE id = $1`,
    [queueItemId, errorMessage],
  );

  log.error('outbound moved to dead letter', { queueItemId, channel, error: errorMessage });

  recordFailed(channel);

  // Alert ops — dedup handled by alerting.service (5-min Redis TTL)
  await alertDeadLetterThreshold(channel, 1);
}

// ─── Retry scanner (catches items missed by BullMQ) ───────────────────────────

/**
 * Scan for pending/failed items whose next_retry_at has passed.
 * Called periodically (e.g., every 30s) as a safety net.
 */
export async function scanRetryableItems(): Promise<number> {
  const items = await db.query<OutboundQueueIdRow>(
    `SELECT id FROM outbound_queue
     WHERE status IN ('pending', 'failed')
       AND next_retry_at <= NOW()
     ORDER BY next_retry_at
     LIMIT 50`,
  );

  for (const item of items) {
    await outboundQueue.add('send', { queueItemId: item.id }, {
      attempts: 1,
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 10000 },
    });
  }

  if (items.length > 0) {
    log.info('retryable items re-enqueued', { count: items.length });
  }

  return items.length;
}

// ─── Worker lifecycle ─────────────────────────────────────────────────────────

let worker: Worker | null = null;
let retryInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the outbound worker + retry scanner.
 */
export function startOutboundWorker(): Worker {
  if (worker) return worker;

  worker = new Worker('omni-outbound', processOutbound, {
    connection: { ...redisOpts },
    concurrency: 5,
    limiter: { max: 30, duration: 1000 },
    lockDuration: 15 * 60 * 1000,
    lockRenewTime: 60 * 1000,
    stalledInterval: 2 * 60 * 1000,
    maxStalledCount: 1,
  });

  worker.on('completed', (job) => {
    log.debug('outbound job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    captureException(err, {
      tags: { worker: 'outbound' },
      extra: { jobId: job?.id },
      level: 'error',
    });
    log.error('outbound job failed', {
      jobId: job?.id,
      error: String(err),
    });
  });

  // Start retry scanner every 30 seconds
  retryInterval = setInterval(() => {
    scanRetryableItems().catch(err =>
      log.error('retry scanner failed', { error: String(err) }),
    );
  }, 30_000);

  log.info('outbound worker started');
  return worker;
}

export async function stopOutboundWorker(): Promise<void> {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
  if (worker) {
    await worker.close();
    worker = null;
    log.info('outbound worker stopped');
  }
}

export { outboundQueue };
