/**
 * Studio schedulers — leader-only execution.
 *
 * Функции:
 * - expireStudioClosures: каждые 10 мин сканирует studios, где status != 'open'
 *   и status_until < CURRENT_DATE → возвращает 'open', эмитит WS 'studio:status-changed'.
 *   Partial index idx_studios_status_expired (migration 130) даёт O(k), k = число
 *   потенциально закрытых студий (обычно 0-3).
 */

import { createLogger } from '../utils/logger.js';
import db from '../database/db.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import { GLOBAL_ROOM } from '../websocket/ws-pubsub.service.js';

const log = createLogger('studio-scheduler');

let expireInterval: ReturnType<typeof setInterval> | null = null;
let expireInitialTimeout: ReturnType<typeof setTimeout> | null = null;

interface ExpiredStudioRow {
  id: string;
  location_code: string | null;
  name: string;
}

export async function expireStudioClosures(): Promise<void> {
  try {
    const rows = await db.query<ExpiredStudioRow>(
      `UPDATE studios
       SET status = 'open', status_message = NULL, status_until = NULL, updated_at = NOW()
       WHERE status != 'open'
         AND status_until IS NOT NULL
         AND status_until < CURRENT_DATE
       RETURNING id, location_code, name`,
    );
    if (rows.length === 0) return;

    log.info(`[Studio] Reopened ${rows.length} studios with expired status_until`, {
      studios: rows.map(r => r.location_code).filter(Boolean),
    });

    for (const row of rows) {
      try {
        broadcastToRoom('studio:status-changed', GLOBAL_ROOM, {
          studioId: row.id,
          locationCode: row.location_code,
          status: 'open',
          status_until: null,
        });
      } catch { /* pub/sub not available */ }
    }
  } catch (err) {
    log.error('[Studio] expireStudioClosures failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startStudioSchedulers(): void {
  log.info('Starting studio schedulers (leader mode)');

  const run = (): void => {
    expireStudioClosures().catch(err =>
      log.error('expireStudioClosures failed', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  };
  expireInitialTimeout = setTimeout(run, 45_000);
  expireInterval = setInterval(run, 10 * 60 * 1000);
}

export function stopStudioSchedulers(): void {
  if (expireInitialTimeout) { clearTimeout(expireInitialTimeout); expireInitialTimeout = null; }
  if (expireInterval) { clearInterval(expireInterval); expireInterval = null; }
  log.info('Studio schedulers stopped');
}
