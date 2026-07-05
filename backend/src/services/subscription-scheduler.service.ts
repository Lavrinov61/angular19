/**
 * Subscription Scheduler — handles:
 * 1. Provisioning credits for new billing periods (renewals via CloudPayments webhook)
 * 2. Expiring subscriptions past their period end without renewal
 * 3. Resuming paused subscriptions when pause_until date arrives
 *
 * Plus the card-change reconciler (S4) — a money-safety net that guarantees there is
 * never more than one active CloudPayments recurrent per subscription after a card swap.
 *
 * Runs under the scheduler-leader singleton (started from onBecomeLeaderMonolith /
 * scheduler entry point — never on dev/follower processes).
 */
import db from '../database/db.js';
import {
  provisionCredits,
  cancelCloudPaymentsRecurrentChecked,
  cloudPaymentsSubscriptionFind,
  adoptOrphanCardChange,
  reconcileEducationEntitlements,
} from './subscription.service.js';
import {
  cardChangeReconcilerCancelRetriesTotal,
  cardChangeOrphanDetectedTotal,
  cardChangePendingCancelOpen,
  cardChangeTtlFailedTotal,
} from './metrics.service.js';
import { createLogger } from '../utils/logger.js';
import type UserSubscriptions from '../types/generated/public/UserSubscriptions.js';

const log = createLogger('subscription-scheduler');

const INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// ─── Card-change reconciler config ──────────────────────────────────────────
const RECONCILER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RECONCILER_FIRST_DELAY_MS = 60_000; // first run +60s
let reconcilerHandle: ReturnType<typeof setInterval> | null = null;
let reconcilerFirstTimer: ReturnType<typeof setTimeout> | null = null;

/** awaiting_token older than this without payment → failed (abandoned widget). */
const CARD_CHANGE_TTL_HOURS = 24;
/** card_change_in_progress flag is force-cleared if started_at older than this and no active change. */
const CARD_CHANGE_FLAG_STALE_MINUTES = 30;
/** Backoff cap for old-recurrent cancel retries (minutes). */
const CANCEL_BACKOFF_CAP_MINUTES = 60;
/** Alert threshold for stuck cancels. */
const CANCEL_ATTEMPTS_ALERT = 5;
/** CloudPayments subscription statuses considered "live" (still charging). */
const CP_LIVE_STATUSES = new Set(['active', 'pastdue', 'past_due']);

type ExpiredSub = Pick<UserSubscriptions, 'id' | 'phone' | 'customer_name'>;
type PausedSub = Pick<UserSubscriptions, 'id' | 'phone'>;
type ActiveSubWithoutCredits = Pick<UserSubscriptions, 'id'>;

/**
 * Expire subscriptions whose period has ended and no renewal payment arrived.
 * Grace period: 3 days after period_end.
 */
async function expireOverdueSubscriptions(): Promise<number> {
  const result = await db.query<ExpiredSub>(
    `UPDATE user_subscriptions
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'active'
       AND current_period_end IS NOT NULL
       AND current_period_end < NOW() - INTERVAL '3 days'
       AND cloudpayments_subscription_id IS NULL
     RETURNING id, phone, customer_name`,
  );

  if (result.length > 0) {
    log.info(`Expired ${result.length} overdue subscriptions (no recurring payment)`, {
      ids: result.map(s => s.id),
    });
  }

  return result.length;
}

/**
 * Resume paused subscriptions whose pause_until date has passed.
 */
async function resumePausedSubscriptions(): Promise<number> {
  const result = await db.query<PausedSub>(
    `UPDATE user_subscriptions
     SET status = 'active', pause_until = NULL, updated_at = NOW()
     WHERE status = 'paused'
       AND pause_until IS NOT NULL
       AND pause_until <= NOW()
     RETURNING id, phone`,
  );

  if (result.length > 0) {
    log.info(`Resumed ${result.length} paused subscriptions`, {
      ids: result.map(s => s.id),
    });
  }

  return result.length;
}

/**
 * Provision credits for active subscriptions that have crossed into a new period
 * but don't yet have credits for the current period.
 * This handles edge cases where the webhook-driven provisioning failed.
 */
async function provisionMissingCredits(): Promise<number> {
  const subs = await db.query<ActiveSubWithoutCredits>(
    `SELECT us.id
     FROM user_subscriptions us
     WHERE us.status = 'active'
       AND us.current_period_start IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM subscription_credits sc
         WHERE sc.subscription_id = us.id
           AND sc.period_start >= us.current_period_start
       )`,
  );

  let provisioned = 0;
  for (const sub of subs) {
    try {
      await provisionCredits(sub.id);
      provisioned++;
    } catch (err) {
      log.error(`Failed to provision credits for subscription ${sub.id}`, { error: String(err) });
    }
  }

  if (provisioned > 0) {
    log.info(`Provisioned missing credits for ${provisioned} subscriptions`);
  }

  return provisioned;
}

