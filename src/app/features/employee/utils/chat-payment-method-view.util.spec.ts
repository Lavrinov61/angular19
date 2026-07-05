import { describe, expect, it } from 'vitest';
import { chatPaymentMethodView } from './chat-payment-method-view.util';

describe('chatPaymentMethodView', () => {
  it('labels payment links paid through CloudPayments as online payment even when provider reports a card', () => {
    expect(chatPaymentMethodView('card', null, 'payment_link')).toMatchObject({
      label: 'ОНЛАЙН ОПЛАТА',
      tone: 'online',
      icon: 'bolt',
    });
  });

  it('keeps direct terminal card payments labeled as card', () => {
    expect(chatPaymentMethodView('card', null, null)).toMatchObject({
      label: 'КАРТА',
      tone: 'card',
      icon: 'credit_card',
    });
  });

  it('labels explicit online method as online payment', () => {
    expect(chatPaymentMethodView('online', null, null)).toMatchObject({
      label: 'ОНЛАЙН ОПЛАТА',
      tone: 'online',
      icon: 'bolt',
    });
  });
});
