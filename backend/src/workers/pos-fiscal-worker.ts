/**
 * pos-fiscal-worker.ts — BullMQ queue for fiscal receipt processing (ATOL 27F via POS Bridge).
 *
 * Pattern: copied from post-payment-queue.service.ts.
 * Concurrency: 1 (single KKT per studio).
 */

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { captureException } from '../utils/error-tracker.js';
import { getBreaker, SERVICE_BREAKERS } from '../utils/circuit-breaker.js';
import { alertCircuitBreakerOpen } from '../services/alerting.service.js';
import db from '../database/db.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import type PosReceipts from '../types/generated/public/PosReceipts.js';
import type Agents from '../types/generated/public/Agents.js';

const log = createLogger('pos-fiscal-worker');

// ─── Circuit breaker for ATOL fiscal endpoint ──────────────────────────────

const CB_CFG = SERVICE_BREAKERS.atolFiscal;
const fiscalBreaker = getBreaker(CB_CFG.name);
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

async function pingAtol(): Promise<boolean> {
  try {
    const resp = await fetch(`${config.bridge.posUrl}/fiscal/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function startHealthCheck(): void {
  if (healthCheckTimer) return;
  healthCheckTimer = setInterval(async () => {
    const ok = await pingAtol();
    if (ok && worker) {
      fiscalBreaker.success();
      log.info('Fiscal circuit CLOSED — ATOL recovered, resuming queue');
      worker.resume();
      emitCircuitState('CLOSED');
      stopHealthCheck();
    } else {
      log.debug('ATOL health check — still unreachable');
    }
  }, 30_000);
}

function stopHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

function emitCircuitState(state: string): void {
  broadcastToRoom('fiscal:circuit', 'admin:infra', { state, timestamp: new Date().toISOString() });
}

function onCircuitOpen(errorMsg: string): void {
  if (!worker) return;
  log.warn('Fiscal circuit OPEN — ATOL unreachable, pausing queue');
  worker.pause();
  emitCircuitState('OPEN');
  startHealthCheck();
  alertCircuitBreakerOpen(CB_CFG.name, fiscalBreaker.getFailures(), errorMsg)
    .catch((err: unknown) => log.error('Failed to send circuit-open alert', { error: err instanceof Error ? err.message : String(err) }));
}

// ─── Redis connection ───────────────────────────────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FiscalJobData {
  receiptId: string;
  receiptNumber: string;
  items: unknown[];
  total: number;
  payments: unknown[];
  operation: 'sale' | 'void' | 'refund';
}

interface FiscalBridgeResult {
  receipt_url?: string;
  receipt_number?: string;
  fiscal_sign?: string;
}

interface InsertedTxRow {
  id: string;
}

// ─── Queue (always created — enqueue can happen from any node) ──────────────

const QUEUE_NAME = 'pos-fiscal';
const queue = new Queue(QUEUE_NAME, { connection: { ...redisOpts } });

export function getFiscalQueue(): Queue {
  return queue;
}

// ─── Enqueue ────────────────────────────────────────────────────────────────

function normalizeFiscalPaymentMethod(method: string): string {
  switch (method) {
    case 'cash':
    case 'card':
    case 'sbp':
      return method;
    case 'subscription':
      return 'prepaid';
    case 'online':
    case 'transfer':
      return 'card';
    default:
      return 'card';
  }
}

function extractPaymentMethod(payments: unknown[]): string {
  let subscriptionOnly = false;

  for (const payment of payments) {
    if (!payment || typeof payment !== 'object' || !('payment_type' in payment)) continue;
    const val = Reflect.get(payment, 'payment_type');
    if (typeof val !== 'string') continue;
    if (val === 'subscription') {
      subscriptionOnly = true;
      continue;
    }
    return normalizeFiscalPaymentMethod(val);
  }

  return subscriptionOnly ? 'prepaid' : 'card';
}

// Receipt fiscal_status values for which a fiscal job is already in-flight or done.
// Claiming the receipt in any of these states would double-fiscalize the same sale
// on the real ATOL KKT (54-ФЗ), so we skip. Legitimate fiscal-retry works with
// 'failed', which is NOT in this set and therefore still claims successfully.
const FISCAL_INFLIGHT_STATUSES = ['queued', 'processing', 'success'] as const;

export async function enqueueFiscal(data: FiscalJobData): Promise<void> {
  // Look up studio_id from the receipt
  const receipt = await db.queryOne<Pick<PosReceipts, 'studio_id'>>(
    `SELECT studio_id FROM pos_receipts WHERE id = $1`,
    [data.receiptId],
  );
  if (!receipt) {
    log.error(`Receipt ${data.receiptId} not found, skipping fiscal enqueue`);
    return;
  }

  // Find the POS agent for this studio (needed for print-api MQTT routing)
  const agent = await db.queryOne<Pick<Agents, 'id'>>(
    `SELECT id FROM agents WHERE studio_id = $1 AND agent_type = 'pos' LIMIT 1`,
    [receipt.studio_id],
  );

  const paymentMethod = Array.isArray(data.payments) && data.payments.length > 0
    ? extractPaymentMethod(data.payments)
    : 'card';

  const txType = data.operation === 'refund' || data.operation === 'void'
    ? 'fiscal_refund'
    : 'fiscal_sale';

  // Idempotency guard against double-fiscalization (P0). The claim and the INSERT
  // run in ONE transaction so a crash between them can't leave a "queued" receipt
  // without its fiscal_sale tx (the ROLLBACK undoes the claim).
  //
  // Race safety: the CAS-claim is a single-row UPDATE on pos_receipts that takes a
  // row-level lock and only succeeds when fiscal_status is NOT already in-flight.
  // Two concurrent enqueueFiscal calls on the same receipt serialize on that lock;
  // the loser sees 0 rows (the winner already flipped the status) and bails out.
  // This is the actual atomic guard (a WHERE NOT EXISTS read would NOT serialize,
  // since the status flip is a separate statement). 'failed' is not in-flight, so
  // legitimate fiscal-retry claims successfully and re-fiscalizes.
  const claimed = await db.transaction(async (client) => {
    const claim = await client.query<InsertedTxRow>(
      `UPDATE pos_receipts
         SET fiscal_status = 'queued', fiscal_queued_at = NOW()
       WHERE id = $1 AND fiscal_status <> ALL($2::text[])
       RETURNING id`,
      [data.receiptId, FISCAL_INFLIGHT_STATUSES],
    );
    if (claim.rowCount === 0) {
      // Another caller already claimed this receipt (or it is already fiscalized).
      return false;
    }

    // Claimed: enqueue the fiscal-sale tx. PG NOTIFY -> print-api -> MQTT -> pos-agent -> ATOL.
    // A failure here throws → db.transaction ROLLBACKs the claim above.
    await client.query(
      `INSERT INTO pos_transactions (studio_id, agent_id, transaction_type, amount, receipt_id, status, payment_method, initiated_by)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
      [receipt.studio_id, agent?.id ?? null, txType, data.total, data.receiptId, paymentMethod, null],
    );
    return true;
  });

  if (!claimed) {
    // Receipt already has a fiscal job in-flight or fiscalized, so skip to avoid a
    // duplicate ATOL receipt. Not an error: this is the guard against re-enqueue.
    log.info(`Skipping fiscal enqueue for receipt ${data.receiptNumber}: already queued/processing/fiscalized`, { receiptId: data.receiptId, operation: data.operation });
    return;
  }

  log.info(`Enqueued fiscal job for receipt ${data.receiptNumber} via pos_transactions`, { operation: data.operation, txType });
}

