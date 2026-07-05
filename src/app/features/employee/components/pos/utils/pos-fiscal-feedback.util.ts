import type { PosReceiptPayment } from '../../../services/pos-api.service';

export type FiscalStatus = 'pending' | 'queued' | 'processing' | 'success' | 'failed' | 'skipped' | string;

export interface CreatedReceiptMessageInput {
  readonly receiptNumber: string;
  readonly total: number;
  readonly fiscalRequired: boolean;
}

export function receiptPaymentsRequireFiscal(payments: readonly PosReceiptPayment[]): boolean {
  return payments.some(payment =>
    payment.amount > 0
    && (payment.payment_type === 'cash' || payment.payment_type === 'card' || payment.payment_type === 'sbp')
  );
}

export function fiscalErrorSummary(message?: string | null): string {
  const trimmed = message?.trim();
  if (!trimmed) return 'Ошибка фискализации';

  const normalized = trimmed.toLocaleLowerCase('ru-RU');
  if (normalized.includes('нет бумаги')) return 'Нет бумаги в ККТ';
  if (normalized.startsWith('банк одобрил оплату')) return trimmed;

  return trimmed.replace(/^DLL error:\s*/i, '').trim();
}

export function fiscalFailureEmployeeMessage(message?: string | null): string {
  const summary = fiscalErrorSummary(message);
  if (summary === 'Нет бумаги в ККТ') {
    return 'Нет бумаги в ККТ. Вставьте бумагу и повторите фискализацию чека. Не пробивайте оплату повторно без сверки терминала.';
  }
  if (summary.toLocaleLowerCase('ru-RU').startsWith('банк одобрил оплату')) return summary;

  return `Чек не фискализирован: ${summary}. Проверьте ККТ и повторите фискализацию.`;
}

export function createdReceiptMessage(input: CreatedReceiptMessageInput): string {
  const base = `Чек ${input.receiptNumber} · ${input.total}₽`;
  return input.fiscalRequired
    ? `${base}. Ожидаем фискализацию на ККТ`
    : base;
}

export function isFinalFiscalStatus(status: FiscalStatus): boolean {
  return status === 'success' || status === 'failed' || status === 'skipped';
}
