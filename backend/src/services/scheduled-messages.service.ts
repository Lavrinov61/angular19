import db from '../database/db.js';
import type ScheduledMessages from '../types/generated/public/ScheduledMessages.js';
import type Conversations from '../types/generated/public/Conversations.js';
import type Messages from '../types/generated/public/Messages.js';
import { enqueueOutbound } from './connectors/pipeline/outbound-worker.js';
import { broadcastChatMessage } from './chat-broadcast.service.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scheduled-messages');

const INTERVAL_MS = 30_000; // every 30 seconds
const BATCH_SIZE = 50;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

type PendingMessage = Pick<
  ScheduledMessages,
  'id' | 'conversation_id' | 'content' | 'created_by'
>;

/**
 * Process all pending scheduled messages whose send_at has passed.
 * For each: insert message, broadcast via Socket.IO, deliver to messenger channels.
 */
async function processScheduledMessages(): Promise<void> {
  try {
    const pending = await db.query<PendingMessage>(
      `SELECT id, conversation_id, content, created_by
       FROM scheduled_messages
       WHERE status = 'pending' AND send_at <= NOW()
       ORDER BY send_at ASC
       LIMIT $1`,
      [BATCH_SIZE],
    );

    if (pending.length === 0) return;

    log.info('Processing scheduled messages', { count: pending.length });

    for (const msg of pending) {
      try {
        await sendScheduledMessage(msg);
      } catch (err: unknown) {
        const errorText = err instanceof Error ? err.message : String(err);
        log.error('Failed to send scheduled message', {
          id: msg.id,
          conversationId: msg.conversation_id,
          error: errorText,
        });
        await db.query(
          `UPDATE scheduled_messages SET status = 'failed', error = $1 WHERE id = $2`,
          [errorText.substring(0, 500), msg.id],
        );
      }
    }
  } catch (err: unknown) {
    log.error('Scheduled messages processing error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function sendScheduledMessage(msg: PendingMessage): Promise<void> {
  const sessionId = msg.conversation_id;

  // 1. Get operator name for the message
  const creator = await db.queryOne<{ display_name: string | null }>(
    `SELECT display_name FROM users WHERE id = $1`,
    [msg.created_by],
  );
  const senderName = creator?.display_name || 'Оператор';

  // 2. Insert message into conversation
  const inserted = await db.queryOne<Pick<Messages, 'id' | 'created_at'>>(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_id, sender_name, message_type, content)
     VALUES ($1, 'operator', $2, $3, 'text', $4)
     RETURNING id, created_at`,
    [sessionId, msg.created_by, senderName, msg.content],
  );

  if (!inserted) {
    throw new Error('Failed to insert message');
  }

  // 3. Update conversation last_message for inbox
  await db.query(
    `UPDATE conversations
     SET last_message_content = $1, last_message_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [msg.content.substring(0, 200), sessionId],
  );

  // 4. Broadcast via Socket.IO (visitor + admin)
  const msgPayload = {
    sessionId,
    content: msg.content,
    senderName,
    senderType: 'operator',
    messageType: 'text',
    timestamp: inserted.created_at,
    sender_id: msg.created_by,
  };
  broadcastToRoom('operator:message', `visitor:${sessionId}`, msgPayload);

  broadcastChatMessage({
    sessionId,
    message: {
      id: inserted.id,
      conversation_id: sessionId,
      content: msg.content,
      sender_type: 'operator',
      sender_id: msg.created_by,
      sender_name: senderName,
      message_type: 'text',
      created_at: inserted.created_at,
    },
  }).catch((err: unknown) =>
    log.warn('Broadcast failed for scheduled message', { id: msg.id, error: String(err) }),
  );

  // 5. If messenger channel — enqueue outbound delivery
  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
    `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
    [sessionId],
  );
  if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
    enqueueOutbound({
      channel: conv.channel,
      externalChatId: conv.external_chat_id,
      content: msg.content,
      messageType: 'text',
      conversationId: sessionId,
    }).catch((err: unknown) =>
      log.warn('Outbound enqueue failed for scheduled message', { id: msg.id, error: String(err) }),
    );
  }

  // 6. Mark as sent
  await db.query(
    `UPDATE scheduled_messages SET status = 'sent', sent_at = NOW() WHERE id = $1`,
    [msg.id],
  );

  log.info('Scheduled message sent', {
    id: msg.id,
    conversationId: sessionId,
    channel: conv?.channel ?? 'web',
  });
}

export function startScheduledMessagesScheduler(): void {
  if (intervalHandle) {
    log.warn('Scheduled messages scheduler already running');
    return;
  }

  log.info(`Scheduled messages scheduler started (interval: ${INTERVAL_MS / 1000}s)`);

  // First run after 15s delay
  setTimeout(() => {
    processScheduledMessages();
  }, 15_000);

  intervalHandle = setInterval(processScheduledMessages, INTERVAL_MS);
}

export function stopScheduledMessagesScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('Scheduled messages scheduler stopped');
  }
}
