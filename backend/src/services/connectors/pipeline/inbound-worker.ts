/**
 * Omnichannel v2 — Inbound Worker
 *
 * BullMQ worker that processes incoming webhook events:
 * 1. Load webhook_event row (raw payload)
 * 2. adapter.parseInbound() → ParsedMessage[]
 * 3. For each message:
 *    a. Dedup by external_message_id
 *    b. ConversationManager.findOrCreate
 *    c. ContactResolver.resolve
 *    d. Resolve reply_to_message_id
 *    e. INSERT messages
 *    f. Emit media worker jobs
 *    g. Update conversation counters
 *    h. Broadcast via Socket.IO
 *    i. adapter.markAsRead (fire-and-forget)
 *    j. Welcome on new conversation
 * 4. UPDATE webhook_events SET status='processed'
 */

import { Worker, Queue } from 'bullmq';
import type { Job } from 'bullmq';
import db from '../../../database/db.js';
import { getAdapterOrThrow } from '../core/adapter-registry.js';
import { getAccountById } from '../core/account-store.js';
import { findOrCreateConversation } from './conversation-manager.js';
import { resolveContact } from './contact-resolver.js';
import { broadcastNewMessage, broadcastMergeSuggestion, broadcastConversationUpdate } from './broadcast.js';
import type { MessageRow } from './broadcast.js';
import { logAudit } from '../../audit.service.js';
import { recordReceived } from '../../channel-metrics.service.js';
import { enqueueCrmEvent } from '../../crm-event-queue.service.js';
import { autoAssignOperator } from '../../auto-assign.service.js';
import { botTemplates } from '../../bot-template.service.js';
import { enqueueOutbound } from './outbound-worker.js';
import { enqueueAiTurn } from './ai-turn-worker.js';
import type { ChannelType } from '../core/types.js';
import type { ParsedMessage } from '../core/dto.js';
import type Messages from '../../../types/generated/public/Messages.js';
import type WebhookEvents from '../../../types/generated/public/WebhookEvents.js';
import type { ConversationAiModeMutationRow } from '../../../types/views/chat-views.js';
import { normalizePhone, findOrCreateContact, type Contact } from '../../contact.service.js';
import { inferAttributionFromMessage } from '../../service-attribution.service.js';
import { config } from '../../../config/index.js';
import { createLogger } from '../../../utils/logger.js';
import { captureException } from '../../../utils/error-tracker.js';
import { getRequestId, runWithRequestId } from '../../../middleware/request-context.js';
import { registerConversion } from '../../attribution.service.js';
import { cacheGet, cacheDel, getCrmRedis } from '../../redis-cache.service.js';
import { mpQuery } from '../../../database/mp-db.js';
import { conversionsSkippedTotal } from '../../metrics.service.js';
import { isTrustedPhoneSource, shouldExtractPhoneFromPlainText } from './phone-trust.js';

interface TgStartEventRow {
  id: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

type DeepLinkUtm = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
};

type WebhookPayloadRow = Pick<WebhookEvents, 'raw_body' | 'raw_headers'>;

interface MessageIdLookup {
  id: string;
}

interface ConversationContactLookup {
  contact_id: string | null;
  user_id: string | null;
}

interface ContactSummaryLookup {
  display_name: string | null;
  phone: string | null;
}

interface ReplyMessageLookup {
  content: string;
  sender_name: string | null;
}

const log = createLogger('inbound-worker');

// Shadow mode removed (Phase 7: v2 is the only pipeline)

// ─── BullMQ setup ─────────────────────────────────────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

const mediaQueue = new Queue('omni-media', { connection: { ...redisOpts } });

interface InboundJobData {
  webhookEventId: string;
  channel: ChannelType;
  accountId: string;
  _requestId?: string;
}

function normalizeWebhookHeaders(headers: WebhookPayloadRow['raw_headers']): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, typeof value === 'string' ? value : String(value)]),
  );
}

// ─── Worker processor ─────────────────────────────────────────────────────────

async function processInbound(job: Job<InboundJobData>): Promise<void> {
  // Restore requestId from job data into AsyncLocalStorage for distributed tracing
  return runWithRequestId(job.data._requestId, () => processInboundInner(job));
}

