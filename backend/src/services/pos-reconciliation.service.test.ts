import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetMockDb } from '../test-utils/index.js';

const mockRecordBusinessEvent = vi.fn();
const mockFindPosAgentId = vi.fn();
const posConfig = { terminalGateEnabled: false, reconAlertEnabled: false };

vi.mock('../database/db.js', () => ({ default: mockDb }));

vi.mock('../config/index.js', () => ({
  config: {
    get pos() {
      return posConfig;
    },
  },
}));

vi.mock('./business-observability.service.js', () => ({
  recordBusinessEvent: mockRecordBusinessEvent,
}));

vi.mock('./cash-drawer.service.js', () => ({
  findPosAgentId: mockFindPosAgentId,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}));

const {
  parseSettlementReport,
  evaluateReconciliation,
  computeShiftCardNet,
  finalizeShiftReconciliation,
  enqueueShiftReconciliation,
} = await import('./pos-reconciliation.service.js');

// Реальный полный отчёт op59 (pos_transactions 90c8b6e3, терминал 11087928).
const FULL_REPORT = [
  'Своё Фото',
  'г Ростов-на-Дону,пер Соборный,д',
  '               21',
  '         СВЕРКА ИТОГОВ',
  '02.06.26                19:20:08',
  'ID ТЕРМИНАЛA:           11087928',
  '--------------------------------',
  '              ОТЧЕТ',
  '--------------------------------',
  'ПЕРВ. ОПЕР:   23/05/26  09:49:00',
  'ПОСЛ. ОПЕР:   02/06/26  18:58:21',
  '--------------------------------',
  'ОПЛАТА                ОПЕР:  146',
  'СУММА :            68\'361.50 РУБ',
  'ОТМЕНА                ОПЕР:    1',
  'СУММА :                 1.00 РУБ',
  'ОПЛАТА ПО QR          ОПЕР:   14',
  'СУММА :             9\'656.00 РУБ',
  '================================',
  'ОПЕРАЦИИ ПО КАРТАМ:68\'360.50 RUB',
  'ОПЕРАЦИИ ПО QR:     9\'656.00 RUB',
  'ОПЕРАЦИИ ПО БИО:        0.00 RUB',
  'ОПЕРАЦИИ Bluetooth:     0.00 RUB',
  '--------------------------------',
  'ИТОГО :            78\'016.50 RUB',
  '        ОТЧЕТ ЗАВЕРШЕН',
].join('\n');

// Реальный пустой отчёт (pos_transactions 8dc0410c — повторная op59, батч пуст).
const EMPTY_REPORT = [
  'Своё Фото',
  'г Ростов-на-Дону,пер Соборный,д',
  '               21',
  '         СВЕРКА ИТОГОВ',
  '02.06.26                20:44:13',
  'ID ТЕРМИНАЛA:           11087928',
  '--------------------------------',
  '              ОТЧЕТ',
  '--------------------------------',
  '        ОТЧЕТ ЗАВЕРШЕН',
].join('\n');

// Реальный битый win-1251 (pos_transactions aa24cbb3, status=failed).
const BROKEN_REPORT = '??? ?????? ??? ?????';

describe('parseSettlementReport', () => {
  it('полный отчёт: апостроф-разделитель, RUB латиницей → карты/QR/итого', () => {
    const parsed = parseSettlementReport(FULL_REPORT);
    expect(parsed.confident).toBe(true);
    expect(parsed.reason).toBe('parsed');
    expect(parsed.cardSum).toBe(68360.5);
    expect(parsed.qrSum).toBe(9656.0);
    expect(parsed.totalSum).toBe(78016.5);
  });

  it('пустой отчёт «ОТЧЕТ ЗАВЕРШЕН» без операций → confident:false / no_operations', () => {
    const parsed = parseSettlementReport(EMPTY_REPORT);
    expect(parsed.confident).toBe(false);
    expect(parsed.reason).toBe('no_operations');
    expect(parsed.cardSum).toBeNull();
    expect(parsed.totalSum).toBeNull();
  });

  it('битый win-1251 (mojibake ???) → confident:false / parse_error', () => {
    const parsed = parseSettlementReport(BROKEN_REPORT);
    expect(parsed.confident).toBe(false);
    expect(parsed.reason).toBe('parse_error');
  });

  it('U+FFFD mojibake → parse_error', () => {
    const parsed = parseSettlementReport('��� �������� ��� ������');
    expect(parsed.confident).toBe(false);
    expect(parsed.reason).toBe('parse_error');
  });

  it('пустая строка / null → empty', () => {
    expect(parseSettlementReport('').reason).toBe('empty');
    expect(parseSettlementReport(null).reason).toBe('empty');
    expect(parseSettlementReport(undefined).reason).toBe('empty');
  });
});

