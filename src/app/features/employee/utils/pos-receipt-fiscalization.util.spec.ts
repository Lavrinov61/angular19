import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { Observable } from 'rxjs';

import type { PosApiService } from '../services/pos-api.service';
import {
  cardFiscalProblemMessage,
  waitForReceiptFiscalization,
  type ReceiptFiscalStatusSnapshot,
} from './pos-receipt-fiscalization.util';

type FiscalApi = Pick<PosApiService, 'getFiscalStatus'>;

describe('POS receipt fiscalization wait', () => {
  it('waits until a queued card receipt becomes fiscalized', async () => {
    const statuses: ReceiptFiscalStatusSnapshot[] = [
      { fiscal_status: 'queued', fiscal_attempts: 1, fiscal_last_error: null },
      { fiscal_status: 'processing', fiscal_attempts: 1, fiscal_last_error: null },
      { fiscal_status: 'success', fiscal_attempts: 1, fiscal_last_error: null },
    ];
    const api: FiscalApi = {
      getFiscalStatus: () => of(statuses.shift() ?? statuses[0]),
    };

    const result = await waitForReceiptFiscalization(api, 'receipt-1', {
      pollIntervalMs: 0,
      delay: () => Promise.resolve(),
    });

    expect(result.fiscal_status).toBe('success');
  });

  it('turns no-paper failures into an employee action instead of payment success', async () => {
    const api: FiscalApi = {
      getFiscalStatus: (): Observable<ReceiptFiscalStatusSnapshot> => of({
        fiscal_status: 'failed',
        fiscal_attempts: 1,
        fiscal_last_error: 'DLL error: ATOL error 44: Нет бумаги',
      }),
    };

    let error: unknown;
    try {
      await waitForReceiptFiscalization(api, 'receipt-2', {
        pollIntervalMs: 0,
        delay: () => Promise.resolve(),
      });
    } catch (err) {
      error = err;
    }

    expect(error instanceof Error).toBe(true);
    const message = error instanceof Error ? error.message : '';
    expect(message).toContain('Вставьте бумагу');
    expect(message).toContain('Не пробивайте оплату повторно');
    expect(cardFiscalProblemMessage(message)).toContain('Банк одобрил оплату, но чек не пробит');
    expect(cardFiscalProblemMessage(message)).not.toContain('Оплата прошла');
  });

  it('keeps checking fiscal status through transient status errors', async () => {
    let attempts = 0;
    const api: FiscalApi = {
      getFiscalStatus: () => {
        attempts += 1;
        if (attempts === 1) {
          return throwError(() => new Error('network'));
        }
        return of({
          fiscal_status: 'success',
          fiscal_attempts: 1,
          fiscal_last_error: null,
        });
      },
    };

    const result = await waitForReceiptFiscalization(api, 'receipt-3', {
      pollIntervalMs: 0,
      delay: () => Promise.resolve(),
    });

    expect(result.fiscal_status).toBe('success');
    expect(attempts).toBe(2);
  });

  it('does not wait forever when the KKT never returns a final status', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const timestamps = [0, 0, 31_000, 61_000];
    nowSpy.mockImplementation(() => timestamps.shift() ?? 61_000);
    const api: FiscalApi = {
      getFiscalStatus: () => of({
        fiscal_status: 'processing',
        fiscal_attempts: 1,
        fiscal_last_error: null,
      }),
    };

    try {
      await expect(waitForReceiptFiscalization(api, 'receipt-4', {
        timeoutMs: 60_000,
        pollIntervalMs: 0,
        delay: () => Promise.resolve(),
      })).rejects.toThrow('ККТ не подтвердила фискализацию');
    } finally {
      nowSpy.mockRestore();
    }
  });
});
