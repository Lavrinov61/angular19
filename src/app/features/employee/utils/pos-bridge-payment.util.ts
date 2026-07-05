import { firstValueFrom } from 'rxjs';
import type {
  PosApiService,
  PosBridgePayRequest,
  PosBridgeTransaction,
} from '../services/pos-api.service';

type BridgePaymentApi = Pick<PosApiService, 'bridgePay' | 'getBridgeTransaction'>;
type TransactionPollApi = Pick<PosApiService, 'getBridgeTransaction'>;

export interface BridgePaymentWaitOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly delay?: (ms: number) => Promise<void>;
}

export interface BridgePaymentResult {
  readonly transactionId: string;
  readonly transaction: PosBridgeTransaction;
  readonly cardInfo?: string;
}

export const DEFAULT_BRIDGE_PAYMENT_TIMEOUT_MS = 180_000;

const DEFAULT_POLL_INTERVAL_MS = 1_200;
const FAILED_STATUSES = new Set(['failed', 'cancelled', 'timeout']);

/**
 * Исход «статус оплаты неизвестен»: терминал не вернул определённый результат
 * (таймаут, обрыв связи) либо backend пометил транзакцию `in_doubt`. Деньги
 * могли списаться, поэтому это НЕ обычный отказ: повторно оплату запускать нельзя.
 */
export class InDoubtPaymentError extends Error {
  readonly isInDoubt = true;
  readonly transactionId: string | null;

  constructor(message: string, transactionId: string | null = null) {
    super(message);
    this.name = 'InDoubtPaymentError';
    this.transactionId = transactionId;
  }
}

/** Сообщение по умолчанию для исхода `in_doubt` (без тире). */
export const IN_DOUBT_PAYMENT_MESSAGE =
  'Статус оплаты неизвестен, деньги могли списаться, проверьте, не запускайте оплату повторно';

export function isInDoubtPaymentError(value: unknown): value is InDoubtPaymentError {
  return value instanceof InDoubtPaymentError
    || (typeof value === 'object' && value !== null && (value as { isInDoubt?: unknown }).isInDoubt === true);
}

export async function startAndWaitForBridgePayment(
  posApi: BridgePaymentApi,
  request: PosBridgePayRequest,
  options: BridgePaymentWaitOptions = {},
): Promise<BridgePaymentResult> {
  const response = await firstValueFrom(posApi.bridgePay(request));
  if (!response.success || !response.transactionId) {
    throw new Error('Терминал не принял команду оплаты');
  }

  const transaction = await waitForBridgeTransaction(posApi, response.transactionId, options);
  return {
    transactionId: response.transactionId,
    transaction,
    cardInfo: response.cardInfo ?? extractBridgeCardInfo(transaction),
  };
}

export async function waitForBridgeTransaction(
  posApi: TransactionPollApi,
  transactionId: string,
  options: BridgePaymentWaitOptions = {},
): Promise<PosBridgeTransaction> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BRIDGE_PAYMENT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const delay = options.delay ?? defaultDelay;
  const startedAt = Date.now();
  let lastStatusError = false;

  while (Date.now() - startedAt <= timeoutMs) {
    let transaction: PosBridgeTransaction;
    try {
      transaction = await firstValueFrom(posApi.getBridgeTransaction(transactionId));
      lastStatusError = false;
    } catch {
      lastStatusError = true;
      await delay(pollIntervalMs);
      continue;
    }

    if (transaction.status === 'completed') {
      return transaction;
    }

    // Backend пометил оплату как «статус неизвестен» (op1 без определённого ответа).
    // Не зацикливаемся до таймаута: сразу выходим особым исходом, без авто-failed.
    if (transaction.status === 'in_doubt') {
      throw new InDoubtPaymentError(
        transaction.error_message || IN_DOUBT_PAYMENT_MESSAGE,
        transactionId,
      );
    }

    if (FAILED_STATUSES.has(transaction.status)) {
      throw new Error(transaction.error_message || 'Оплата по карте не прошла');
    }

    await delay(pollIntervalMs);
  }

  // Таймаут или потеря связи во время оплаты: результат неизвестен (деньги могли
  // списаться) — это in_doubt, а не отказ. Повторять оплату нельзя.
  throw new InDoubtPaymentError(
    lastStatusError
      ? 'Не удалось получить результат оплаты с терминала, деньги могли списаться, проверьте, не запускайте оплату повторно'
      : IN_DOUBT_PAYMENT_MESSAGE,
    transactionId,
  );
}

export function extractBridgeCardInfo(transaction: PosBridgeTransaction): string | undefined {
  const response = transaction.terminal_response;
  return cleanText(response?.card_mask)
    ?? cleanText(response?.approval_code)
    ?? cleanText(response?.rrn);
}

function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
