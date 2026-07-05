import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { piiAudit } from '../middleware/pii-audit.js';
import db from '../database/db.js';
import { cacheGetOrFetch, getCrmRedis } from '../services/redis-cache.service.js';
import type {
  InboxViewRow,
  ConversationTagRow,
  InboxPaidUnlinkedCountRow,
  ReopenedTodayConversationRow,
  CrmNoteRow,
  CrmNoteAuthorRow,
  OnlineUserRow,
  CsatStatsRow,
  ConversionSummaryRow,
  ConversionDailyRow,
  ConversionByChannelRow,
} from '../types/views/crm-views.js';
import type { CrmInboxMetadata, CrmInboxTagMetadata } from '../types/jsonb/crm-inbox-metadata.js';
import { createLogger } from '../utils/logger.js';
import { enqueueCrmEvent } from '../services/crm-event-queue.service.js';
import { getSocketServer } from './chat/chat-shared.js';

// Alias for backward compatibility — conversion stats, CSAT, online users still use direct Redis
const getRedis = getCrmRedis;
const logger = createLogger('crm-inbox.routes');

const router = Router();

const COUNTS_TTL = 30; // seconds (stale-while-revalidate: serves cached, refreshes in background when TTL < 10s)
const COUNTS_EARLY_REFRESH = 10; // seconds

const PaymentFilterSchema = z.enum(['all', 'paid_unlinked']).default('all');
const BulkActionSchema = z.object({
  action: z.enum(['resolve', 'close', 'assign', 'tag']),
  ids: z.array(z.string()).min(1).max(50),
  payload: z.object({
    operatorId: z.string().optional(),
    tagId: z.string().optional(),
  }).optional(),
});

interface SocketServerWithPresence {
  getOnlineUserIds: () => Promise<string[]>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hasOnlineUserIds(server: unknown): server is SocketServerWithPresence {
  return typeof server === 'object'
    && server !== null
    && 'getOnlineUserIds' in server
    && typeof server.getOnlineUserIds === 'function';
}

async function invalidateInboxCountsCache(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const done = (): void => {
          clearTimeout(timer);
          redis.off('ready', done);
          redis.off('error', done);
          resolve();
        };
        timer = setTimeout(done, 500);
        redis.once('ready', done);
        redis.once('error', done);
      });
    }
    if (redis.status !== 'ready') return;

    const keys = await redis.keys('crm:inbox:counts:v2:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (err) {
    logger.warn('Failed to invalidate inbox counts cache', { error: errorMessage(err) });
  }
}

/** SLA helper: 5 min limit, 70% = warning */
function computeSlaStatus(createdAt: string, firstResponseAt: string | null): 'ok' | 'warning' | 'breached' | null {
  if (firstResponseAt) return 'ok'; // already responded
  const elapsed = Date.now() - new Date(createdAt).getTime();
  const limitMs = 5 * 60 * 1000;
  if (elapsed >= limitMs) return 'breached';
  if (elapsed >= limitMs * 0.7) return 'warning';
  return null; // within SLA, no badge needed
}

const PAID_LINK_UNLINKED_SOURCE_SQL = `
  SELECT 1 AS count,
         pl.amount::numeric AS amount,
         pl.order_ref AS order_ref,
         pl.paid_at,
         pl.updated_at,
         pl.created_at
  FROM payment_links pl
  WHERE pl.conversation_id = crm_inbox.id::uuid
    AND pl.status = 'paid'
    AND pl.order_ref_linked IS NULL
`;

const MANUAL_PAYMENT_SOURCE_SQL = `
  SELECT 1 AS count,
         CASE
           WHEN (m.metadata->'payment'->>'amount') ~ '^[0-9]+(\\.[0-9]+)?$'
           THEN (m.metadata->'payment'->>'amount')::numeric
           ELSE 0::numeric
         END AS amount,
         COALESCE(m.metadata->'payment'->>'orderRef', m.metadata->'payment'->>'receiptNumber') AS order_ref,
         COALESCE(NULLIF(m.metadata->'payment'->>'paidAt', '')::timestamptz, m.created_at) AS paid_at,
         m.created_at AS updated_at,
         m.created_at
  FROM messages m
  WHERE m.conversation_id = crm_inbox.id::uuid
    AND m.sender_type = 'system'
    AND m.metadata->'payment'->>'source' = 'pos_receipt'
    AND m.metadata->'payment'->>'status' = 'paid'
    AND COALESCE(m.metadata->'payment'->>'linkedOrderId', '') = ''
`;

