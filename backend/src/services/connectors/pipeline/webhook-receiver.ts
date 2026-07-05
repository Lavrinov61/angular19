/**
 * Omnichannel v2 — Webhook Receiver
 *
 * Entry point for all channel webhooks. Handles:
 * 1. Verify webhook authenticity (adapter.verifyWebhook)
 * 2. Handle special events (confirmation, challenge-response)
 * 3. Store raw payload in webhook_events (for replay/debugging)
 * 4. Respond 200 OK immediately (< 50ms target)
 * 5. Emit BullMQ job for async processing (inbound or status worker)
 *
 * Each channel's webhook route calls handleWebhook() and returns its response.
 */

import { Queue } from 'bullmq';
import db from '../../../database/db.js';
import { config } from '../../../config/index.js';
import { getAdapterOrThrow } from '../core/adapter-registry.js';
import { getAccountByChannel } from '../core/account-store.js';
import type { ChannelType } from '../core/types.js';
import type { RawRequest } from '../core/dto.js';
import { createLogger } from '../../../utils/logger.js';
import { getRequestId } from '../../../middleware/request-context.js';

const log = createLogger('webhook-receiver');

// ─── BullMQ Queues ────────────────────────────────────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

const inboundQueue = new Queue('omni-inbound', { connection: { ...redisOpts } });
const statusQueue = new Queue('omni-status', { connection: { ...redisOpts } });

export function getInboundQueue(): Queue { return inboundQueue; }
export function getStatusQueue(): Queue { return statusQueue; }

// ─── Response types ───────────────────────────────────────────────────────────

export interface WebhookResponse {
  /** HTTP status code to return */
  status: number;
  /** Response body (string for challenge/confirmation, 'ok' otherwise) */
  body?: string;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * Handle an incoming webhook from any channel.
 *
 * Flow:
 * 1. Load account + adapter
 * 2. Verify webhook (HMAC, secret, etc.)
 * 3. Handle challenge-response / confirmation (return immediately)
 * 4. Check idempotency (skip duplicate webhooks)
 * 5. Store raw payload in webhook_events
 * 6. Determine if this is a status update or a message
 * 7. Enqueue appropriate BullMQ job
 * 8. Return 200 OK
 */
export async function handleWebhook(
  channel: ChannelType,
  rawRequest: RawRequest,
): Promise<WebhookResponse> {
  // 1. Load account and adapter
  const account = await getAccountByChannel(channel);
  if (!account) {
    log.warn('no active account for channel', { channel });
    return { status: 200, body: 'ok' }; // Don't reveal internals
  }

  const adapter = getAdapterOrThrow(channel);

  // 2. Verify webhook
  const verification = adapter.verifyWebhook(rawRequest, account);

  // 3. Handle challenge-response (WhatsApp/Instagram GET verification)
  if (verification.challengeResponse) {
    return { status: 200, body: verification.challengeResponse };
  }

  // Handle VK confirmation handshake
  if (verification.confirmationCode) {
    return { status: 200, body: verification.confirmationCode };
  }

  if (!verification.valid) {
    log.warn('webhook verification failed', { channel });
    return { status: 200, body: 'ok' }; // 200 to prevent retries from platform
  }

  // 4. Handle special events (non-message: VK message_allow, TG callback_query, etc.)
  if (adapter.isSpecialEvent(rawRequest.body)) {
    try {
      const specialResponse = await adapter.handleSpecialEvent(rawRequest.body, account);
      return { status: 200, body: specialResponse || 'ok' };
    } catch (err) {
      log.error('special event handling failed', { channel, error: String(err) });
      return { status: 200, body: 'ok' };
    }
  }

  // 5+6. Atomic idempotency check + store raw payload (fixes BUG-3 race condition)
  const idempotencyKey = adapter.extractIdempotencyKey(rawRequest.body);

  const webhookEvent = await db.queryOne<{ id: string }>(
    `INSERT INTO webhook_events
      (channel, account_id, raw_headers, raw_body, idempotency_key, source_ip, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      channel,
      account.id,
      JSON.stringify(rawRequest.headers),
      JSON.stringify(rawRequest.body),
      idempotencyKey,
      rawRequest.ip || null,
    ],
  );

  // RETURNING is empty on conflict — duplicate webhook, skip silently
  if (!webhookEvent) {
    log.debug('duplicate webhook skipped', { channel, idempotencyKey });
    return { status: 200, body: 'ok' };
  }

  const webhookEventId = webhookEvent.id;

  // 7. Determine event type and enqueue
  const statusUpdates = adapter.parseStatusUpdate(rawRequest.body);
  const hasStatusUpdates = statusUpdates.length > 0;

  // Status updates go to status queue; messages go to inbound queue.
  // Some webhooks contain both (e.g., WhatsApp) — handle accordingly.
  // Propagate requestId into BullMQ jobs for distributed tracing
  const _requestId = getRequestId();

  if (hasStatusUpdates) {
    await statusQueue.add('process-status', {
      webhookEventId,
      channel,
      accountId: account.id,
      _requestId,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 10000 },
    });
  }

  // Check if there are also inbound messages (WhatsApp sends statuses and messages in same webhook)
  // We always try inbound parse — the worker will handle empty parse results gracefully
  if (!hasStatusUpdates || channel === 'whatsapp') {
    await inboundQueue.add('process-inbound', {
      webhookEventId,
      channel,
      accountId: account.id,
      _requestId,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 10000 },
    });
  }

  log.debug('webhook received and queued', {
    channel,
    webhookEventId,
    idempotencyKey,
    hasStatusUpdates,
  });

  // 8. Return 200 OK immediately
  return { status: 200, body: 'ok' };
}
