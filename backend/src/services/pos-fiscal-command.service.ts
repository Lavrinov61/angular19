import db from '../database/db.js';
import type Agents from '../types/generated/public/Agents.js';
import type PosTransactions from '../types/generated/public/PosTransactions.js';
import { createLogger } from '../utils/logger.js';
import { recordBusinessEvent } from './business-observability.service.js';
import { POS_AGENT_ONLINE_WINDOW_SECONDS } from './pos-agent-availability.service.js';

const logger = createLogger('pos-fiscal-command.service');

export type ShiftFiscalCommandType = 'shift_open' | 'shift_close';

export async function enqueueShiftFiscalCommand(
  studioId: string,
  transactionType: ShiftFiscalCommandType,
  userId: string | null,
): Promise<string | null> {
  try {
    const posAgent = await db.queryOne<Pick<Agents, 'id'>>(
      `SELECT id
       FROM agents
       WHERE studio_id = $1
         AND agent_type = 'pos'
         AND is_active = true
         AND is_online = true
         AND last_heartbeat_at IS NOT NULL
         AND last_heartbeat_at >= NOW() - ($2::int * INTERVAL '1 second')
       ORDER BY last_heartbeat_at DESC NULLS LAST
       LIMIT 1`,
      [studioId, POS_AGENT_ONLINE_WINDOW_SECONDS],
    );
    if (!posAgent) {
      recordBusinessEvent({
        domain: 'pos',
        event: 'fiscal_shift_command.skipped',
        outcome: 'skipped',
        severity: 'warn',
        actorId: userId,
        metadata: {
          studioId,
          transactionType,
          reason: 'no_online_pos_agent',
        },
      });
      return null;
    }

    const transaction = await db.queryOne<Pick<PosTransactions, 'id'>>(
      `INSERT INTO pos_transactions (studio_id, agent_id, transaction_type, amount, status, initiated_by)
       VALUES ($1, $2, $3, 0, 'pending', $4)
       RETURNING id`,
      [studioId, posAgent.id, transactionType, userId],
    );
    recordBusinessEvent({
      domain: 'pos',
      event: 'fiscal_shift_command.enqueued',
      outcome: 'success',
      severity: 'info',
      actorId: userId,
      entityType: 'pos_transaction',
      entityId: transaction?.id ?? null,
      metadata: {
        studioId,
        transactionType,
        agentId: posAgent.id,
      },
    });
    return transaction?.id ?? null;
  } catch (err: unknown) {
    logger.warn('[pos] shift fiscal transaction insert failed', {
      studio_id: studioId,
      transaction_type: transactionType,
      detail: err instanceof Error ? err.message : String(err),
    });
    recordBusinessEvent({
      domain: 'pos',
      event: 'fiscal_shift_command.enqueue_failed',
      outcome: 'failure',
      severity: 'critical',
      actorId: userId,
      error: err,
      metadata: {
        studioId,
        transactionType,
      },
      alert: {
        key: `pos_fiscal_shift_command_failed:${studioId}:${transactionType}`,
        title: 'POS fiscal shift command enqueue failed',
      },
    });
    return null;
  }
}