describe('evaluateReconciliation', () => {
  it('касса card совпадает с картами терминала (в пределах порога) → ok', () => {
    const parsed = parseSettlementReport(FULL_REPORT);
    const result = evaluateReconciliation({ cashCardNet: 68360.5, parsed });
    expect(result.status).toBe('ok');
    expect(result.terminalCompareSum).toBe(68360.5);
    expect(result.diff).toBe(0);
  });

  it('касса card отличается от карт терминала → mismatch', () => {
    const parsed = parseSettlementReport(FULL_REPORT);
    // Инцидент HGKP: касса безнал 76166.50, терминал картами 68360.50.
    const result = evaluateReconciliation({ cashCardNet: 76166.5, parsed });
    expect(result.status).toBe('mismatch');
    expect(result.diff).toBe(7806);
  });

  it('пустой отчёт → no_operations (НЕ ложный mismatch)', () => {
    const parsed = parseSettlementReport(EMPTY_REPORT);
    const result = evaluateReconciliation({ cashCardNet: 5000, parsed });
    expect(result.status).toBe('no_operations');
    expect(result.diff).toBeNull();
  });

  it('битый отчёт → low_confidence (не mismatch)', () => {
    const parsed = parseSettlementReport(BROKEN_REPORT);
    const result = evaluateReconciliation({ cashCardNet: 5000, parsed });
    expect(result.status).toBe('low_confidence');
    expect(result.diff).toBeNull();
  });

  it('копеечное расхождение в пределах порога 1 ₽ → ok', () => {
    const parsed = parseSettlementReport(FULL_REPORT);
    const result = evaluateReconciliation({ cashCardNet: 68361.0, parsed });
    expect(result.status).toBe('ok');
  });
});

describe('computeShiftCardNet', () => {
  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
  });

  it('агрегирует только card+completed по смене (без transfer/cash)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ sum: '76166.50' });
    const net = await computeShiftCardNet('shift-1');
    expect(net).toBe(76166.5);
    const [sql, params] = vi.mocked(mockDb.queryOne).mock.calls[0] ?? [];
    expect(String(sql)).toContain("rp.payment_type = 'card'");
    expect(String(sql)).toContain("rp.status = 'completed'");
    expect(String(sql)).not.toContain('transfer');
    expect(params).toEqual(['shift-1']);
  });
});

describe('finalizeShiftReconciliation', () => {
  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
    posConfig.reconAlertEnabled = false;
  });

  it('чужой transaction_id (нет pending-строки) → no-op, UPDATE не вызывается', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);
    await finalizeShiftReconciliation('not-a-settlement', FULL_REPORT, 'completed');
    expect(mockDb.query).not.toHaveBeenCalled();
    expect(mockRecordBusinessEvent).not.toHaveBeenCalled();
  });

  it('pending-строка + полный отчёт + status=completed → запись с парсингом', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'rec-1',
      shift_id: 'shift-1',
      studio_id: 'studio-1',
      cash_card_sum: '68360.50',
    });
    await finalizeShiftReconciliation('settlement-tx-1', FULL_REPORT, 'completed');

    const [sql, params] = vi.mocked(mockDb.query).mock.calls[0] ?? [];
    expect(String(sql)).toContain('UPDATE pos_shift_reconciliation');
    // status (5-й параметр) = ok, terminal_card_sum = 68360.5
    expect(params?.[1]).toBe(68360.5);
    expect(params?.[4]).toBe('ok');
    // recordBusinessEvent вызван (наблюдаемость), но без alert (флаг OFF).
    expect(mockRecordBusinessEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordBusinessEvent.mock.calls[0][0].alert).toBe(false);
  });

  it('settlement status=failed → settlement_failed', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'rec-2',
      shift_id: 'shift-2',
      studio_id: 'studio-1',
      cash_card_sum: '5000.00',
    });
    await finalizeShiftReconciliation('settlement-tx-2', null, 'failed');
    const [, params] = vi.mocked(mockDb.query).mock.calls[0] ?? [];
    expect(params?.[4]).toBe('settlement_failed');
  });

  it('mismatch при флаге POS_RECON_ALERT_ENABLED=true → alert выставлен', async () => {
    posConfig.reconAlertEnabled = true;
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'rec-3',
      shift_id: 'shift-3',
      studio_id: 'studio-1',
      cash_card_sum: '76166.50',
    });
    await finalizeShiftReconciliation('settlement-tx-3', FULL_REPORT, 'completed');
    const event = mockRecordBusinessEvent.mock.calls[0][0];
    expect(event.metadata.status).toBe('mismatch');
    expect(event.alert).toMatchObject({ key: 'pos_reconciliation_studio-1' });
  });

  it('mismatch при флаге OFF (default) → alert НЕ выставлен', async () => {
    posConfig.reconAlertEnabled = false;
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'rec-4',
      shift_id: 'shift-4',
      studio_id: 'studio-1',
      cash_card_sum: '76166.50',
    });
    await finalizeShiftReconciliation('settlement-tx-4', FULL_REPORT, 'completed');
    expect(mockRecordBusinessEvent.mock.calls[0][0].alert).toBe(false);
  });
});

