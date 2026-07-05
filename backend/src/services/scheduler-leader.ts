/**
 * Scheduler Leader Election via PostgreSQL Advisory Lock.
 *
 * Only one instance (leader) runs schedulers. The other serves HTTP only.
 * If the leader dies, the follower acquires the lock within ~30s and starts schedulers.
 *
 * Uses a dedicated pooled connection that holds a session-level advisory lock.
 */
import { PoolClient } from 'pg';
import { pool } from '../database/db.js';

import { createLogger } from '../utils/logger.js';
const LEADER_LOCK_ID = 737001;
const RETRY_MS = 30_000;
const HEARTBEAT_MS = 60_000;

const logger = createLogger('scheduler-leader');
let lockClient: PoolClient | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let isLeader = false;
let onBecomeLeader: (() => void) | null = null;
let onLoseLeadership: (() => void) | null = null;

async function tryAcquire(): Promise<void> {
  if (isLeader) return;

  try {
    const client = await pool.connect();
    const { rows } = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [LEADER_LOCK_ID],
    );

    if (rows[0].acquired) {
      lockClient = client;
      isLeader = true;
      logger.info('[Leader] Acquired advisory lock — this instance is the scheduler leader');

      heartbeatTimer = setInterval(async () => {
        try {
          await lockClient?.query('SELECT 1');
        } catch {
          loseLeadership();
        }
      }, HEARTBEAT_MS);

      client.on('error', () => loseLeadership());
      onBecomeLeader?.();
    } else {
      // Check if lock is held by a stale/dead session and terminate it
      try {
        const { rows: holders } = await client.query<{
          pid: number; state: string; idle_seconds: number;
        }>(`
          SELECT l.pid, a.state,
                 EXTRACT(EPOCH FROM (NOW() - COALESCE(a.query_start, a.state_change)))::int AS idle_seconds
          FROM pg_locks l
          JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND l.classid = 0 AND l.objid = $1 AND l.granted = true
        `, [LEADER_LOCK_ID]);

        if (holders.length > 0) {
          const holder = holders[0];
          if (holder.idle_seconds > 120) {
            logger.warn('[Leader] Terminating stale lock holder', {
              pid: holder.pid, state: holder.state, idleSeconds: holder.idle_seconds,
            });
            await client.query('SELECT pg_terminate_backend($1)', [holder.pid]);
          }
        }
      } catch (err) {
        logger.warn('[Leader] Stale holder check failed', { error: String(err) });
      }
      client.release();
    }
  } catch (err) {
    logger.error('[Leader] Lock acquisition error:', { error: String(err) });
  }
}

function loseLeadership(): void {
  if (!isLeader) return;
  isLeader = false;
  logger.warn('[Leader] Lost leadership — stopping schedulers');

  // Clear timers first to prevent race conditions
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }

  if (lockClient) {
    // Attempt advisory unlock before releasing connection
    try {
      lockClient.query('SELECT pg_advisory_unlock($1)', [LEADER_LOCK_ID])
        .catch((err: unknown) => logger.warn('[Leader] unlock failed during loseLeadership', { error: String(err) }));
    } catch { /* connection already dead */ }
    try { lockClient.release(); } catch { /* ignore */ }
    lockClient = null;
  }

  onLoseLeadership?.();
}

export async function initLeaderElection(
  onLeader: () => void,
  onFollower: () => void,
): Promise<void> {
  onBecomeLeader = onLeader;
  onLoseLeadership = onFollower;

  await tryAcquire();

  retryTimer = setInterval(() => tryAcquire(), RETRY_MS);
}

export function getLeaderStatus(): 'leader' | 'follower' {
  return isLeader ? 'leader' : 'follower';
}

export async function stopLeaderElection(): Promise<void> {
  // Clear timers first to prevent race conditions during shutdown
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }

  if (lockClient) {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [LEADER_LOCK_ID]);
    } catch (err) {
      logger.warn('[Leader] unlock failed during stopLeaderElection', { error: String(err) });
    }
    try { lockClient.release(); } catch { /* connection already dead */ }
    lockClient = null;
  }
  isLeader = false;
}
