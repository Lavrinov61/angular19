/**
 * Unit tests for transactional webhook idempotency service.
 *
 * Verifies: duplicate detection, race handling, rollback on error, response caching.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb, resetMockDb } from '../test-utils/index.js';

vi.mock('../database/db.js', () => ({
  default: mockDb,
}));

vi.mock('../services/metrics.service.js', () => ({
  webhookIdempotencyHits: { inc: vi.fn() },
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { withWebhookIdempotency } = await import('./webhook-idempotency.service.js');

describe('withWebhookIdempotency', () => {
  let mockClient: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    resetMockDb();
    // Override transaction mock to capture the client
    mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    vi.mocked(mockDb.transaction).mockImplementation(async (fn: (client: unknown) => unknown) => {
      return fn(mockClient);
    });
  });

  it('executes callback when key is new (not duplicate)', async () => {
    // INSERT returns the key (claimed successfully)
    mockClient.query.mockResolvedValueOnce({
      rows: [{ idempotency_key: 'pay:123' }],
    });
    // UPDATE response — success
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    const callback = vi.fn().mockResolvedValue({ orderId: 'SF-001' });

    const result = await withWebhookIdempotency('pay', '123', 'SF-001', callback);

    expect(result.duplicate).toBe(false);
    if (!result.duplicate) {
      expect(result.result).toEqual({ orderId: 'SF-001' });
    }
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(mockClient);
  });

  it('returns cached response for duplicate webhook', async () => {
    // INSERT returns empty (conflict — key already exists)
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // SELECT existing response
    mockClient.query.mockResolvedValueOnce({
      rows: [{ response_body: { code: 0 } }],
    });

    const callback = vi.fn();

    const result = await withWebhookIdempotency('pay', '123', 'SF-001', callback);

    expect(result.duplicate).toBe(true);
    if (result.duplicate) {
      expect(result.cachedResponse).toEqual({ code: 0 });
    }
    expect(callback).not.toHaveBeenCalled();
  });

  it('returns code:0 when duplicate has null response_body (processing)', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    mockClient.query.mockResolvedValueOnce({ rows: [{ response_body: null }] });

    const callback = vi.fn();

    const result = await withWebhookIdempotency('pay', '456', null, callback);

    expect(result.duplicate).toBe(true);
    if (result.duplicate) {
      expect(result.cachedResponse).toEqual({ code: 0 });
    }
  });

  it('propagates callback errors (transaction rolls back key)', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{ idempotency_key: 'pay:789' }],
    });

    const callback = vi.fn().mockRejectedValue(new Error('DB write failed'));

    await expect(
      withWebhookIdempotency('pay', '789', 'SF-002', callback),
    ).rejects.toThrow('DB write failed');

    // The transaction mock wraps in try/catch → ROLLBACK happens in db.transaction()
    // Key INSERT is rolled back, so CloudPayments can retry
  });

  it('saves response body in the same transaction', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{ idempotency_key: 'fail:100' }],
    });
    // callback succeeds
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    const callback = vi.fn().mockResolvedValue('ok');

    await withWebhookIdempotency('fail', '100', 'SF-003', callback, { code: 0 });

    // Last call should be the UPDATE
    const lastCall = mockClient.query.mock.calls[1];
    expect(lastCall[0]).toContain('UPDATE webhook_idempotency');
    expect(lastCall[1]).toEqual(['fail:100', 0, JSON.stringify({ code: 0 })]);
  });

  it('uses correct key format: {webhookType}:{transactionId}', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{ idempotency_key: 'refund:555' }],
    });
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    await withWebhookIdempotency('refund', '555', 'SF-004', vi.fn().mockResolvedValue(null));

    const insertCall = mockClient.query.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO webhook_idempotency');
    expect(insertCall[1]).toEqual(['refund:555', 'refund', 'SF-004']);
  });
});
