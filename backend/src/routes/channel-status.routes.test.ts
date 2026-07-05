import request from 'supertest';
import express from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ getWhatsappAvailability: vi.fn() }));

vi.mock('../services/channel-availability.service.js', () => ({
  getWhatsappAvailability: (...args: unknown[]) => h.getWhatsappAvailability(...args),
}));
// Avoid touching Redis for the rate-limit store — fall back to in-memory.
vi.mock('../middleware/rate-limit-store.js', () => ({ createRateLimitStore: () => undefined }));

import channelStatusRoutes from './channel-status.routes.js';

function makeApp(): express.Express {
  const app = express();
  app.use('/api/channel-status', channelStatusRoutes);
  return app;
}

describe('GET /api/channel-status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the whatsapp availability payload the frontend consumes', async () => {
    h.getWhatsappAvailability.mockResolvedValue({ available: true, checkedAt: '2026-01-01T00:00:00.000Z' });
    const res = await request(makeApp()).get('/api/channel-status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ whatsapp: { available: true, checkedAt: '2026-01-01T00:00:00.000Z' } });
    expect(res.headers['cache-control']).toContain('max-age=60');
  });

  it('reflects an unavailable channel', async () => {
    h.getWhatsappAvailability.mockResolvedValue({ available: false, checkedAt: '2026-01-01T00:00:00.000Z' });
    const res = await request(makeApp()).get('/api/channel-status');

    expect(res.status).toBe(200);
    expect(res.body.whatsapp.available).toBe(false);
  });
});