/**
 * Expire pending subscriptions that were never paid (abandoned checkout).
 * Grace period: 24 hours from creation.
 */
async function cleanupStalePending(): Promise<number> {
  const result = await db.query<Pick<UserSubscriptions, 'id'>>(
    `UPDATE user_subscriptions
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending'
       AND created_at < NOW() - INTERVAL '24 hours'
     RETURNING id`,
  );

  if (result.length > 0) {
    log.info(`Cleaned up ${result.length} stale pending subscriptions`, {
      ids: result.map(s => s.id),
    });
  }

  return result.length;
}

async function runSchedulerCycle(): Promise<void> {
  try {
    const expired = await expireOverdueSubscriptions();
    const resumed = await resumePausedSubscriptions();
    const provisioned = await provisionMissingCredits();
    const staleCleaned = await cleanupStalePending();
    // После teardown-путей сверяем education-льготы: «застрявшие» education_subscription
    // у экс-подписчиков → 'education_verified' (если статус ещё подтверждён) или 'expired'.
    const eduReconciled = await reconcileEducationEntitlements();

    if (expired + resumed + provisioned + staleCleaned + eduReconciled > 0) {
      log.info('Subscription scheduler cycle complete', { expired, resumed, provisioned, staleCleaned, eduReconciled });
    }
  } catch (err) {
    log.error('Subscription scheduler cycle error', { error: String(err) });
  }
}

// ─── Card-change reconciler (S4) ─────────────────────────────────────────────
//
// Money-safety net for the self-service card change flow. The synchronous confirm
// path (subscription.service.confirmCardChange) already swaps the recurrent and
// cancels the old one; this reconciler only mops up after process death / transient
// CloudPayments failures so that there is never more than one live recurrent per
// subscription. Runs every 5 minutes under the scheduler-leader singleton, is
// best-effort and idempotent (CP cancel/find are idempotent), and never throws.

/** pending_cancel_old row that still needs the old recurrent cancelled. */
interface PendingCancelRow {
  id: string;
  subscription_id: string;
  old_cp_subscription_id: string | null;
  cancel_attempts: number;
}

/** A change row that may have left an orphan CloudPayments subscription behind. */
interface OrphanCandidateRow {
  id: string;
  subscription_id: string;
  status: string;
  old_cp_subscription_id: string | null;
  new_cp_subscription_id: string | null;
  new_cp_token: string | null;
  new_card_last_four: string | null;
  new_card_type: string | null;
  current_cp_subscription_id: string | null;
  sub_status: string | null;
}

interface CountRow {
  n: string | number;
}

/** Row returned by id-only UPDATE ... RETURNING id helpers in the reconciler. */
interface IdRow {
  id: string;
}

/**
 * Task 1 — retry cancelling the OLD recurrent for rows stuck in pending_cancel_old.
 *
 * Backoff: a row is only retried once its updated_at is older than
 * min(2^cancel_attempts, 60) minutes, so a permanently-failing CP cancel doesn't
 * hammer the API. On success → status='completed' + clear card_change_in_progress.
 * On failure → cancel_attempts++ + last_error (an alert is logged past the threshold).
 */
