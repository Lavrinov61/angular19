/**
 * F74: Auto-assign Operator Service
 *
 * When a new conversation arrives, automatically assign it to the
 * online operator with the fewest active conversations (least-loaded round-robin).
 *
 * Online status: Redis Sorted Set `ws:online` (managed by SocketServer).
 * Operator eligibility: users with role in ('admin', 'manager', 'employee')
 * — i.e. roles that have the `chat:assign` permission.
 *
 * If no operators are online — conversation stays unassigned (NULL).
 */

import db from '../database/db.js';
import { getCrmRedis } from './redis-cache.service.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import { enqueueCrmEvent } from './crm-event-queue.service.js';
import { createLogger } from '../utils/logger.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type { ConversationsId } from '../types/generated/public/Conversations.js';

const log = createLogger('auto-assign');

/** Roles eligible for auto-assignment (those with chat:assign permission). */
const OPERATOR_ROLES = ['admin', 'manager', 'employee'] as const;

interface OperatorLoad {
  id: UsersId;
  display_name: string;
  active_count: number;
}

/** Опции назначения. */
export interface AutoAssignOptions {
  /**
   * Тихое назначение: НЕ писать системное сообщение «назначен» в ленту и НЕ
   * слать «громкий» chat:assigned broadcast. Применяется, когда диалог ведёт
   * бот (mode='bot'): оператор закрепляется как наблюдатель на случай перехвата,
   * но клиент и лента не должны видеть, будто чат уже у человека. CRM-событие
   * назначения шлём в любом случае (оно нужно инбоксу для маршрутизации).
   */
  silent?: boolean;
}

/**
 * Auto-assign a newly created conversation to the least-loaded online operator.
 *
 * Steps:
 * 1. Get online user IDs from Redis `ws:online`
 * 2. Filter to operators (by role) and count their active conversations
 * 3. Pick the one with the fewest active chats
 * 4. UPDATE conversations SET assigned_operator_id
 * 5. Insert system message + emit Socket.IO event + CRM inbox event
 *    (в тихом режиме шаги системного сообщения и broadcast пропускаются)
 *
 * Returns the assigned operator ID, or null if no operator was available.
 */
export async function autoAssignOperator(
  conversationId: string,
  options: AutoAssignOptions = {},
): Promise<UsersId | null> {
  const silent = options.silent === true;
  // 1. Get online user IDs from Redis
  const onlineUserIds = await getOnlineUserIds();
  if (onlineUserIds.length === 0) {
    log.debug('no online users, skipping auto-assign', { conversationId });
    return null;
  }

  // 2. Query eligible operators with their active conversation counts
  //    CTE: join online IDs with users table (filter by operator roles),
  //    then LEFT JOIN active conversations to count load.
  const operators = await db.query<OperatorLoad>(
    `WITH online_ops AS (
       SELECT u.id, u.display_name
       FROM users u
       WHERE u.id = ANY($1)
         AND u.role = ANY($2)
     )
     SELECT
       o.id,
       o.display_name,
       COUNT(c.id)::int AS active_count
     FROM online_ops o
     LEFT JOIN conversations c
       ON c.assigned_operator_id = o.id
       AND c.status IN ('open', 'active', 'waiting')
     GROUP BY o.id, o.display_name
     ORDER BY active_count ASC, o.display_name ASC
     LIMIT 1`,
    [onlineUserIds, [...OPERATOR_ROLES]],
  );

  if (operators.length === 0) {
    log.debug('no eligible online operators', { conversationId, onlineCount: onlineUserIds.length });
    return null;
  }

  const chosen = operators[0]!;

  // 3. Assign operator to conversation
  const updated = await db.queryOne<{ id: ConversationsId }>(
    `UPDATE conversations
     SET assigned_operator_id = $2,
         status = CASE WHEN status = 'open' THEN 'active' ELSE status END,
         updated_at = NOW()
     WHERE id = $1
       AND assigned_operator_id IS NULL
     RETURNING id`,
    [conversationId, chosen.id],
  );

  if (!updated) {
    // Already assigned (race condition with manual assign) — do nothing
    log.debug('conversation already assigned, skipping', { conversationId });
    return null;
  }

  const operatorName = chosen.display_name || 'Оператор';

  if (!silent) {
    // 4. System message
    await db.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, message_type, content)
       VALUES ($1, 'bot', 'system', 'Система', 'system', $2)`,
      [conversationId, `Чат автоматически назначен: ${operatorName}`],
    );

    // 5. Socket.IO broadcast
    broadcastToRoom('chat:assigned', 'admin:visitor-chats', {
      sessionId: conversationId,
      operatorId: chosen.id,
      operatorName,
      assignedBy: 'auto-assign',
    });
  }

  // 6. CRM inbox event
  enqueueCrmEvent('chat', conversationId, 'assignment_changed', {
    assigned_to: chosen.id,
    assigned_to_name: operatorName,
    status: 'active',
    priority: 3,
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  log.info('auto-assigned operator', {
    conversationId,
    operatorId: chosen.id,
    operatorName,
    activeChats: chosen.active_count,
    silent,
  });

  return chosen.id;
}

/**
 * Get online user IDs from Redis Sorted Set `ws:online`.
 * Falls back to empty array if Redis is unavailable.
 */
async function getOnlineUserIds(): Promise<string[]> {
  const redis = getCrmRedis();
  if (!redis) return [];

  try {
    return await redis.zrange('ws:online', 0, -1);
  } catch (err) {
    log.warn('failed to read ws:online from Redis', { error: String(err) });
    return [];
  }
}