const PAID_UNLINKED_EXISTS_SQL = `
  EXISTS (${PAID_LINK_UNLINKED_SOURCE_SQL})
  OR EXISTS (${MANUAL_PAYMENT_SOURCE_SQL})
`;

const PAID_UNLINKED_COUNT_SQL = `
  SELECT COALESCE(SUM(payment_source.count), 0)::int
  FROM (
    ${PAID_LINK_UNLINKED_SOURCE_SQL}
    UNION ALL
    ${MANUAL_PAYMENT_SOURCE_SQL}
  ) payment_source
`;

const PAID_UNLINKED_AMOUNT_SQL = `
  SELECT COALESCE(SUM(payment_source.amount), 0)::numeric(10,2)
  FROM (
    ${PAID_LINK_UNLINKED_SOURCE_SQL}
    UNION ALL
    ${MANUAL_PAYMENT_SOURCE_SQL}
  ) payment_source
`;

const PAID_UNLINKED_ORDER_REF_SQL = `
  SELECT payment_source.order_ref
  FROM (
    ${PAID_LINK_UNLINKED_SOURCE_SQL}
    UNION ALL
    ${MANUAL_PAYMENT_SOURCE_SQL}
  ) payment_source
  ORDER BY payment_source.paid_at DESC NULLS LAST,
           payment_source.updated_at DESC,
           payment_source.created_at DESC
  LIMIT 1
`;

// Все CRM-эндпоинты требуют авторизации + inbox:view permission
// (admin, manager, employee, photographer — все имеют inbox:view; client — нет)
router.use(authenticateToken);
router.use(requirePermission('inbox:view'));

/**
 * Unified Inbox item type
 */
interface InboxItem {
  id: string;
  type: 'chat' | 'task' | 'booking' | 'order' | 'approval';
  clientName: string | null;
  clientPhone: string | null;
  preview: string;
  status: string;
  priority: number; // 0=urgent, 1=high, 2=normal, 3=low
  sortTime: string;
  channel?: string;
  assignedTo?: string;
  assignedToName?: string;
  unread?: boolean;
  metadata: CrmInboxMetadata;
}

/**
 * GET /api/crm/inbox
 * Unified feed — читает из crm_inbox TABLE (real-time, обновляется event queue worker'ом).
 * MV crm_inbox_view используется только как backstop reconciliation (раз в 5 мин).
 * Для чатов — постзагрузка тегов одним запросом (batch).
 */
