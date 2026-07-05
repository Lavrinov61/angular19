import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock BullMQ (enqueueFiscal only touches the Queue constructor at import) ──

vi.mock('bullmq', () => {
  function MockQueue() {
    return { add: vi.fn(), getJobCounts: vi.fn(), name: 'pos-fiscal' };
  }
  function MockWorker() {
    return { on: vi.fn(), close: vi.fn(), pause: vi.fn(), resume: vi.fn() };
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

// ─── Mock dependencies ───────────────────────────────────────────────────────

vi.mock('../config/index.js', () => ({
  config: {
    redis: { host: 'localhost', port: 6379, password: '', tls: undefined },
    bridge: { posUrl: 'http://localhost:5052' },
  },
}));

const { mockLog } = vi.hoisted(() => ({
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => mockLog,
}));

vi.mock('../utils/error-tracker.js', () => ({
  captureException: vi.fn(),
}));

vi.mock('../utils/circuit-breaker.js', () => ({
  getBreaker: () => ({
    allow: vi.fn().mockReturnValue(true),
    success: vi.fn(),
    failure: vi.fn(),
    getState: vi.fn().mockReturnValue('CLOSED'),
    getFailures: vi.fn().mockReturnValue(0),
  }),
  SERVICE_BREAKERS: { atolFiscal: { name: 'atol-fiscal', timeoutMs: 15_000 } },
}));

vi.mock('../services/alerting.service.js', () => ({
  alertCircuitBreakerOpen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../websocket/broadcast-to-room.js', () => ({
  broadcastToRoom: vi.fn(),
}));

// db mock: queryOne for the studio/agent lookups; transaction runs the callback
// against a per-call mock PoolClient whose client.query we control per test.
const { mockDb, makeClient } = vi.hoisted(() => {
  function makeClient(queryImpl: (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }>) {
    return { query: vi.fn(queryImpl) };
  }
  const mockDb = {
    queryOne: vi.fn(),
    query: vi.fn(),
    // transaction simply invokes the callback with whatever client the test installed.
    transaction: vi.fn(),
  };
  return { mockDb, makeClient };
});

vi.mock('../database/db.js', () => ({ default: mockDb }));

// ─── SUT ─────────────────────────────────────────────────────────────────────

import { enqueueFiscal, type FiscalJobData } from './pos-fiscal-worker.js';

const RECEIPT_ID = 'receipt-1';
const STUDIO_ID = 'studio-1';

function makeJob(): FiscalJobData {
  return {
    receiptId: RECEIPT_ID,
    receiptNumber: 'SF-POS-000001',
    items: [{ product_name: 'Печать', quantity: 1, unit_price: 100, total: 100 }],
    total: 100,
    payments: [{ payment_type: 'card', amount: 100 }],
    operation: 'sale',
  };
}

// Prime the studio/agent lookups that run before the transaction.
function primeLookups(): void {
  mockDb.queryOne
    .mockResolvedValueOnce({ studio_id: STUDIO_ID }) // SELECT studio_id
    .mockResolvedValueOnce({ id: 'agent-1' }); // SELECT pos agent
}

// Install a transaction that runs the real callback against a client whose
// CAS-UPDATE returns `claimRowCount` rows. The 2nd query (INSERT) succeeds.
function installTransaction(claimRowCount: number): { client: { query: ReturnType<typeof vi.fn> } } {
  const client = makeClient(async (sql: string) => {
    if (sql.includes('UPDATE pos_receipts')) {
      return { rowCount: claimRowCount, rows: claimRowCount > 0 ? [{ id: RECEIPT_ID }] : [] };
    }
    // INSERT pos_transactions
    return { rowCount: 1, rows: [{ id: 'tx-1' }] };
  });
  mockDb.transaction.mockImplementation(async (cb: (c: typeof client) => Promise<unknown>) => cb(client));
  return { client };
}

describe('enqueueFiscal — double-fiscalization guard (CAS-claim)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims the receipt then INSERTs the fiscal tx when NOT in-flight (pending/failed/skipped)', async () => {
    primeLookups();
    const { client } = installTransaction(1); // CAS-claim succeeds (1 row)

    await enqueueFiscal(makeJob());

    // It ran inside a transaction.
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    // The CAS-claim UPDATE is a single-row UPDATE on pos_receipts that excludes in-flight states.
    const claimCall = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE pos_receipts'));
    expect(claimCall).toBeDefined();
    expect(String(claimCall?.[0])).toContain('<> ALL');
    expect(String(claimCall?.[0])).toContain("fiscal_status = 'queued'");
    expect(claimCall?.[1]).toContainEqual(['queued', 'processing', 'success']);

    // Because the claim succeeded, the fiscal_sale tx is inserted (same client = same tx).
    const insertCall = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO pos_transactions'));
    expect(insertCall).toBeDefined();

    // No standalone db.query outside the transaction.
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('does NOT insert (loser bails out) when the receipt is already in-flight — CAS-claim returns 0 rows', async () => {
    primeLookups();
    const { client } = installTransaction(0); // CAS-claim matched 0 rows (already queued/processing/success)

    await enqueueFiscal(makeJob());

    // The claim was attempted...
    const claimCall = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE pos_receipts'));
    expect(claimCall).toBeDefined();

    // ...but since it claimed 0 rows, the INSERT must NOT happen (no double fiscal_sale → no double ATOL receipt).
    const insertCall = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO pos_transactions'));
    expect(insertCall).toBeUndefined();
    expect(client.query).toHaveBeenCalledTimes(1); // only the claim

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('Skipping fiscal enqueue'),
      expect.objectContaining({ receiptId: RECEIPT_ID }),
    );
  });

  it('RACE: two concurrent enqueueFiscal on a pending receipt → exactly ONE INSERT', async () => {
    // Shared receipt state across both calls; the CAS-UPDATE serializes them.
    let receiptStatus = 'pending';
    const inserts: string[] = [];

    // Each enqueueFiscal call gets its own client, but they share `receiptStatus`,
    // emulating the row-lock: the first UPDATE flips it to 'queued', the second sees 0 rows.
    mockDb.transaction.mockImplementation(async (cb: (c: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (String(sql).includes('UPDATE pos_receipts')) {
            const inFlight = ['queued', 'processing', 'success'].includes(receiptStatus);
            if (inFlight) return { rowCount: 0, rows: [] };
            receiptStatus = 'queued';
            return { rowCount: 1, rows: [{ id: RECEIPT_ID }] };
          }
          inserts.push(String(sql));
          return { rowCount: 1, rows: [{ id: 'tx-1' }] };
        }),
      };
      return cb(client);
    });

    // Both calls share the lookups; prime four queryOne results (2 per call).
    mockDb.queryOne
      .mockResolvedValueOnce({ studio_id: STUDIO_ID }).mockResolvedValueOnce({ id: 'agent-1' })
      .mockResolvedValueOnce({ studio_id: STUDIO_ID }).mockResolvedValueOnce({ id: 'agent-1' });

    await Promise.all([enqueueFiscal(makeJob()), enqueueFiscal(makeJob())]);

    // Exactly one fiscal_sale tx was inserted despite two concurrent calls.
    expect(inserts).toHaveLength(1);
  });

  it('fiscal-retry path: failed receipt is NOT in-flight → claim succeeds → re-fiscalizes', async () => {
    primeLookups();
    // 'failed' is not in the stop-list, so the CAS-UPDATE matches (1 row).
    const { client } = installTransaction(1);

    await enqueueFiscal(makeJob());

    const insertCall = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO pos_transactions'));
    expect(insertCall).toBeDefined(); // retry re-enqueues, not blocked
  });

  it('skips entirely (no transaction) when the receipt does not exist', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null); // SELECT studio_id → not found

    await enqueueFiscal(makeJob());

    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});
