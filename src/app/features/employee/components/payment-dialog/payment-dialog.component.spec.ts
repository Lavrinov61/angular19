import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('PaymentDialogComponent source', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/features/employee/components/payment-dialog/payment-dialog.component.ts'),
    'utf8',
  );

  const sourceBetween = (startMarker: string, endMarker: string): string => {
    const start = source.indexOf(startMarker);
    expect(start, `Missing source marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end, `Missing source marker: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  it('keeps bank-approved card payments pending for receipt retry instead of auto-reversal', () => {
    const failStart = source.indexOf('private failCardFiscalization');
    const nextMethodStart = source.indexOf('private failApprovedCardReceiptCreation', failStart);
    const failSource = source.slice(failStart, nextMethodStart);

    expect(failSource).toContain('this.pendingCardFiscalPayment = context');
    expect(failSource).toContain("this.cardPaymentStatus.set('fiscal_error')");
    expect(failSource).not.toContain('bridgeRefund');
    expect(failSource).not.toContain('attemptCardPaymentReversal');
    expect(source).not.toContain("'reversal_error'");
  });

  // Клиент из чата без телефона (visitor_phone NULL) → кассир не мог применить
  // образовательную/бонусную скидку. Поле ввода телефона закрывает дыру.
  it('lets the cashier attach a customer phone and wires it into the pricing recalc', () => {
    // Поле телефона показывается, когда есть что считать и валидный телефон не привязан.
    expect(source).toContain('pd-customer-phone');
    expect(source).toContain('class="pd-phone-input"');
    expect(source).toContain('(blur)="applyCustomerPhone()"');
    expect(source).toContain('(keydown.enter)="applyCustomerPhone()"');

    const applyStart = source.indexOf('applyCustomerPhone(): void');
    const applyEnd = source.indexOf('startEditCustomerPhone(): void', applyStart);
    const applySource = source.slice(applyStart, applyEnd);

    // Валидный телефон → перезагрузка лояльности/подписки + проводка в pricing-поток.
    expect(applySource).toContain('const normalizedPhone = normalizeRussianPhoneDigits(raw)');
    expect(applySource).toContain('this.loadLoyalty(normalizedPhone)');
    expect(applySource).toContain('this.loadSubscription(normalizedPhone)');
    expect(applySource).toContain("this.state.setCustomerPhone(normalizedPhone)");
    // Неполный номер не валит расчёт, а просто снимает привязку.
    expect(applySource).toContain('this.state.setCustomerPhone(null)');
  });

  it('formats the customer phone input as a Russian phone number while typing', () => {
    expect(source).toContain('formatRussianPhoneInput');
    expect(source).toContain('normalizeRussianPhoneDigits');
    expect(source).toContain('placeholder="+7 (___) ___-__-__"');

    const inputSource = sourceBetween(
      'onCustomerPhoneInput(value: string): void',
      '/**\n   * Attach the typed phone',
    );
    expect(inputSource).toContain('this.customerPhoneInput.set(formatRussianPhoneInput(value))');

    const editSource = sourceBetween(
      'startEditCustomerPhone(): void',
      'private mapCategory',
    );
    expect(editSource).toContain('formatRussianPhoneInput');
  });

  it('keeps catalog, search, selected items and manual amount available for a prefilled print cart', () => {
    expect(source).toContain('pd-cart-addons-heading');
    expect(source).toContain('Добавить в чек');

    const bodySource = sourceBetween('<!-- Quick presets -->', '<!-- Customer phone');
    expect(bodySource).not.toContain('@if (!state.cartPrefillDetails()) {');
    expect(bodySource).not.toContain('@if (!state.cartPrefillDetails() && state.selectedItems().length > 0) {');
    expect(bodySource).not.toContain('@if (!state.cartPrefillDetails()) {\n            <div class="pd-section">');
    expect(bodySource).toContain('<app-service-search [(query)]="search.query" />');
    expect(bodySource).toContain('<app-pd-selection-summary');

    const manualSource = sourceBetween('<!-- Manual amount -->', '<!-- Subscription picker');
    expect(manualSource).toContain('<app-pd-manual-amount');
    expect(manualSource).not.toContain('@if (!state.cartPrefillDetails())');
  });

  it('shows the education/loyalty hint and keeps the account-discount line', () => {
    // Ненавязчивая подсказка про образовательную/бонусную скидку рядом с полем.
    expect(source).toContain('возможна образовательная или бонусная скидка');
    // Синяя строка account-скидки в селекшн-суммари не сломана.
    expect(source).toContain('@if (state.accountDiscount(); as account) {');
    expect(source).toContain('pd-account-discount');
  });

  it('uses the resolved customer phone in outgoing payment requests', () => {
    const effectivePhoneSource = sourceBetween(
      'private effectiveCustomerPhone(): string',
      '/**\n   * Show the phone field',
    );
    expect(effectivePhoneSource).toContain('this.isMaskedPhone(phone)');

    const requestSources = [
      sourceBetween('generate(autoSend: boolean): void', 'const editLink = this.data.editPaymentLink;'),
      sourceBetween('async payOrderSbp(): Promise<void>', 'private payOrderSubscription(): void'),
      sourceBetween('private async payChatSbp(): Promise<void>', 'private async payPosSbp(): Promise<void>'),
      sourceBetween('private async startPosSbpPayment(): Promise<void>', 'private async sendChatTransferInstructions(): Promise<void>'),
      sourceBetween('private notifyManualChatPayment(', 'private buildReceiptPaymentResult('),
      sourceBetween('private async createOrderForSbp(', 'private cartLinePriceParts('),
    ];

    for (const requestSource of requestSources) {
      expect(requestSource).toContain('this.effectiveCustomerPhone()');
      expect(requestSource).not.toContain('this.data.phone || undefined');
      expect(requestSource).not.toContain('phone: this.data.phone');
    }
  });

  it('keeps identity-based customer pricing on the backend instead of resolving the real phone in the browser', () => {
    expect(source).not.toContain('/api/crm-booking/client-context');
    expect(source).not.toContain('resolveCustomerPhoneByIdentity');

    const initSource = sourceBetween('ngOnInit(): void', 'onKeydown(event: KeyboardEvent): void');
    expect(initSource).toContain('this.state.setCustomerIdentity');
    expect(initSource).not.toContain('this.loadLoyalty(real)');
    expect(initSource).not.toContain('this.loadSubscription(real)');

    const requestSources = [
      sourceBetween('generate(autoSend: boolean): void', 'const editLink = this.data.editPaymentLink;'),
      sourceBetween('private async createOrderForSbp(', 'private cartLinePriceParts('),
    ];

    for (const requestSource of requestSources) {
      expect(requestSource).toContain('clientUserId: this.data.clientUserId');
      expect(requestSource).toContain('clientContactId: this.data.clientContactId');
    }

    const pricingReceiptRequests = source.match(/this\.posApi\.createFromPricing\(\{[\s\S]*?\}\)\.subscribe/g) ?? [];
    expect(pricingReceiptRequests.length).toBeGreaterThan(0);
    for (const requestSource of pricingReceiptRequests) {
      expect(requestSource).toContain('client_user_id: this.data.clientUserId');
      expect(requestSource).toContain('client_contact_id: this.data.clientContactId');
    }
  });

  it('links POS receipts created from an existing order back to that order', () => {
    const orderCardReceiptSource = sourceBetween(
      'private createOrderCardReceipt(',
      'private resetOrderProcessingState(): void',
    );
    const directReceiptSource = sourceBetween(
      'private payReceiptDirect(',
      'private handleReceiptCreatedForPayment(',
    );
    const generatedPosReceiptSource = sourceBetween(
      'generatePosReceipt(): void',
      '\n}',
    );

    for (const requestSource of [orderCardReceiptSource, directReceiptSource, generatedPosReceiptSource]) {
      expect(requestSource).toContain('print_order_id: this.data.printOrderId');
      expect(requestSource).not.toContain('print_order_id: this.data.orderId');
    }
  });
});
