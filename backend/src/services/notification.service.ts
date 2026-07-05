import db from '../database/db.js';
import { sendPush } from './web-push-notify.service.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';

import { createLogger } from '../utils/logger.js';

interface NotificationData {
  [key: string]: unknown;
}

interface CreateNotificationParams {
  userId: string;
  title: string;
  body: string;
  type: 'order_status' | 'booking_update' | 'chat_message' | 'system' | 'retouch_approval'
    | 'task_assigned' | 'task_handoff' | 'task_urgent' | 'task_deadline' | 'shift_briefing' | 'shift_reminder' | 'colleague_note'
    | 'partner_registration' | 'partner_status' | 'partner_referral' | 'partner_payout'
    | 'schedule_request' | 'payment_confirmed';
  data?: NotificationData;
}

const logger = createLogger('notification.service');

interface NotificationRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: string;
  data: NotificationData | string | null;
  read: boolean;
  timestamp: string;
  created_at: string;
}

interface UnreadNotificationCountRow {
  count: string;
}

function normalizeNotificationData(value: unknown): NotificationData {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return normalizeNotificationData(parsed);
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const data: NotificationData = {};
    for (const [key, item] of Object.entries(value)) {
      data[key] = item;
    }
    return data;
  }
  return {};
}

export class NotificationService {
  /**
   * @deprecated Socket.IO binding больше не нужен — эмиты идут через broadcastToRoom().
   * Оставлен как no-op shim для обратной совместимости с server.ts (удалится в P2).
   */
  static setSocketServer(_server: unknown): void {
    /* no-op — kept for caller compatibility, see class JSDoc */
  }

  static async create(params: CreateNotificationParams): Promise<NotificationRow | null> {
    const { userId, title, body, type, data } = params;

    try {
      const notification = await db.queryOne<NotificationRow>(
        `INSERT INTO notifications (user_id, title, body, type, data)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING *`,
        [userId, title, body, type, JSON.stringify(data || {})]
      );

      if (notification) {
        broadcastToRoom('notification:new', `user:${userId}`, {
          id: notification.id,
          title: notification.title,
          body: notification.body,
          type: notification.type,
          data: notification.data,
          read: notification.read,
          timestamp: notification.timestamp || notification.created_at,
        });
      }

      // Web Push (серверный, работает даже если вкладка закрыта)
      if (notification) {
        const pushTypes = ['task_assigned', 'task_handoff', 'task_urgent', 'task_deadline', 'shift_reminder', 'retouch_approval'];
        if (pushTypes.includes(type)) {
          const pushUrl = type === 'retouch_approval' && data?.['chatSessionId']
            ? `/employee?approvalId=${data['sessionId']}`
            : data?.['taskId'] ? `/employee/tasks/${data['taskId']}` : '/employee';
          sendPush(userId, {
            title,
            body,
            tag: `${type}-${notification.id}`,
            url: pushUrl,
            icon: '/web-app-manifest-192x192.png',
            sound: type === 'task_urgent' || type === 'task_deadline',
          }).catch(err => logger.error('[NotificationService] WebPush error', { error: String(err) }));
        }
      }

      return notification;
    } catch (error) {
      logger.error('[NotificationService] Failed to create notification:', { error: String(error) });
      return null;
    }
  }

  private static readonly GROUPABLE_TYPES = [
    'task_assigned', 'task_handoff', 'chat_message', 'colleague_note',
  ];
  private static readonly GROUP_WINDOW_SEC = 300; // 5 минут

  /**
   * Создать уведомление или сгруппировать с недавним аналогичным.
   * Группируемые типы: task_assigned, task_handoff, chat_message, colleague_note.
   */
  static async createOrGroup(params: CreateNotificationParams): Promise<NotificationRow | null> {
    if (!this.GROUPABLE_TYPES.includes(params.type)) {
      return this.create(params);
    }

    try {
      const recent = await db.queryOne<NotificationRow>(
        `SELECT id, user_id, title, body, type, data, read, timestamp, created_at, updated_at FROM notifications
         WHERE user_id = $1 AND type = $2 AND read = false
           AND created_at > NOW() - make_interval(secs => $3)
         ORDER BY created_at DESC LIMIT 1`,
        [params.userId, params.type, this.GROUP_WINDOW_SEC],
      );

      if (recent) {
        const existingData = normalizeNotificationData(recent.data);
        const rawGroupCount = existingData['group_count'];
        const groupCount = (typeof rawGroupCount === 'number' ? rawGroupCount : 1) + 1;

        const updated = await db.queryOne<NotificationRow>(
          `UPDATE notifications
           SET body = $1, data = $2::jsonb, created_at = NOW()
           WHERE id = $3 RETURNING *`,
          [
            `${params.body} (+${groupCount - 1} ещё)`,
            JSON.stringify({ ...existingData, ...params.data, group_count: groupCount }),
            recent.id,
          ],
        );

        if (updated) {
          broadcastToRoom('notification:new', `user:${params.userId}`, {
            id: updated.id,
            title: params.title,
            body: updated.body,
            type: updated.type,
            data: updated.data,
            read: false,
            timestamp: updated.created_at,
          });
        }

        return updated;
      }
    } catch (err) {
      logger.error('[NotificationService] Group check failed, falling back to create', { error: String(err) });
    }

    return this.create(params);
  }

  static async getUnreadCount(userId: string): Promise<number> {
    try {
      const result = await db.queryOne<UnreadNotificationCountRow>(
        `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false`,
        [userId]
      );
      return parseInt(result?.count || '0', 10);
    } catch (error) {
      logger.error('[NotificationService] Failed to get unread count:', { error: String(error) });
      return 0;
    }
  }
}
