import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetMockDb } from '../test-utils/index.js';

// db is used directly by the reconciler for its own SELECT/UPDATEs.
vi.mock('../database/db.js', () => ({ default: mockDb }));

// subscription.service supplies the CloudPayments helpers + adopt wrapper (S2 contract).
const cancelCloudPaymentsRecurrentChecked = vi.fn();
const cloudPaymentsSubscriptionFind = vi.fn();
const adoptOrphanCardChange = vi.fn();
const provisionCredits = vi.fn();
vi.mock('./subscription.service.js', () => ({
  cancelCloudPaymentsRecurrentChecked,
  cloudPaymentsSubscriptionFind,
  adoptOrphanCardChange,
  provisionCredits,
}));

// Prometheus metrics — no-op counters/gauge so the reconciler can call .inc()/.set().
// Named fns so beforeEach can reset call counts (avoids cross-test leakage).
const cancelRetriesInc = vi.fn();
const orphanDetectedInc = vi.fn();
const pendingCancelOpenSet = vi.fn();
const ttlFailedInc = vi.fn();
vi.mock('./metrics.service.js', () => ({
  cardChangeReconcilerCancelRetriesTotal: { inc: cancelRetriesInc },
  cardChangeOrphanDetectedTotal: { inc: orphanDetectedInc },
  cardChangePendingCancelOpen: { set: pendingCancelOpenSet },
  cardChangeTtlFailedTotal: { inc: ttlFailedInc },
}));

const { reconcileCardChanges } = await import('./subscription-scheduler.service.js');

/**
 * The reconciler issues four DB-reading passes per cycle (orphans, pending-cancel, ttl/flag,
 * gauge). Each pass starts with one query. This helper maps a query by a recognizable SQL
 * fragment so tests don't depend on call order.
 */
function routeQueryBySql(handlers: { match: RegExp; rows: unknown[] }[]): void {
  vi.mocked(mockDb.query).mockImplementation(async (sql: string) => {
    for (const h of handlers) {
      if (h.match.test(sql)) return h.rows as never;
    }
    return [] as never;
  });
}