async function processInboundInner(job: Job<InboundJobData>): Promise<void> {
  const { webhookEventId, channel, accountId } = job.data;

  // 1. Load webhook_event
  const event = await db.queryOne<WebhookPayloadRow>(
    `SELECT raw_body, raw_headers FROM webhook_events WHERE id = $1`,
    [webhookEventId],
  );
  if (!event) {
    log.warn('webhook event not found', { webhookEventId });
    return;
  }

  // Load account + adapter
  const account = await getAccountById(accountId);
  if (!account) {
    await markWebhookFailed(webhookEventId, 'account not found');
    return;
  }
  const adapter = getAdapterOrThrow(channel);

  // 2. Expand truncated webhook body if needed (e.g. VK is_cropped)
  let rawBody = event.raw_body;
  if (adapter.expandBody) {
    try {
      rawBody = await adapter.expandBody(rawBody, account);
    } catch (err) {
      log.warn('expandBody failed, proceeding with original body', { channel, error: String(err) });
    }
  }

  // 2b. Parse inbound messages
  let messages: ParsedMessage[];
  try {
    messages = await adapter.parseInbound(rawBody, normalizeWebhookHeaders(event.raw_headers), account);
  } catch (err) {
    await markWebhookFailed(webhookEventId, `parse error: ${String(err)}`);
    throw err;
  }

  if (messages.length === 0) {
    // Webhook contained no parseable messages (e.g., only status updates)
    await db.query(
      `UPDATE webhook_events SET status = 'skipped', processed_at = NOW() WHERE id = $1`,
      [webhookEventId],
    );
    return;
  }

  // 2b. Enrich user names (VK: resolve "VK User 12345" → real names)
  if (adapter.enrichUserNames) {
    try {
      await adapter.enrichUserNames(messages, account);
    } catch (err) {
      log.warn('enrichUserNames failed, proceeding with fallback names', { channel, error: String(err) });
    }
  }

  // 3. Process each parsed message
  for (const msg of messages) {
    try {
      await processOneMessage(channel, account, adapter, msg);
      recordReceived(channel);
    } catch (err: unknown) {
      captureException(err, {
        tags: { worker: 'inbound', channel },
        extra: { externalMessageId: msg.externalMessageId },
        level: 'error',
      });
      log.error('message processing failed', {
        channel,
        externalMessageId: msg.externalMessageId,
        error: String(err),
      });
      // Continue processing remaining messages in this webhook
    }
  }

  // 4. Mark webhook as processed
  await db.query(
    `UPDATE webhook_events SET status = 'processed', processed_at = NOW() WHERE id = $1`,
    [webhookEventId],
  );
}

// ─── Single message processing ────────────────────────────────────────────────

