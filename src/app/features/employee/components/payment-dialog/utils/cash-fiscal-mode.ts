export type CashFiscalMode = 'fiscal' | 'skip';
export type ReceiptFiscalPaymentMethod = 'cash' | 'card' | 'transfer' | 'sbp';
export type ReceiptFiscalShiftPreparationStatus = 'ready' | 'open-existing-shift' | 'open-new-shift' | 'unavailable';

export interface ReceiptFiscalShiftRef {
  readonly id: string;
  readonly fiscal_enabled: boolean;
}

export interface ReceiptFiscalShiftPreparation {
  readonly status: ReceiptFiscalShiftPreparationStatus;
}

export function cashFiscalShiftId(mode: CashFiscalMode, shiftId: string | null): string | undefined {
  return mode === 'skip' ? undefined : shiftId ?? undefined;
}

export function receiptFiscalShiftId(
  method: ReceiptFiscalPaymentMethod,
  cashMode: CashFiscalMode,
  shift: ReceiptFiscalShiftRef | null,
): string | undefined {
  if (method === 'cash') {
    if (cashMode === 'skip') return undefined;
    return shift?.fiscal_enabled ? shift.id : undefined;
  }

  if (method === 'card' || method === 'sbp') {
    return shift?.fiscal_enabled ? shift.id : undefined;
  }

  return shift?.id;
}

export function receiptFiscalShiftPreparation(
  method: ReceiptFiscalPaymentMethod,
  cashMode: CashFiscalMode,
  shift: ReceiptFiscalShiftRef | null,
  hasStudio: boolean,
): ReceiptFiscalShiftPreparation {
  const requiresFiscalShift = method === 'card'
    || method === 'sbp'
    || (method === 'cash' && cashMode === 'fiscal');

  if (!requiresFiscalShift) return { status: 'ready' };
  if (shift?.fiscal_enabled) return { status: 'ready' };
  if (shift) return { status: 'open-existing-shift' };
  return hasStudio ? { status: 'open-new-shift' } : { status: 'unavailable' };
}
