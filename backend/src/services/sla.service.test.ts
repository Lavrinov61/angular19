import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
  },
}));

vi.mock('../database/db.js', () => ({
  pool: mockPool,
}));

describe('computeSlaFromOrderItems', () => {
  beforeEach(() => {
    vi.mocked(mockPool.query).mockReset();
  });

  it('uses DB minutes with SLA work units instead of hardcoded photo count rules', async () => {
    const { computeSlaFromOrderItems } = await import('./sla.service.js');

    vi.mocked(mockPool.query).mockResolvedValueOnce({
      rows: [
        { option_id: 'speed-normal', category_id: 'photo-docs', selection_type: 'single', estimated_minutes: 30 },
        { option_id: 'retouch', category_id: 'photo-docs', selection_type: 'single', estimated_minutes: 15 },
        { option_id: 'uniform', category_id: 'photo-docs', selection_type: 'multi', estimated_minutes: 60 },
      ],
    });

    const minutes = await computeSlaFromOrderItems([
      { serviceOptionId: 'speed-normal' },
      { serviceOptionId: 'retouch', slaQuantity: 20 },
      { serviceOptionId: 'uniform' },
    ]);

    expect(minutes).toBe(360);
  });

  it('falls back to the normal photo-docs work time when no SLA inputs exist', async () => {
    const { computeSlaFromOrderItems } = await import('./sla.service.js');

    const minutes = await computeSlaFromOrderItems([]);

    expect(minutes).toBe(30);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('sums independent service categories and quantity groups', async () => {
    const { computeSlaFromOrderItems } = await import('./sla.service.js');

    vi.mocked(mockPool.query).mockResolvedValueOnce({
      rows: [
        { option_id: 'retouch-pro', category_id: 'retouch', selection_type: 'single', estimated_minutes: 60 },
        { option_id: 'print-copy', category_id: 'copy-print', selection_type: 'quantity', estimated_minutes: 2 },
      ],
    });

    const minutes = await computeSlaFromOrderItems([
      { serviceOptionId: 'retouch-pro', slaQuantity: 3 },
      { serviceOptionId: 'print-copy', quantity: 10 },
    ]);

    expect(minutes).toBe(200);
  });
});