router.get('/inbox', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const types = (req.query['types'] as string || 'chat,task,booking,order,approval').split(',');
  const filter = req.query['filter'] as string || 'all'; // all | my | unassigned | urgent
  const search = (req.query['search'] as string || '').trim().toLowerCase();
  const sort = req.query['sort'] as string || 'priority'; // priority | time
  const limit = Math.min(parseInt(req.query['limit'] as string) || 200, 500);
  const offset = parseInt(req.query['offset'] as string) || 0;

  const paymentFilterParse = PaymentFilterSchema.safeParse(req.query['paymentFilter'] ?? 'all');
  if (!paymentFilterParse.success) {
    throw new AppError(400, `paymentFilter must be one of: all, paid_unlinked`);
  }
  const paymentFilter = paymentFilterParse.data;

  // ── Build WHERE clauses ──────────────────────────────────
  const params: unknown[] = [];
  const conditions: string[] = [];
  let p = 1;

  // Type filter
  if (types.length < 5) {
    conditions.push(`type = ANY($${p++})`);
    params.push(types);
  }

  // Ownership filter
  if (filter === 'my') {
    conditions.push(`assigned_to = $${p++}`);
    params.push(userId);
  } else if (filter === 'unassigned') {
    conditions.push(`assigned_to IS NULL`);
  } else if (filter === 'urgent') {
    conditions.push(`priority <= 1`);
  }

  // Full-text search
  if (search) {
    conditions.push(
      `(LOWER(COALESCE(client_name, '')) LIKE $${p} OR LOWER(COALESCE(client_phone, '')) LIKE $${p})`
    );
    params.push(`%${search}%`);
    p++;
  }

  if (paymentFilter === 'paid_unlinked') {
    conditions.push(
      `type = 'chat' AND (${PAID_UNLINKED_EXISTS_SQL})`
    );
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // ── Count + Data in one query (window function) ──────────
  const countParam = p++;
  const limitParam = p++;
  params.push(offset, limit);

  const rows = await db.query<InboxViewRow>(`
    SELECT
      id, type, client_name, client_phone, preview,
      status, priority, sort_time, channel,
      assigned_to, assigned_to_name, unread, metadata,
      COUNT(*) OVER() AS total_count,
      CASE WHEN type = 'chat' THEN (${PAID_UNLINKED_EXISTS_SQL}) ELSE false END AS has_paid_unlinked,
      CASE WHEN type = 'chat' THEN (${PAID_UNLINKED_COUNT_SQL}) ELSE 0 END AS paid_unlinked_count,
      CASE WHEN type = 'chat' THEN (${PAID_UNLINKED_AMOUNT_SQL}) ELSE 0 END AS paid_unlinked_amount,
      CASE WHEN type = 'chat' THEN (${PAID_UNLINKED_ORDER_REF_SQL}) ELSE NULL END AS paid_unlinked_order_ref
    FROM crm_inbox
    ${whereClause}
    ORDER BY ${sort === 'time' ? 'sort_time DESC NULLS LAST' : 'priority ASC, sort_time DESC NULLS LAST'}
    OFFSET $${countParam} LIMIT $${limitParam}
  `, params);

  const total = rows.length > 0 ? parseInt(rows[0].total_count) : 0;

  // ── Enrich chat items with tags (single batch query) ─────
  const chatIds = rows.filter(r => r.type === 'chat').map(r => r.id);
  const tagsMap: Record<string, CrmInboxTagMetadata[]> = {};

  if (chatIds.length > 0) {
    const tagRows = await db.query<ConversationTagRow>(
      `SELECT ct.conversation_id, t.id, t.name, t.color, t.icon
       FROM conversation_tags ct
       JOIN chat_tags t ON t.name = ct.tag
       WHERE ct.conversation_id = ANY($1::uuid[])`,
      [chatIds]
    );
    for (const tr of tagRows) {
      if (!tagsMap[tr.conversation_id]) tagsMap[tr.conversation_id] = [];
      tagsMap[tr.conversation_id].push({ id: tr.id, name: tr.name, color: tr.color, icon: tr.icon });
    }
  }

  // ── Map to InboxItem ──────────────────────────────────────
  const items: InboxItem[] = rows.map(r => {
    const meta: CrmInboxMetadata = { ...(r.metadata || {}) };
    if (r.type === 'chat') {
      const paidUnlinkedCount = Number(r.paid_unlinked_count) || 0;
      const paidUnlinkedAmount = Number(r.paid_unlinked_amount) || 0;
      meta.tags = tagsMap[r.id] || [];
      meta.hasPaidUnlinked = paidUnlinkedCount > 0 || r.has_paid_unlinked;
      meta.paidUnlinkedCount = paidUnlinkedCount;
      meta.paidUnlinkedAmount = paidUnlinkedAmount > 0 ? paidUnlinkedAmount : undefined;
      meta.paidUnlinkedOrderRef = r.paid_unlinked_order_ref ?? undefined;
    }
    return {
      id: r.id,
      type: r.type as InboxItem['type'],
      clientName: r.client_name,
      clientPhone: r.client_phone,
      preview: r.preview,
      status: r.status,
      priority: r.priority,
      sortTime: r.sort_time,
      channel: r.channel ?? undefined,
      assignedTo: r.assigned_to ?? undefined,
      assignedToName: r.assigned_to_name ?? undefined,
      unread: r.unread ?? undefined,
      metadata: meta,
    };
  });

  res.json({ success: true, data: items, total });
});

/**
 * GET /api/crm/inbox/counts
 * Badge counts per type
 */
