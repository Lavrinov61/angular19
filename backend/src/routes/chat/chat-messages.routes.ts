/**
 * chat-messages.routes.ts — Message CRUD: send, list, delete, clear, quick-replies.
 * Auth-only: /sessions/:id/* endpoints используют ownership через getOwnedConversation.
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import { pool } from '../../database/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { config } from '../../config/index.js';
import { findOrCreateContact } from '../../services/contact.service.js';
import { scheduleAIResponse } from '../../services/ai-chat.service.js';
import { executeChatAction } from '../../services/chat-actions.service.js';
import { getNextSessionNumber, generateVisitorName, safePath, getOwnedConversation } from './chat-shared.js';
import type { BotInteractive } from './chat-shared.js';
import { handleInteractiveResponse, handleContextualTextInput } from './chat-bot-engine.js';
import { recalcSessionContext, isReturningBasicCustomer } from './chat-context.service.js';
import { buildOrderCard, buildOrderConfirmedButtons, extractPrice, formatPriceBreakdown } from './chat-pricing.helpers.js';
import { createLazyRedis } from '../../services/redis-factory.js';
import { requireUser, type AuthRequest } from '../../middleware/auth.js';

import { autoAssignOperator } from '../../services/auto-assign.service.js';
import { searchKbForFaq } from '../../services/kb-faq.service.js';
import { broadcastChatMessage } from '../../services/chat-broadcast.service.js';
import { createLogger } from '../../utils/logger.js';
import { logAndEmit } from '../../websocket/log-and-emit.js';
import type { SocketServer } from '../../websocket/socket-server.js';

interface LeadSession {
  id: string;
  visitor_id: string;
  visitor_name: string | null;
  user_agent: string | null;
  channel: string | null;
  source: string | null;
  page_url: string | null;
}

interface VisitorMessageSession {
  id: string;
  visitor_id: string | null;
  user_id: string | null;
  channel: string | null;
  status: string | null;
  visitor_name: string | null;
  selected_service: string | null;
  selected_price: number | null;
  page_url: string | null;
  user_agent: string | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
}

interface ChatMessageRequestBody {
  readonly [key: string]: unknown;
}

function isChatMessageRequestBody(value: unknown): value is ChatMessageRequestBody {
  return typeof value === 'object' && value !== null;
}

const router = Router();

const logger = createLogger('chat-messages.routes');
// --- Per-user rate limiter (Redis-backed, fail-open) ---
const RL_WINDOW = 10; // seconds
const RL_MAX = 20;    // max messages per window

const getRlRedis = createLazyRedis('chat-msg-rate-limit', {
  enableOfflineQueue: false,
});

async function checkUserChatRateLimit(userId: string): Promise<boolean> {
  const redis = getRlRedis();
  if (!redis) return true; // fail-open
  try {
    const key = `rl:chat-user:${userId}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RL_WINDOW);
    return count <= RL_MAX;
  } catch {
    return true; // fail-open
  }
}

/** Defense-in-depth: strip HTML tags before DB insert (Angular already escapes on output) */
function sanitizeContent(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim();
}

function isClosedConversationStatus(status: string | null | undefined): boolean {
  return status === 'resolved' || status === 'closed';
}

/**
 * Скрытое lead-уведомление (клик по CTA на лендинге).
 * POST /api/visitor-chat/lead-notify
 */
