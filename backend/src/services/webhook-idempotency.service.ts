/**
 * Transactional webhook idempotency.
 *
 * Replaces the middleware approach (middleware/idempotency.ts) with in-transaction
 * idempotency: INSERT key + business logic + UPDATE response all in one BEGIN/COMMIT.
 *
 * Benefits:
 * - Atomic: if callback throws, key INSERT is rolled back → CloudPayments retries correctly
 * - No monkey-patch of res.json
 * - Race-safe: INSERT ON CONFLICT prevents double-processing
 */

import type { PoolClient } from 'pg';
import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import { webhookIdempotencyHits } from './metrics.service.js';

const log = createLogger('webhook-idempotency');

export type IdempotencyResult<T> =
  | { duplicate: true; cachedResponse: unknown }
  | { duplicate: false; result: T };

/**
 * Execute a webhook handler inside an idempotent transaction.
 *
 * Key format: {webhookType}:{transactionId}
 *
 * @param webhookType - 'pay', 'fail', 'refund', 'cancel', 'recurrent'
 * @param transactionId - CloudPayments TransactionId
 * @param orderId - InvoiceId (nullable, for logging/audit)
 * @param callback - business logic receiving the transaction's PoolClient
 * @param responseBody - optional response to cache (defaults to { code: 0 })
 */
export async function withWebhookIdempotency<T>(
  webhookType: string,
  transactionId: string,
  orderId: string | null,
  callback: (client: PoolClient) => Promise<T>,
  responseBody: unknown = { code: 0 },
): Promise<IdempotencyResult<T>> {
  const key = `${webhookType}:${transactionId}`;

  return db.transaction(async (client) => {
    // 1. Try to claim the idempotency key
    const claimResult = await client.query<{ idempotency_key: string }>(
      `INSERT INTO webhook_idempotency (idempotency_key, webhook_type, order_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [key, webhookType, orderId],
    );

    if (claimResult.rows.length === 0) {
      // Key already exists — another process handled this webhook
      webhookIdempotencyHits.inc();

      const existing = await client.query<{ response_body: unknown }>(
        'SELECT response_body FROM webhook_idempotency WHERE idempotency_key = $1',
        [key],
      );

      const cached = existing.rows[0]?.response_body ?? { code: 0 };
      log.info('Duplicate webhook detected', { key, webhookType, orderId });

      return { duplicate: true, cachedResponse: cached } satisfies IdempotencyResult<T>;
    }

    // 2. Execute business logic with the same transaction client
    const result = await callback(client);

    // 3. Save response in the same transaction
    await client.query(
      `UPDATE webhook_idempotency
       SET response_code = $2, response_body = $3
       WHERE idempotency_key = $1`,
      [key, 0, JSON.stringify(responseBody)],
    );

    return { duplicate: false, result } satisfies IdempotencyResult<T>;
  });
}
