import { of, throwError } from 'rxjs';
import type {
  PosBridgePayRequest,
  PosBridgePayResponse,
  PosBridgeTransaction,
} from '../services/pos-api.service';
import type { Observable } from 'rxjs';
import {
  extractBridgeCardInfo,
  InDoubtPaymentError,
  isInDoubtPaymentError,
  startAndWaitForBridgePayment,
  waitForBridgeTransaction,
} from './pos-bridge-payment.util';

interface BridgeApi {
  bridgePay: (request: PosBridgePayRequest) => Observable<PosBridgePayResponse>;
  getBridgeTransaction: (transactionId: string) => Observable<PosBridgeTransaction>;
}

const paymentRequest: PosBridgePayRequest = {
  amount: 2800,
  orderId: 'order-1',
  studioId: 'studio-1',
};

describe('pos bridge payment utils', () => {
  it('waits for terminal completion after bridgePay queues the payment', async () => {
    const transactions: PosBridgeTransaction[] = [
      {
        id: 'tx-1',
        status: 'processing',
        transaction_type: 'payment',
        error_message: null,
        terminal_response: null,
      },
      {
        id: 'tx-1',
        status: 'completed',
        transaction_type: 'payment',
        error_message: null,
        terminal_response: { card_mask: '****4242', approval_code: 'A12345' },
      },
    ];
    const api: BridgeApi = {
      bridgePay: () => of({ success: true, transactionId: 'tx-1' }),
      getBridgeTransaction: () => of(transactions.shift() ?? transactions[0]),
    };

    const result = await startAndWaitForBridgePayment(api, paymentRequest, {
      pollIntervalMs: 0,
      delay: () => Promise.resolve(),
    });

    expect(result.transactionId).toBe('tx-1');
    expect(result.cardInfo).toBe('****4242');
  });

  it('forwards the full request (snapshot + pricing) to bridgePay for order-first persistence', async () => {
    let captured: PosBridgePayRequest | null = null;
    const api: BridgeApi = {
      bridgePay: (request) => {
        captured = request;
        return of({ success: true, transactionId: 'tx-order-first' });
      },
      getBridgeTransaction: () => of({
        id: 'tx-order-first',
        status: 'completed',
        transaction_type: 'payment',
        error_message: null,
        terminal_response: null,
      }),
    };

    const request: PosBridgePayRequest = {
      amount: 2800,
      orderId: 'POS-SVC-1',
      studioId: 'studio-1',
      snapshot: {
        items: [],
        subtotal: 2800,
        total: 2800,
        studioId: 'studio-1',
        source: 'cart',
      },
      pricing: {
        category_slug: 'portrait',
        selected_options: [{ option_slug: 'portrait-30', quantity: 1 }],
        delivery_method: 'pickup',
        apply_volume_discount: true,
      },
    };

    await startAndWaitForBridgePayment(api, request, {
      pollIntervalMs: 0,
      delay: () => Promise.resolve(),
    });

    expect(captured).toEqual(request);
    expect(captured!.snapshot?.studioId).toBe('studio-1');
    expect(captured!.snapshot?.source).toBe('cart');
    expect(captured!.pricing?.category_slug).toBe('portrait');
  });

  it('rejects queued terminal payments that later fail', async () => {
    const api: BridgeApi = {
      bridgePay: () => of({ success: true, transactionId: 'tx-2' }),
      getBridgeTransaction: () => of({
        id: 'tx-2',
        status: 'failed',
        transaction_type: 'payment',
        error_message: 'Операция отклонена банком',
        terminal_response: null,
      }),
    };

    let error: unknown;
    try {
      await startAndWaitForBridgePayment(api, paymentRequest, {
        pollIntervalMs: 0,
        delay: () => Promise.resolve(),
      });
    } catch (err) {
      error = err;
    }

    expect(error instanceof Error).toBe(true);
    expect(error instanceof Error ? error.message : '').toBe('Операция отклонена банком');
  });

  it('returns the in_doubt outcome without looping when the backend marks the payment uncertain', async () => {
    let attempts = 0;
    const api = {
      getBridgeTransaction: () => {
        attempts += 1;
        return of({
          id: 'tx-doubt',
          status: 'in_doubt',
          transaction_type: 'payment',
          error_message: null,
          terminal_response: null,
        });
      },
    };

    let error: unknown;
    try {
      await waitForBridgeTransaction(api, 'tx-doubt', {
        pollIntervalMs: 0,
        delay: () => Promise.resolve(),
      });
    } catch (err) {
      error = err;
    }

    expect(error instanceof InDoubtPaymentError).toBe(true);
    expect(isInDoubtPaymentError(error)).toBe(true);
    // Не зацикливаемся: одна выборка статуса, не доходим до таймаута 180с.
    expect(attempts).toBe(1);
    expect((error as InDoubtPaymentError).transactionId).toBe('tx-doubt');
  });

  it('treats a terminal timeout as an in_doubt outcome, not a failure', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const timestamps = [0, 0, 200_000];
    nowSpy.mockImplementation(() => timestamps.shift() ?? 200_000);
    const api = {
      getBridgeTransaction: () => of({
        id: 'tx-timeout',
        status: 'processing',
        transaction_type: 'payment',
        error_message: null,
        terminal_response: null,
      }),
    };

    let error: unknown;
    try {
      await waitForBridgeTransaction(api, 'tx-timeout', {
        pollIntervalMs: 0,
        delay: () => Promise.resolve(),
      });
    } catch (err) {
      error = err;
    } finally {
      nowSpy.mockRestore();
    }

    expect(error instanceof InDoubtPaymentError).toBe(true);
    expect((error as InDoubtPaymentError).transactionId).toBe('tx-timeout');
  });

  it('keeps polling through transient transaction status errors', async () => {
    let attempts = 0;
    const api = {
      getBridgeTransaction: () => {
        attempts += 1;
        if (attempts === 1) {
          return throwError(() => new Error('network'));
        }
        return of({
          id: 'tx-3',
          status: 'completed',
          transaction_type: 'payment',
          error_message: null,
          terminal_response: null,
        });
      },
    };

    const result = await waitForBridgeTransaction(api, 'tx-3', {
      pollIntervalMs: 0,
      delay: () => Promise.resolve(),
    });

    expect(result.status).toBe('completed');
    expect(attempts).toBe(2);
  });

  it('keeps polling past 90 seconds while the terminal operation is still processing', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const timestamps = [0, 0, 91_000, 121_000];
    nowSpy.mockImplementation(() => timestamps.shift() ?? 121_000);
    let attempts = 0;
    const api = {
      getBridgeTransaction: () => {
        attempts += 1;
        return of({
          id: 'tx-long',
          status: attempts < 3 ? 'processing' : 'completed',
          transaction_type: 'payment',
          error_message: null,
          terminal_response: null,
        });
      },
    };

    try {
      const result = await waitForBridgeTransaction(api, 'tx-long', {
        pollIntervalMs: 0,
        delay: () => Promise.resolve(),
      });

      expect(result.status).toBe('completed');
      expect(attempts).toBe(3);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('extracts card info from the terminal response', () => {
    expect(extractBridgeCardInfo({
      id: 'tx-4',
      status: 'completed',
      transaction_type: 'payment',
      error_message: null,
      terminal_response: { card_mask: ' ****1234 ', rrn: ' 999 ' },
    })).toBe('****1234');
  });
});