beforeEach(() => {
  resetMockDb();
  cancelCloudPaymentsRecurrentChecked.mockReset();
  cloudPaymentsSubscriptionFind.mockReset().mockResolvedValue([]);
  adoptOrphanCardChange.mockReset();
  provisionCredits.mockReset();
  cancelRetriesInc.mockReset();
  orphanDetectedInc.mockReset();
  pendingCancelOpenSet.mockReset();
  ttlFailedInc.mockReset();
  vi.mocked(mockDb.queryOne).mockResolvedValue({ n: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reconcileCardChanges — no-op on empty data', () => {
  it('does not call CloudPayments when there is nothing to reconcile', async () => {
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    await expect(reconcileCardChanges()).resolves.toBeUndefined();

    expect(cancelCloudPaymentsRecurrentChecked).not.toHaveBeenCalled();
    expect(cloudPaymentsSubscriptionFind).not.toHaveBeenCalled();
    expect(adoptOrphanCardChange).not.toHaveBeenCalled();
  });

  it('refreshes the pending_cancel_open gauge each cycle', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValue({ n: 3 });

    await reconcileCardChanges();

    expect(pendingCancelOpenSet).toHaveBeenCalledWith(3);
  });
});

describe('reconcileCardChanges — pending_cancel_old retry', () => {
  it('cancels the old recurrent and completes the change on success', async () => {
    routeQueryBySql([
      {
        match: /WHERE status = 'pending_cancel_old'/,
        rows: [{
          id: 'change-1', subscription_id: 'sub-1',
          old_cp_subscription_id: 'cp-old-1', cancel_attempts: 0,
        }],
      },
    ]);
    cancelCloudPaymentsRecurrentChecked.mockResolvedValue({ success: true, message: null });

    await reconcileCardChanges();

    expect(cancelCloudPaymentsRecurrentChecked).toHaveBeenCalledWith('cp-old-1');
    // flag-off UPDATE on user_subscriptions + completed UPDATE on the change.
    const updates = vi.mocked(mockDb.query).mock.calls.map(c => String(c[0]));
    expect(updates.some(s => /card_change_in_progress = false/.test(s))).toBe(true);
    expect(updates.some(s => /SET status = 'completed'/.test(s))).toBe(true);
  });

  it('increments cancel_attempts and records last_error on failure', async () => {
    routeQueryBySql([
      {
        match: /WHERE status = 'pending_cancel_old'/,
        rows: [{
          id: 'change-2', subscription_id: 'sub-2',
          old_cp_subscription_id: 'cp-old-2', cancel_attempts: 1,
        }],
      },
    ]);
    cancelCloudPaymentsRecurrentChecked.mockResolvedValue({ success: false, message: 'cp timeout' });

    await reconcileCardChanges();

    const updates = vi.mocked(mockDb.query).mock.calls;
    const attemptUpdate = updates.find(c => /cancel_attempts = cancel_attempts \+ 1/.test(String(c[0])));
    expect(attemptUpdate).toBeDefined();
    expect(attemptUpdate?.[1]).toEqual(['change-2', 'cp timeout']);
    // Must NOT mark completed on failure.
    expect(updates.some(c => /SET status = 'completed'/.test(String(c[0])))).toBe(false);
  });

  it('closes out a pending_cancel_old row with no old recurrent (already gone)', async () => {
    routeQueryBySql([
      {
        match: /WHERE status = 'pending_cancel_old'/,
        rows: [{
          id: 'change-3', subscription_id: 'sub-3',
          old_cp_subscription_id: null, cancel_attempts: 0,
        }],
      },
    ]);

    await reconcileCardChanges();

    expect(cancelCloudPaymentsRecurrentChecked).not.toHaveBeenCalled();
    const updates = vi.mocked(mockDb.query).mock.calls.map(c => String(c[0]));
    expect(updates.some(s => /SET status = 'completed'/.test(s))).toBe(true);
  });
});

describe('reconcileCardChanges — orphan detector', () => {
  it('adopts a swapping change with an unknown live recurrent (claimer died after create)', async () => {
    routeQueryBySql([
      {
        match: /JOIN user_subscriptions us ON us\.id = scc\.subscription_id/,
        rows: [{
          id: 'change-4', subscription_id: 'sub-4', status: 'swapping',
          old_cp_subscription_id: 'cp-old-4', new_cp_subscription_id: null,
          new_cp_token: 'tok-new-4', new_card_last_four: '4242', new_card_type: 'Visa',
          current_cp_subscription_id: 'cp-old-4', sub_status: 'active',
        }],
      },
    ]);
    cloudPaymentsSubscriptionFind.mockResolvedValue([
      { Id: 'cp-old-4', Status: 'Active' },   // current/old — left alone
      { Id: 'cp-new-orphan-4', Status: 'Active' }, // the orphan we created
    ]);
    adoptOrphanCardChange.mockResolvedValue('adopted');
    cancelCloudPaymentsRecurrentChecked.mockResolvedValue({ success: true, message: null });

    await reconcileCardChanges();

    expect(adoptOrphanCardChange).toHaveBeenCalledWith(
      'change-4', 'cp-new-orphan-4', 'tok-new-4', '4242', 'Visa',
    );
    // After adopt the old recurrent is cancelled immediately (close double-charge window)...
    expect(cancelCloudPaymentsRecurrentChecked).toHaveBeenCalledWith('cp-old-4');
    // ...and never the new one it just adopted.
    expect(cancelCloudPaymentsRecurrentChecked).not.toHaveBeenCalledWith('cp-new-orphan-4');
    // Success completes the change + clears the in-progress flag.
    const updates = vi.mocked(mockDb.query).mock.calls.map(c => String(c[0]));
    expect(updates.some(s => /card_change_in_progress = false/.test(s))).toBe(true);
    expect(updates.some(s => /SET status = 'completed'/.test(s))).toBe(true);
  });

  it('keeps the change in pending_cancel_old when the post-adopt cancel fails', async () => {
    routeQueryBySql([
      {
        match: /JOIN user_subscriptions us ON us\.id = scc\.subscription_id/,
        rows: [{
          id: 'change-4b', subscription_id: 'sub-4b', status: 'swapping',
          old_cp_subscription_id: 'cp-old-4b', new_cp_subscription_id: null,
          new_cp_token: 'tok-4b', new_card_last_four: null, new_card_type: null,
          current_cp_subscription_id: 'cp-old-4b', sub_status: 'active',
        }],
      },
    ]);
    cloudPaymentsSubscriptionFind.mockResolvedValue([
      { Id: 'cp-old-4b', Status: 'Active' },
      { Id: 'cp-new-orphan-4b', Status: 'Active' },
    ]);
    adoptOrphanCardChange.mockResolvedValue('adopted');
    cancelCloudPaymentsRecurrentChecked.mockResolvedValue({ success: false, message: 'cp down' });

    await reconcileCardChanges();

    const updates = vi.mocked(mockDb.query).mock.calls;
    expect(updates.some(c => /cancel_attempts = cancel_attempts \+ 1/.test(String(c[0])))).toBe(true);
    // Must NOT complete the change while the old recurrent is still live.
    expect(updates.some(c => /SET status = 'completed'/.test(String(c[0])))).toBe(false);
  });

  it("cancels the old recurrent immediately when adopt reports 'already_swapped'", async () => {
    routeQueryBySql([
      {
        match: /JOIN user_subscriptions us ON us\.id = scc\.subscription_id/,
        rows: [{
          id: 'change-4c', subscription_id: 'sub-4c', status: 'swapping',
          old_cp_subscription_id: 'cp-old-4c', new_cp_subscription_id: null,
          new_cp_token: 'tok-4c', new_card_last_four: null, new_card_type: null,
          current_cp_subscription_id: 'cp-old-4c', sub_status: 'active',
        }],
      },
    ]);
    cloudPaymentsSubscriptionFind.mockResolvedValue([
      { Id: 'cp-old-4c', Status: 'Active' },
      { Id: 'cp-new-orphan-4c', Status: 'Active' },
    ]);
    adoptOrphanCardChange.mockResolvedValue('already_swapped');
    cancelCloudPaymentsRecurrentChecked.mockResolvedValue({ success: true, message: null });

    await reconcileCardChanges();

    expect(cancelCloudPaymentsRecurrentChecked).toHaveBeenCalledWith('cp-old-4c');
  });

  it('cancels an extra duplicate recurrent that is neither current nor old', async () => {
    routeQueryBySql([
      {
        match: /JOIN user_subscriptions us ON us\.id = scc\.subscription_id/,
        rows: [{
          id: 'change-5', subscription_id: 'sub-5', status: 'pending_cancel_old',
          old_cp_subscription_id: 'cp-old-5', new_cp_subscription_id: 'cp-new-5',
          new_cp_token: 'tok-5', new_card_last_four: '1111', new_card_type: 'MIR',
          current_cp_subscription_id: 'cp-new-5', sub_status: 'active',
        }],
      },
    ]);
    cloudPaymentsSubscriptionFind.mockResolvedValue([
      { Id: 'cp-new-5', Status: 'Active' },  // current — keep
      { Id: 'cp-old-5', Status: 'Active' },  // tracked old (pending_cancel_old) — keep, handled by retry
      { Id: 'cp-rogue-5', Status: 'Active' }, // a third, unexpected recurrent → must cancel
    ]);
    cancelCloudPaymentsRecurrentChecked.mockResolvedValue({ success: true, message: null });

    await reconcileCardChanges();

    expect(adoptOrphanCardChange).not.toHaveBeenCalled();
    expect(cancelCloudPaymentsRecurrentChecked).toHaveBeenCalledWith('cp-rogue-5');
    // Must NOT cancel the current working recurrent.
    expect(cancelCloudPaymentsRecurrentChecked).not.toHaveBeenCalledWith('cp-new-5');
  });

  it('ignores cancelled CP recurrents (only acts on live ones)', async () => {
    routeQueryBySql([
      {
        match: /JOIN user_subscriptions us ON us\.id = scc\.subscription_id/,
        rows: [{
          id: 'change-6', subscription_id: 'sub-6', status: 'swapping',
          old_cp_subscription_id: 'cp-old-6', new_cp_subscription_id: null,
          new_cp_token: 'tok-6', new_card_last_four: null, new_card_type: null,
          current_cp_subscription_id: 'cp-old-6', sub_status: 'active',
        }],
      },
    ]);
    cloudPaymentsSubscriptionFind.mockResolvedValue([
      { Id: 'cp-old-6', Status: 'Active' },
      { Id: 'cp-dead-6', Status: 'Cancelled' }, // already cancelled → not an orphan
    ]);

    await reconcileCardChanges();

    expect(adoptOrphanCardChange).not.toHaveBeenCalled();
    expect(cancelCloudPaymentsRecurrentChecked).not.toHaveBeenCalled();
  });

  it('cancels the orphan as a duplicate when no token was ever recorded', async () => {
    routeQueryBySql([
      {
        match: /JOIN user_subscriptions us ON us\.id = scc\.subscription_id/,
        rows: [{
          id: 'change-7', subscription_id: 'sub-7', status: 'swapping',
          old_cp_subscription_id: 'cp-old-7', new_cp_subscription_id: null,
          new_cp_token: null, new_card_last_four: null, new_card_type: null,
          current_cp_subscription_id: 'cp-old-7', sub_status: 'active',
        }],
      },
    ]);
    cloudPaymentsSubscriptionFind.mockResolvedValue([
      { Id: 'cp-old-7', Status: 'Active' },
      { Id: 'cp-orphan-7', Status: 'Active' },
    ]);
    cancelCloudPaymentsRecurrentChecked.mockResolvedValue({ success: true, message: null });

    await reconcileCardChanges();

    // No token to adopt → billing-safety wins: cancel the orphan.
    expect(adoptOrphanCardChange).not.toHaveBeenCalled();
    expect(cancelCloudPaymentsRecurrentChecked).toHaveBeenCalledWith('cp-orphan-7');
  });
});

describe('reconcileCardChanges — TTL fail + stale-flag reset', () => {
  it('fails awaiting_token changes older than 24h with no recurrent created', async () => {
    vi.mocked(mockDb.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      // The TTL-fail UPDATE: awaiting_token, no new_cp, created_at past 24h → returns 2 ids.
      if (/last_error = 'awaiting_token_ttl_expired'/.test(sql)) {
        // Sanity-check the guard conditions so we never fail an in-flight change.
        expect(sql).toMatch(/status = 'awaiting_token'/);
        expect(sql).toMatch(/new_cp_subscription_id IS NULL/);
        expect(sql).toMatch(/created_at < NOW\(\) - \(\$1 \* INTERVAL '1 hour'\)/);
        expect(params).toEqual([24]);
        return [{ id: 'change-ttl-1' }, { id: 'change-ttl-2' }] as never;
      }
      return [] as never;
    });

    await reconcileCardChanges();

    // The metric counts every row failed by the TTL pass.
    expect(ttlFailedInc).toHaveBeenCalledWith(2);
  });

  it('does not touch the TTL metric when nothing has expired', async () => {
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    await reconcileCardChanges();

    expect(ttlFailedInc).not.toHaveBeenCalled();
  });

  it('clears card_change_in_progress flags stuck >30min with no active change', async () => {
    vi.mocked(mockDb.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/SET card_change_in_progress = false/.test(sql) && /card_change_started_at/.test(sql)) {
        // Guard: only stale flags (>30min) AND with no open change row are cleared.
        expect(sql).toMatch(/card_change_in_progress = true/);
        expect(sql).toMatch(/card_change_started_at < NOW\(\) - \(\$1 \* INTERVAL '1 minute'\)/);
        expect(sql).toMatch(/NOT EXISTS/);
        expect(sql).toMatch(/scc\.status IN \('awaiting_token', 'swapping', 'pending_cancel_old'\)/);
        expect(params).toEqual([30]);
        return [{ id: 'sub-stale-1' }] as never;
      }
      return [] as never;
    });

    // Should run and complete without throwing; the guarded UPDATE is asserted above.
    await expect(reconcileCardChanges()).resolves.toBeUndefined();
    const ran = vi.mocked(mockDb.query).mock.calls
      .some(c => /SET card_change_in_progress = false/.test(String(c[0])) && /card_change_started_at/.test(String(c[0])));
    expect(ran).toBe(true);
  });
});

describe('reconcileCardChanges — resilience', () => {
  it('does not throw when a CloudPayments helper rejects', async () => {
    routeQueryBySql([
      {
        match: /WHERE status = 'pending_cancel_old'/,
        rows: [{
          id: 'change-8', subscription_id: 'sub-8',
          old_cp_subscription_id: 'cp-old-8', cancel_attempts: 0,
        }],
      },
    ]);
    cancelCloudPaymentsRecurrentChecked.mockRejectedValue(new Error('network down'));

    await expect(reconcileCardChanges()).resolves.toBeUndefined();
  });
});
