import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processFiscalRetries } from './pos-fiscal-retry-sweep.service.js';

const findFiscalRetryCandidates = vi.hoisted(() => vi.fn());
const enqueueFiscal = vi.hoisted(() => vi.fn());
const breakerAllow = vi.hoisted(() => vi.fn());

const posConfig = vi.hoisted(() => ({
  fiscalAutoretryEnabled: true,
  fiscalAutoretryMax: 5,
  fiscalAutoretryMaxAgeMinutes: 1440,
  fiscalSweepIncludeStuck: false,
  fiscalAutoretryStaleMinutes: 15,
  fiscalAutoretryIntervalMs: 300000,
}));

vi.mock('../config/index.js', () => ({ config: { pos: posConfig } }));
vi.mock('./pos.service.js', () => ({ findFiscalRetryCandidates }));
vi.mock('../workers/pos-fiscal-worker.js', () => ({ enqueueFiscal }));
vi.mock('../utils/circuit-breaker.js', () => ({
  getBreaker: () => ({ allow: breakerAllow }),
  SERVICE_BREAKERS: { atolFiscal: { name: 'atol-fiscal' } },
}));
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function candidate(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'rcpt-1',
    receipt_number: 'R-001',
    total: 525,
    fiscal_status: 'failed',
    studio_id: 'studio-1',
    ...over,
  };
}

describe('processFiscalRetries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    posConfig.fiscalAutoretryEnabled = true;
    breakerAllow.mockReturnValue(true);
    enqueueFiscal.mockResolvedValue(undefined);
  });

  it('флаг OFF — sweep не запускается', async () => {
    posConfig.fiscalAutoretryEnabled = false;
    await processFiscalRetries();
    expect(findFiscalRetryCandidates).not.toHaveBeenCalled();
    expect(enqueueFiscal).not.toHaveBeenCalled();
  });

  it('breaker OPEN (allow=false) — пропускаем тик', async () => {
    breakerAllow.mockReturnValue(false);
    await processFiscalRetries();
    expect(findFiscalRetryCandidates).not.toHaveBeenCalled();
    expect(enqueueFiscal).not.toHaveBeenCalled();
  });

  it('передаёт в детектор кандидатов окно/макс/includeStuck из конфига (P1.2)', async () => {
    findFiscalRetryCandidates.mockResolvedValue([]);
    await processFiscalRetries();
    expect(findFiscalRetryCandidates).toHaveBeenCalledWith({
      maxAttempts: 5,
      maxAgeMinutes: 1440,
      includeStuck: false,
      staleMinutes: 15,
    });
  });

  it('повторно ставит fiscal-чек: payments:[] (дефолт card) и operation:sale', async () => {
    findFiscalRetryCandidates.mockResolvedValue([candidate()]);
    await processFiscalRetries();
    expect(enqueueFiscal).toHaveBeenCalledWith({
      receiptId: 'rcpt-1',
      receiptNumber: 'R-001',
      items: [],
      total: 525,
      payments: [],
      operation: 'sale',
    });
  });

  it('обрабатывает несколько кандидатов; ошибка одного не валит остальных', async () => {
    findFiscalRetryCandidates.mockResolvedValue([
      candidate({ id: 'rcpt-1' }),
      candidate({ id: 'rcpt-2', fiscal_status: 'pending' }),
    ]);
    enqueueFiscal.mockRejectedValueOnce(new Error('atol down'));
    await processFiscalRetries();
    expect(enqueueFiscal).toHaveBeenCalledTimes(2);
  });

  it('пустой список кандидатов — enqueueFiscal не зовётся', async () => {
    findFiscalRetryCandidates.mockResolvedValue([]);
    await processFiscalRetries();
    expect(enqueueFiscal).not.toHaveBeenCalled();
  });
});
