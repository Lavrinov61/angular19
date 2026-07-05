import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('PosPaymentOverlayComponent source', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/features/employee/components/pos/dialogs/pos-payment-overlay.component.ts'),
    'utf8',
  );

  it('waits for receipt fiscalization before showing card payment success', () => {
    const runCardPaymentStart = source.indexOf('private async runCardPayment');
    const nextMethodStart = source.indexOf('private nextCardPaymentRun', runCardPaymentStart);
    const runCardPaymentSource = source.slice(runCardPaymentStart, nextMethodStart);

    expect(source).toContain('waitForReceiptFiscalization');
    expect(runCardPaymentSource).toContain("this.cardStatus.set('fiscalizing')");
    expect(runCardPaymentSource).not.toContain("this.cardStatus.set('success')");
  });

  it('keeps an approved card payment pending for receipt retry when fiscalization fails', () => {
    const failStart = source.indexOf('private failApprovedCardFiscalization');
    const nextMethodStart = source.indexOf('private completeCardPaymentWithReceipt', failStart);
    const failSource = source.slice(failStart, nextMethodStart);

    expect(failSource).toContain('this.pendingCardFiscalPayment');
    expect(failSource).toContain("this.cardStatus.set('fiscal_error')");
    expect(failSource).not.toContain('bridgeRefund');
    expect(failSource).not.toContain('attemptCardPaymentReversal');
    expect(source).not.toContain("'reversal_error'");
  });
});