router.post('/lead-notify', async (req: Request, res: Response): Promise<void> => {
  const body = isChatMessageRequestBody(req.body) ? req.body : {};
  const visitorId = typeof body['visitorId'] === 'string' ? body['visitorId'] : undefined;
  const pageUrl = typeof body['pageUrl'] === 'string' ? body['pageUrl'] : undefined;
  const service = typeof body['service'] === 'string' ? body['service'] : undefined;

  if (!visitorId) {
    throw new AppError(400, 'visitorId is required');
  }

  const normalizedPageUrl = typeof pageUrl === 'string' && pageUrl.length > 0
    ? pageUrl
    : null;
  const normalizedService = typeof service === 'string' && service.length > 0
    ? service
    : 'Фото на документы онлайн';

  // Ищем открытую сессию или создаём минимальную без welcome-сообщения.
  const existingSession = await pool.query<LeadSession>(
    `SELECT id, visitor_id, visitor_name, user_agent, channel, source, page_url
     FROM conversations
     WHERE visitor_id = $1 AND status != 'closed'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [visitorId]
  );

  let session: LeadSession | undefined = existingSession.rows[0];

  if (!session) {
    const ip = req.ip || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;
    const sessionNum = await getNextSessionNumber();
    const displayName = generateVisitorName(sessionNum, typeof userAgent === 'string' ? userAgent : undefined);

    // Create contact before conversation
    const contact = await findOrCreateContact({
      phone: null,
      displayName,
      source: 'web',
    });

    const createdSession = await pool.query(
      `INSERT INTO conversations
        (visitor_id, visitor_name, selected_service, selected_price, page_url, user_agent, ip_address, channel, source, entry_context, contact_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'online', 'web', '{}'::jsonb, $8)
       RETURNING id, visitor_id, visitor_name, user_agent, channel, source, page_url`,
      [visitorId, displayName, normalizedService, 0, normalizedPageUrl, userAgent, ip, contact.id]
    );

    session = createdSession.rows[0];
    if (!session) {
      throw new AppError(500, 'Failed to create visitor session');
    }

    // F74: Auto-assign operator for new web conversations
    autoAssignOperator(session.id).catch(err =>
      logger.warn('autoAssignOperator failed', { sessionId: session!.id, error: String(err) }),
    );
  }

  const leadText = `🔔 Потенциальный клиент нажал «Заказать онлайн» (${normalizedService})`;
  const messageResult = await pool.query(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'system', $2, $3::jsonb)
     RETURNING id, message_type, content`,
    [session.id, leadText, JSON.stringify({ hiddenInUi: true, type: 'lead_notification' })]
  );

  res.json({ success: true });
});

/**
 * Отправить сообщение
 * POST /api/visitor-chat/sessions/:sessionId/messages
 */
