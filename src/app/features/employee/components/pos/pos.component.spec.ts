import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('PosComponent source', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/features/employee/components/pos/pos.component.ts'),
    'utf8',
  );

  it('uses guarded fiscal flow after direct POS card approval', () => {
    expect(source).toContain('createApprovedCardReceipt');
    expect(source).toContain('waitForReceiptFiscalization');
    expect(source).toContain('handleApprovedCardFiscalizationFailure');
    expect(source).toContain('let createdReceipt: PosReceipt | null = null');

    const approvedReceiptStart = source.indexOf('private async createApprovedCardReceiptAsync');
    const reversalStart = source.indexOf('private async attemptApprovedCardPaymentReversal', approvedReceiptStart);
    const approvedReceiptSource = source.slice(approvedReceiptStart, reversalStart);

    expect(approvedReceiptSource).toContain('if (createdReceipt)');
    expect(approvedReceiptSource).not.toContain('bridgeRefund');

    const directCardStart = source.indexOf('if (cardPaymentIndex >= 0)');
    const sbpStart = source.indexOf('} else if (sbpPaymentIndex >= 0)', directCardStart);
    const directCardSource = source.slice(directCardStart, sbpStart);

    expect(directCardSource).not.toContain('this.createReceipt(receiptData)');
  });

  it('requires a chat decision before direct POS payment', () => {
    expect(source).toContain('shouldShowChatPrompt');
    expect(source).toContain('Привязать чат');
    expect(source).toContain('С клиентом нет чата');
    expect(source).toMatch(/\[disabled\]="[^"]*shouldShowChatPrompt\(\)[^"]*"/);

    const paymentStart = source.indexOf('async processPayment');
    const customerStart = source.indexOf('const customer = this.posService.customer()', paymentStart);
    const paymentGuardSource = source.slice(paymentStart, customerStart);

    expect(paymentGuardSource).toContain('ensureChatDecisionBeforePayment');
  });

  it('posts linked POS receipts back to the selected chat', () => {
    expect(source).toContain('notifyLinkedChatAboutReceipt');
    expect(source).toContain('/api/payments/manual-chat-payment');
    expect(source).toContain('receiptId: receipt.id');
    expect(source).toContain('sessionId: linkedSessionId');
  });

  it('surfaces orphan payments (paid without receipt) via banner and journal', () => {
    expect(source).toContain('loadOrphanPayments');
    expect(source).toContain('orphanPayments');
    expect(source).toContain("openReceiptJournal('orphan')");
    expect(source).toContain('без чека');
    // Реагируем на realtime-детектор осиротевшей оплаты
    expect(source).toContain('posOrphanPayment');
  });

  it('sends a cart snapshot with studioId/source on direct card payment (order-first)', () => {
    const cardStart = source.indexOf('if (cardPaymentIndex >= 0)');
    const sbpStart = source.indexOf('} else if (sbpPaymentIndex >= 0)', cardStart);
    const directCardSource = source.slice(cardStart, sbpStart);

    expect(directCardSource).toContain('snapshot: {');
    expect(directCardSource).toContain('studioId: receiptStudioId');
    expect(directCardSource).toContain("source: 'cart'");
  });

  it('sends pricing params on services card payment so the backend persists the composition', () => {
    const pricingPaymentStart = source.indexOf('async processPricingPayment');
    const completePricingStart = source.indexOf('completePricingReceipt', pricingPaymentStart);
    const pricingPaymentSource = source.slice(pricingPaymentStart, completePricingStart);

    expect(pricingPaymentSource).toContain('pricing: {');
    expect(pricingPaymentSource).toContain('category_slug: order.categorySlug');
    expect(pricingPaymentSource).toContain('selected_options: order.selectedOptions');
    expect(pricingPaymentSource).toContain('apply_volume_discount: this.posService.volumeDiscountRequested()');
  });
});