describe('enqueueShiftReconciliation', () => {
  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
    mockFindPosAgentId.mockResolvedValue('agent-1');
  });

  it('существующая строка сверки → не дублирует, op59 не слать', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ id: 'rec-existing', status: 'ok' });
    const result = await enqueueShiftReconciliation('shift-1', 'studio-1');
    expect(result.enqueued).toBe(false);
    expect(result.status).toBe('ok');
    expect(mockFindPosAgentId).not.toHaveBeenCalled();
  });

  it('нет агента → no_agent, op59 не слать', async () => {
    mockFindPosAgentId.mockResolvedValue(null);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(null) // нет существующей строки
      .mockResolvedValueOnce({ sum: '5000.00' }) // computeShiftCardNet
      .mockResolvedValueOnce(null) // recentSettlement
      .mockResolvedValueOnce({ id: 'rec-noagent' }); // insert
    const result = await enqueueShiftReconciliation('shift-2', 'studio-1');
    expect(result.status).toBe('no_agent');
    expect(result.enqueued).toBe(false);
  });

  it('недавняя завершённая op59 → дедуп, no_operations, повторно не слать', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(null) // нет существующей строки
      .mockResolvedValueOnce({ sum: '5000.00' }) // computeShiftCardNet
      .mockResolvedValueOnce({ id: 'recent-settlement' }) // recentSettlement найден
      .mockResolvedValueOnce({ id: 'rec-dedup' }); // insert
    const result = await enqueueShiftReconciliation('shift-3', 'studio-1');
    expect(result.status).toBe('no_operations');
    expect(result.enqueued).toBe(false);
    // INSERT bank_settlement (op59) НЕ вызывался — батч обнулять повторно нельзя.
    const insertSettlementCall = vi.mocked(mockDb.queryOne).mock.calls.find(
      (call) => String(call[0]).includes('INSERT INTO pos_transactions'),
    );
    expect(insertSettlementCall).toBeUndefined();
  });

  it('нет дедупа + агент онлайн → ставит op59, статус pending', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(null) // нет существующей строки
      .mockResolvedValueOnce({ sum: '5000.00' }) // computeShiftCardNet
      .mockResolvedValueOnce(null) // recentSettlement нет
      .mockResolvedValueOnce({ id: 'settlement-new' }) // INSERT bank_settlement
      .mockResolvedValueOnce({ id: 'rec-new' }); // INSERT reconciliation
    const result = await enqueueShiftReconciliation('shift-4', 'studio-1');
    expect(result.status).toBe('pending');
    expect(result.enqueued).toBe(true);
    const insertSettlementCall = vi.mocked(mockDb.queryOne).mock.calls.find(
      (call) => String(call[0]).includes('INSERT INTO pos_transactions'),
    );
    expect(insertSettlementCall).toBeDefined();
    expect(String(insertSettlementCall?.[0])).toContain("'bank_settlement'");
  });
});
