import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDb = vi.hoisted(() => ({
  queryOne: vi.fn().mockResolvedValue(null),
}));

vi.mock('../database/db.js', () => ({
  default: mockDb,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    warn: vi.fn(),
  })),
}));

import {
  buildRestorationWorkloadSnapshot,
  getRestorationWorkload,
  leadTimeForRestorationTier,
} from './restoration-workload.service.js';

describe('restoration workload SLA', () => {
  beforeEach(() => {
    vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  });

  it('keeps the public promise within the day at normal load', () => {
    const snapshot = buildRestorationWorkloadSnapshot({
      activeOrders: 1,
      activeRetouchTasks: 1,
      completedToday: 1,
      now: new Date('2026-05-17T10:00:00+03:00'),
    });

    expect(snapshot.loadLevel).toBe('normal');
    expect(snapshot.leadTimeLabel).toBe('в течение дня');
    expect(leadTimeForRestorationTier('simple', snapshot)).toBe('в течение дня');
    expect(leadTimeForRestorationTier('medium', snapshot)).toBe('в течение дня');
  });

  it('extends the page lead time when the active queue is busy', () => {
    const snapshot = buildRestorationWorkloadSnapshot({
      activeOrders: 4,
      activeRetouchTasks: 3,
      completedToday: 1,
      now: new Date('2026-05-17T10:00:00+03:00'),
    });

    expect(snapshot.loadLevel).toBe('busy');
    expect(snapshot.leadTimeLabel).toBe('1-2 дня');
    expect(leadTimeForRestorationTier('complex', snapshot)).toBe('2-3 дня');
  });

  it('stops promising a fixed deadline during a surge', () => {
    const snapshot = buildRestorationWorkloadSnapshot({
      activeOrders: 11,
      activeRetouchTasks: 10,
      completedToday: 8,
      now: new Date('2026-05-17T10:00:00+03:00'),
    });

    expect(snapshot.loadLevel).toBe('surge');
    expect(snapshot.leadTimeLabel).toBe('по согласованию');
    expect(leadTimeForRestorationTier('pro', snapshot)).toBe('по согласованию');
  });

  it('counts restoration orders by service type while keeping legacy mode fallback', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ active_orders: '2', completed_today: '1' })
      .mockResolvedValueOnce({ active_retouch_tasks: '3' });

    const snapshot = await getRestorationWorkload();
    const orderSql = String(mockDb.queryOne.mock.calls[0]?.[0] ?? '');

    expect(orderSql).toContain("service_type = 'restoration'");
    expect(orderSql).toContain("mode = 'restoration'");
    expect(snapshot.activeOrders).toBe(2);
    expect(snapshot.activeRetouchTasks).toBe(3);
    expect(snapshot.completedToday).toBe(1);
  });
});
