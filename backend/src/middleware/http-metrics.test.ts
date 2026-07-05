import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock metrics before import
vi.mock('../services/metrics.service.js', () => ({
  httpRequestDuration: { observe: vi.fn() },
  httpRequestsTotal: { inc: vi.fn() },
  httpRequestsInFlight: { inc: vi.fn(), dec: vi.fn() },
}));

import { httpMetricsMiddleware } from './http-metrics.js';
import { httpRequestDuration, httpRequestsTotal, httpRequestsInFlight } from '../services/metrics.service.js';
import type { Request, Response, NextFunction } from 'express';

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/api/health',
    baseUrl: '',
    route: null,
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response & { triggerFinish: () => void } {
  const listeners: Record<string, (() => void)[]> = {};
  const res = {
    statusCode: 200,
    on(event: string, cb: () => void) {
      (listeners[event] ??= []).push(cb);
      return res;
    },
    triggerFinish() {
      for (const cb of listeners['finish'] ?? []) cb();
    },
  };
  return res as unknown as Response & { triggerFinish: () => void };
}

describe('httpMetricsMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls next() immediately', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    httpMetricsMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('increments in-flight gauge on request start', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    httpMetricsMiddleware(req, res, next);

    expect(httpRequestsInFlight.inc).toHaveBeenCalledOnce();
  });

  it('records metrics on response finish', () => {
    const req = createMockReq({ method: 'POST', path: '/api/orders' });
    const res = createMockRes();
    res.statusCode = 201;
    const next = vi.fn();

    httpMetricsMiddleware(req, res, next);
    res.triggerFinish();

    expect(httpRequestDuration.observe).toHaveBeenCalledOnce();
    expect(httpRequestsTotal.inc).toHaveBeenCalledOnce();
    expect(httpRequestsInFlight.dec).toHaveBeenCalledOnce();

    const labels = (httpRequestsTotal.inc as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(labels.method).toBe('POST');
    expect(labels.status_code).toBe('201');
    expect(labels.route).toBe('/api/orders');
  });

  it('skips /api/metrics endpoint', () => {
    const req = createMockReq({ path: '/api/metrics' });
    const res = createMockRes();
    const next = vi.fn();

    httpMetricsMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(httpRequestsInFlight.inc).not.toHaveBeenCalled();
  });

  it('normalizes UUID path segments', () => {
    const req = createMockReq({ path: '/api/orders/550e8400-e29b-41d4-a716-446655440000/items' });
    const res = createMockRes();
    const next = vi.fn();

    httpMetricsMiddleware(req, res, next);
    res.triggerFinish();

    const labels = (httpRequestsTotal.inc as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(labels.route).toBe('/api/orders/:id/items');
  });

  it('normalizes numeric path segments', () => {
    const req = createMockReq({ path: '/api/users/12345' });
    const res = createMockRes();
    const next = vi.fn();

    httpMetricsMiddleware(req, res, next);
    res.triggerFinish();

    const labels = (httpRequestsTotal.inc as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(labels.route).toBe('/api/users/:id');
  });

  it('uses req.route.path when available (Express matched route)', () => {
    const req = createMockReq({
      baseUrl: '/api/orders',
      route: { path: '/:id' } as unknown as Request['route'],
    });
    const res = createMockRes();
    const next = vi.fn();

    httpMetricsMiddleware(req, res, next);
    res.triggerFinish();

    const labels = (httpRequestsTotal.inc as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(labels.route).toBe('/api/orders/:id');
  });
});
