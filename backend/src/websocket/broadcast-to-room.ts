/**
 * broadcastToRoom — role-aware WS emit for PM2-split deployment.
 *
 * Единая точка входа для emit'а в клиентские комнаты независимо от того,
 * какой PM2-процесс её вызывает:
 *
 *  - api / monolith  → прямой `logAndEmit(apiIO, room, event, payload)`
 *  - non-api roles   → `wsPubSub.publish(event, room, payload)` (через Redis)
 *
 * Phase 4.3 переведёт существующие `io.to(room).emit(...)` call-sites на этот
 * вызов. Phase 4.4 привяжет `apiIO` в server.ts через `bindApiIO(socketServer.getIO())`.
 */

import type { Server as SocketIOServer } from 'socket.io';
import type { WsEventPayload } from '../types/jsonb/ws-payload.js';
import { createLogger } from '../utils/logger.js';
import { logAndEmit } from './log-and-emit.js';
import { isApiProcess } from './role.js';
import {
  wsPubSub,
  type PubSubEvent,
  type PubSubRoom,
} from './ws-pubsub.service.js';

const log = createLogger('broadcast-to-room');

let apiIOBound: SocketIOServer | null = null;

/**
 * Register the Socket.IO server instance. Called once в api-процессе после
 * создания SocketServer (см. server.ts).
 */
export function bindApiIO(io: SocketIOServer): void {
  if (apiIOBound !== null) {
    log.warn('bindApiIO called twice — overwriting previous binding');
  }
  apiIOBound = io;
}

/** Test helper — сброс биндинга между spec-runner'ами. */
export function __resetApiIOForTests(): void {
  apiIOBound = null;
}

/**
 * Expose the bound api Socket.IO для metrics-collector (только чтение, НЕ для эмитов).
 * Возвращает null в worker-процессе, где io не биндится.
 */
export function getBoundApiIOForMetrics(): SocketIOServer | null {
  return apiIOBound;
}

/**
 * Broadcast event to room. В api/monolith — напрямую через logAndEmit,
 * в worker-процессах — через Redis pub/sub.
 *
 * Never throws. Pub/sub ошибки логируются и инкрементят `ws_pubsub_dropped_total`.
 */
export function broadcastToRoom(
  event: PubSubEvent,
  room: PubSubRoom,
  payload: WsEventPayload,
): void {
  if (isApiProcess()) {
    if (!apiIOBound) {
      // Boot race — SocketServer ещё не создан. Не throw, просто warn и return.
      log.warn('broadcastToRoom invoked before bindApiIO — dropping emit', {
        event,
        room,
      });
      return;
    }
    logAndEmit(apiIOBound, room, event, payload);
    return;
  }

  // Worker path — fire-and-forget publish; publish() внутри сам swallow'ит ошибки.
  wsPubSub.publish(event, room, payload).catch((err: unknown) => {
    log.warn('ws-pubsub publish threw unexpectedly', {
      event,
      room,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