async function reconcilePendingCancel(): Promise<void> {
  const rows = await db.query<PendingCancelRow>(
    `SELECT id, subscription_id, old_cp_subscription_id, cancel_attempts
       FROM subscription_card_changes
      WHERE status = 'pending_cancel_old'
        AND updated_at < NOW() - (LEAST(POWER(2, cancel_attempts)::int, $1) * INTERVAL '1 minute')
      ORDER BY updated_at ASC
      LIMIT 100`,
    [CANCEL_BACKOFF_CAP_MINUTES],
  );

  for (const row of rows) {
    // No old recurrent recorded (already gone) → close out the row directly.
    if (!row.old_cp_subscription_id) {
      await completePendingCancel(row.id, row.subscription_id);
      cardChangeReconcilerCancelRetriesTotal.inc({ result: 'noop' });
      continue;
    }

    const result = await cancelCloudPaymentsRecurrentChecked(row.old_cp_subscription_id);
    if (result.success) {
      await completePendingCancel(row.id, row.subscription_id);
      cardChangeReconcilerCancelRetriesTotal.inc({ result: 'success' });
      log.info('[CardChange][reconciler] Old recurrent cancelled, change completed', {
        changeId: row.id, subscriptionId: row.subscription_id,
      });
    } else {
      const attempts = row.cancel_attempts + 1;
      await db.query(
        `UPDATE subscription_card_changes
            SET cancel_attempts = cancel_attempts + 1,
                last_error = $2,
                updated_at = NOW()
          WHERE id = $1 AND status = 'pending_cancel_old'`,
        [row.id, result.message ?? 'cancel_failed'],
      );
      cardChangeReconcilerCancelRetriesTotal.inc({ result: 'failure' });
      if (attempts > CANCEL_ATTEMPTS_ALERT) {
        log.error('[CardChange][reconciler] Old recurrent cancel still failing — manual review', {
          changeId: row.id, subscriptionId: row.subscription_id,
          oldCpSubscriptionId: row.old_cp_subscription_id,
          cancelAttempts: attempts, message: result.message,
        });
      } else {
        log.warn('[CardChange][reconciler] Old recurrent cancel retry failed', {
          changeId: row.id, cancelAttempts: attempts, message: result.message,
        });
      }
    }
  }
}

/** Marks a change completed and clears the in-progress flag once the old recurrent is gone. */
async function completePendingCancel(changeId: string, subscriptionId: string): Promise<void> {
  await db.query(
    `UPDATE user_subscriptions
        SET card_change_in_progress = false, updated_at = NOW()
      WHERE id = $1`,
    [subscriptionId],
  );
  await db.query(
    `UPDATE subscription_card_changes
        SET status = 'completed', updated_at = NOW()
      WHERE id = $1 AND status = 'pending_cancel_old'`,
    [changeId],
  );
}

/**
 * Cancels the old recurrent right after an orphan adopt landed the swap, closing the
 * double-charge window immediately instead of deferring to the next pending_cancel tick.
 * On success completes the change + clears the flag; on failure records the attempt so
 * reconcilePendingCancel retries it with backoff. No old id recorded → just complete.
 */
async function cancelOldAfterAdopt(
  changeId: string,
  subscriptionId: string,
  oldCpSubscriptionId: string | null,
): Promise<void> {
  if (!oldCpSubscriptionId) {
    await completePendingCancel(changeId, subscriptionId);
    cardChangeReconcilerCancelRetriesTotal.inc({ result: 'noop' });
    return;
  }
  const result = await cancelCloudPaymentsRecurrentChecked(oldCpSubscriptionId);
  if (result.success) {
    await completePendingCancel(changeId, subscriptionId);
    cardChangeReconcilerCancelRetriesTotal.inc({ result: 'success' });
    log.info('[CardChange][reconciler] Old recurrent cancelled after adopt, change completed', {
      changeId, subscriptionId,
    });
  } else {
    await db.query(
      `UPDATE subscription_card_changes
          SET cancel_attempts = cancel_attempts + 1, last_error = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'pending_cancel_old'`,
      [changeId, result.message ?? 'cancel_failed_after_adopt'],
    );
    cardChangeReconcilerCancelRetriesTotal.inc({ result: 'failure' });
    log.warn('[CardChange][reconciler] Old recurrent cancel after adopt failed (will retry)', {
      changeId, subscriptionId, message: result.message,
    });
  }
}

/**
 * Task 2 — orphan detector. A change can leave the real CloudPayments state ahead of
 * our DB if the confirm path died between /subscriptions/create and recording new_cp
 * (change stuck in 'swapping' with new_cp_subscription_id IS NULL), or if a duplicate
 * recurrent was created. We reconcile against CloudPayments via /subscriptions/find.
 *
 * For each stuck change, list the account's live CP recurrents and classify each one:
 *  - the current working cloudpayments_subscription_id → leave it (this is the live one);
 *  - the still-live OLD recurrent of a pending_cancel_old change → leave it (reconcile-
 *    PendingCancel cancels it with backoff);
 *  - an UNKNOWN live recurrent on a 'swapping'+new_cp-NULL change → that's the orphan we
 *    created: ADOPT it via subscription.service.adoptOrphanCardChange (reuses the private
 *    executeCardSwapTx — single money-critical swap path), then pending_cancel cancels old;
 *  - any other extra live recurrent → CANCEL it, so we never bill twice.
 */