// ─── Worker (started only on leader node) ───────────────────────────────────

let worker: Worker | null = null;

export function startFiscalWorker(): void {
  log.info('Starting POS fiscal worker');

  worker = new Worker(QUEUE_NAME, async (job: Job<FiscalJobData>) => {
    const d = job.data;

    // Circuit breaker guard — if ATOL is known to be down, fail fast
    if (!fiscalBreaker.allow()) {
      throw new Error('Fiscal circuit OPEN — ATOL unreachable, job will retry after recovery');
    }

    // Mark as processing
    await db.query(
      `UPDATE pos_receipts SET fiscal_status = 'processing', fiscal_attempts = fiscal_attempts + 1 WHERE id = $1`,
      [d.receiptId],
    );

    let response: Response;
    try {
      response = await fetch(`${config.bridge.posUrl}/fiscal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receipt_number: d.receiptNumber,
          items: d.items,
          total: d.total,
          payments: d.payments,
          operation: d.operation,
        }),
        signal: AbortSignal.timeout(CB_CFG.timeoutMs ?? 15_000),
      });
    } catch (fetchErr) {
      // Network-level failure (ECONNREFUSED, timeout) — trip breaker
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      fiscalBreaker.failure(errMsg);
      if (fiscalBreaker.getState() === 'OPEN') {
        onCircuitOpen(errMsg);
      }
      throw fetchErr;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const errMsg = `Fiscal bridge returned ${response.status}: ${errorText}`;
      // 5xx = ATOL/bridge infrastructure issue → trip breaker
      if (response.status >= 500) {
        fiscalBreaker.failure(errMsg);
        if (fiscalBreaker.getState() === 'OPEN') {
          onCircuitOpen(errMsg);
        }
      }
      throw new Error(errMsg);
    }

    // Success — reset circuit breaker
    fiscalBreaker.success();

    const result = await response.json() as FiscalBridgeResult;

    // Update receipt with fiscal data
    await db.query(
      `UPDATE pos_receipts SET
        fiscal_status = 'success',
        fiscal_receipt_url = COALESCE($2, fiscal_receipt_url),
        fiscal_receipt_number = COALESCE($3, fiscal_receipt_number),
        fiscal_sign = COALESCE($4, fiscal_sign)
      WHERE id = $1`,
      [
        d.receiptId,
        result.receipt_url ?? null,
        result.receipt_number ?? null,
        result.fiscal_sign ?? null,
      ],
    );

    log.info(`Fiscal success for ${d.receiptNumber}`, { operation: d.operation });

    // Notify CRM operators via Socket.IO
    const receiptRow = await db.queryOne<Pick<PosReceipts, 'studio_id'>>(
      `SELECT studio_id FROM pos_receipts WHERE id = $1`,
      [d.receiptId],
    );
    if (receiptRow?.studio_id) {
      broadcastToRoom('fiscal:success', `studio:${receiptRow.studio_id}`, {
        receipt_id: d.receiptId,
        receipt_number: d.receiptNumber,
        fiscal_receipt_number: (result['receipt_number'] as string | undefined) ?? null,
        fiscal_sign: (result['fiscal_sign'] as string | undefined) ?? null,
      });
    }
  }, {
    connection: { ...redisOpts },
    concurrency: 1, // Single KKT per studio
  });

  worker.on('failed', (job: Job<FiscalJobData> | undefined, err: Error) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts || 5;

    // Update DB with error
    db.query(
      `UPDATE pos_receipts SET fiscal_status = 'failed', fiscal_last_error = $2 WHERE id = $1`,
      [job.data.receiptId, err.message],
    ).catch((dbErr: unknown) => log.error('Failed to update fiscal_last_error', { error: dbErr instanceof Error ? dbErr.message : String(dbErr) }));

    if (job.attemptsMade >= maxAttempts) {
      captureException(err, {
        tags: { worker: 'pos-fiscal', receipt: job.data.receiptNumber },
        extra: { receiptId: job.data.receiptId, attempts: job.attemptsMade, operation: job.data.operation },
        level: 'error',
      });
      log.error(`Fiscal dead letter: ${job.data.receiptNumber}`, {
        error: err.message,
        attempts: job.attemptsMade,
        receiptId: job.data.receiptId,
      });

      // Notify CRM operators via Socket.IO
      db.query<Pick<PosReceipts, 'studio_id'>>(
        `SELECT studio_id FROM pos_receipts WHERE id = $1`,
        [job.data.receiptId],
      ).then((rows) => {
        const studioId = rows[0]?.studio_id;
        if (studioId) {
          broadcastToRoom('fiscal:failure', `studio:${studioId}`, {
            receipt_id: job.data.receiptId,
            receipt_number: job.data.receiptNumber,
            error_message: err.message,
            retry_count: job.attemptsMade,
            operation: job.data.operation,
          });
        }
      }).catch((dbErr: unknown) => log.error('Failed to emit fiscal:failure', { error: dbErr instanceof Error ? dbErr.message : String(dbErr) }));
    }
  });

  worker.on('error', (err: Error) => {
    captureException(err, { tags: { worker: 'pos-fiscal' }, level: 'error' });
    log.error('Fiscal worker error', { error: err.message });
  });
}

export async function stopFiscalWorker(): Promise<void> {
  stopHealthCheck();
  if (worker) {
    log.info('Stopping POS fiscal worker');
    await worker.close();
    worker = null;
  }
}
