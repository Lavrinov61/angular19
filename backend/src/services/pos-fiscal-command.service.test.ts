import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetMockDb } from '../test-utils/index.js';

vi.mock('../database/db.js', () => ({
  default: mockDb,
}));

const { enqueueShiftFiscalCommand } = await import('./pos-fiscal-command.service.js');

const STUDIO_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

describe('enqueueShiftFiscalCommand', () => {
  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
  });

  it('does not enqueue a shift command when no fresh online POS agent is available', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);

    await expect(enqueueShiftFiscalCommand(STUDIO_ID, 'shift_open', USER_ID)).resolves.toBeNull();

    expect(mockDb.queryOne).toHaveBeenCalledTimes(1);
    const [lookupSql, lookupParams] = vi.mocked(mockDb.queryOne).mock.calls[0] ?? [];
    expect(String(lookupSql)).toContain('is_online = true');
    expect(String(lookupSql)).toContain('last_heartbeat_at');
    expect(lookupParams).toEqual([STUDIO_ID, 120]);
    expect(vi.mocked(mockDb.queryOne).mock.calls.some(([sql]) => String(sql).includes('INSERT INTO pos_transactions')))
      .toBe(false);
  });

  it('enqueues a shift command to a fresh online POS agent', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ id: 'agent-id' })
      .mockResolvedValueOnce({ id: 'transaction-id' });

    await expect(enqueueShiftFiscalCommand(STUDIO_ID, 'shift_open', USER_ID)).resolves.toBe('transaction-id');

    const [lookupSql, lookupParams] = vi.mocked(mockDb.queryOne).mock.calls[0] ?? [];
    expect(String(lookupSql)).toContain('is_online = true');
    expect(String(lookupSql)).toContain('last_heartbeat_at');
    expect(String(lookupSql)).toContain('ORDER BY last_heartbeat_at DESC NULLS LAST');
    expect(lookupParams).toEqual([STUDIO_ID, 120]);
    expect(mockDb.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pos_transactions'),
      [STUDIO_ID, 'agent-id', 'shift_open', USER_ID],
    );
  });
});