async function reconcileOrphans(): Promise<void> {
  const candidates = await db.query<OrphanCandidateRow>(
    `SELECT scc.id, scc.subscription_id, scc.status,
            scc.old_cp_subscription_id, scc.new_cp_subscription_id,
            scc.new_cp_token, scc.new_card_last_four, scc.new_card_type,
            us.cloudpayments_subscription_id AS current_cp_subscription_id,
            us.status AS sub_status
       FROM subscription_card_changes scc
       JOIN user_subscriptions us ON us.id = scc.subscription_id
      WHERE scc.status IN ('swapping', 'pending_cancel_old')
         OR (scc.status = 'awaiting_token' AND scc.new_cp_subscription_id IS NOT NULL)
      ORDER BY scc.updated_at ASC
      LIMIT 50`,
  );

  for (const c of candidates) {
    try {
      await reconcileOrphanForChange(c);
    } catch (err: unknown) {
      log.error('[CardChange][reconciler] Orphan reconciliation failed for change', {
        changeId: c.id, subscriptionId: c.subscription_id, error: String(err),
      });
    }
  }
}

async function reconcileOrphanForChange(c: OrphanCandidateRow): Promise<void> {
  const cpSubs = await cloudPaymentsSubscriptionFind(c.subscription_id);
  if (cpSubs.length === 0) return;

  // Collect live recurrents that are neither the current working one nor the tracked old one.
  const unknownLive: string[] = [];
  for (const model of cpSubs) {
    const cpId = model.Id ? String(model.Id) : null;
    if (!cpId) continue;
    if (!CP_LIVE_STATUSES.has((model.Status ?? '').toLowerCase())) continue; // cancelled/expired/etc.

    if (cpId === c.current_cp_subscription_id) continue; // the live one — keep.
    // Still-live old recurrent of a pending_cancel_old change — left to reconcilePendingCancel.
    if (cpId === c.old_cp_subscription_id && c.status === 'pending_cancel_old') continue;
    // Old recurrent of a row already advanced to a recorded new_cp — also pending_cancel's job.
    if (cpId === c.old_cp_subscription_id && c.new_cp_subscription_id) continue;

    unknownLive.push(cpId);
  }
  if (unknownLive.length === 0) return;

  // Adoptable case: a 'swapping' change whose new_cp was never recorded (claimer died after
  // create). Exactly one unknown-live recurrent is our orphan new one → adopt it.
  const isAdoptable = c.status === 'swapping' && !c.new_cp_subscription_id;
  if (isAdoptable && unknownLive.length === 1) {
    const orphanCpId = unknownLive[0];
    const token = c.new_cp_token; // recorded by the /pay webhook (storeVerifiedCard).
    if (token) {
      cardChangeOrphanDetectedTotal.inc({ action: 'adopt' });
      const outcome = await adoptOrphanCardChange(
        c.id, orphanCpId, token, c.new_card_last_four, c.new_card_type,
      );
      log.warn('[CardChange][reconciler] Orphan recurrent adopt outcome', {
        changeId: c.id, subscriptionId: c.subscription_id,
        newCpSubscriptionId: orphanCpId, outcome,
      });
      // After the swap landed (or had already landed), the old recurrent is now the duplicate.
      // Cancel it immediately to close the double-charge window — don't wait a tick. On success
      // the change is completed + the flag cleared; on failure it stays pending_cancel_old and
      // reconcilePendingCancel retries it with backoff next tick.
      if (outcome === 'adopted' || outcome === 'already_swapped') {
        await cancelOldAfterAdopt(c.id, c.subscription_id, c.old_cp_subscription_id);
      }
      return;
    }
    // No token to adopt with (verify webhook never recorded it) — fall through and cancel the
    // orphan as a duplicate. Billing safety wins: better lose this new card than double-charge.
    log.warn('[CardChange][reconciler] Orphan recurrent without stored token — cancelling as duplicate', {
      changeId: c.id, subscriptionId: c.subscription_id, orphanCpSubscriptionId: orphanCpId,
    });
  }

  // Everything still in unknownLive is an extra/duplicate recurrent → cancel (idempotent).
  for (const cpId of unknownLive) {
    cardChangeOrphanDetectedTotal.inc({ action: 'cancel' });
    const result = await cancelCloudPaymentsRecurrentChecked(cpId);
    log.warn('[CardChange][reconciler] Cancelled duplicate/orphan recurrent', {
      changeId: c.id, subscriptionId: c.subscription_id, orphanCpSubscriptionId: cpId,
      success: result.success, message: result.message,
    });
  }
}

/**
 * Task 3 — TTL fail + stale-flag cleanup.
 *  - awaiting_token older than 24h with no new recurrent created yet → failed (the
 *    customer abandoned the widget; the old subscription was never touched).
 *  - clear card_change_in_progress on subscriptions whose card_change_started_at is
 *    older than 30 min and have no active change row (defensive: a crashed flow must
 *    not leave the recurrent guard permanently armed and block future renewals).
 */
