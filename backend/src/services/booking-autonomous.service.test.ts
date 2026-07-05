import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDb,
  createTaskFromBooking,
  notifyBookingCreated,
  notifyBookingCancelled,
  notifyBookingRescheduled,
} = vi.hoisted(() => ({
  mockDb: {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
  },
  createTaskFromBooking: vi.fn().mockResolvedValue(undefined),
  notifyBookingCreated: vi.fn().mockResolvedValue(undefined),
  notifyBookingCancelled: vi.fn().mockResolvedValue(undefined),
  notifyBookingRescheduled: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../database/db.js', () => ({ default: mockDb }));
vi.mock('./task-auto.service.js', () => ({ createTaskFromBooking }));
vi.mock('./booking-notify.service.js', () => ({
  notifyBookingCreated,
  notifyBookingCancelled,
  notifyBookingRescheduled,
}));
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { createBooking, getAvailableSlots, rescheduleBooking } = await import('./booking-autonomous.service.js');

describe('booking autonomous studio status window', () => {
  beforeEach(() => {
    vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
    vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
    vi.mocked(createTaskFromBooking).mockReset().mockResolvedValue(undefined);
    vi.mocked(notifyBookingCreated).mockReset().mockResolvedValue(undefined);
    vi.mocked(notifyBookingCancelled).mockReset().mockResolvedValue(undefined);
    vi.mocked(notifyBookingRescheduled).mockReset().mockResolvedValue(undefined);
  });

  it('uses the requested slot date when resolving a temporary studio closure', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ name: 'Баррикадная', status: 'open', status_message: null })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ name: 'Баррикадная' });
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([{ start_time: '09:00:00', end_time: '10:00:00', employee_name: 'Администратор' }])
      .mockResolvedValueOnce([]);

    const result = await getAvailableSlots('studio-1', '2026-05-11');

    expect(result.slots.map(slot => slot.time)).toEqual(['09:00', '09:30']);
    const statusCall = vi.mocked(mockDb.queryOne).mock.calls[0];
    expect(String(statusCall?.[0])).toContain('status_until < $2::date');
    expect(statusCall?.[1]).toEqual(['studio-1', '2026-05-11']);
  });

  it('keeps the studio closed through status_until inclusively', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        name: 'Баррикадная',
        status: 'closed',
        status_message: 'Точка временно закрыта до 9 мая.',
      });

    const result = await getAvailableSlots('studio-1', '2026-05-09');

    expect(result.slots).toEqual([]);
    expect(result.closedReason).toBe('Точка временно закрыта до 9 мая.');
    expect(vi.mocked(mockDb.queryOne)).toHaveBeenCalledTimes(1);
  });

  it('uses the booking date when validating studio status before insert', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ name: 'Баррикадная', status: 'open', status_message: null })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'booking-1' })
      .mockResolvedValueOnce({ name: 'Баррикадная' });

    const result = await createBooking({
      studioId: 'studio-1',
      date: '2026-05-11',
      time: '10:00',
      clientName: 'Иван Иванов',
      clientPhone: '+79001234567',
      source: 'website',
    });

    expect(result).toEqual({ success: true, bookingId: 'booking-1' });
    const statusCall = vi.mocked(mockDb.queryOne).mock.calls[0];
    expect(String(statusCall?.[0])).toContain('status_until < $2::date');
    expect(statusCall?.[1]).toEqual(['studio-1', '2026-05-11']);
  });

  it('does not look up a user account for an unknown phone placeholder', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ name: 'Баррикадная', status: 'open', status_message: null })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'booking-1' })
      .mockResolvedValueOnce({ name: 'Баррикадная' });

    const result = await createBooking({
      studioId: 'studio-1',
      date: '2035-05-11',
      time: '10:00',
      clientName: 'Вера',
      clientPhone: '?',
      source: 'crm',
    });

    expect(result).toEqual({ success: true, bookingId: 'booking-1' });
    const queriedUsers = vi.mocked(mockDb.queryOne).mock.calls.some(call => String(call[0]).includes('FROM users WHERE phone'));
    expect(queriedUsers).toBe(false);
  });

  it('uses the target date when validating studio status before rescheduling', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: 'booking-1',
        studio_id: 'studio-1',
        studio_name: 'Баррикадная',
        client_name: 'Иван Иванов',
        client_phone: '+79001234567',
        client_email: null,
        service_name: 'Фото на документы',
        start_time: '2026-05-11T10:00:00.000Z',
        end_time: '2026-05-11T10:30:00.000Z',
        status: 'confirmed',
        source: 'website',
        notes: null,
        created_at: '2026-05-01T10:00:00.000Z',
      })
      .mockResolvedValueOnce({
        name: 'Баррикадная',
        status: 'closed',
        status_message: 'Точка временно закрыта до 9 мая.',
      });

    const result = await rescheduleBooking('booking-1', '2026-05-09', '10:00');

    expect(result).toEqual({ success: false, error: 'Точка временно закрыта до 9 мая.' });
    expect(vi.mocked(mockDb.queryOne)).toHaveBeenCalledTimes(2);
    const statusCall = vi.mocked(mockDb.queryOne).mock.calls[1];
    expect(String(statusCall?.[0])).toContain('status_until < $2::date');
    expect(statusCall?.[1]).toEqual(['studio-1', '2026-05-09']);
  });
});
