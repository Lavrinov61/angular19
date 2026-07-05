/**
 * Payment schedulers — leader-only execution.
 *
 * Extracted from payments.routes.ts to prevent duplicate execution
 * when multiple Node.js instances load the router module.
 *
 * Functions:
 * - cleanupAbandonedOrders: expire pending_payment > 24h (every 60 min)
 * - sendAbandonedCartReminders: 2h + 22h reminders (every 15 min)
 * - cleanupWebhookIdempotency: purge old idempotency keys (daily)
 */

import { createLogger } from '../utils/logger.js';
import { cleanupAbandonedOrders, sendAbandonedCartReminders, expirePaymentLinks } from '../routes/payments.routes.js';
import db from '../database/db.js';

const log = createLogger('payment-scheduler');

let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let reminderInterval: ReturnType<typeof setInterval> | null = null;
let idempotencyCleanupInterval: ReturnType<typeof setInterval> | null = null;
let paymentLinksExpireInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInitialTimeout: ReturnType<typeof setTimeout> | null = null;
let reminderInitialTimeout: ReturnType<typeof setTimeout> | null = null;
let idempotencyInitialTimeout: ReturnType<typeof setTimeout> | null = null;
let paymentLinksExpireInitialTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Cleanup webhook_idempotency entries older than 30 days.
 * Without this, table grows ~2-3M rows/month at 1M DAU.
 */
async function cleanupWebhookIdempotency(): Promise<void> {
  try {
    const result = await db.query(
      `DELETE FROM webhook_idempotency WHERE created_at < NOW() - INTERVAL '30 days'`,
    );
    if (result.length > 0) {
      log.info(`Cleaned up ${result.length} old webhook idempotency entries`);
    }
  } catch (err) {
    log.error('Failed to cleanup webhook idempotency', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startPaymentSchedulers(): void {
  log.info('Starting payment schedulers (leader mode)');

  // Cleanup abandoned orders — every 60 min, first run after 30s
  cleanupInitialTimeout = setTimeout(cleanupAbandonedOrders, 30_000);
  cleanupInterval = setInterval(cleanupAbandonedOrders, 60 * 60 * 1000);

  // Abandoned cart reminders — every 15 min, first run after 60s
  reminderInitialTimeout = setTimeout(sendAbandonedCartReminders, 60_000);
  reminderInterval = setInterval(sendAbandonedCartReminders, 15 * 60 * 1000);

  // Webhook idempotency cleanup — daily, first run after 5 min
  idempotencyInitialTimeout = setTimeout(cleanupWebhookIdempotency, 5 * 60 * 1000);
  idempotencyCleanupInterval = setInterval(cleanupWebhookIdempotency, 24 * 60 * 60 * 1000);

  // Expire pending payment_links — every 15 min, first run after 45s (offset от cleanupAbandonedOrders)
  const runExpirePaymentLinks = (): void => {
    expirePaymentLinks().catch(err => log.error('expirePaymentLinks failed', {
      error: err instanceof Error ? err.message : String(err),
    }));
  };
  paymentLinksExpireInitialTimeout = setTimeout(runExpirePaymentLinks, 45_000);
  paymentLinksExpireInterval = setInterval(runExpirePaymentLinks, 15 * 60 * 1000);
}

export function stopPaymentSchedulers(): void {
  if (cleanupInitialTimeout) { clearTimeout(cleanupInitialTimeout); cleanupInitialTimeout = null; }
  if (reminderInitialTimeout) { clearTimeout(reminderInitialTimeout); reminderInitialTimeout = null; }
  if (idempotencyInitialTimeout) { clearTimeout(idempotencyInitialTimeout); idempotencyInitialTimeout = null; }
  if (paymentLinksExpireInitialTimeout) { clearTimeout(paymentLinksExpireInitialTimeout); paymentLinksExpireInitialTimeout = null; }
  if (cleanupInterval) { clearInterval(cleanupInterval); cleanupInterval = null; }
  if (reminderInterval) { clearInterval(reminderInterval); reminderInterval = null; }
  if (idempotencyCleanupInterval) { clearInterval(idempotencyCleanupInterval); idempotencyCleanupInterval = null; }
  if (paymentLinksExpireInterval) { clearInterval(paymentLinksExpireInterval); paymentLinksExpireInterval = null; }
  log.info('Payment schedulers stopped');
}
