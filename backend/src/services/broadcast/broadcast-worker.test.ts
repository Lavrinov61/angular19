/**
 * Broadcast Worker — unit tests for the governor pre-send gate, 429 yield protocol,
 * and the dispatcher's deterministic-jobId enqueue (anti-duplicate).
 *
 * BullMQ, campaign.service, the governor, db and account-store are all mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const RATE_LIMIT_ERROR_MESSAGE = 'bullmq:rateLimitExceeded';

const {
  mockQueueAdd,
  mockWorkerRateLimit,
  mockWorkerClose,
  mockSendToRecipient,
  mockClaimDispatchable,
  mockIsBotPaused,
  mockGetBotPauseMs,
  mockQuery,
  mockGetAccountByChannel,
} = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockWorkerRateLimit: vi.fn().mockResolvedValue(undefined),
  mockWorkerClose: vi.fn().mockResolvedValue(undefined),
  mockSendToRecipient: vi.fn(),
  mockClaimDispatchable: vi.fn().mockResolvedValue([]),
  mockIsBotPaused: vi.fn().mockResolvedValue(false),
  mockGetBotPauseMs: vi.fn().mockResolvedValue(0),
  mockQuery: vi.fn().mockResolvedValue([]),
  mockGetAccountByChannel: vi.fn().mockResolvedValue({
    id: 'tg-account',
    credentials: { botToken: '8038532455:AA-fake-test-token' },
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

vi.mock('./broadcast-governor.js', () => ({
  isBotPaused: mockIsBotPaused,
  getBotPauseMs: mockGetBotPauseMs,
  pauseBot: vi.fn(),
}));

vi.mock('./campaign.service.js', () => ({
  sendToRecipient: mockSendToRecipient,
  claimDispatchableRecipients: mockClaimDispatchable,
}));

vi.mock('../../database/db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../connectors/core/account-store.js', () => ({
  getAccountByChannel: mockGetAccountByChannel,
}));

import {
  processBroadcast,
  dispatchOnce,
  startBroadcastWorker,
  stopBroadcastWorker,
} from './broadcast-worker.js';

type BroadcastJob = Parameters<typeof processBroadcast>[0];
const makeJob = (recipientId: string): BroadcastJob =>
  ({ data: { recipientId } } as BroadcastJob);

describe('broadcast-worker', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockIsBotPaused.mockResolvedValue(false);
    mockGetBotPauseMs.mockResolvedValue(0);
    mockClaimDispatchable.mockResolvedValue([]);
    mockQuery.mockResolvedValue([]);
    mockGetAccountByChannel.mockResolvedValue({
      id: 'tg-account',
      credentials: { botToken: '8038532455:AA-fake-test-token' },
    });
    // Create the module-singleton worker so yieldRateLimited can call worker.rateLimit.
    startBroadcastWorker();
  });

  it('(a) when bot is paused → yields via worker.rateLimit + RateLimitError, adapter NOT called', async () => {
    mockIsBotPaused.mockResolvedValue(true);
    mockGetBotPauseMs.mockResolvedValue(8000);

    await expect(processBroadcast(makeJob('rcpt-1'))).rejects.toThrow(RATE_LIMIT_ERROR_MESSAGE);

    // Yielded for the pause window.
    expect(mockWorkerRateLimit).toHaveBeenCalledWith(8000);
    // The send (campaign.service.sendToRecipient) was NEVER reached.
    expect(mockSendToRecipient).not.toHaveBeenCalled();
  });

  it('(b) when sendToRecipient returns rate_limited → yields without consuming an attempt', async () => {
    mockIsBotPaused.mockResolvedValue(false);
    mockSendToRecipient.mockResolvedValue({ status: 'rate_limited', retryAfterMs: 5000 });

    await expect(processBroadcast(makeJob('rcpt-2'))).rejects.toThrow(RATE_LIMIT_ERROR_MESSAGE);

    expect(mockSendToRecipient).toHaveBeenCalledWith('rcpt-2');
    expect(mockWorkerRateLimit).toHaveBeenCalledWith(5000);
  });

  it('terminal send result (sent) → resolves without rate-limit yield', async () => {
    mockIsBotPaused.mockResolvedValue(false);
    mockSendToRecipient.mockResolvedValue({ status: 'sent' });

    await expect(processBroadcast(makeJob('rcpt-3'))).resolves.toBeUndefined();
    expect(mockWorkerRateLimit).not.toHaveBeenCalled();
  });

  it('(c) dispatchOnce enqueues each recipient with NO custom jobId (BullMQ auto-id; re-dispatch-safe)', async () => {
    mockQuery.mockResolvedValue([{ id: 'camp-1' }]);
    mockClaimDispatchable.mockResolvedValue([
      { id: 'rcpt-a', idempotencyKey: 'camp:camp-1:contact-a' },
      { id: 'rcpt-b', idempotencyKey: 'camp:camp-1:contact-b' },
    ]);

    const enqueued = await dispatchOnce();

    expect(enqueued).toBe(2);
    expect(mockClaimDispatchable).toHaveBeenCalledWith('camp-1', 500);
    const callA = mockQueueAdd.mock.calls.find((c) => c[1]?.recipientId === 'rcpt-a');
    const callB = mockQueueAdd.mock.calls.find((c) => c[1]?.recipientId === 'rcpt-b');
    expect(callA).toBeTruthy();
    expect(callB).toBeTruthy();
    // No custom jobId: BullMQ rejects ':' in custom ids and idempotency_key is full of colons;
    // also a deterministic id would permanently dedup re-queued recipients. Auto-id + CAS-lease
    // (in sendToRecipient) is the double-send guard, and it unblocks retries/re-dispatch.
    expect(callA![2]?.jobId).toBeUndefined();
    expect(callA![2].attempts).toBe(1);
    expect(callB![2]?.jobId).toBeUndefined();
  });

  it('dispatchOnce is a no-op when no active campaigns', async () => {
    mockQuery.mockResolvedValue([]);
    const enqueued = await dispatchOnce();
    expect(enqueued).toBe(0);
    expect(mockClaimDispatchable).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('stopBroadcastWorker closes the worker', async () => {
    await stopBroadcastWorker();
    expect(mockWorkerClose).toHaveBeenCalled();
  });
});
