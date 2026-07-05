/**
 * Inbox Materialized View Refresh + Reconciliation Service
 *
 * Post-CQRS role: backstop reconciliation every 5 minutes.
 * Primary inbox updates are handled by crm-event-queue.service.ts (O(1) per event).
 * MV refresh catches drift from missed events.
 *
 * After MV refresh, reconciles crm_inbox table from the MV.
 */
import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('inbox-mv');

const REFRESH_INTERVAL_MS = 300_000; // 5 minutes (backstop only, was 30s)

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isRefreshing = false;

async function refreshAndReconcile(): Promise<void> {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    // 1. Refresh MV
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY crm_inbox_view');

    // 2. Reconcile crm_inbox table from MV (catches drift from missed events)
    await db.query(`
      INSERT INTO crm_inbox (type, id, client_name, client_phone, preview, status, priority, sort_time, channel, assigned_to, assigned_to_name, unread, metadata, updated_at)
      SELECT type, id, client_name, client_phone, preview, status, priority, sort_time, channel, assigned_to, assigned_to_name, unread, metadata, NOW()
      FROM crm_inbox_view
      ON CONFLICT (type, id) DO UPDATE SET
        client_name      = EXCLUDED.client_name,
        client_phone     = EXCLUDED.client_phone,
        preview          = EXCLUDED.preview,
        status           = EXCLUDED.status,
        priority         = EXCLUDED.priority,
        sort_time        = EXCLUDED.sort_time,
        channel          = EXCLUDED.channel,
        assigned_to      = EXCLUDED.assigned_to,
        assigned_to_name = EXCLUDED.assigned_to_name,
        unread           = EXCLUDED.unread,
        metadata         = EXCLUDED.metadata,
        updated_at       = NOW()
    `);

    // 2b. SLA auto-urgent: escalate chat priority to 0 (urgent) when SLA breached (5 min, no first response)
    await db.query(`
      UPDATE crm_inbox ci
      SET priority = 0, updated_at = NOW()
      FROM conversations c
      WHERE ci.type = 'chat'
        AND ci.priority > 0
        AND c.id = ci.id::uuid
        AND c.status IN ('open','waiting','active')
        AND c.first_response_at IS NULL
        AND EXTRACT(epoch FROM now() - c.created_at) >= 300
    `);

    // 2c. Sync status for chats that fell out of MV (closed in conversations but stale in crm_inbox).
    // The MV only includes open/waiting/active, so closed chats never get their status updated by step 2.
    // This catches the drift so step 3 DELETE can clean them up.
    await db.query(`
      UPDATE crm_inbox ci
      SET status = c.status, updated_at = NOW()
      FROM conversations c
      WHERE ci.type = 'chat' AND c.id = ci.id::uuid AND ci.status != c.status
    `);

    // 3. Remove orphaned chat entries (conversation deleted/never migrated)
    await db.query(`
      DELETE FROM crm_inbox ci
      WHERE ci.type = 'chat'
        AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = ci.id::uuid)
    `);

    // 4. Remove closed/resolved chats from crm_inbox (status-based)
    await db.query(`
      DELETE FROM crm_inbox ci
      WHERE ci.type = 'chat' AND ci.status IN ('closed', 'resolved')
    `);
    await db.query(`
      DELETE FROM crm_inbox ci
      WHERE ci.type = 'task' AND ci.status IN ('completed', 'cancelled')
    `);
    await db.query(`
      DELETE FROM crm_inbox ci
      WHERE ci.type = 'order' AND ci.status IN ('completed', 'cancelled', 'refunded', 'payment_failed', 'expired')
    `);
    await db.query(`
      DELETE FROM crm_inbox ci
      WHERE ci.type = 'approval' AND ci.status = 'completed'
    `);
    await db.query(`
      DELETE FROM crm_inbox ci
      WHERE ci.type = 'booking' AND ci.status IN ('cancelled', 'completed', 'no-show')
    `);

    log.debug('MV refresh + reconciliation completed');
  } catch (err) {
    log.error('MV refresh/reconciliation failed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    isRefreshing = false;
  }
}

export function startInboxMVRefresh(): void {
  if (intervalHandle) return;
  // Immediate reconciliation on startup to catch anything missed while offline
  refreshAndReconcile().catch(err => log.error('Initial MV refresh failed', { error: String(err) }));
  intervalHandle = setInterval(refreshAndReconcile, REFRESH_INTERVAL_MS);
  log.info('Inbox MV backstop started (every 5min)');
}

export function stopInboxMVRefresh(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('Inbox MV backstop stopped');
  }
}

/**
 * Принудительный refresh + reconciliation.
 * Вызывается редко — для ручного триггера или после bulk операций.
 */
export async function triggerInboxMVRefresh(): Promise<void> {
  await refreshAndReconcile();
}