async function reconcileTtlAndStaleFlags(): Promise<void> {
  const failed = await db.query<IdRow>(
    `UPDATE subscription_card_changes
        SET status = 'failed', last_error = 'awaiting_token_ttl_expired', updated_at = NOW()
      WHERE status = 'awaiting_token'
        AND new_cp_subscription_id IS NULL
        AND created_at < NOW() - ($1 * INTERVAL '1 hour')
      RETURNING id`,
    [CARD_CHANGE_TTL_HOURS],
  );
  if (failed.length > 0) {
    cardChangeTtlFailedTotal.inc(failed.length);
    log.info(`[CardChange][reconciler] Failed ${failed.length} expired awaiting_token changes`, {
      ids: failed.map(r => r.id),
    });
  }

  const cleared = await db.query<IdRow>(
    `UPDATE user_subscriptions us
        SET card_change_in_progress = false, updated_at = NOW()
      WHERE us.card_change_in_progress = true
        AND us.card_change_started_at IS NOT NULL
        AND us.card_change_started_at < NOW() - ($1 * INTERVAL '1 minute')
        AND NOT EXISTS (
          SELECT 1 FROM subscription_card_changes scc
          WHERE scc.subscription_id = us.id
            AND scc.status IN ('awaiting_token', 'swapping', 'pending_cancel_old')
        )
      RETURNING us.id`,
    [CARD_CHANGE_FLAG_STALE_MINUTES],
  );
  if (cleared.length > 0) {
    log.warn(`[CardChange][reconciler] Cleared ${cleared.length} stale card_change_in_progress flags`, {
      ids: cleared.map(r => r.id),
    });
  }
}

/** Refreshes the gauge of still-open pending_cancel_old rows for alerting. */
async function refreshPendingCancelGauge(): Promise<void> {
  const row = await db.queryOne<CountRow>(
    `SELECT count(*) AS n FROM subscription_card_changes WHERE status = 'pending_cancel_old'`,
  );
  cardChangePendingCancelOpen.set(row ? Number(row.n) : 0);
}

/**
 * One reconciler cycle. Order matters: orphans first (adopt → pending_cancel_old),
 * then cancel pending old recurrents, then TTL/flag cleanup, then refresh the gauge.
 * Each task is independently try/catch'd so one failing task can't starve the others.
 */
export async function reconcileCardChanges(): Promise<void> {
  try {
    await reconcileOrphans();
  } catch (err) {
    log.error('[CardChange][reconciler] orphan task error', { error: String(err) });
  }
  try {
    await reconcilePendingCancel();
  } catch (err) {
    log.error('[CardChange][reconciler] pending-cancel task error', { error: String(err) });
  }
  try {
    await reconcileTtlAndStaleFlags();
  } catch (err) {
    log.error('[CardChange][reconciler] ttl/flag task error', { error: String(err) });
  }
  try {
    await refreshPendingCancelGauge();
  } catch (err) {
    log.error('[CardChange][reconciler] gauge refresh error', { error: String(err) });
  }
}

export function startSubscriptionScheduler(): void {
  if (intervalHandle) {
    log.warn('Subscription scheduler already running');
    return;
  }

  log.info(`Subscription scheduler started (interval: ${INTERVAL_MS / 1000}s)`);

  // First run after 90s delay
  setTimeout(() => {
    runSchedulerCycle();
  }, 90_000);

  intervalHandle = setInterval(runSchedulerCycle, INTERVAL_MS);

  // Card-change reconciler — separate, faster cadence (5 min, first run +60s).
  if (!reconcilerHandle) {
    log.info(`Card-change reconciler started (interval: ${RECONCILER_INTERVAL_MS / 1000}s)`);
    reconcilerFirstTimer = setTimeout(() => {
      reconcilerFirstTimer = null;
      reconcileCardChanges();
    }, RECONCILER_FIRST_DELAY_MS);
    reconcilerHandle = setInterval(reconcileCardChanges, RECONCILER_INTERVAL_MS);
  }
}

export function stopSubscriptionScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('Subscription scheduler stopped');
  }
  if (reconcilerFirstTimer) {
    clearTimeout(reconcilerFirstTimer);
    reconcilerFirstTimer = null;
  }
  if (reconcilerHandle) {
    clearInterval(reconcilerHandle);
    reconcilerHandle = null;
    log.info('Card-change reconciler stopped');
  }
}
