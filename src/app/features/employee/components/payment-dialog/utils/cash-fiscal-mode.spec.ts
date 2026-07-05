import { cashFiscalShiftId, receiptFiscalShiftId, receiptFiscalShiftPreparation } from './cash-fiscal-mode';

describe('cashFiscalShiftId', () => {
  it('uses the active shift when cash must be fiscalized', () => {
    expect(cashFiscalShiftId('fiscal', 'shift-1')).toBe('shift-1');
  });

  it('omits shift_id when cash must skip fiscalization', () => {
    expect(cashFiscalShiftId('skip', 'shift-1')).toBeUndefined();
  });
});

describe('receiptFiscalShiftId', () => {
  const fiscalShift = { id: 'shift-fiscal', fiscal_enabled: true };
  const nonFiscalShift = { id: 'shift-no-fiscal', fiscal_enabled: false };

  it('omits shift_id for cash without fiscalization', () => {
    expect(receiptFiscalShiftId('cash', 'skip', fiscalShift)).toBeUndefined();
    expect(receiptFiscalShiftId('cash', 'skip', nonFiscalShift)).toBeUndefined();
  });

  it('uses only a fiscal shift for cash with fiscalization', () => {
    expect(receiptFiscalShiftId('cash', 'fiscal', fiscalShift)).toBe('shift-fiscal');
    expect(receiptFiscalShiftId('cash', 'fiscal', nonFiscalShift)).toBeUndefined();
  });

  it('uses only a fiscal shift for card and SBP payments', () => {
    expect(receiptFiscalShiftId('card', 'fiscal', fiscalShift)).toBe('shift-fiscal');
    expect(receiptFiscalShiftId('sbp', 'fiscal', fiscalShift)).toBe('shift-fiscal');
    expect(receiptFiscalShiftId('card', 'fiscal', nonFiscalShift)).toBeUndefined();
    expect(receiptFiscalShiftId('sbp', 'fiscal', nonFiscalShift)).toBeUndefined();
    expect(receiptFiscalShiftId('card', 'fiscal', null)).toBeUndefined();
    expect(receiptFiscalShiftId('sbp', 'fiscal', null)).toBeUndefined();
  });

  it('keeps transfer behavior tied to the active shift when one exists', () => {
    expect(receiptFiscalShiftId('transfer', 'fiscal', fiscalShift)).toBe('shift-fiscal');
    expect(receiptFiscalShiftId('transfer', 'fiscal', nonFiscalShift)).toBe('shift-no-fiscal');
    expect(receiptFiscalShiftId('transfer', 'fiscal', null)).toBeUndefined();
  });
});

describe('receiptFiscalShiftPreparation', () => {
  const fiscalShift = { id: 'shift-fiscal', fiscal_enabled: true };
  const nonFiscalShift = { id: 'shift-no-fiscal', fiscal_enabled: false };

  it('continues when a fiscal shift is already open', () => {
    expect(receiptFiscalShiftPreparation('card', 'fiscal', fiscalShift, true).status).toBe('ready');
    expect(receiptFiscalShiftPreparation('sbp', 'fiscal', fiscalShift, true).status).toBe('ready');
    expect(receiptFiscalShiftPreparation('cash', 'fiscal', fiscalShift, true).status).toBe('ready');
  });

  it('offers to enable fiscal registrar on the current non-fiscal shift', () => {
    expect(receiptFiscalShiftPreparation('card', 'fiscal', nonFiscalShift, true).status).toBe('open-existing-shift');
    expect(receiptFiscalShiftPreparation('sbp', 'fiscal', nonFiscalShift, true).status).toBe('open-existing-shift');
    expect(receiptFiscalShiftPreparation('cash', 'fiscal', nonFiscalShift, true).status).toBe('open-existing-shift');
  });

  it('offers to open POS and fiscal shift when no shift exists but a studio is known', () => {
    expect(receiptFiscalShiftPreparation('card', 'fiscal', null, true).status).toBe('open-new-shift');
    expect(receiptFiscalShiftPreparation('sbp', 'fiscal', null, true).status).toBe('open-new-shift');
  });

  it('keeps cash without fiscalization available without a fiscal shift', () => {
    expect(receiptFiscalShiftPreparation('cash', 'skip', null, true).status).toBe('ready');
    expect(receiptFiscalShiftPreparation('cash', 'skip', nonFiscalShift, true).status).toBe('ready');
  });

  it('reports unavailable when fiscalization is required and no studio is known', () => {
    expect(receiptFiscalShiftPreparation('card', 'fiscal', null, false).status).toBe('unavailable');
    expect(receiptFiscalShiftPreparation('cash', 'fiscal', null, false).status).toBe('unavailable');
  });
});