router.get('/inbox/counts', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const filter = req.query['filter'] as string || 'all';

  const cacheKey = `crm:inbox:counts:v2:${filter}:${userId}`;

  const data = await cacheGetOrFetch(cacheKey, COUNTS_TTL, COUNTS_EARLY_REFRESH, async () => {
    const myCondition = filter === 'my';

    const mvRows = await db.query<InboxPaidUnlinkedCountRow>(
      `SELECT
         type,
         COUNT(*)::int                                                                               AS count,
         SUM(CASE WHEN unread THEN 1 ELSE 0 END)::int                                               AS unread_count,
         SUM(CASE WHEN assigned_to IS NULL AND type IN ('chat','task') THEN 1 ELSE 0 END)::int      AS unassigned_count,
         SUM(CASE WHEN type IN ('task','chat') AND priority <= 1 THEN 1 ELSE 0 END)::int            AS urgent_count,
         SUM(CASE WHEN type = 'order' AND (metadata->>'paymentStatus') IS DISTINCT FROM 'paid' THEN 1 ELSE 0 END)::int AS unpaid_count,
         COUNT(*) FILTER (
           WHERE CASE WHEN type = 'chat' THEN (${PAID_UNLINKED_EXISTS_SQL}) ELSE false END
         )::int AS paid_unlinked_count
       FROM crm_inbox
       WHERE (type IN ('booking','order') OR NOT $1::boolean OR assigned_to = $2)
       GROUP BY type`,
      [myCondition, userId]
    );

    const counts: Record<string, InboxPaidUnlinkedCountRow> = {};
    for (const r of mvRows) counts[r.type] = r;

    const chat     = counts['chat']?.count     || 0;
    const task     = counts['task']?.count     || 0;
    const booking  = counts['booking']?.count  || 0;
    const order    = counts['order']?.count    || 0;
    const approval = counts['approval']?.count || 0;

    return {
      chat, task, booking, order, approval,
      total:      chat + task + booking + order + approval,
      urgent:     (counts['task']?.urgent_count || 0) + (counts['chat']?.urgent_count || 0),
      unassigned: (counts['chat']?.unassigned_count || 0) + (counts['task']?.unassigned_count || 0),
      unread:     counts['chat']?.unread_count      || 0,
      unpaid:     counts['order']?.unpaid_count     || 0,
      paidUnlinked: counts['chat']?.paid_unlinked_count || 0,
    };
  });

  res.json({ success: true, data });
});

/**
 * POST /api/crm/inbox/reopen-closed-today
 * Admin-only rollback for chats closed/resolved during the current Moscow day.
 */
