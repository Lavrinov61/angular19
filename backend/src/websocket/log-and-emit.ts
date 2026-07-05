/**
 * logAndEmit — единая точка emit для критичных WS-событий (Phase 4, pult-notifications-idle).
 *
 * Назначение:
 * - Наблюдаемость доставки критичных нотификаций (размер комнаты в момент emit,
 *   счётчики notifications_emit_total / ws_emit_empty_room_total).
 * - PII-safety: payload не логируется, только Object.keys(payload).length.
 * - Для не-критичных событий (visitor:online-status, typing:*, presence и т.д.)
 *   используется прямой io.emit — fallback ниже.
 *
 * CRITICAL_WS_EVENTS — closed-set, добавлять только после ревью архитектора.
 */

import type { Server as SocketIOServer } from 'socket.io';
import { createLogger } from '../utils/logger.js';
import { notificationsEmitTotal, wsEmitEmptyRoomTotal } from '../services/metrics.service.js';

const log = createLogger('ws-log-emit');

export const CRITICAL_WS_EVENTS: ReadonlySet<string> = new Set([
  'notification:new',
  'notification:count',
  'chat:inbox-updated',
  'order:created',
  'order:updated',
  'order:deleted',
  'payment-link:expired',
  'payment-link:paid',
  'payment-link:linked',
  'payment-link:updated',
  'payment-link:cancelled',
  'studio:status-changed',
  'staff-chat:mention',
]);

export type RoomType =
  | 'user'
  | 'admin-visitor-chats'
  | 'admin-channels'
  | 'admin-infra'
  | 'employee-dashboard'
  | 'staff-online'
  | 'studio'
  | 'booking'
  | 'order'
  | 'conversation'
  | 'visitor'
  | 'staff-chat'
  | 'global'
  | 'other';

/** Sentinel для io.emit без конкретной комнаты (broadcast всем подключённым). */
export const GLOBAL_ROOM = '__GLOBAL__';

export function classifyRoom(room: string): RoomType {
  if (room === GLOBAL_ROOM) return 'global';
  if (room === 'admin:visitor-chats') return 'admin-visitor-chats';
  if (room === 'admin:channels') return 'admin-channels';
  if (room === 'admin:infra') return 'admin-infra';
  if (room === 'employee:dashboard') return 'employee-dashboard';
  if (room === 'staff-online') return 'staff-online';
  if (room.startsWith('user:')) return 'user';
  if (room.startsWith('studio:')) return 'studio';
  if (room.startsWith('booking:')) return 'booking';
  if (room.startsWith('order:')) return 'order';
  if (room.startsWith('conversation:')) return 'conversation';
  if (room.startsWith('visitor:')) return 'visitor';
  if (room.startsWith('staff-chat:')) return 'staff-chat';
  return 'other';
}

/**
 * Emit + log + metrics для критичных событий. Для не-критичных — прямой io.emit.
 *
 * @param io         Socket.IO server (adapter-aware — работает cross-node).
 * @param room       Имя комнаты или GLOBAL_ROOM для broadcast.
 * @param event      Имя WS-события.
 * @param payload    Любой сериализуемый объект. Не логируется, только keys.length.
 */
export function logAndEmit(
  io: SocketIOServer,
  room: string,
  event: string,
  payload: object,
): void {
  // Non-critical events: fallback на прямой emit без метрик/логов.
  if (!CRITICAL_WS_EVENTS.has(event)) {
    if (room === GLOBAL_ROOM) {
      io.emit(event, payload);
    } else {
      io.to(room).emit(event, payload);
    }
    return;
  }

  const roomType = classifyRoom(room);
  const payloadKeyCount = payload && typeof payload === 'object' ? Object.keys(payload).length : 0;

  // Размер комнаты — только для адресных emit. Для global считать не имеет смысла
  // (нет операционной реакции на "мы бродкастим всем подключённым").
  let size = 0;
  if (room !== GLOBAL_ROOM) {
    const roomSet = io.sockets.adapter.rooms.get(room);
    size = roomSet ? roomSet.size : 0;
  }

  // Emit всегда, даже если room пуста — delivered через Redis adapter на другие ноды.
  if (room === GLOBAL_ROOM) {
    io.emit(event, payload);
  } else {
    io.to(room).emit(event, payload);
  }

  notificationsEmitTotal.inc({ event, room_type: roomType });

  if (room !== GLOBAL_ROOM && size === 0) {
    wsEmitEmptyRoomTotal.inc({ event, room_type: roomType });
    log.warn('WS critical emit into empty room', {
      event,
      room,
      roomType,
      payloadKeyCount,
    });
  } else {
    log.info('WS critical emit', {
      event,
      room,
      roomType,
      size,
      payloadKeyCount,
    });
  }
}
