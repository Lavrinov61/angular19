import type { NextFunction, Request, Response } from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { mockDb, getStudiosMock } = vi.hoisted(() => ({
  mockDb: {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
  },
  getStudiosMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('../database/db.js', () => ({ default: mockDb }));
vi.mock('../middleware/rate-limit-store.js', () => ({
  createRateLimitStore: vi.fn(() => undefined),
}));
vi.mock('../middleware/idempotency.js', () => ({
  idempotent: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));
vi.mock('../services/booking-autonomous.service.js', () => ({
  getStudios: getStudiosMock,
  getAvailableSlots: vi.fn().mockResolvedValue({ slots: [] }),
  createBooking: vi.fn().mockResolvedValue({ success: true, bookingId: 'booking-1' }),
}));
vi.mock('../services/partners.service.js', () => ({
  validatePartnerPromoCode: vi.fn().mockResolvedValue(null),
  recordReferral: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/sms.service.js', () => ({
  normalizePhone: vi.fn((phone: string) => phone.replace(/\D/g, '')),
}));
vi.mock('../services/voice-otp-dispatcher.service.js', () => ({
  requestVoiceOtpDispatch: vi.fn().mockResolvedValue({ method: 'sms' }),
}));
vi.mock('../config/index.js', () => ({
  config: { redis: { host: '' } },
}));
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

let app: import('express').Express;

const sobornyStudio = {
  id: 'studio-soborny',
  name: 'Своё Фото — Соборный',
  location_code: 'soborny',
  address: 'ул. Соборный 21, Ростов-на-Дону',
  status: 'open',
  status_message: null,
  status_until: null,
};

const barrikadnayaStudio = {
  id: 'studio-barrikadnaya',
  name: 'Своё Фото — Баррикадная',
  location_code: 'barrikadnaya-4',
  address: 'ул. 2-ая Баррикадная 4, Ростов-на-Дону',
  status: 'closed',
  status_message: 'Точка закрыта навсегда.',
  status_until: null,
};

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./public-booking.routes.js');
  app = createTestApp(router);
});

beforeEach(() => {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(getStudiosMock).mockReset().mockResolvedValue([]);
});

describe('public booking studio visibility', () => {
  it('returns only public studios for website booking', async () => {
    vi.mocked(getStudiosMock).mockResolvedValue([barrikadnayaStudio, sobornyStudio]);

    const res = await request(app).get('/studios');

    expect(res.status).toBe(200);
    expect(res.body.data.map((studio: { location_code: string }) => studio.location_code)).toEqual(['soborny']);
  });

  it('returns only public closure alerts for the global banner', async () => {
    vi.mocked(mockDb.query).mockResolvedValue([
      {
        studio_id: 'studio-barrikadnaya',
        location_code: 'barrikadnaya-4',
        studio_name: 'Своё Фото — Баррикадная',
        exception_date: '2026-06-24',
        is_closed: true,
        open_time: null,
        close_time: null,
        reason: 'Точка закрыта навсегда.',
      },
      {
        studio_id: 'studio-soborny',
        location_code: 'soborny',
        studio_name: 'Своё Фото — Соборный',
        exception_date: '2026-06-24',
        is_closed: true,
        open_time: null,
        close_time: null,
        reason: 'Санитарный день.',
      },
    ]);

    const res = await request(app).get('/alerts');

    expect(res.status).toBe(200);
    expect(res.body.data.map((alert: { location_code: string }) => alert.location_code)).toEqual(['soborny']);
  });
});
