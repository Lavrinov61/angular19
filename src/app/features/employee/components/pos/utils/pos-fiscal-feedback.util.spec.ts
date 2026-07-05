import { describe, expect, it } from 'vitest';

import {
  createdReceiptMessage,
  fiscalFailureEmployeeMessage,
  fiscalErrorSummary,
  receiptPaymentsRequireFiscal,
} from './pos-fiscal-feedback.util';
import type { PosReceiptPayment } from '../../../services/pos-api.service';

describe('POS fiscal feedback', () => {
  it('shows no-paper fiscal errors as an employee action', () => {
    const message = fiscalFailureEmployeeMessage('DLL error: ATOL error 44: Нет бумаги');

    expect(fiscalErrorSummary('DLL error: ATOL error 44: Нет бумаги')).toBe('Нет бумаги в ККТ');
    expect(message).toContain('Вставьте бумагу');
    expect(message).toContain('Не пробивайте оплату повторно');
  });

  it('does not present fiscal receipts as paid until fiscalization is confirmed', () => {
    expect(createdReceiptMessage({
      receiptNumber: 'SF-POS-000146',
      total: 250,
      fiscalRequired: true,
    })).toContain('Ожидаем фискализацию');
    expect(createdReceiptMessage({
      receiptNumber: 'SF-POS-000146',
      total: 250,
      fiscalRequired: true,
    })).not.toContain('Оплата прошла');
  });

  it('requires fiscalization only for cash, card, and SBP payments', () => {
    const payments: PosReceiptPayment[] = [
      { payment_type: 'subscription', amount: 100 },
      { payment_type: 'transfer', amount: 200 },
    ];

    expect(receiptPaymentsRequireFiscal(payments)).toBe(false);
    expect(receiptPaymentsRequireFiscal([...payments, { payment_type: 'card', amount: 300 }])).toBe(true);
  });
});