router.post('/inbox/reopen-closed-today', async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    throw new AppError(403, 'Только администратор может возвращать закрытые чаты');
  }

  const rows = await db.query<ReopenedTodayConversationRow>(
    `WITH bounds AS (
       SELECT
         ((NOW() AT TIME ZONE 'Europe/Moscow')::date AT TIME ZONE 'Europe/Moscow') AS start_at,
         (((NOW() AT TIME ZONE 'Europe/Moscow')::date + 1) AT TIME ZONE 'Europe/Moscow') AS end_at
     ),
     reopened AS (
       UPDATE conversations c
          SET status = CASE WHEN c.assigned_operator_id IS NULL THEN 'open' ELSE 'active' END,
              closed_at = NULL,
              resolved_at = NULL,
              updated_at = NOW(),
              metadata = COALESCE(c.metadata, '{}'::jsonb)
                || jsonb_build_object(
                  'reopenedByAdmin', true,
                  'reopenedAt', NOW(),
                  'reopenedBy', $1::text
                )
         FROM bounds
        WHERE c.status IN ('closed', 'resolved')
          AND COALESCE(c.closed_at, c.resolved_at, c.updated_at) >= bounds.start_at
          AND COALESCE(c.closed_at, c.resolved_at, c.updated_at) < bounds.end_at
      RETURNING c.*
     ),
     projected AS (
     SELECT
       r.id::text AS id,
       COALESCE(ct.display_name, client_u.display_name, r.visitor_name) AS client_name,
       COALESCE(ct.phone, client_u.phone, r.visitor_phone) AS client_phone,
       COALESCE(r.last_message_content, 'Чат возвращён администратором') AS preview,
       r.status::text AS status,
       CASE r.status
         WHEN 'open' THEN 1
         WHEN 'waiting' THEN 2
         ELSE 3
       END AS priority,
       COALESCE(r.last_message_at, r.updated_at, r.created_at, NOW()) AS sort_time,
       r.channel::text AS channel,
       r.assigned_operator_id::text AS assigned_to,
       u_op.display_name AS assigned_to_name,
       (COALESCE(r.unread_count, 0) > 0) AS unread,
       jsonb_build_object(
         'messageCount', COALESCE(r.message_count, 0),
         'channel', r.channel,
         'createdAt', r.created_at,
         'firstResponseAt', r.first_response_at,
         'userId', COALESCE(ct.user_id, r.user_id),
         'unreadCount', COALESCE(r.unread_count, 0),
         'reopenedByAdmin', true
       ) AS metadata
       FROM reopened r
       LEFT JOIN contacts ct ON ct.id = r.contact_id
       LEFT JOIN users client_u ON client_u.id = COALESCE(ct.user_id, r.user_id)
       LEFT JOIN users u_op ON u_op.id = r.assigned_operator_id
     ),
     upserted AS (
       INSERT INTO crm_inbox (
         type, id, client_name, client_phone, preview, status, priority, sort_time,
         channel, assigned_to, assigned_to_name, unread, metadata, updated_at
       )
       SELECT
         'chat', id, client_name, client_phone, preview, status, priority, sort_time,
         channel, assigned_to, assigned_to_name, unread, metadata, NOW()
       FROM projected
       ON CONFLICT (type, id) DO UPDATE SET
         client_name = EXCLUDED.client_name,
         client_phone = EXCLUDED.client_phone,
         preview = EXCLUDED.preview,
         status = EXCLUDED.status,
         priority = EXCLUDED.priority,
         sort_time = EXCLUDED.sort_time,
         channel = EXCLUDED.channel,
         assigned_to = EXCLUDED.assigned_to,
         assigned_to_name = EXCLUDED.assigned_to_name,
         unread = EXCLUDED.unread,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING id
     )
     SELECT projected.*
     FROM projected
     JOIN upserted ON upserted.id = projected.id`,
    [req.user.id],
  );

  await Promise.all(rows.map(row =>
    enqueueCrmEvent('chat', row.id, 'conversation_reopened_today', {
      client_name: row.client_name,
      client_phone: row.client_phone,
      preview: row.preview,
      status: row.status,
      priority: row.priority,
      sort_time: row.sort_time,
      channel: row.channel,
      assigned_to: row.assigned_to,
      assigned_to_name: row.assigned_to_name,
      unread: row.unread,
      metadata: row.metadata,
    })
  ));

  await invalidateInboxCountsCache();

  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    for (const row of rows) {
      socketServer.getIO().to('admin:visitor-chats').emit('chat:status-changed', {
        sessionId: row.id,
        status: row.status,
        assignedOperatorId: row.assigned_to,
        updatedBy: req.user.id,
      });
    }
  }

  logger.info('closed chats reopened for current Moscow day', {
    affected: rows.length,
    userId: req.user.id,
  });

  res.json({ success: true, affected: rows.length });
});

// ============================================================================
// CRM Notes — универсальные заметки для booking/order/chat
// ============================================================================

/**
 * GET /api/crm/notes?entity_type=booking&entity_id=<uuid>
 */
router.get('/notes', async (req: AuthRequest, res: Response) => {
  const entityType = req.query['entity_type'] as string;
  const entityId = req.query['entity_id'] as string;

  if (!entityType || !entityId) throw new AppError(400, 'entity_type and entity_id required');

  const notes = await db.query<CrmNoteRow>(
    `SELECT n.id, n.entity_type, n.entity_id, n.author_id,
            COALESCE(n.author_name, u.display_name, 'Система') as author_name,
            n.note_type, n.content, n.created_at
     FROM crm_notes n
     LEFT JOIN users u ON u.id = n.author_id
     WHERE n.entity_type = $1 AND n.entity_id = $2
     ORDER BY n.created_at ASC`,
    [entityType, entityId]
  );

  res.json({ success: true, data: notes });
});

/**
 * POST /api/crm/notes
 * Body: { entity_type, entity_id, content }
 */
