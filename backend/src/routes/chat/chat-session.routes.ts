/**
 * chat-session.routes.ts — Auth-only chat session lifecycle.
 * Legacy anonymous pathways removed 2026-04-19 (ARCH_BACKEND §5).
 */

import { Router, Request, Response } from 'express';
import { pool } from '../../database/db.js';
import { logAudit } from '../../services/audit.service.js';
import { AppError } from '../../middleware/errorHandler.js';
import { getOwnedConversation, type BotInteractive } from './chat-shared.js';
import { enqueueCrmEvent } from '../../services/crm-event-queue.service.js';
import { buildWidgetPaymentButton } from './chat-pricing.helpers.js';
import { authenticateToken, requireUser, type AuthRequest } from '../../middleware/auth.js';
import type {
  ChatCurrentContactRow,
  ChatCurrentConversationRow,
  ChatReadMessageRow,
  ChatSessionCsatRow,
  ChatUnreadCountRow,
} from '../../types/views/chat-views.js';

import { createLogger } from '../../utils/logger.js';
const router = Router();

const logger = createLogger('chat-session.routes');

const HISTORICAL_CHAT_STATUSES = ['resolved', 'closed'];

interface CsatInput {
  score: number | null;
  comment: string | null;
}

interface CsatBody {
  score?: unknown;
  comment?: unknown;
}

