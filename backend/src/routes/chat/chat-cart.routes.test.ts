import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../middleware/errorHandler.js';
import type { AuthRequest } from '../../middleware/auth.js';

const mockQuery = vi.fn();
vi.mock('../../database/db.js', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { ensureSessionOwnerByUser } = await import('./chat-cart.routes.js');

function makeReq(userId: string | null): AuthRequest {
  const base = userId
    ? { user: { id: userId, email: 'test@example.com', role: 'client' } }
    : {};
  return base as AuthRequest;
}

describe('chat-cart.routes security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows cart access when conversation belongs to authenticated user', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'session-1',
        contact_id: 'contact-1',
        channel: 'web',
        status: 'open',
        created_at: null,
        updated_at: null,
        user_id: 'user-1',
      }],
    });

    await expect(
      ensureSessionOwnerByUser(makeReq('user-1'), 'session-1'),
    ).resolves.toBeUndefined();
  });

  it('blocks cart access when conversation belongs to different user (403)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'session-1',
        contact_id: 'contact-2',
        channel: 'web',
        status: 'open',
        created_at: null,
        updated_at: null,
        user_id: 'user-other',
      }],
    });

    const promise = ensureSessionOwnerByUser(makeReq('user-1'), 'session-1');
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 when conversation missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const promise = ensureSessionOwnerByUser(makeReq('user-1'), 'missing-id');
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ statusCode: 404 });
  });
});
