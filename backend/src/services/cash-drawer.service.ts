import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import type Agents from '../types/generated/public/Agents.js';
import type PosTransactions from '../types/generated/public/PosTransactions.js';

const log = createLogger('cash-drawer');

interface PaymentLike {
  readonly payment_type?: unknown;
  readonly method?: unknown;
  readonly amount?: unknown;
}

interface CashDrawerCommandInput {
  readonly studioId: string | null | undefined;
  readonly initiatedBy?: string | null;
  readonly receiptId?: string | null;
  readonly orderId?: string | null;
  readonly source?: string;
}

function isPaymentLike(value: unknown): value is PaymentLike {
  return typeof value === 'object' && value !== null;
}

export function hasPositiveCashPayment(payments: unknown): boolean {
  if (!Array.isArray(payments)) return false;

  return payments.some(payment => {
    if (!isPaymentLike(payment)) return false;
    const paymentType = payment.payment_type ?? payment.method;
    return paymentType === 'cash' && Number(payment.amount) > 0;
  });
}

export async function findPosAgentId(studioId: string): Promise<Agents['id'] | null> {
  const onlineAgent = await db.queryOne<Pick<Agents, 'id'>>(
    `SELECT id FROM agents WHERE studio_id = $1 AND agent_type = 'pos' AND is_online = true LIMIT 1`,
    [studioId],
  );
  if (onlineAgent?.id) return onlineAgent.id;

  const anyAgent = await db.queryOne<Pick<Agents, 'id'>>(
    `SELECT id FROM agents WHERE studio_id = $1 AND agent_type = 'pos' LIMIT 1`,
    [studioId],
  );
  return anyAgent?.id ?? null;
}

export async function enqueueCashDrawerCommand(input: CashDrawerCommandInput): Promise<PosTransactions['id'] | null> {
  if (!input.studioId) return null;

  const agentId = await findPosAgentId(input.studioId);
  if (!agentId) {
    log.warn('Cash drawer command skipped: POS agent not found', {
      studio_id: input.studioId,
      receipt_id: input.receiptId ?? null,
      order_id: input.orderId ?? null,
      source: input.source ?? null,
    });
    return null;
  }

  const txResult = await db.queryOne<Pick<PosTransactions, 'id'>>(
    `INSERT INTO pos_transactions (studio_id, agent_id, transaction_type, amount, receipt_id, order_id, status, initiated_by)
     VALUES ($1, $2, 'cash_drawer', 0, $3, $4, 'pending', $5)
     RETURNING id`,
    [
      input.studioId,
      agentId,
      input.receiptId ?? null,
      input.orderId ?? null,
      input.initiatedBy ?? null,
    ],
  );

  log.info('Cash drawer command queued', {
    transaction_id: txResult?.id ?? null,
    studio_id: input.studioId,
    receipt_id: input.receiptId ?? null,
    order_id: input.orderId ?? null,
    source: input.source ?? null,
  });

  return txResult?.id ?? null;
}

export function enqueueCashDrawerCommandSafe(input: CashDrawerCommandInput): void {
  enqueueCashDrawerCommand(input).catch((err: unknown) => {
    log.warn('Cash drawer command failed', {
      studio_id: input.studioId ?? null,
      receipt_id: input.receiptId ?? null,
      order_id: input.orderId ?? null,
      source: input.source ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
