import { firstValueFrom } from 'rxjs';

import type { PosApiService, PosReceipt } from '../services/pos-api.service';
import {
  fiscalFailureEmployeeMessage,
  isFinalFiscalStatus,
  type FiscalStatus,
} from '../components/pos/utils/pos-fiscal-feedback.util';

type ReceiptFiscalApi = Pick<PosApiService, 'getFiscalStatus'>;

export interface ReceiptFiscalStatusSnapshot {
  readonly fiscal_status: FiscalStatus;
  readonly fiscal_attempts: number;
  readonly fiscal_last_error: string | null;
}

export interface ReceiptFiscalWaitOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly delay?: (ms: number) => Promise<void>;
  readonly initialStatus?: ReceiptFiscalStatusSnapshot | null;
}

export const DEFAULT_RECEIPT_FISCAL_TIMEOUT_MS = 90_000;

const DEFAULT_RECEIPT_FISCAL_POLL_INTERVAL_MS = 1_500;

export async function waitForReceiptFiscalization(
  posApi: ReceiptFiscalApi,
  receiptId: string,
  options: ReceiptFiscalWaitOptions = {},
): Promise<ReceiptFiscalStatusSnapshot> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RECEIPT_FISCAL_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_RECEIPT_FISCAL_POLL_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  const startedAt = Date.now();
  let lastStatusError = false;

  if (options.initialStatus) {
    const resolved = resolveFiscalStatus(options.initialStatus);
    if (resolved) return resolved;
  }

  while (Date.now() - startedAt <= timeoutMs) {
    let status: ReceiptFiscalStatusSnapshot;
    try {
      status = await firstValueFrom(posApi.getFiscalStatus(receiptId));
      lastStatusError = false;
    } catch {
      lastStatusError = true;
      await delay(pollIntervalMs);
      continue;
    }

    const resolved = resolveFiscalStatus(status);
    if (resolved) return resolved;

    await delay(pollIntervalMs);
  }

  throw new Error(
    lastStatusError
      ? 'Не удалось получить статус фискализации чека'
      : fiscalTimeoutMessage(timeoutMs),
  );
}

export function receiptFiscalInitialStatus(receipt: PosReceipt): ReceiptFiscalStatusSnapshot | null {
  if (!receipt.fiscal_status) return null;
  return {
    fiscal_status: receipt.fiscal_status,
    fiscal_attempts: receipt.fiscal_attempts ?? 0,
    fiscal_last_error: receipt.fiscal_last_error ?? null,
  };
}

export function cardFiscalProblemMessage(reason: string): string {
  const trimmed = reason.trim() || 'Проверьте ККТ и повторите фискализацию.';
  return `Банк одобрил оплату, но чек не пробит. ${trimmed}`;
}

export function approvedCardFiscalRetryMessage(reason: string): string {
  const message = cardFiscalProblemMessage(reason);
  const normalized = message.toLocaleLowerCase('ru-RU');
  const paperHint = normalized.includes('вставьте бумагу')
    ? ''
    : ' Вставьте бумагу в ККТ, если она закончилась.';
  const retryHint = normalized.includes('повторить чек') || normalized.includes('повторите фискализацию')
    ? ''
    : ' Нажмите «Повторить чек», чтобы пробить чек без повторной оплаты.';
  const paymentHint = normalized.includes('не запускайте оплату повторно')
    || normalized.includes('не пробивайте оплату повторно')
    ? ''
    : ' Не запускайте оплату повторно без сверки терминала.';

  return `${message}${paperHint}${retryHint}${paymentHint}`;
}

function resolveFiscalStatus(status: ReceiptFiscalStatusSnapshot): ReceiptFiscalStatusSnapshot | null {
  if (status.fiscal_status === 'success' || status.fiscal_status === 'skipped') {
    return status;
  }

  if (status.fiscal_status === 'failed' || isFinalFiscalStatus(status.fiscal_status)) {
    throw new Error(fiscalFailureEmployeeMessage(status.fiscal_last_error));
  }

  return null;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fiscalTimeoutMessage(timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `ККТ не подтвердила фискализацию за ${minutes} ${minuteWord(minutes)}`;
  }

  return `ККТ не подтвердила фискализацию за ${seconds} ${secondWord(seconds)}`;
}

function minuteWord(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'минуту';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'минуты';
  return 'минут';
}

function secondWord(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'секунду';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'секунды';
  return 'секунд';
}
