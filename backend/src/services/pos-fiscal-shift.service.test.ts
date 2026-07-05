import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetMockDb } from '../test-utils/index.js';

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();

vi.mock('../database/db.js', () => ({
  default: mockDb,
}));

vi.mock('./redis-cache.service.js', () => ({
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
}));

const {
  cachePosTelemetrySnapshot,
  getTerminalGateState,
  isFiscalShiftOpenForShift,
  isTelemetryFresh,
  reconcileFiscalShiftTransactionFromTelemetry,
  withFiscalShiftDeviceStatus,
} = await import('./pos-fiscal-shift.service.js');

const SHIFT_ID = '11111111-1111-4111-8111-111111111111';
const STUDIO_ID = '22222222-2222-4222-8222-222222222222';
const OPENED_AT = '2026-05-20T10:00:00.000Z';

describe('pos fiscal shift source of truth', () => {
  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
  });

  it('does not trust pos_shifts.fiscal_enabled without device confirmation', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: SHIFT_ID,
        studio_id: STUDIO_ID,
        opened_at: OPENED_AT,
        status: 'open',
        fiscal_enabled: true,
      })
      .mockResolvedValueOnce({ available: true })
      .mockResolvedValueOnce(null);

    await expect(isFiscalShiftOpenForShift(SHIFT_ID)).resolves.toBe(false);
  });

  it('reports fiscal unavailable when no fresh online POS agent is present', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ available: false })
      .mockResolvedValueOnce(null);

    const shift = await withFiscalShiftDeviceStatus({
      id: SHIFT_ID,
      employee_id: '33333333-3333-4333-8333-333333333333',
      studio_id: STUDIO_ID,
      shift_number: 17,
      opened_at: OPENED_AT,
      closed_at: null,
      cash_at_open: 1290,
      cash_at_close: null,
      expected_cash: null,
      fiscal_enabled: false,
      status: 'open',
      total_sales: 0,
      total_refunds: 0,
      receipt_count: 0,
      cash_collected: null,
      collection_count: null,
      notes: null,
    });

    expect(shift.fiscal_status).toMatchObject({
      ready: false,
      available: false,
      source: 'none',
    });
    const [availabilitySql, availabilityParams] = vi.mocked(mockDb.queryOne).mock.calls[0] ?? [];
    expect(String(availabilitySql)).toContain('is_online = true');
    expect(String(availabilitySql)).toContain('last_heartbeat_at');
    expect(availabilityParams).toEqual([STUDIO_ID, 120]);
  });

  it('uses fresh POS-agent telemetry as the authoritative fiscal shift state', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: SHIFT_ID,
        studio_id: STUDIO_ID,
        opened_at: OPENED_AT,
        status: 'open',
        fiscal_enabled: false,
      })
      .mockResolvedValueOnce({ available: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockCacheGet.mockResolvedValueOnce({
      studio_id: STUDIO_ID,
      agent_id: 'pos-agent',
      terminal_online: true,
      fiscal_online: true,
      shift_status: 'open',
      timestamp_ms: Date.now(),
    });

    await expect(isFiscalShiftOpenForShift(SHIFT_ID)).resolves.toBe(true);
  });

  it('falls back only to a completed device shift_open command when telemetry is absent', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: SHIFT_ID,
        studio_id: STUDIO_ID,
        opened_at: OPENED_AT,
        status: 'open',
        fiscal_enabled: false,
      })
      .mockResolvedValueOnce({
        available: true,
      })
      .mockResolvedValueOnce({
        id: 'shift-open-transaction',
        transaction_type: 'shift_open',
        status: 'completed',
        initiated_at: OPENED_AT,
        completed_at: '2026-05-20T10:00:05.000Z',
        initiated_by: '33333333-3333-4333-8333-333333333333',
        initiated_by_name: 'Бутенко Оля',
      });

    await expect(isFiscalShiftOpenForShift(SHIFT_ID)).resolves.toBe(true);
  });

  it('exposes ATOL-confirmed fiscal status with opener metadata from the shift command', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ available: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'shift-open-transaction',
        transaction_type: 'shift_open',
        status: 'processing',
        initiated_at: OPENED_AT,
        completed_at: null,
        initiated_by: '33333333-3333-4333-8333-333333333333',
        initiated_by_name: 'Бутенко Оля',
      });
    mockCacheGet.mockResolvedValueOnce({
      studio_id: STUDIO_ID,
      agent_id: 'pos-agent',
      terminal_online: true,
      fiscal_online: true,
      shift_status: 'open',
      timestamp_ms: 1_790_000_000_000,
    });

    const shift = await withFiscalShiftDeviceStatus({
      id: SHIFT_ID,
      employee_id: '33333333-3333-4333-8333-333333333333',
      studio_id: STUDIO_ID,
      shift_number: 17,
      opened_at: OPENED_AT,
      closed_at: null,
      cash_at_open: 1290,
      cash_at_close: null,
      expected_cash: null,
      fiscal_enabled: false,
      status: 'open',
      total_sales: 0,
      total_refunds: 0,
      receipt_count: 0,
      cash_collected: null,
      collection_count: null,
      notes: null,
    });

    expect(shift.fiscal_enabled).toBe(true);
    expect(shift.fiscal_status).toMatchObject({
      ready: true,
      available: true,
      source: 'telemetry',
      shift_status: 'open',
      opened_at: OPENED_AT,
      opened_by: 'Бутенко Оля',
      command_status: 'completed',
    });
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining(`SET status = 'completed'`),
      ['shift-open-transaction', 1_790_000_000_000],
    );
  });

  it('caches valid POS telemetry snapshots by studio', async () => {
    await cachePosTelemetrySnapshot({
      studio_id: STUDIO_ID,
      agent_id: 'pos-agent',
      terminal_online: true,
      fiscal_online: false,
      shift_status: 'closed',
      timestamp_ms: 1_790_000_000_000,
    });

    expect(mockCacheSet).toHaveBeenCalledWith(
      `pos:telemetry:${STUDIO_ID}`,
      {
        studio_id: STUDIO_ID,
        agent_id: 'pos-agent',
        terminal_online: true,
        fiscal_online: false,
        shift_status: 'closed',
        timestamp_ms: 1_790_000_000_000,
      },
      expect.any(Number),
    );
  });

  it('reconciles a waiting shift_open transaction when ATOL telemetry already reports open', async () => {
    mockCacheGet.mockResolvedValueOnce({
      studio_id: STUDIO_ID,
      agent_id: 'pos-agent',
      terminal_online: true,
      fiscal_online: true,
      shift_status: 'open',
      timestamp_ms: 1_790_000_000_000,
    });

    await expect(reconcileFiscalShiftTransactionFromTelemetry({
      id: 'shift-open-transaction',
      studio_id: STUDIO_ID,
      transaction_type: 'shift_open',
      status: 'processing',
      error_message: null,
      terminal_response: null,
      initiated_at: OPENED_AT,
    })).resolves.toMatchObject({
      status: 'completed',
      error_message: null,
    });
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining(`SET status = 'completed'`),
      ['shift-open-transaction', 1_790_000_000_000],
    );
  });
});

