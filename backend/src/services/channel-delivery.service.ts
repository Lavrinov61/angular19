/**
 * Channel Delivery Service — v2 Pipeline
 *
 * Delivers operator replies to external channels via v2 ChannelAdapter.
 * Uses adapter-registry + account-store instead of legacy connector registry.
 */

import { getAdapterOrThrow, isChannelDisabled } from './connectors/core/adapter-registry.js';
import { getAccountByChannel } from './connectors/core/account-store.js';
import db from '../database/db.js';
import { recordSent, recordDelivered, recordFailed } from './channel-metrics.service.js';
import { createLogger } from '../utils/logger.js';
import type Conversations from '../types/generated/public/Conversations.js';

const log = createLogger('channel-delivery');

/**
 * Доставить ответ оператора в соответствующий канал.
 * При успешной отправке ставит delivered_at на сообщение.
 */
export async function deliverReply(
  channel: string,
  externalChatId: string,
  content: string,
  messageId?: string,
  messageType?: string,
  attachmentUrl?: string,
  replyToExternalId?: string,
): Promise<boolean> {
  // Skip metrics for web/online/studio — handled via WebSocket
  const trackMetrics = !!channel && !['web', 'online', 'studio'].includes(channel);

  if (trackMetrics) recordSent(channel);
  const startTime = Date.now();

  const ok = await deliverToChannel(channel, externalChatId, content, messageType, attachmentUrl, replyToExternalId);

  if (trackMetrics) {
    if (ok) {
      recordDelivered(channel, Date.now() - startTime);
    } else {
      recordFailed(channel);
    }
  }

  // Mark delivered_at on success
  if (ok && messageId) {
    try {
      await db.query(
        `UPDATE messages SET delivered_at = NOW() WHERE id = $1 AND delivered_at IS NULL`,
        [messageId],
      );
    } catch (err) {
      log.error('delivered_at update failed', { messageId, error: String(err) });
    }
  }

  return ok;
}

/**
 * Raw channel delivery (used by outbound-queue workers).
 * No delivered_at update — that's done by the worker.
 * Uses v2 adapter registry for all channels.
 */
export async function deliverToChannel(
  channel: string,
  externalChatId: string,
  content: string,
  messageType?: string,
  attachmentUrl?: string,
  replyToExternalId?: string,
): Promise<boolean> {
  // Web/online/studio — handled via WebSocket, not external delivery
  if (!channel || ['web', 'online', 'studio'].includes(channel)) {
    return true;
  }

  // Runtime toggle via Redis (admin panel)
  if (await isChannelDisabled(channel)) {
    log.warn('Channel disabled via admin toggle', { channel });
    return false;
  }

  // Load v2 adapter and account
  let adapter;
  try {
    adapter = getAdapterOrThrow(channel as Parameters<typeof getAdapterOrThrow>[0]);
  } catch {
    log.warn('No adapter for channel', { channel });
    return false;
  }

  const account = await getAccountByChannel(channel as Parameters<typeof getAccountByChannel>[0]);
  if (!account) {
    log.warn('No active account for channel', { channel });
    return false;
  }

  // 24-hour reply window check (Instagram + WhatsApp)
  if (channel === 'instagram' || channel === 'whatsapp') {
    try {
      const session = await db.queryOne<Pick<Conversations, 'last_message_at'>>(
        `SELECT last_message_at FROM conversations
         WHERE channel = $1 AND metadata->>'externalChatId' = $2
           AND status NOT IN ('closed')
         ORDER BY last_message_at DESC LIMIT 1`,
        [channel, externalChatId],
      );
      if (session?.last_message_at) {
        const lastMsg = new Date(session.last_message_at);
        const hoursSince = (Date.now() - lastMsg.getTime()) / (1000 * 60 * 60);
        if (hoursSince > 24) {
          log.warn(`${channel} 24h window expired — freeform blocked`, {
            channel,
            externalChatId,
            hoursSince: hoursSince.toFixed(1),
          });
          return false;
        }
      }
    } catch (err) {
      log.error(`${channel} 24h check error`, { channel, externalChatId, error: String(err) });
    }
  }

  try {
    // Media routing: image/video/audio/file → sendMedia, else → sendText
    if (attachmentUrl && messageType && messageType !== 'text') {
      const result = await adapter.sendMedia(
        account,
        externalChatId,
        attachmentUrl,
        messageType as Parameters<typeof adapter.sendMedia>[3],
        content || undefined,
      );
      return result.success;
    }

    // Text
    const result = await adapter.sendText(account, externalChatId, content, replyToExternalId);
    return result.success;
  } catch (err) {
    log.error('Delivery error', { channel, externalChatId, error: String(err) });
    return false;
  }
}