async function processOneMessage(
  channel: ChannelType,
  account: ReturnType<typeof getAccountById> extends Promise<infer T> ? NonNullable<T> : never,
  adapter: ReturnType<typeof getAdapterOrThrow>,
  msg: ParsedMessage,
): Promise<void> {
  // 3a. Dedup by external_message_id
  if (msg.externalMessageId) {
    const dup = await db.queryOne<MessageIdLookup>(
      `SELECT id FROM messages WHERE external_message_id = $1`,
      [msg.externalMessageId],
    );
    if (dup) {
      log.debug('duplicate message skipped', { externalMessageId: msg.externalMessageId });
      return;
    }
  }

  // 3b. Resolve contact BEFORE conversation (contact_id NOT NULL)
  let preResolvedContact: Contact | undefined;
  try {
    const contact = await findOrCreateContact({
      phone: msg.phone || null,
      displayName: msg.userName,
      source: channel,
      externalUserId: msg.externalUserId,
      channel,
    });
    preResolvedContact = contact;
  } catch (err) {
    log.warn('pre-resolve contact failed, will retry after conversation', { channel, error: String(err) });
  }

  // 3c. Find or create conversation (with contact_id)
  let { conversationId, isNew, reopened, conversation } = await findOrCreateConversation(
    channel, account, msg, preResolvedContact?.id,
  );

  // 3d. Full contact resolution (link contact_id, channel_users, user_id, merge suggestions)
  try {
    const contactResult = await resolveContact(channel, msg, conversationId, preResolvedContact);
    if (contactResult.duplicates.length > 0) {
      broadcastMergeSuggestion(
        { id: contactResult.contact.id, displayName: contactResult.contact.display_name, source: contactResult.contact.source },
        contactResult.duplicates,
      );
    }
  } catch (err) {
    log.warn('contact resolution failed', { channel, error: String(err) });
  }

  // 3c-bis. Broadcast contact link to frontend (for real-time right panel update)
  const updatedConv = await db.queryOne<ConversationContactLookup>(
    'SELECT contact_id, user_id FROM conversations WHERE id = $1',
    [conversationId],
  );
  if (updatedConv && (updatedConv.contact_id || updatedConv.user_id)) {
    // Refresh conversation after contact resolution
    if (updatedConv.contact_id) {
      conversation = { ...conversation, contact_id: updatedConv.contact_id };
    }
    if (updatedConv.user_id) {
      conversation = { ...conversation, user_id: updatedConv.user_id };
    }

    // Fetch contact details for the broadcast
    let clientName: string | null = null;
    let clientPhone: string | null = null;
    if (updatedConv.contact_id) {
      const ct = await db.queryOne<ContactSummaryLookup>(
        'SELECT display_name, phone FROM contacts WHERE id = $1',
        [updatedConv.contact_id],
      );
      if (ct) {
        clientName = ct.display_name;
        clientPhone = ct.phone;
      }
    }

    const { broadcastToRoom } = await import('../../../websocket/broadcast-to-room.js');
    broadcastToRoom('chatClientLinked', 'admin:visitor-chats', {
      sessionId: conversationId,
      userId: updatedConv.user_id || null,
      clientName: clientName || msg.userName || null,
      clientPhone: clientPhone || msg.phone || null,
      contactId: updatedConv.contact_id,
    });
  }

  // 3d. Resolve reply_to_message_id
  let replyToMessageId: string | null = null;
  if (msg.replyToExternalId) {
    const replyRow = await db.queryOne<MessageIdLookup>(
      `SELECT id FROM messages WHERE external_message_id = $1`,
      [msg.replyToExternalId],
    );
    if (replyRow) replyToMessageId = replyRow.id;
  }

  // 3e. INSERT messages
  const msgMetadata = msg.mediaGroupId ? { mediaGroupId: msg.mediaGroupId } : null;
  const savedMsg = await db.queryOne<MessageRow>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_id, sender_name,
       message_type, content, external_message_id,
       reply_to_message_id, is_forwarded, forwarded_from_name,
       delivery_status, metadata)
     VALUES ($1, 'visitor', $2, $3, $4, $5, $6, $7, $8, $9, 'accepted', $10)
     ON CONFLICT (external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      conversationId,
      msg.externalUserId,
      msg.userName,
      msg.messageType,
      msg.content,
      msg.externalMessageId,
      replyToMessageId,
      msg.isForwarded || false,
      msg.forwardedFromName || null,
      msgMetadata ? JSON.stringify(msgMetadata) : null,
    ],
  );

  if (!savedMsg) {
    log.debug('duplicate inbound message skipped at insert', {
      channel,
      externalMessageId: msg.externalMessageId,
      conversationId,
    });
    return;
  }

  // 3e-ter. AI-агент (Этап 2, slice S4): определяем эффективный режим диалога и,
  // если бот включён глобально и диалог в 'off', лениво переводим его в 'bot'.
  // Результат используется ниже: тихое auto-assign при боте, гейт offline-ответа
  // и постановка хода бота. Сообщение здесь всегда visitor (sender_type='visitor'
  // в INSERT выше). Best-effort: сбой не ломает доставку.
  let agentMode: string | null = null;
  try {
    const resolved = await resolveAgentModeForInbound(conversationId);
    agentMode = resolved.mode;
  } catch (err) {
    log.warn('resolveAgentModeForInbound failed', { conversationId, channel, error: String(err) });
  }
  const botLeads = agentMode === 'bot';

  // 3e-bis. FC-3 (slice S5): online Tier2 inference услуги по тексту visitor-сообщения.
  // За env-флагом SERVICE_INFERENCE_ONLINE (default OFF на первый деплой). Best-effort:
  // ошибки не ломают доставку. selected_service проставляем только если ещё пуст.
  if (
    process.env['SERVICE_INFERENCE_ONLINE'] === 'true' &&
    conversation.contact_id &&
    msg.messageType === 'text' &&
    msg.content
  ) {
    try {
      const inferred = await inferAttributionFromMessage({
        contactId: conversation.contact_id,
        conversationId,
        channel: conversation.channel,
        text: msg.content,
      });
      if (inferred) {
        await db.query(
          `UPDATE conversations c
              SET selected_service = (
                SELECT primary_service_slug FROM contacts WHERE id = c.contact_id
              )
            WHERE c.id = $1
              AND c.selected_service IS NULL
              AND EXISTS (
                SELECT 1 FROM contacts
                 WHERE id = c.contact_id
                   AND primary_service_slug IS NOT NULL
                   AND primary_service_slug <> 'not_determined'
              )`,
          [conversationId],
        );
      }
    } catch (err) {
      log.warn('online service inference failed', { conversationId, channel, error: String(err) });
    }
  }

  // 3f. Register conversion for analytics attribution (fire-and-forget)
  if (isNew && channel !== 'web') {
    let deepLinkUtm: DeepLinkUtm = {};
    if (channel === 'telegram' && msg.externalChatId) {
      const cached = await cacheGet<DeepLinkUtm>(`tg_deeplink:${msg.externalChatId}`);
      if (cached) {
        deepLinkUtm = cached;
        await cacheDel(`tg_deeplink:${msg.externalChatId}`);
        log.info('Telegram deep link applied to conversion', { chatId: msg.externalChatId, utm: deepLinkUtm });
      } else if (msg.externalUserId) {
        try {
          const rows = await mpQuery<TgStartEventRow>(
            `SELECT id, utm_source, utm_medium, utm_campaign, utm_content, utm_term
             FROM tg_start_events
             WHERE tg_user_id = $1 AND processed_at IS NULL
             ORDER BY received_at DESC LIMIT 1`,
            [msg.externalUserId],
          );
          if (rows.length > 0) {
            const row = rows[0];
            deepLinkUtm = {
              utm_source: row.utm_source ?? undefined,
              utm_medium: row.utm_medium ?? undefined,
              utm_campaign: row.utm_campaign ?? undefined,
              utm_content: row.utm_content ?? undefined,
              utm_term: row.utm_term ?? undefined,
            };
            await mpQuery('UPDATE tg_start_events SET processed_at = NOW() WHERE id = $1', [row.id])
              .catch((err: unknown) => log.warn('mark tg_start_events processed failed', { id: row.id, error: String(err) }));
            log.info('Telegram deep link applied (db fallback)', { tgUserId: msg.externalUserId, utm: deepLinkUtm });
          }
        } catch (err) {
          log.warn('tg_start_events fallback query failed', { error: String(err) });
        }
      }
    }
    registerConversion({
      phone: msg.phone || undefined,
      conversion_type: 'messenger_contact',
      messenger_type: channel,
      telegram_user_id: channel === 'telegram' ? msg.externalUserId : undefined,
      max_user_id: channel === 'max' ? msg.externalUserId : undefined,
      ...deepLinkUtm,
    }).catch(err => log.warn('registerConversion failed', { channel, error: String(err) }));
  } else {
    conversionsSkippedTotal.inc({ reason: !isNew ? 'not_new' : 'web_channel' });
  }

  // 3g. Emit media worker jobs for each media attachment
  const mediaUrls: string[] = [];
  if (msg.media && msg.media.length > 0) {
    for (const mediaRef of msg.media) {
      await mediaQueue.add('process-media', {
        messageId: savedMsg.id,
        channel,
        accountId: account.id,
        mediaRef,
        _requestId: getRequestId(),
      }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 5000 },
        removeOnFail: { count: 10000 },
      });
    }
  }

  // 3g. Conversation counters — handled by trg_message_counters trigger (AFTER INSERT ON messages).
  // Explicit updateConversationOnMessage() removed to fix BUG-9 (double counter increment).

  // 3h. Broadcast via Socket.IO
  let replyToContent: string | null = null;
  let replyToSenderName: string | null = null;
  if (replyToMessageId) {
    const replyMsg = await db.queryOne<ReplyMessageLookup>(
      `SELECT content, sender_name FROM messages WHERE id = $1`,
      [replyToMessageId],
    );
    if (replyMsg) {
      replyToContent = replyMsg.content;
      replyToSenderName = replyMsg.sender_name;
    }
  }

  broadcastNewMessage({
    message: savedMsg,
    conversation,
    replyToContent,
    replyToSenderName,
    mediaUrls,
    reopened,
  });

  // 3h-bis. CRM inbox incremental update
  enqueueCrmEvent('chat', conversationId, 'message_received', {
    client_name: conversation.visitor_name,
    client_phone: conversation.visitor_phone,
    preview: savedMsg.content?.substring(0, 200) || 'Новое сообщение',
    status: conversation.status,
    priority: conversation.status === 'open' ? 1 : conversation.status === 'waiting' ? 2 : 3,
    sort_time: savedMsg.created_at,
    channel: conversation.channel,
    assigned_to: conversation.assigned_operator_id,
    assigned_to_name: null,
    unread: true,
    metadata: {
      messageCount: (conversation.message_count || 0) + 1,
      channel: conversation.channel,
      createdAt: conversation.created_at,
      firstResponseAt: conversation.first_response_at,
      userId: conversation.user_id,
    },
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  // 3i. markAsRead (fire-and-forget with logging)
  if (adapter.markAsRead) {
    adapter.markAsRead(account, msg.externalChatId, msg.externalMessageId).catch(err =>
      log.warn('markAsRead failed', { channel, error: String(err) }),
    );
  }

  // 3j. Welcome on new conversation (except Telegram — /start handled separately)
  if (isNew && channel !== 'telegram' && adapter.sendWelcome) {
    adapter.sendWelcome(account, msg.externalChatId).catch(err =>
      log.warn('sendWelcome failed', { channel, error: String(err) }),
    );
  }

  // 3j-bis. F74: Auto-assign operator for new conversations
  //         F83: Auto-reply when all operators are offline (throttled: 1 per conversation)
  //         S4: при ведущем боте назначаем оператора ТИХО (наблюдатель на случай
  //             перехвата) и НЕ шлём offline-автоответ (бот сам ответит — иначе дубль).
  if (isNew) {
    try {
      const assignedId = await autoAssignOperator(conversationId, { silent: botLeads });
      if (!botLeads && !assignedId && conversation.external_chat_id && !conversation.auto_reply_sent) {
        const clientName = conversation.visitor_name || 'клиент';
        const text = await botTemplates.render('offline_auto_reply', { client_name: clientName });
        if (text) {
          const botMsg = await db.queryOne<Pick<Messages, 'id'>>(
            `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, message_type, content)
             VALUES ($1, 'bot', 'system', 'Автоответ', 'text', $2)
             RETURNING id`,
            [conversationId, text],
          );
          if (botMsg) {
            await enqueueOutbound({
              channel,
              accountId: account.id,
              externalChatId: conversation.external_chat_id,
              content: text,
              conversationId,
              sourceMessageId: botMsg.id,
            });
          }
          await db.query(
            `UPDATE conversations SET auto_reply_sent = true WHERE id = $1`,
            [conversationId],
          );
          log.info('offline auto-reply sent', { conversationId, channel });
        }
      }
    } catch (err) {
      log.warn('autoAssign/auto-reply failed', { conversationId, error: String(err) });
    }
  }

  // 3j-ter. AI-агент (slice S4): если диалог ведёт бот — ставим ход в очередь
  // omni-ai-turn (для новых И существующих диалогов). Fire-and-forget, горячий
  // путь не блокируем. Дебаунс+коалесинг (один ход на серию реплик) и все гейты
  // (killswitch, leader-check, перечитка режима, классификатор, CAS) — в S3.
  if (botLeads) {
    scheduleAgentTurn(conversationId, channel, savedMsg.id);
  }

  // 3k. Capture trusted phone from platform contact-sharing flows.
  if (msg.messageType === 'contact' && msg.phone) {
    const phone = msg.phone;
    const normalizedPhone = normalizePhone(phone) ?? phone.replace(/\D/g, '');
    const phoneSource = 'contact_shared' as const;
    const { updatePhoneAndMetadata } = await import('../../../routes/chat/conversation-adapter.js');
    await updatePhoneAndMetadata(conversationId, normalizedPhone, { phoneSource });

    // Trusted platform contacts are allowed to correct identity records.
    await db.query(
      `UPDATE contacts SET phone = $1, updated_at = NOW()
       WHERE id = (SELECT contact_id FROM conversations WHERE id = $2)
         AND phone IS DISTINCT FROM $1`,
      [normalizedPhone, conversationId],
    );

    // Mark the channel identity as phone-verified by a native contact share.
    await db.query(
      `UPDATE channel_users
       SET phone = $1,
           verified_at = NOW(),
           linked_by = $4
       WHERE external_user_id = $2 AND channel = $3`,
      [normalizedPhone, msg.externalUserId, channel, phoneSource],
    );

    // Broadcast phone update to frontend in real-time
    broadcastConversationUpdate(conversationId, {
      visitorPhone: normalizedPhone,
      phoneSource,
    });

    if (isTrustedPhoneSource(phoneSource)) {
      const { autoLinkSessionToClient } = await import('../../client-context.service.js');
      autoLinkSessionToClient(conversationId).catch(err =>
        log.warn('autoLinkSessionToClient failed after trusted phone capture', { conversationId, error: String(err) }),
      );
    }

    // Remove reply keyboard for Telegram after successful phone capture
    if (channel === 'telegram') {
      const { maskPhone } = await import('../../../utils/mask-phone.js');
      const masked = maskPhone(normalizedPhone) ?? '***';
      adapter.sendText(account, msg.externalChatId, `Спасибо! Ваш номер ${masked} сохранён.`).catch(err =>
        log.warn('phone confirmation send failed', { error: String(err) }),
      );
    }

    log.info('visitor phone captured from contact', { conversationId, phone: normalizedPhone, channel });
  }

  // 3l. Extract plain-text phones only as untrusted operator context.
  // Channels with native contact sharing must use the verified contact flow instead.
  if (shouldExtractPhoneFromPlainText(channel) && msg.messageType === 'text' && msg.content && !conversation.visitor_phone) {
    const { extractPhoneFromText } = await import('../../../utils/extract-phone.js');
    const textPhone = extractPhoneFromText(msg.content);
    if (textPhone) {
      const phoneSource = 'text_extracted' as const;
      const { updatePhoneAndMetadata } = await import('../../../routes/chat/conversation-adapter.js');
      await updatePhoneAndMetadata(conversationId, textPhone, { phoneSource });

      // Broadcast phone update to frontend in real-time
      broadcastConversationUpdate(conversationId, {
        visitorPhone: textPhone,
        phoneSource,
      });

      log.info('visitor phone captured from text', { conversationId, phone: textPhone, channel });
    }
  }

  // Audit (fire-and-forget)
  logAudit({
    action: 'webhook_received',
    entityType: 'conversation',
    entityId: conversationId,
    details: {
      channel,
      externalChatId: msg.externalChatId,
      isNewConversation: isNew,
      messageType: msg.messageType,
    },
  });
}

// ─── AI-агент: автозапуск хода (Этап 2, slice S4) ───────────────────────────────

interface AgentModeLookup {
  ai_agent_mode: string | null;
  external_chat_id: string | null;
  ai_agent_mode_set_by: string | null;
  ai_agent_locked_at: Date | null;
}

/**
 * Redis-override авто-возврата operator->bot. Мгновенный стоп самого рискованного
 * направления (бот перебивает оператора) без передеплоя: ключ `ai:auto_return` ==
 * 'false' глушит ВСЕ авто-возвраты.
 *
 * Fail-CLOSED по контракту killswitch (см. ai-turn-worker.ts isKillswitchEngaged):
 * авто-возврат пишет наружу реальным людям (бот после возврата отвечает), поэтому
 * при недоступности Redis / ошибке считаем override ВЗВЕДЁННЫМ (возврат подавляем,
 * диалог остаётся 'operator'). «Лучше не перебивать, чем перебить без возможности
 * экстренно остановить». Локальный helper (НЕ трогаем ai-turn-worker.ts).
 */
async function isAutoReturnSilenced(): Promise<boolean> {
  const redis = getCrmRedis();
  if (!redis) {
    log.warn('auto-return: Redis-клиент недоступен -> fail-closed (возврат подавлен)');
    return true;
  }
  try {
    const value = await redis.get('ai:auto_return');
    return value === 'false';
  } catch (err) {
    log.warn('auto-return override check failed -> fail-closed (возврат подавлен)', { err: String(err) });
    return true;
  }
}

/**
 * Эффективный режим AI-агента для входящего сообщения клиента + признак, есть ли
 * канал для ответа. Возвращается вызывающему, чтобы в одном месте решить:
 *   - тихо ли назначать оператора (silent при 'bot'),
 *   - нужен ли offline-автоответ (только при 'off' и боте выкл / без канала),
 *   - ставить ли ход бота в очередь.
 *
 * Побочный эффект: ленивый автозапуск бота. Если агент включён глобально
 * (config.ai.agentEnabled), есть external_chat_id и диалог в режиме 'off' —
 * переводим его в 'bot' (CAS по ai_agent_mode='off', чтобы НЕ перетереть
 * 'operator', выставленный перехватом, и не сбросить уже идущий 'bot').
 *
 * Режим 'operator' (перехвачен/эскалирован): авто-возврат operator->bot после
 * паузы (slice S2). По типу set_by ('agent_handoff' -> handoffReturnMinutes,
 * 'operator:<uuid>' -> operatorReturnMinutes) проверяем тишину оператора и
 * АТОМАРНО (один CAS-UPDATE с NOT EXISTS на свежие operator-сообщения) переводим
 * в 'bot'. Анти-перебивание встроено в CAS: если оператор писал в пределах порога
 * (или дописал между SELECT и UPDATE) — NOT EXISTS=false, CAS=0, остаёмся
 * 'operator'. Флаг config.ai.autoReturnEnabled + Redis-override ai:auto_return.
 *
 * Режим 'suggest' (легаси-подсказки оператору) не трогаем и ход не ставим: бот
 * наружу не пишет.
 *
 * Экспортируется как test seam: CAS off->bot, авто-возврат и гонки режимов
 * проверяются юнит-тестом.
 */
export async function resolveAgentModeForInbound(
  conversationId: string,
): Promise<{ mode: string | null; hasChannel: boolean }> {
  // Агент выключен глобально — бот не участвует, поведение как до Этапа 2.
  if (!config.ai.agentEnabled) {
    return { mode: null, hasChannel: false };
  }

  const row = await db.queryOne<AgentModeLookup>(
    `SELECT ai_agent_mode, external_chat_id, ai_agent_mode_set_by, ai_agent_locked_at
       FROM conversations WHERE id = $1`,
    [conversationId],
  );
  if (!row) return { mode: null, hasChannel: false };

  const hasChannel = !!row.external_chat_id;
  // Нет канала для ответа — бот не сможет ответить, не вмешиваемся.
  if (!hasChannel) {
    return { mode: row.ai_agent_mode, hasChannel: false };
  }

  if (row.ai_agent_mode === 'off') {
    // Ленивый автозапуск: off -> bot (CAS, не перетирает operator/идущий bot).
    const moved = await db.queryOne<ConversationAiModeMutationRow>(
      `UPDATE conversations
          SET ai_agent_mode = 'bot',
              ai_agent_mode_set_by = 'auto',
              updated_at = NOW()
        WHERE id = $1
          AND ai_agent_mode = 'off'
        RETURNING ai_agent_mode`,
      [conversationId],
    );
    // CAS мог не сработать (гонка: оператор/другой обработчик уже сменил режим) —
    // тогда читаем актуальное значение из исходной выборки нельзя (оно устарело),
    // но для решений вызывающего достаточно: moved -> 'bot', иначе НЕ 'bot'.
    return { mode: moved ? 'bot' : 'operator', hasChannel: true };
  }

  if (row.ai_agent_mode === 'operator') {
    return await tryAutoReturnOperator(conversationId, row);
  }

  return { mode: row.ai_agent_mode, hasChannel: true };
}

/**
 * Авто-возврат operator->bot (slice S2). Вызывается ТОЛЬКО когда диалог в
 * 'operator' и есть канал. Возвращает 'bot' лишь при успешном CAS, иначе
 * 'operator' (диалог остаётся за оператором, бот молчит).
 *
 * Пороги тишины по типу set_by:
 *   - 'agent_handoff' (бот сам эскалировал) -> config.ai.handoffReturnMinutes (30).
 *   - 'operator:<uuid>' (живой оператор перехватил) -> operatorReturnMinutes (240).
 *   - NULL/прочее -> НЕ возвращаем (нет понятного источника паузы).
 *
 * Анти-перебивание (P1-1): порог И «оператор не писал недавно» проверяются
 * АТОМАРНО внутри одного CAS-UPDATE (locked_at < now-threshold + NOT EXISTS
 * свежего operator-сообщения). Отдельного silence-SELECT нет — он создавал бы
 * гонку «тот же оператор дописал между SELECT и UPDATE». locked_at=NULL после
 * возврата ОБЯЗАТЕЛЕН: иначе гейт processAiTurn (ai_agent_locked_at IS NULL)
 * подавит ход.
 */
async function tryAutoReturnOperator(
  conversationId: string,
  row: AgentModeLookup,
): Promise<{ mode: string | null; hasChannel: boolean }> {
  if (!config.ai.autoReturnEnabled) {
    return { mode: 'operator', hasChannel: true };
  }

  // Redis-override: мгновенный стоп без передеплоя. Fail-closed: при недоступности
  // Redis авто-возврат подавляем (не перебиваем оператора вслепую).
  if (await isAutoReturnSilenced()) {
    return { mode: 'operator', hasChannel: true };
  }

  const setBy = row.ai_agent_mode_set_by;
  let thresholdMin: number;
  let kind: 'handoff' | 'operator';
  let newSetBy: string;
  if (setBy === 'agent_handoff') {
    thresholdMin = config.ai.handoffReturnMinutes;
    kind = 'handoff';
    newSetBy = 'auto:handoff_return';
  } else if (setBy && setBy.startsWith('operator:')) {
    thresholdMin = config.ai.operatorReturnMinutes;
    kind = 'operator';
    newSetBy = 'auto:operator_return';
  } else {
    // Непонятный источник паузы (NULL/прочее) — не трогаем.
    return { mode: 'operator', hasChannel: true };
  }

  // Атомарный CAS: порог тишины (момент перехвата/эскалации) + анти-перебивание
  // (NOT EXISTS свежего operator-сообщения) в одном UPDATE. $3 = точное прежнее
  // значение set_by из SELECT (защита от гонки смены режима).
  const returned = await db.queryOne<ConversationAiModeMutationRow>(
    `UPDATE conversations c
        SET ai_agent_mode = 'bot',
            ai_agent_locked_at = NULL,
            ai_agent_mode_set_by = $2,
            updated_at = NOW()
      WHERE c.id = $1
        AND c.ai_agent_mode = 'operator'
        AND c.ai_agent_mode_set_by = $3
        AND c.ai_agent_locked_at < NOW() - ($4 || ' minutes')::interval
        AND NOT EXISTS (
          SELECT 1 FROM messages m
           WHERE m.conversation_id = c.id
             AND m.sender_type = 'operator'
             AND m.deleted_at IS NULL
             AND m.created_at > NOW() - ($4 || ' minutes')::interval
        )
      RETURNING ai_agent_mode`,
    [conversationId, newSetBy, setBy, String(thresholdMin)],
  );

  if (returned) {
    log.info('AUTO_RETURN: operator->bot', { conversationId, kind, thresholdMin });
    return { mode: 'bot', hasChannel: true };
  }

  return { mode: 'operator', hasChannel: true };
}

/**
 * Ставит ход бота в очередь omni-ai-turn (fire-and-forget). Вызывается ТОЛЬКО
 * когда эффективный режим диалога 'bot'. Горячий путь не блокирует: ошибки
 * постановки гасим в лог. Дальнейшие гейты (killswitch, leader-check, перечитка
 * режима, классификатор, CAS) — внутри processAiTurn (slice S3).
 */
function scheduleAgentTurn(conversationId: string, channel: ChannelType, triggerMessageId: string): void {
  enqueueAiTurn({ conversationId, triggerMessageId, channel }).catch(err =>
    log.warn('enqueueAiTurn failed (агент-ход не поставлен)', { conversationId, channel, error: String(err) }),
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function markWebhookFailed(webhookEventId: string, errorMessage: string): Promise<void> {
  await db.query(
    `UPDATE webhook_events SET
       status = 'failed',
       error_message = $2,
       retry_count = retry_count + 1,
       processed_at = NOW()
     WHERE id = $1`,
    [webhookEventId, errorMessage],
  );
  log.error('webhook event failed', { webhookEventId, errorMessage });
}

// ─── Worker creation ──────────────────────────────────────────────────────────

let worker: Worker | null = null;

/**
 * Start the inbound worker. Called once at app startup.
 * Only runs on the scheduler-leader node (singleton via advisory lock).
 */
export function startInboundWorker(): Worker {
  if (worker) return worker;

  worker = new Worker('omni-inbound', processInbound, {
    connection: { ...redisOpts },
    concurrency: 5,
    limiter: { max: 50, duration: 1000 },
    lockDuration: 5 * 60 * 1000,
    lockRenewTime: 60 * 1000,
    stalledInterval: 2 * 60 * 1000,
    maxStalledCount: 1,
  });

  worker.on('completed', (job) => {
    log.debug('inbound job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    captureException(err, {
      tags: { worker: 'inbound' },
      extra: { jobId: job?.id, data: job?.data },
      level: 'error',
    });
    log.error('inbound job failed', {
      jobId: job?.id,
      error: String(err),
      data: job?.data,
    });
  });

  log.info('inbound worker started');
  return worker;
}

/**
 * Stop the inbound worker (graceful shutdown).
 */
export async function stopInboundWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    log.info('inbound worker stopped');
  }
}

export { mediaQueue };