router.post('/notes', async (req: AuthRequest, res: Response) => {
  const { entity_type, entity_id, content } = req.body;

  if (!entity_type || !entity_id || !content?.trim()) throw new AppError(400, 'entity_type, entity_id, and content required');

  const validTypes = ['booking', 'order', 'chat', 'approval'];
  if (!validTypes.includes(entity_type)) throw new AppError(400, `entity_type must be one of: ${validTypes.join(', ')}`);

  const authorId = req.user!.id;

  // Get author name from users table
  const authorRow = await db.queryOne<CrmNoteAuthorRow>(
    'SELECT display_name FROM users WHERE id = $1', [authorId]
  );
  const authorName = authorRow?.display_name || null;

  const note = await db.queryOne(
    `INSERT INTO crm_notes (entity_type, entity_id, author_id, author_name, content)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [entity_type, entity_id, authorId, authorName, content.trim()]
  );

  res.status(201).json({ success: true, data: note });
});

// ─── BULK ACTIONS ───────────────────────────────────────

router.post('/inbox/bulk', async (req: AuthRequest, res: Response) => {
  const parsed = BulkActionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid bulk action payload');
  }
  const { action, ids, payload } = parsed.data;

  let affected = 0;

  switch (action) {
    case 'resolve':
      const resolveResult = await db.query(
        `UPDATE conversations SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW())
         WHERE id = ANY($1::uuid[]) AND status NOT IN ('resolved', 'closed')`,
        [ids]
      );
      affected = resolveResult.length;
      // Update status in CRM inbox
      for (const id of ids) {
        enqueueCrmEvent('chat', id, 'status_changed', { status: 'resolved', priority: 3, sort_time: new Date().toISOString() })
          .catch(err => logger.warn('bulk resolve enqueueCrmEvent failed', { error: errorMessage(err), id }));
      }
      break;

    case 'close':
      const closeResult = await db.query(
        `UPDATE conversations SET status = 'closed', resolved_at = COALESCE(resolved_at, NOW())
         WHERE id = ANY($1::uuid[]) AND status != 'closed'`,
        [ids]
      );
      affected = closeResult.length;
      // Remove closed chats from CRM inbox
      for (const id of ids) {
        enqueueCrmEvent('chat', id, 'conversation_closed', undefined, true)
          .catch(err => logger.warn('bulk close enqueueCrmEvent failed', { error: errorMessage(err), id }));
      }
      break;

    case 'assign':
      if (!payload?.operatorId) throw new AppError(400, 'payload.operatorId is required');
      const opId = payload.operatorId === 'self' ? req.user!.id : payload.operatorId;
      const assignResult = await db.query(
        `UPDATE conversations SET assigned_operator_id = $2
         WHERE id = ANY($1::uuid[])`,
        [ids, opId]
      );
      affected = assignResult.length;
      // CRM inbox event for each assigned chat
      for (const id of ids) {
        enqueueCrmEvent('chat', id, 'assignment_changed', {
          assigned_to: opId,
          status: 'active',
          priority: 3,
        }).catch(err => logger.warn('bulk assign enqueueCrmEvent failed', { error: errorMessage(err), id }));
      }
      // WebSocket broadcast
      {
        const ss = getSocketServer(req.app);
        if (ss) {
          for (const id of ids) {
            ss.getIO().to('admin:visitor-chats').emit('chat:assigned', {
              sessionId: id, operatorId: opId, assignedBy: req.user?.id,
            });
          }
        }
      }
      break;

    case 'tag':
      if (!payload?.tagId) throw new AppError(400, 'payload.tagId is required');
      for (const conversationId of ids) {
        await db.query(
          `INSERT INTO conversation_tags (conversation_id, tag)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [conversationId, payload.tagId]
        );
      }
      affected = ids.length;
      break;

    default:
      throw new AppError(400, 'Unknown action');
  }

  res.json({ success: true, affected });
});

// ─── CHAT TAGS ──────────────────────────────────────────

/** GET /api/crm/tags — all tags */
router.get('/tags', async (_req: AuthRequest, res: Response) => {
  const redis = getRedis();
  const cacheKey = 'crm:tags';
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) { res.json({ success: true, data: JSON.parse(cached) }); return; }
    } catch (err) {
      logger.warn('Failed to get tags from cache', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  const tags = await db.query('SELECT id, name, color, icon, sort_order, created_at FROM chat_tags ORDER BY sort_order, name');
  if (redis) {
    redis.set(cacheKey, JSON.stringify(tags), 'EX', 600)
      .catch(err => logger.warn('Failed to cache tags', { error: errorMessage(err) }));
  }
  res.json({ success: true, data: tags });
});