interface VisibleMessageExistsRow {
  has_messages: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCsatBody(value: unknown): value is CsatBody {
  return typeof value === 'object' && value !== null;
}

function isLiveChatStatus(status: string | null | undefined): boolean {
  return status === 'open' || status === 'waiting' || status === 'active';
}

async function hasVisibleConversationMessages(conversationId: string): Promise<boolean> {
  const result = await pool.query<VisibleMessageExistsRow>(
    `SELECT EXISTS (
       SELECT 1
         FROM messages m
        WHERE m.conversation_id = $1
          AND m.deleted_at IS NULL
          AND (m.metadata IS NULL OR (m.metadata->>'hiddenInUi') IS DISTINCT FROM 'true')
          AND m.sender_type != 'internal_note'
        LIMIT 1
     ) AS has_messages`,
    [conversationId],
  );
  return result.rows[0]?.has_messages === true;
}

async function findHistoricalConversation(
  contactId: string,
  userId: string,
  requireVisibleMessages: boolean,
): Promise<ChatCurrentConversationRow | undefined> {
  const historical = await pool.query<ChatCurrentConversationRow>(
    `SELECT id, status, channel, contact_id, user_id, created_at, updated_at
       FROM conversations c
      WHERE c.channel = 'web'
        AND c.status = ANY($3::text[])
        AND (c.contact_id = $1 OR c.user_id = $2)
        AND (
          $4::boolean = false
          OR EXISTS (
            SELECT 1
              FROM messages m
             WHERE m.conversation_id = c.id
               AND m.deleted_at IS NULL
               AND (m.metadata IS NULL OR (m.metadata->>'hiddenInUi') IS DISTINCT FROM 'true')
               AND m.sender_type != 'internal_note'
          )
        )
      ORDER BY
        CASE WHEN c.contact_id = $1 THEN 0 ELSE 1 END,
        COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC NULLS LAST,
        c.updated_at DESC NULLS LAST
      LIMIT 1`,
    [contactId, userId, HISTORICAL_CHAT_STATUSES, requireVisibleMessages],
  );
  return historical.rows[0];
}

async function linkHistoricalConversation(
  conversation: ChatCurrentConversationRow,
  contactId: string,
  userId: string,
): Promise<ChatCurrentConversationRow> {
  const linked = await pool.query<ChatCurrentConversationRow>(
    `UPDATE conversations
        SET contact_id = $2,
            user_id = $3
      WHERE id = $1
        AND (contact_id IS DISTINCT FROM $2 OR user_id IS DISTINCT FROM $3)
      RETURNING id, status, channel, contact_id, user_id, created_at, updated_at`,
    [conversation.id, contactId, userId],
  );

  return linked.rows[0] ?? {
    ...conversation,
    contact_id: contactId,
    user_id: userId,
  };
}

async function closeEmptyLiveConversation(conversationId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE conversations c
        SET status = 'closed',
            closed_at = COALESCE(c.closed_at, NOW()),
            updated_at = NOW()
      WHERE c.id = $1
        AND c.status IN ('open','waiting','active')
        AND NOT EXISTS (
          SELECT 1
            FROM messages m
           WHERE m.conversation_id = c.id
             AND m.deleted_at IS NULL
             AND (m.metadata IS NULL OR (m.metadata->>'hiddenInUi') IS DISTINCT FROM 'true')
             AND m.sender_type != 'internal_note'
        )`,
    [conversationId],
  );
  return (result.rowCount ?? 0) > 0;
}

function parseCsatInput(body: unknown): CsatInput {
  if (!isCsatBody(body)) {
    return { score: null, comment: null };
  }

  const rawScore = body.score;
  const score = typeof rawScore === 'number'
    ? rawScore
    : typeof rawScore === 'string'
      ? Number(rawScore)
      : null;

  const rawComment = body.comment;
  const comment = typeof rawComment === 'string' ? rawComment.trim() : null;

  return {
    score: Number.isFinite(score) ? score : null,
    comment: comment || null,
  };
}

// ============================================================================
// Helper: unpaid-order reminder (fire-and-forget из GET /sessions/current)
// ============================================================================

async function remindUnpaidOrders(sessionId: string, req: Request): Promise<void> {
  const unpaidRows = await pool.query(
    `SELECT order_id, total_price, status
     FROM photo_print_orders
     WHERE chat_session_id = $1
       AND status IN ('pending_payment', 'payment_failed')
       AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionId],
  );

  if (unpaidRows.rows.length === 0) return;

  const order = unpaidRows.rows[0];

  const recentReminder = await pool.query(
    `SELECT id FROM messages
     WHERE conversation_id = $1
       AND sender_type = 'bot'
       AND content LIKE '%неоплаченный заказ%'
       AND created_at > NOW() - INTERVAL '1 hour'
     LIMIT 1`,
    [sessionId],
  );
  if (recentReminder.rows.length > 0) return;

  const price = Number(order.total_price);

  const reminderText = order.status === 'payment_failed'
    ? `⚠️ У вас есть неоплаченный заказ на ${price}₽ (оплата не прошла). Попробуйте снова:`
    : `💳 У вас есть неоплаченный заказ на ${price}₽. Оплатите его:`;

  const interactive: BotInteractive = {
    type: 'buttons',
    buttons: [
      buildWidgetPaymentButton(order.order_id, price, `Оплата заказа`),
      { id: 'track_order', label: '📦 Отслеживать заказ', icon: 'local_shipping', value: 'track_order', url: `https://svoefoto.ru/track/${order.order_id}`, color: '#667eea' },
    ],
  };

  const metadata = JSON.stringify({ interactive });

  const msgResult = await pool.query(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)
     RETURNING *`,
    [sessionId, reminderText, metadata],
  );

  try {
    const io = req.app.socketServer?.getIO();
    if (io) {
      const msg = msgResult.rows[0];
      io.to(`visitor:${sessionId}`).emit('operator:message', {
        sessionId,
        content: reminderText,
        senderName: 'Своё Фото',
        senderType: 'bot',
        messageType: 'interactive',
        interactive,
        timestamp: msg.created_at,
        id: msg.id,
      });
    }
  } catch (error) {
    logger.warn('[sessions/current] unpaid-order reminder socket emit failed', {
      sessionId,
      error: errorMessage(error),
    });
  }
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/chat/sessions/current
 *
 * Auth-only: возвращает (или создаёт) активную web-conversation
 * текущего залогиненного пользователя. Использует partial UNIQUE index
 * ux_one_active_web_conv_per_contact для idempotent upsert при race.
 */
router.get(
  '/sessions/current',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const userId = req.user.id;

    const contactResult = await pool.query<ChatCurrentContactRow>(
      'SELECT id FROM contacts WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [userId],
    );
    if (contactResult.rows.length === 0) {
      logger.error('[sessions/current] CONTACT_MISSING', { userId });
      throw new AppError(500, 'Contact not found for authenticated user');
    }
    const contactId = contactResult.rows[0].id;

    const existing = await pool.query<ChatCurrentConversationRow>(
      `SELECT id, status, channel, contact_id, user_id, created_at, updated_at
         FROM conversations
        WHERE contact_id = $1
          AND channel = 'web'
          AND status IN ('open','waiting','active')
        ORDER BY updated_at DESC
        LIMIT 1`,
      [contactId],
    );

    let conversation: ChatCurrentConversationRow | undefined;
    let isExisting = existing.rows.length > 0;

    if (isExisting) {
      conversation = existing.rows[0];
      if (conversation.user_id !== userId) {
        const linked = await pool.query<ChatCurrentConversationRow>(
          `UPDATE conversations
              SET user_id = $2,
                  updated_at = NOW()
            WHERE id = $1
              AND user_id IS DISTINCT FROM $2
            RETURNING id, status, channel, contact_id, user_id, created_at, updated_at`,
          [conversation.id, userId],
        );
        conversation = linked.rows[0] ?? { ...conversation, user_id: userId };
      }
    } else {
      const legacyByUser = await pool.query<ChatCurrentConversationRow>(
        `SELECT id, status, channel, contact_id, user_id, created_at, updated_at
           FROM conversations
          WHERE user_id = $1
            AND channel = 'web'
            AND status IN ('open','waiting','active')
          ORDER BY updated_at DESC
          LIMIT 1`,
        [userId],
      );

      const legacyConversation = legacyByUser.rows[0];
      if (legacyConversation) {
        const adopted = await pool.query<ChatCurrentConversationRow>(
          `UPDATE conversations
              SET contact_id = $2,
                  user_id = $1,
                  updated_at = NOW()
            WHERE id = $3
              AND NOT EXISTS (
                SELECT 1
                  FROM conversations cx
                 WHERE cx.contact_id = $2
                   AND cx.channel = 'web'
                   AND cx.status IN ('open','waiting','active')
                   AND cx.id <> $3
              )
            RETURNING id, status, channel, contact_id, user_id, created_at, updated_at`,
          [userId, contactId, legacyConversation.id],
        );
        conversation = adopted.rows[0];
        isExisting = Boolean(conversation);
      }
    }

    if (conversation && isLiveChatStatus(conversation.status)) {
      const hasVisibleMessages = await hasVisibleConversationMessages(conversation.id);
      if (!hasVisibleMessages) {
        const historicalConversation = await findHistoricalConversation(contactId, userId, true);
        if (historicalConversation) {
          const closedEmptyConversation = await closeEmptyLiveConversation(conversation.id);
          if (closedEmptyConversation) {
            enqueueCrmEvent('chat', conversation.id, 'conversation_closed', undefined, true).catch(error => {
              logger.warn('[sessions/current] empty duplicate conversation cleanup failed', {
                conversationId: conversation?.id,
                error: errorMessage(error),
              });
            });
            conversation = await linkHistoricalConversation(historicalConversation, contactId, userId);
            isExisting = true;
          }
        }
      }
    }

    if (!conversation) {
      const historicalConversation = await findHistoricalConversation(contactId, userId, false);
      if (historicalConversation) {
        conversation = await linkHistoricalConversation(historicalConversation, contactId, userId);
        isExisting = true;
      }
    }

    if (!conversation) {
      const upserted = await pool.query<ChatCurrentConversationRow>(
        `INSERT INTO conversations
           (contact_id, user_id, channel, status, source, created_at, updated_at)
         VALUES ($1, $2, 'web', 'open', 'web', NOW(), NOW())
         ON CONFLICT (contact_id) WHERE channel='web' AND status IN ('open','waiting','active')
         DO UPDATE SET user_id = EXCLUDED.user_id,
                       updated_at = NOW()
         RETURNING id, status, channel, contact_id, user_id, created_at, updated_at`,
        [contactId, userId],
      );
      conversation = upserted.rows[0];
    }

    if (!conversation) {
      throw new AppError(500, 'Conversation creation/lookup failed');
    }

    const unreadResult = await pool.query<ChatUnreadCountRow>(
      `SELECT COUNT(*)::text AS count FROM messages
        WHERE conversation_id = $1
          AND sender_type IN ('operator','bot')
          AND is_read = false`,
      [conversation.id],
    );
    const unreadCount = Number(unreadResult.rows[0]?.count ?? 0);

    const includeMessages = req.query['include_messages'] !== 'false';
    let messages: unknown[] | undefined;
    if (includeMessages) {
      const msgResult = await pool.query(
        `SELECT id, sender_type, sender_name, message_type, content,
                attachment_url, metadata, is_read, client_message_id,
                CASE
                  WHEN read_at IS NOT NULL THEN 'read'
                  WHEN delivered_at IS NOT NULL THEN 'delivered'
                  WHEN sender_type = 'visitor' AND delivery_status = 'accepted' THEN 'sent'
                  ELSE delivery_status
                END AS delivery_status,
                delivered_at, read_at, created_at
           FROM messages
          WHERE conversation_id = $1
            AND deleted_at IS NULL
            AND (metadata IS NULL OR (metadata->>'hiddenInUi') IS DISTINCT FROM 'true')
            AND sender_type != 'internal_note'
          ORDER BY created_at DESC
          LIMIT 50`,
        [conversation.id],
      );
      messages = msgResult.rows.reverse();
    }

    const toIso = (v: Date | string | null): string | null => {
      if (!v) return null;
      if (typeof v === 'string') return v;
      return v.toISOString();
    };

    const conversationPayload = {
      id: conversation.id,
      status: conversation.status,
      channel: conversation.channel,
      contact_id: conversation.contact_id,
      user_id: conversation.user_id ?? userId,
      created_at: toIso(conversation.created_at),
      updated_at: toIso(conversation.updated_at),
      unread_count: unreadCount,
    };

    res.json({
      success: true,
      data: {
        conversation: conversationPayload,
        session: {
          ...conversationPayload,
          visitor_id: conversation.contact_id ?? contactId,
          status: conversation.status ?? 'open',
        },
        unread: unreadCount,
        isExisting,
        isHistorical: !isLiveChatStatus(conversation.status),
        ...(messages ? { messages } : {}),
      },
    });

    if (isLiveChatStatus(conversation.status)) {
      remindUnpaidOrders(conversation.id, req).catch(error => {
        logger.warn('[sessions/current] unpaid-order reminder failed', {
          conversationId: conversation.id,
          error: errorMessage(error),
        });
      });
    }
  },
);

/**
 * DELETED endpoints (auth-only cleanup 2026-04-19, ARCH_BACKEND §5.1):
 *   POST /sessions                       → replaced by GET /sessions/current
 *   POST /sessions/:id/update-visitor    → fingerprint rotation obsolete
 *   POST /sessions/:id/rotate-visitor    → legacy wrapper
 *   POST /link-user                      → visitor→user linking obsolete
 */

router.put(
  '/sessions/:sessionId/close',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const conv = await getOwnedConversation(req.user.id, req.params.sessionId);

    await pool.query(
      `UPDATE conversations
         SET status = 'closed', closed_at = NOW()
       WHERE id = $1`,
      [conv.id],
    );

    enqueueCrmEvent('chat', conv.id, 'conversation_closed', undefined, true).catch(error => {
      logger.warn('[sessions/:sessionId/close] CRM event enqueue failed', {
        conversationId: conv.id,
        error: errorMessage(error),
      });
    });

    res.json({ success: true, message: 'Session closed' });
  },
);

router.post(
  '/sessions/:sessionId/csat',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const conv = await getOwnedConversation(req.user.id, req.params.sessionId);
    const { score, comment } = parseCsatInput(req.body);

    if (score === null || score < 1 || score > 5) {
      throw new AppError(400, 'score (1-5) required');
    }

    const session = await pool.query<ChatSessionCsatRow>(
      `SELECT id, status, csat_score FROM conversations WHERE id = $1`,
      [conv.id],
    );
    const s = session.rows[0];
    if (!s) throw new AppError(404, 'Session not found');
    if (!s.status || !['resolved', 'closed'].includes(s.status)) {
      throw new AppError(400, 'Session not yet resolved');
    }
    if (s.csat_score !== null) throw new AppError(400, 'Already rated');

    await pool.query(
      `UPDATE conversations
          SET csat_score = $1, csat_comment = $2, csat_submitted_at = NOW()
        WHERE id = $3`,
      [score, comment, conv.id],
    );

    const io = req.app.socketServer?.getIO();
    if (io) {
      io.to('admin:visitor-chats').emit('csat:submitted', {
        sessionId: conv.id,
        score,
        comment,
      });
    }

    logAudit({
      action: 'csat_submitted',
      entityType: 'chat',
      entityId: conv.id,
      details: { score, hasComment: !!comment },
    });

    res.json({ success: true });
  },
);

router.post(
  '/sessions/:sessionId/read',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const conv = await getOwnedConversation(req.user.id, req.params.sessionId);

    const result = await pool.query<ChatReadMessageRow>(
      `UPDATE messages
          SET is_read = true, read_at = NOW(), delivered_at = COALESCE(delivered_at, NOW())
        WHERE conversation_id = $1
          AND sender_type IN ('operator', 'bot')
          AND is_read = false
       RETURNING id`,
      [conv.id],
    );

    if (result.rows.length > 0) {
      const io = req.app.socketServer?.getIO();
      if (io) {
        io.to('admin:visitor-chats').emit('message:status-update', {
          sessionId: conv.id,
          conversationId: conv.id,
          messageIds: result.rows.map(r => r.id),
          status: 'read',
        });
      }
    }

    res.json({ success: true, data: { readCount: result.rows.length } });
  },
);

export default router;
