import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetouchAvailabilityRow } from '../types/views/retouch-views.js';

const { addBusinessMinutesMock, mockPool } = vi.hoisted(() => ({
  addBusinessMinutesMock: vi.fn(),
  mockPool: {
    query: vi.fn(),
  },
}));

vi.mock('../database/db.js', () => ({
  pool: mockPool,
}));

vi.mock('./business-hours.service.js', () => ({
  addBusinessMinutes: addBusinessMinutesMock,
}));

function availabilityRow(start: string, end: string): RetouchAvailabilityRow {
  return {
    employee_id: 'employee-1' as RetouchAvailabilityRow['employee_id'],
    studio_id: 'studio-1' as RetouchAvailabilityRow['studio_id'],
    shift_start_at: new Date(start),
    shift_end_at: new Date(end),
    active_count: 0,
  };
}

describe('retouch deadline scheduling', () => {
  beforeEach(() => {
    vi.mocked(mockPool.query).mockReset();
    vi.mocked(addBusinessMinutesMock).mockReset();
  });

  it('moves a 30 minute deadline to the next retoucher shift', async () => {
    const { computeRetouchDeadlineFromAvailability } = await import('./retouch-deadline.service.js');
    const now = new Date('2026-05-14T07:00:00.000Z');

    const deadline = computeRetouchDeadlineFromAvailability(30, [
      availabilityRow('2026-05-15T06:00:00.000Z', '2026-05-15T16:30:00.000Z'),
    ], now);

    expect(deadline?.toISOString()).toBe('2026-05-15T06:30:00.000Z');
  });

  it('uses today when a retoucher is already in an open shift', async () => {
    const { computeRetouchDeadlineFromAvailability } = await import('./retouch-deadline.service.js');
    const now = new Date('2026-05-14T07:00:00.000Z');

    const deadline = computeRetouchDeadlineFromAvailability(30, [
      availabilityRow('2026-05-14T06:00:00.000Z', '2026-05-14T16:30:00.000Z'),
    ], now);

    expect(deadline?.toISOString()).toBe('2026-05-14T07:30:00.000Z');
  });

  it('queries only open retoucher shifts and returns the first available deadline', async () => {
    const { computeRetouchDeadline } = await import('./retouch-deadline.service.js');
    vi.mocked(mockPool.query).mockResolvedValueOnce({
      rows: [
        availabilityRow('2026-05-15T06:00:00.000Z', '2026-05-15T16:30:00.000Z'),
      ],
    });

    const deadline = await computeRetouchDeadline(30, {
      now: new Date('2026-05-14T07:00:00.000Z'),
      studioId: 'studio-1',
    });

    const sql = String(vi.mocked(mockPool.query).mock.calls[0]?.[0] ?? '');
    const params = vi.mocked(mockPool.query).mock.calls[0]?.[1];

    expect(deadline.toISOString()).toBe('2026-05-15T06:30:00.000Z');
    expect(sql).toContain('studio_schedule_exceptions');
    expect(sql).toContain('status_until');
    expect(params).toEqual([new Date('2026-05-14T07:00:00.000Z'), 45, 'studio-1']);
    expect(addBusinessMinutesMock).not.toHaveBeenCalled();
  });

  it('falls back to studio business hours when no retoucher shift is available', async () => {
    const { computeRetouchDeadline } = await import('./retouch-deadline.service.js');
    const fallbackDeadline = new Date('2026-05-15T06:30:00.000Z');
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] });
    vi.mocked(addBusinessMinutesMock).mockResolvedValueOnce(fallbackDeadline);

    const deadline = await computeRetouchDeadline(30, {
      now: new Date('2026-05-14T07:00:00.000Z'),
      studioId: 'studio-1',
    });

    expect(deadline).toBe(fallbackDeadline);
    expect(addBusinessMinutesMock).toHaveBeenCalledWith(
      new Date('2026-05-14T07:00:00.000Z'),
      30,
      'studio-1',
    );
  });
});