/** POST /api/crm/tags — create tag */
router.post('/tags', async (req: AuthRequest, res: Response) => {
  const { name, color, icon } = req.body;
  if (!name) throw new AppError(400, 'Name is required');

  const tags = await db.query(
    `INSERT INTO chat_tags (name, color, icon) VALUES ($1, $2, $3)
     ON CONFLICT (name) DO NOTHING
     RETURNING *`,
    [name, color || '#757575', icon || null]
  );
  if (!tags.length) throw new AppError(409, 'Tag already exists');
  res.status(201).json({ success: true, data: tags[0] });
});

/** POST /api/crm/sessions/:id/tags — add tag to session */
router.post('/sessions/:id/tags', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { tagId } = req.body;
  if (!tagId) throw new AppError(400, 'tagId is required');

  await db.query(
    `INSERT INTO conversation_tags (conversation_id, tag)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [id, tagId]
  );
  res.json({ success: true });
});

/** DELETE /api/crm/sessions/:id/tags/:tagId — remove tag */
router.delete('/sessions/:id/tags/:tagId', async (req: AuthRequest, res: Response) => {
  const { id, tagId } = req.params;
  await db.query(
    'DELETE FROM conversation_tags WHERE conversation_id = $1 AND tag = $2',
    [id, tagId]
  );
  res.json({ success: true });
});

/** GET /api/crm/sessions/:id/tags — tags for a session */
router.get('/sessions/:id/tags', piiAudit('conversation', 'id'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const tags = await db.query(
    `SELECT t.* FROM chat_tags t
     JOIN conversation_tags ct ON t.name = ct.tag
     WHERE ct.conversation_id = $1
     ORDER BY t.sort_order, t.name`,
    [id]
  );
  res.json({ success: true, data: tags });
});

/**
 * GET /api/crm/staff/online
 * Список онлайн сотрудников
 */
router.get('/staff/online', async (req: AuthRequest, res: Response): Promise<void> => {
  const socketServer = getSocketServer(req.app);
  if (!hasOnlineUserIds(socketServer)) {
    res.json({ success: true, data: [] });
    return;
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const onlineIds = (await socketServer.getOnlineUserIds()).filter(id => UUID_RE.test(id));
  if (!onlineIds.length) {
    res.json({ success: true, data: [] });
    return;
  }

  const result = await db.query<OnlineUserRow>(
    `SELECT id, display_name, role FROM users
     WHERE id = ANY($1::uuid[]) AND role IN ('admin', 'employee', 'photographer')`,
    [onlineIds]
  );

  res.json({ success: true, data: result });
});

// ─── CSAT STATS ─────────────────────────────────────

router.get('/csat-stats', async (_req: AuthRequest, res: Response) => {
  const redis = getRedis();
  const cacheKey = 'crm:csat-stats';
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) { res.json({ success: true, data: JSON.parse(cached) }); return; }
    } catch (err) {
      logger.warn('Failed to get CSAT stats from cache', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const stats = await db.query<CsatStatsRow>(
    `SELECT
       COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::text as total_ratings,
       COALESCE(ROUND(AVG(csat_score)::numeric, 2), 0)::text as avg_score,
       COUNT(*) FILTER (WHERE csat_score = 5)::text as five_star,
       COUNT(*) FILTER (WHERE csat_score <= 2)::text as negative
     FROM conversations
     WHERE csat_submitted_at > NOW() - INTERVAL '30 days'`,
  );

  const s = stats[0];
  const data = {
    totalRatings: parseInt(s?.total_ratings || '0'),
    avgScore: parseFloat(s?.avg_score || '0'),
    fiveStar: parseInt(s?.five_star || '0'),
    negative: parseInt(s?.negative || '0'),
  };

  if (redis) {
    redis.set(cacheKey, JSON.stringify(data), 'EX', 300)
      .catch(err => logger.warn('Failed to cache CSAT stats', { error: errorMessage(err) }));
  }
  res.json({ success: true, data });
});

// ─── CONVERSION STATS ───────────────────────────────

router.get('/conversion-stats', async (req: AuthRequest, res: Response) => {
  const period = (req.query['period'] as string) || 'month';
  const interval = period === 'week' ? '7 days' : period === 'quarter' ? '90 days' : '30 days';

  // Redis cache 5 min
  const redis = getRedis();
  const cacheKey = `crm:conversion-stats:${period}`;
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) { res.json({ success: true, data: JSON.parse(cached) }); return; }
    } catch (err) {
      logger.warn('Failed to get conversion stats from cache', {
        error: err instanceof Error ? err.message : String(err),
        period
      });
    }
  }

  // Summary
  const summary = await db.query<ConversionSummaryRow>(
    `SELECT
       (SELECT COUNT(*) FROM conversations WHERE created_at > NOW() - $1::interval)::text as total_chats,
       (SELECT COUNT(*) FROM photo_print_orders WHERE created_at > NOW() - $1::interval AND status != 'cancelled')::text as total_orders,
       (SELECT COUNT(*) FROM bookings WHERE created_at > NOW() - $1::interval AND status != 'cancelled')::text as total_bookings,
       (SELECT COALESCE(SUM(total_price), 0) FROM photo_print_orders WHERE created_at > NOW() - $1::interval AND status != 'cancelled')::text as total_revenue,
       (SELECT COUNT(*) FROM photo_print_orders WHERE created_at > NOW() - $1::interval AND payment_status = 'paid')::text as paid_orders`,
    [interval],
  );

  // Daily breakdown — JOIN вместо correlated subqueries (устраняет до 270 subqueries для quarter)
  const daily = await db.query<ConversionDailyRow>(
    `WITH date_range AS (
       SELECT generate_series(
         (NOW() - $1::interval)::date,
         CURRENT_DATE,
         '1 day'::interval
       )::date AS day
     )
     SELECT
       d.day::text,
       COUNT(DISTINCT s.id)::text                                                              AS chats,
       COUNT(DISTINCT CASE WHEN o.status != 'cancelled' THEN o.id END)::text                  AS orders,
       COUNT(DISTINCT CASE WHEN b.status != 'cancelled' THEN b.id END)::text                  AS bookings,
       COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_price ELSE 0 END), 0)::text AS revenue
     FROM date_range d
     LEFT JOIN conversations s  ON DATE(s.created_at)  = d.day
     LEFT JOIN photo_print_orders    o  ON DATE(o.created_at)  = d.day
     LEFT JOIN bookings              b  ON DATE(b.created_at)  = d.day
     GROUP BY d.day
     ORDER BY d.day DESC`,
    [interval],
  );

  // By channel
  const byChannel = await db.query<ConversionByChannelRow>(
    `SELECT
       s.channel,
       COUNT(DISTINCT s.id)::text as chats,
       COUNT(DISTINCT o.id)::text as orders
     FROM conversations s
     LEFT JOIN photo_print_orders o ON o.chat_session_id = s.id AND o.status != 'cancelled'
     WHERE s.created_at > NOW() - $1::interval
     GROUP BY s.channel
     ORDER BY chats DESC`,
    [interval],
  );

  const s = summary[0];
  const totalChats = parseInt(s?.total_chats || '0');
  const totalOrders = parseInt(s?.total_orders || '0');
  const totalBookings = parseInt(s?.total_bookings || '0');
  const totalRevenue = parseFloat(s?.total_revenue || '0');
  const paidOrders = parseInt(s?.paid_orders || '0');
  const conversionRate = totalChats > 0
    ? Math.round((totalOrders + totalBookings) / totalChats * 1000) / 10
    : 0;
  const avgCheck = paidOrders > 0 ? Math.round(totalRevenue / paidOrders) : 0;

  const responseData = {
    summary: { totalChats, totalOrders, totalBookings, totalRevenue, conversionRate, avgCheck },
    daily: daily.map(d => ({
      day: d.day,
      chats: parseInt(d.chats),
      orders: parseInt(d.orders),
      bookings: parseInt(d.bookings),
      revenue: parseFloat(d.revenue),
    })),
    byChannel: byChannel.map(c => ({
      channel: c.channel,
      chats: parseInt(c.chats),
      orders: parseInt(c.orders),
    })),
  };

  if (redis) {
    redis.set(cacheKey, JSON.stringify(responseData), 'EX', 300)
      .catch(err => logger.warn('Failed to cache conversion stats', { error: errorMessage(err), period }));
  }
  res.json({ success: true, data: responseData });
});

export default router;
