import type { NextFunction, Request, Response } from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { mockMpQuery, mockEnqueueVisitorSessionUpdate } = vi.hoisted(() => ({
  mockMpQuery: vi.fn().mockResolvedValue([{ id: 123 }]),
  mockEnqueueVisitorSessionUpdate: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../workers/visitor-session-worker.js', () => ({
  enqueueVisitorSessionUpdate: mockEnqueueVisitorSessionUpdate,
}));

vi.mock('../services/metrics.service.js', () => ({
  adClicksTotal: { inc: vi.fn() },
  adClicksErrorsTotal: { inc: vi.fn() },
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./tracking.routes.js');
  app = createTestApp(router);
});

beforeEach(() => {
  vi.mocked(mockMpQuery).mockReset().mockResolvedValue([{ id: 123 }]);
  vi.mocked(mockEnqueueVisitorSessionUpdate).mockReset().mockResolvedValue(undefined);
});

describe('POST /click', () => {
  it('records a click without setting visitor_id cookies', async () => {
    const res = await request(app)
      .post('/click')
      .send({
        visitor_id: '11111111-1111-4111-8111-111111111111',
        tracking_id: 'codex-cookie-fix',
        utm_source: 'direct',
        landing_page: '/',
        host: 'svoefoto.ru',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, click_id: 123, tracking_id: expect.any(String) });
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