router.post('/sessions/:sessionId/messages', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const userId = req.user.id;
  await getOwnedConversation(userId, req.params.sessionId);
  const { sessionId } = req.params;
  const { messageType = 'text', attachmentUrl, clientMessageId, replyToMessageId } = req.body;
  let content = req.body.content as string | undefined;

  if (!content) {
    throw new AppError(400, 'content is required');
  }

  // Idempotency: if clientMessageId provided, check for duplicate
  if (clientMessageId && typeof clientMessageId === 'string') {
    const existing = await pool.query(
      `SELECT m.*, COALESCE(
         (SELECT row_to_json(b.*) FROM messages b
          WHERE b.conversation_id = m.conversation_id AND b.sender_type IN ('bot','operator')
          AND b.created_at > m.created_at ORDER BY b.created_at LIMIT 1), NULL
       ) AS bot_response
       FROM messages m WHERE m.client_message_id = $1`,
      [clientMessageId]
    );
    if (existing.rows.length > 0) {
      const msg = existing.rows[0];
      const botResp = msg.bot_response;
      delete msg.bot_response;
      res.json({ success: true, data: { message: msg, botResponse: botResp } });
      return;
    }
  }

  // Per-user rate limiting
  const allowed = await checkUserChatRateLimit(userId);
  if (!allowed) {
    throw new AppError(429, 'Слишком много сообщений. Подождите несколько секунд.');
  }

  // Content validation + sanitization
  content = sanitizeContent(content);
  if (!content) {
    throw new AppError(400, 'Message content cannot be empty');
  }
  if (content.length > 10000) {
    throw new AppError(400, 'Message content exceeds maximum length (10000 characters)');
  }

  // Получаем сессию (ownership уже проверен выше)
  const sessionCheck = await pool.query<VisitorMessageSession>(
    `SELECT id, visitor_id, user_id, channel, status, visitor_name, selected_service, selected_price, page_url, user_agent, created_at, updated_at FROM conversations WHERE id = $1`,
    [sessionId]
  );

  if (sessionCheck.rows.length === 0) {
    throw new AppError(404, 'Session not found');
  }
  const session = sessionCheck.rows[0];

  // Проверяем, это нажатие интерактивной кнопки?
  const isButtonClick = req.body.isButtonClick === true;
  const buttonValue = req.body.buttonValue;
  const buttonData = isChatMessageRequestBody(req.body.buttonData) ? req.body.buttonData : undefined;

  // Сохраняем человекочитаемый label как content (для отображения в чате),
  // а machine-readable buttonValue — в metadata.buttonValue (для recalcSessionContext).
  const savedContent = content;
  const messageMetadata = (isButtonClick && buttonValue)
    ? JSON.stringify({ buttonValue })
    : null;

  // Сохраняем сообщение посетителя (с client_message_id для идемпотентности)
  const messageResult = await pool.query(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, attachment_url, client_message_id, reply_to_message_id, metadata)
     VALUES ($1, 'visitor', $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [sessionId, session.visitor_name || 'Посетитель', messageType, savedContent, attachmentUrl, clientMessageId || null, replyToMessageId || null, messageMetadata]
  );

  const message = messageResult.rows[0];

  // Update denormalized last_message fields on conversation
  await pool.query(
    `UPDATE conversations
     SET status = CASE WHEN status IN ('resolved','closed') THEN 'open' ELSE status END,
         closed_at = CASE WHEN status IN ('resolved','closed') THEN NULL ELSE closed_at END,
         last_message_at = NOW(),
         last_message_content = LEFT($2, 200),
         message_count = COALESCE(message_count, 0) + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [sessionId, savedContent]
  );

  // Обработка интерактивного ответа или автоответа бота
  let botMessage = null;
  let botResponseText: string | null = null;
  let botInteractive: BotInteractive | undefined;

  if (config.chat.botEnabled) {
  if (isButtonClick && buttonValue) {
    // Обработка нажатия кнопки (с контекстом сессии)
    const interactiveResult = await executeChatAction(sessionId, buttonValue, buttonData, {
      handlers: { handleInteractiveResponse },
    });
    if (interactiveResult) {
      botResponseText = interactiveResult.content;
      botInteractive = interactiveResult.interactive;
    }

    // Эмитить order:created в CRM когда заказ был создан через чат
    if (botInteractive?.step?.startsWith('order_paid')) {
      const payBtn = botInteractive.buttons?.find(b => b.value === 'pay_online_widget');
      if (payBtn?.data) {
        const ss: SocketServer | undefined = req.app['socketServer'];
        if (ss) {
          logAndEmit(ss.getIO(), 'admin:visitor-chats', 'order:created', {
            orderId: payBtn.data['orderId'] || '',
            totalPrice: payBtn.data['price'] || 0,
            contactName: 'Онлайн-клиент',
          });
        }
      }
    }
  } else {
    // F68: KB FAQ search — try Knowledge Base before AI/operator
    const kbAnswer = await searchKbForFaq(content);
    if (kbAnswer) {
      botResponseText = kbAnswer;
    } else if (config.chat.useAiFirst) {
      // AI-first режим: любые текстовые сообщения обрабатываются AI.
      scheduleAIResponse(sessionId, content, new Date());
    } else {
      // Legacy режим — сначала контекстный state-machine, затем AI fallback.
      const contextResult = await handleContextualTextInput(content, sessionId);
      if (contextResult) {
        botResponseText = contextResult.content;
        botInteractive = contextResult.interactive;
      } else {
        scheduleAIResponse(sessionId, content, new Date());
      }
    }
  }
  } // botEnabled

  if (botResponseText) {
    const interactivePayload = botInteractive
      ? JSON.stringify({ interactive: botInteractive })
      : null;

    const botResult = await pool.query(
      `INSERT INTO messages
        (conversation_id, sender_type, sender_name, message_type, content, metadata)
       VALUES ($1, 'bot', 'Своё Фото', $3, $2, $4)
       RETURNING *`,
      [sessionId, botResponseText, botInteractive ? 'interactive' : 'text', interactivePayload]
    );
    botMessage = { ...botResult.rows[0] };
    if (botInteractive) {
      botMessage.interactive = botInteractive;
    }
  }

  // Broadcast visitor message to CRM (дублирует WS-путь для надёжности при HTTP-only отправке, напр. welcome chips)
  broadcastChatMessage({ sessionId, message }).catch(err =>
    logger.warn('[chat-messages] broadcastChatMessage failed', { sessionId, error: String(err) }),
  );

  if (isClosedConversationStatus(session.status)) {
    logger.info('[chat-messages] reopened closed visitor chat by new message', {
      sessionId,
      previousStatus: session.status,
    });
  }

  res.json({
    success: true,
    data: {
      message,
      botResponse: botMessage
    }
  });
});

/**
 * Получить историю сообщений
 * GET /api/visitor-chat/sessions/:sessionId/messages
 */
router.get('/sessions/:sessionId/messages', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  await getOwnedConversation(req.user.id, req.params.sessionId);
  const { sessionId } = req.params;

  // Support after_id for reconnect sync — only fetch messages newer than last known
  const afterId = req.query['after_id'] as string | undefined;
  let messages;
  if (afterId) {
    messages = await pool.query(
      `SELECT id, conversation_id, sender_type, sender_name, message_type, content, metadata, attachment_url, created_at FROM messages
       WHERE conversation_id = $1 AND id > $2 AND deleted_at IS NULL
         AND (metadata IS NULL OR (metadata->>'hiddenInUi') IS DISTINCT FROM 'true')
         AND sender_type != 'internal_note'
       ORDER BY created_at ASC LIMIT 100`,
      [sessionId, afterId]
    );
  } else {
    messages = await pool.query(
      `SELECT id, conversation_id, sender_type, sender_name, message_type, content, metadata, attachment_url, created_at FROM messages
       WHERE conversation_id = $1 AND deleted_at IS NULL
         AND (metadata IS NULL OR (metadata->>'hiddenInUi') IS DISTINCT FROM 'true')
         AND sender_type != 'internal_note'
       ORDER BY created_at ASC`,
      [sessionId]
    );
  }

  // Обогащаем сообщения интерактивными данными из metadata
  const enrichedMessages = messages.rows.map(msg => {
    if (msg.metadata) {
      try {
        const meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
        const galleryUrls = Array.isArray(meta.gallery)
          ? meta.gallery.filter((url: unknown): url is string => typeof url === 'string' && url.length > 0)
          : [];
        if (meta.interactive) {
          return galleryUrls.length > 0
            ? { ...msg, interactive: meta.interactive, gallery_urls: galleryUrls }
            : { ...msg, interactive: meta.interactive };
        }
        if (galleryUrls.length > 0) return { ...msg, gallery_urls: galleryUrls };
      } catch (err) {
        logger.warn('Failed to enrich message with metadata', {
          error: err instanceof Error ? err.message : String(err),
          messageId: msg.id,
          sessionId: msg.conversation_id
        });
      }
    }
    return msg;
  });

  res.json({
    success: true,
    data: enrichedMessages
  });
});

// DISABLED: clear-messages removed for security — visitors should not delete chat history
// See incident #1322: visitor deleted all 24 messages via this unprotected endpoint
// router.delete('/sessions/:sessionId/clear-messages', ...);

/**
 * Поиск по сообщениям в сессии (visitor-side)
 * GET /api/visitor-chat/sessions/:sessionId/messages/search?q=...&limit=50&offset=0&visitorId=...
 */
router.get('/sessions/:sessionId/messages/search', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  await getOwnedConversation(req.user.id, req.params.sessionId);
  const { sessionId } = req.params;
  const q = (req.query['q'] as string || '').trim();
  const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 100);
  const offset = Math.max(parseInt(req.query['offset'] as string) || 0, 0);

  if (!q) {
    res.json({ success: true, data: [], total: 0 });
    return;
  }

  let results;
  if (q.length >= 3) {
    // FTS with ts_headline for highlights
    results = await pool.query(
      `SELECT id, content, sender_name, sender_type, message_type, created_at,
              ts_headline('russian', content, plainto_tsquery('russian', $2), 'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=30') AS highlight
       FROM messages
       WHERE conversation_id = $1 AND deleted_at IS NULL
         AND sender_type != 'internal_note'
         AND (metadata IS NULL OR (metadata->>'hiddenInUi') IS DISTINCT FROM 'true')
         AND search_vector @@ plainto_tsquery('russian', $2)
       ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [sessionId, q, limit, offset]
    );
  } else {
    // Short query — ILIKE fallback
    results = await pool.query(
      `SELECT id, content, sender_name, sender_type, message_type, created_at
       FROM messages
       WHERE conversation_id = $1 AND deleted_at IS NULL
         AND sender_type != 'internal_note'
         AND (metadata IS NULL OR (metadata->>'hiddenInUi') IS DISTINCT FROM 'true')
         AND content ILIKE '%' || $2 || '%'
       ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [sessionId, q, limit, offset]
    );
  }

  res.json({ success: true, data: results.rows, total: results.rowCount });
});

/**
 * Delivery statuses для клиентских сообщений
 * POST /api/visitor-chat/sessions/:sessionId/delivery-statuses
 * Body: { visitorId, clientMessageIds: string[] }
 */
router.post('/sessions/:sessionId/delivery-statuses', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  await getOwnedConversation(req.user.id, req.params.sessionId);
  const { sessionId } = req.params;
  const { clientMessageIds } = req.body;

  if (!Array.isArray(clientMessageIds) || clientMessageIds.length === 0) {
    throw new AppError(400, 'clientMessageIds must be a non-empty array');
  }
  if (clientMessageIds.length > 100) {
    throw new AppError(400, 'Maximum 100 IDs per request');
  }

  const result = await pool.query(
    `SELECT client_message_id,
            CASE
              WHEN read_at IS NOT NULL THEN 'read'
              WHEN delivered_at IS NOT NULL THEN 'delivered'
              WHEN delivery_status = 'accepted' THEN 'sent'
              ELSE delivery_status
            END AS delivery_status,
            delivered_at, read_at
     FROM messages
     WHERE conversation_id = $1 AND client_message_id = ANY($2) AND deleted_at IS NULL`,
    [sessionId, clientMessageIds]
  );

  res.json({ success: true, data: result.rows });
});

/**
 * Soft-delete сообщение посетителя
 * DELETE /api/visitor-chat/sessions/:sessionId/messages/:messageId
 */
router.delete('/sessions/:sessionId/messages/:messageId', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  await getOwnedConversation(req.user.id, req.params.sessionId);
  const { sessionId, messageId } = req.params;

  // Получаем сообщение
  const msgResult = await pool.query(
    `SELECT id, message_type, sender_type, attachment_url
     FROM messages
     WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL`,
    [messageId, sessionId]
  );
  if (msgResult.rows.length === 0) {
    throw new AppError(404, 'Message not found');
  }

  const msg = msgResult.rows[0];
  if (msg.sender_type !== 'visitor') {
    throw new AppError(403, 'Can only delete own messages');
  }

  // Для image — удаляем физический файл
  if (msg.message_type === 'image' && msg.attachment_url) {
    const filePath = safePath(msg.attachment_url);
    if (filePath) {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // Файл мог быть уже удалён — не критично
      }
    }
  }

  // Soft delete
  await pool.query(
    `UPDATE messages SET deleted_at = NOW() WHERE id = $1 AND conversation_id = $2`,
    [messageId, sessionId]
  );

  // Emit Socket.IO event
  const socketServer = req.app.socketServer;
  if (socketServer) {
    const io = socketServer.getIO();
    io.to('admin:visitor-chats').emit('message:deleted', { sessionId, messageId });
    io.to(`visitor:${sessionId}`).emit('message:deleted', { sessionId, messageId });
  }

  // Пересчитываем контекст после удаления фото (полный recalc для точного подсчёта)
  // Только для image-сообщений — текстовые не влияют на заказ
  if (msg.message_type === 'image') {
  try {
    const ctx = await recalcSessionContext(sessionId);
    if (config.chat.botEnabled && (ctx.selectedDoc || ctx.selectedTariff)) {
      const newPhotoCount = ctx.photoCount;

      if (newPhotoCount === 0) {
        // Все фото удалены — отменяем pending заказы и сбрасываем заказ полностью
        await pool.query(
          `UPDATE photo_print_orders SET status = 'cancelled', fail_reason = 'Все фото удалены клиентом'
           WHERE chat_session_id = $1 AND status IN ('pending_payment', 'new')`,
          [sessionId]
        );
        // Очищаем pendingOrder из метаданных сессии
        await pool.query(
          `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) - 'pendingOrder' WHERE id = $1`,
          [sessionId]
        );
        const botContent = '📷 Все фото удалены. Заказ отменён.\n\nЧем ещё могу помочь?';
        const botInteractive: BotInteractive = {
          type: 'buttons',
          step: 'main_menu',
          buttons: [
            { id: 'order_photo', label: '📷 Фото на документы', icon: 'photo_camera', value: 'order_photo', color: '#667eea' },
            { id: 'other_services', label: '🎨 Другие услуги', icon: 'design_services', value: 'other_services', color: '#11998e' },
            { id: 'view_prices', label: '💰 Цены на фото', icon: 'payments', value: 'view_prices', color: '#f093fb' },
            { id: 'ask_question', label: '❓ Задать вопрос', icon: 'help_outline', value: 'ask_question', color: '#4facfe' },
          ],
        };
        const interactivePayload = JSON.stringify({ interactive: botInteractive });

        const botResult = await pool.query(
          `INSERT INTO messages
            (conversation_id, sender_type, sender_name, message_type, content, metadata)
           VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)
           RETURNING *`,
          [sessionId, botContent, interactivePayload]
        );

        const ss1 = req.app.socketServer;
        if (ss1) {
          ss1.getIO().to(`visitor:${sessionId}`).emit('operator:message', {
            sessionId,
            content: botContent,
            senderName: 'Своё Фото',
            senderType: 'bot',
            messageType: 'interactive',
            interactive: botInteractive,
            timestamp: botResult.rows[0].created_at,
            id: botResult.rows[0].id,
          });

          broadcastChatMessage({
            sessionId,
            message: {
              id: botResult.rows[0].id,
              sender_type: 'bot',
              sender_name: 'Своё Фото',
              content: botContent,
              message_type: 'interactive',
              created_at: botResult.rows[0].created_at,
            },
          }).catch(err => logger.error('[Photo Delete] CRM broadcast failed', { error: String(err) }));
        }
      } else if (ctx.selectedDoc && ctx.selectedTariff) {
        // Пересчитываем цену (только если и документ, и тариф выбраны)
        const isReturningDel = await isReturningBasicCustomer(sessionId);
        const buttons = await buildOrderConfirmedButtons(ctx.selectedTariff, ctx.selectedDoc, ctx.orderNumber, newPhotoCount, isReturningDel);
        const orderData = buttons[0].data || {};
        const price = (orderData['price'] as number) || await extractPrice(ctx.selectedTariff, isReturningDel);
        const fp = (orderData['firstPrice'] as number) || price;
        const np = (orderData['nextPrice'] as number) || price;
        const priceText = formatPriceBreakdown(price, fp, np, newPhotoCount);

        // Обновляем pendingOrder
        const pendingOrderData = buttons[0].data || { price, tariff: ctx.selectedTariff, document: ctx.selectedDoc };
        await pool.query(
          `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
          [JSON.stringify({ pendingOrder: pendingOrderData }), sessionId]
        );

        const botContent = `📸 Фото удалено. Заказ пересчитан:\n• Документ: **${ctx.selectedDoc}**\n• Тариф: **${ctx.selectedTariff}**\n• Фото: ${newPhotoCount} шт.\n• Сумма: ${priceText}\n\n🖨 **Нужен печатный вид?** (+200₽)`;
        const botInteractive: BotInteractive = {
          type: 'cards',
          step: 'order_confirmed',
          buttons,
          cards: [buildOrderCard(botContent, buttons)],
        };
        const interactivePayload = JSON.stringify({ interactive: botInteractive });

        const botResult = await pool.query(
          `INSERT INTO messages
            (conversation_id, sender_type, sender_name, message_type, content, metadata)
           VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)
           RETURNING *`,
          [sessionId, botContent, interactivePayload]
        );

        const ss2 = req.app.socketServer;
        if (ss2) {
          ss2.getIO().to(`visitor:${sessionId}`).emit('operator:message', {
            sessionId,
            content: botContent,
            senderName: 'Своё Фото',
            senderType: 'bot',
            messageType: 'interactive',
            interactive: botInteractive,
            timestamp: botResult.rows[0].created_at,
            id: botResult.rows[0].id,
          });

          broadcastChatMessage({
            sessionId,
            message: {
              id: botResult.rows[0].id,
              sender_type: 'bot',
              sender_name: 'Своё Фото',
              content: botContent,
              message_type: 'interactive',
              created_at: botResult.rows[0].created_at,
            },
          }).catch(err => logger.error('[Photo Delete] CRM broadcast failed', { error: String(err) }));
        }
      }
    }
  } catch (recalcError) {
    logger.error('[Photo Delete] Error recalculating order:', { error: String(recalcError) });
    // Не блокируем ответ — фото уже удалено
  }
  } // end if image

  res.json({ success: true });
});

/**
 * Получить быстрые ответы
 * GET /api/visitor-chat/quick-replies
 */
router.get('/quick-replies', async (_req: Request, res: Response): Promise<void> => {
  const result = await pool.query(
    `SELECT id, title, content, category, trigger_keywords, is_active, sort_order, created_at, updated_at FROM chat_quick_replies
     WHERE is_active = true
     ORDER BY sort_order ASC`
  );

  res.json({
    success: true,
    data: result.rows
  });
});

export default router;
