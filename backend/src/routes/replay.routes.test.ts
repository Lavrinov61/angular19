import type { NextFunction, Request, Response } from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { mockDb, mockMpQuery } = vi.hoisted(() => ({
  mockDb: {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue({ id: 'replay-session-1' }),
  },
  mockMpQuery: vi.fn().mockResolvedValue([]),
}));

vi.mock('../database/db.js', () => ({
  default: mockDb,
}));

vi.mock('../database/mp-db.js', () => ({
  mpQuery: mockMpQuery,
}));

vi.mock('../middleware/rate-limit-store.js', () => ({
  createRateLimitStore: vi.fn(() => undefined),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (_req: Request, _res: Response, next: NextFunction) => next(),
  requirePermission: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./replay.routes.js');
  app = createTestApp(router);
});

beforeEach(() => {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue({ id: 'replay-session-1' });
  vi.mocked(mockMpQuery).mockReset().mockResolvedValue([]);
});

describe('POST /sessions', () => {
  it('creates a replay session without setting visitor_id cookies', async () => {
    const res = await request(app)
      .post('/sessions')
      .send({
        visitor_id: '11111111-1111-4111-8111-111111111111',
        landing_page: '/',
        user_agent: 'Mozilla/5.0',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, session_id: 'replay-session-1' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
