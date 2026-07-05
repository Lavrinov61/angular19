/**
 * MAX Broadcast Worker — unit tests for the governor pre-send gate, the 429 yield protocol,
 * the dispatcher's enqueue, and dispatcher CHANNEL ISOLATION.
 *
 * Central isolation guarantee (S5): `dispatchOnceMax` claims ONLY `channel='max'` campaigns —
 * the hot TG dispatcher (`channel='telegram'`) naturally excludes MAX and is never touched.
 * If a future edit let the MAX dispatcher pick up telegram rows, the SQL assertion here fails.
 *
 * BullMQ, max-broadcast-sender, the MAX governor, db and account-store are all mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const RATE_LIMIT_ERROR_MESSAGE = 'bullmq:rateLimitExceeded';

const {
  mockQueueAdd,
  mockWorkerRateLimit,
  mockWorkerClose,
  mockSendToRecipientMax,
  mockClaimDispatchable,
  mockIsMaxPaused,
  mockGetMaxPauseMs,
  mockQuery,
  mockGetAccountByChannel,
} = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockWorkerRateLimit: vi.fn().mockResolvedValue(undefined),
  mockWorkerClose: vi.fn().mockResolvedValue(undefined),
  mockSendToRecipientMax: vi.fn(),
  mockClaimDispatchable: vi.fn().mockResolvedValue([]),
  mockIsMaxPaused: vi.fn().mockResolvedValue(false),
  mockGetMaxPauseMs: vi.fn().mockResolvedValue(0),
  mockQuery: vi.fn().mockResolvedValue([]),
  mockGetAccountByChannel: vi.fn().mockResolvedValue({
    id: 'max-account',
    credentials: { accessToken: 'MAX:ACCESS:TOKEN' },
  }),
}));

vi.mock('bullmq', () => {
  function MockQueue() {
    return { add: mockQueueAdd };
  }
  function MockWorker() {
    return { on: vi.fn(), close: mockWorkerClose, rateLimit: mockWorkerRateLimit };
  }
  // BullMQ flags a rate-limited job by this error message.
  MockWorker.RateLimitError = () => new Error(RATE_LIMIT_ERROR_MESSAGE);
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('../../config/index.js', () => ({
  config: { redis: { host: 'localhost', port: 6379, password: '', tls: undefined } },
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../utils/error-tracker.js', () => ({
  captureException: vi.fn(),
}));

vi.mock('./max-broadcast-governor.js', () => ({
  isMaxPaused: mockIsMaxPaused,
  getMaxPauseMs: mockGetMaxPauseMs,
  pauseMax: vi.fn(),
}));

vi.mock('./max-broadcast-sender.js', () => ({
  sendToRecipientMax: mockSendToRecipientMax,
}));

vi.mock('./campaign.service.js', () => ({
  claimDispatchableRecipients: mockClaimDispatchable,
}));

vi.mock('../../database/db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../connectors/core/account-store.js', () => ({
  getAccountByChannel: mockGetAccountByChannel,
}));

import {
  processMaxBroadcast,
  dispatchOnceMax,
  startMaxBroadcastWorker,
  stopMaxBroadcastWorker,
} from './max-broadcast-worker.js';

type MaxBroadcastJob = Parameters<typeof processMaxBroadcast>[0];
const makeJob = (recipientId: string): MaxBroadcastJob =>
  ({ data: { recipientId } } as MaxBroadcastJob);

describe('max-broadcast-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMaxPaused.mockResolvedValue(false);
    mockGetMaxPauseMs.mockResolvedValue(0);
    mockClaimDispatchable.mockResolvedValue([]);
    mockQuery.mockResolvedValue([]);
    mockGetAccountByChannel.mockResolvedValue({
      id: 'max-account',
      credentials: { accessToken: 'MAX:ACCESS:TOKEN' },
    });
    // Create the module-singleton worker so yieldRateLimited can call worker.rateLimit.
    startMaxBroadcastWorker();
  });

  it('(a) when the MAX token is paused → yields via worker.rateLimit + RateLimitError, sender NOT called', async () => {
    mockIsMaxPaused.mockResolvedValue(true);
    mockGetMaxPauseMs.mockResolvedValue(30000);

    await expect(processMaxBroadcast(makeJob('rcpt-1'))).rejects.toThrow(RATE_LIMIT_ERROR_MESSAGE);

    expect(mockWorkerRateLimit).toHaveBeenCalledWith(30000);
    expect(mockSendToRecipientMax).not.toHaveBeenCalled();
  });

  it('(b) when sendToRecipientMax returns rate_limited → yields without consuming an attempt', async () => {
    mockIsMaxPaused.mockResolvedValue(false);
    mockSendToRecipientMax.mockResolvedValue({ status: 'rate_limited', retryAfterMs: 30000 });

    await expect(processMaxBroadcast(makeJob('rcpt-2'))).rejects.toThrow(RATE_LIMIT_ERROR_MESSAGE);

    expect(mockSendToRecipientMax).toHaveBeenCalledWith('rcpt-2');
    expect(mockWorkerRateLimit).toHaveBeenCalledWith(30000);
  });

  it('terminal send result (sent) → resolves without rate-limit yield', async () => {
    mockIsMaxPaused.mockResolvedValue(false);
    mockSendToRecipientMax.mockResolvedValue({ status: 'sent' });

    await expect(processMaxBroadcast(makeJob('rcpt-3'))).resolves.toBeUndefined();
    expect(mockWorkerRateLimit).not.toHaveBeenCalled();
  });

  it('blocked send result → resolves terminally (no re-yield)', async () => {
    mockIsMaxPaused.mockResolvedValue(false);
    mockSendToRecipientMax.mockResolvedValue({ status: 'blocked' });

    await expect(processMaxBroadcast(makeJob('rcpt-4'))).resolves.toBeUndefined();
    expect(mockWorkerRateLimit).not.toHaveBeenCalled();
  });

  it('ISOLATION (S5): dispatchOnceMax claims ONLY channel=max campaigns (TG dispatcher untouched)', async () => {
    mockQuery.mockResolvedValue([{ id: 'max-camp-1' }]);
    mockClaimDispatchable.mockResolvedValue([
      { id: 'rcpt-a', idempotencyKey: 'camp:max-camp-1:contact-a' },
      { id: 'rcpt-b', idempotencyKey: 'camp:max-camp-1:contact-b' },
    ]);

    const enqueued = await dispatchOnceMax();

    expect(enqueued).toBe(2);
    // The campaign-selection SQL discriminates by the column `channel = 'max'` ONLY — it must
    // NOT widen to telegram (which would steal the live TG dispatcher's recipients).
    const selectSql = String(mockQuery.mock.calls[0][0]);
    expect(selectSql).toContain("channel = 'max'");
    expect(selectSql).toContain("status = 'active'");
    expect(selectSql).not.toContain("channel = 'telegram'");
    expect(mockClaimDispatchable).toHaveBeenCalledWith('max-camp-1', 500);
  });

  it('dispatchOnceMax enqueues each recipient with NO custom jobId (auto-id; CAS-lease guards dupes)', async () => {
    mockQuery.mockResolvedValue([{ id: 'max-camp-1' }]);
    mockClaimDispatchable.mockResolvedValue([
      { id: 'rcpt-a', idempotencyKey: 'camp:max-camp-1:contact-a' },
    ]);

    await dispatchOnceMax();

    const callA = mockQueueAdd.mock.calls.find((c) => c[1]?.recipientId === 'rcpt-a');
    expect(callA).toBeTruthy();
    expect(callA![2]?.jobId).toBeUndefined();
    expect(callA![2].attempts).toBe(1); // retry timing owned by PG, not BullMQ
  });

  it('dispatchOnceMax is a no-op when no active MAX campaigns', async () => {
    mockQuery.mockResolvedValue([]);
    const enqueued = await dispatchOnceMax();
    expect(enqueued).toBe(0);
    expect(mockClaimDispatchable).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('stopMaxBroadcastWorker closes the worker', async () => {
    await stopMaxBroadcastWorker();
    expect(mockWorkerClose).toHaveBeenCalled();
  });
});