const TELEMETRY_TTL_MS = 90_000; // POS_TELEMETRY_CACHE_TTL_SEC * 1000

function telemetrySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    studio_id: STUDIO_ID,
    agent_id: 'pos-agent',
    terminal_online: true,
    fiscal_online: true,
    shift_status: 'open',
    timestamp_ms: Date.now(),
    ...overrides,
  };
}

describe('isTelemetryFresh — граница TTL', () => {
  const TS = 1_790_000_000_000;

  it('снимок ровно на границе TTL (now - ts === 90000) → свежий', () => {
    expect(isTelemetryFresh(telemetrySnapshot({ timestamp_ms: TS }), TS + TELEMETRY_TTL_MS)).toBe(true);
  });

  it('снимок на 1мс старше границы TTL → устаревший', () => {
    expect(isTelemetryFresh(telemetrySnapshot({ timestamp_ms: TS }), TS + TELEMETRY_TTL_MS + 1)).toBe(false);
  });

  it('null-снимок → не свежий', () => {
    expect(isTelemetryFresh(null, TS)).toBe(false);
  });
});

describe('getTerminalGateState — мягкая деградация гарда', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
  });

  it('свежий terminal_online=false → blocked, reason fresh_offline', async () => {
    mockCacheGet.mockResolvedValueOnce(telemetrySnapshot({ terminal_online: false }));

    await expect(getTerminalGateState(STUDIO_ID)).resolves.toMatchObject({
      blocked: true,
      terminalOnline: false,
      reason: 'fresh_offline',
    });
  });

  it('свежий terminal_online=true → не блокируем, reason fresh_online', async () => {
    mockCacheGet.mockResolvedValueOnce(telemetrySnapshot({ terminal_online: true }));

    await expect(getTerminalGateState(STUDIO_ID)).resolves.toMatchObject({
      blocked: false,
      terminalOnline: true,
      reason: 'fresh_online',
    });
  });

  it('снимок старше TTL → не блокируем (stale), terminalOnline=null', async () => {
    mockCacheGet.mockResolvedValueOnce(
      telemetrySnapshot({ terminal_online: false, timestamp_ms: Date.now() - TELEMETRY_TTL_MS - 5_000 }),
    );

    await expect(getTerminalGateState(STUDIO_ID)).resolves.toMatchObject({
      blocked: false,
      terminalOnline: null,
      reason: 'stale',
    });
  });

  it('нет снимка в кэше → не блокируем (no_telemetry), terminalOnline=null', async () => {
    mockCacheGet.mockResolvedValueOnce(null);

    await expect(getTerminalGateState(STUDIO_ID)).resolves.toMatchObject({
      blocked: false,
      terminalOnline: null,
      checkedAt: null,
      reason: 'no_telemetry',
    });
  });

  it('частичный снимок без terminal_online → fail-open (нормализация → null → no_telemetry)', async () => {
    // normalizeTelemetrySnapshot вернёт null (нет terminal_online) → гард деградирует
    // мягко, не блокирует приём карты. Закрепляем «частичный снимок = не блокируем».
    mockCacheGet.mockResolvedValueOnce({
      studio_id: STUDIO_ID,
      agent_id: 'pos-agent',
      fiscal_online: true,
      shift_status: 'open',
      timestamp_ms: Date.now(),
    });

    await expect(getTerminalGateState(STUDIO_ID)).resolves.toMatchObject({
      blocked: false,
      terminalOnline: null,
      reason: 'no_telemetry',
    });
  });
});

describe('normalizeTelemetrySnapshot fail-open (через cachePosTelemetrySnapshot)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheSet.mockResolvedValue(undefined);
  });

  it('частичный снимок без terminal_online не кэшируется (нормализация → null)', async () => {
    await cachePosTelemetrySnapshot({
      studio_id: STUDIO_ID,
      agent_id: 'pos-agent',
      fiscal_online: true,
      shift_status: 'open',
      timestamp_ms: Date.now(),
    });

    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it('terminal_online не-boolean (строка) → нормализация null → не кэшируется', async () => {
    await cachePosTelemetrySnapshot(telemetrySnapshot({ terminal_online: 'true' }));

    expect(mockCacheSet).not.toHaveBeenCalled();
  });
});
