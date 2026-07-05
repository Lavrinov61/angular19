export type ChatPaymentMethodTone = 'cash' | 'transfer' | 'card' | 'sbp' | 'subscription' | 'online' | 'other';

export interface ChatPaymentMethodView {
  readonly label: string | null;
  readonly tone: ChatPaymentMethodTone | null;
  readonly icon: string | null;
}

export function chatPaymentMethodView(method: string | null, explicitLabel: string | null, source: string | null): ChatPaymentMethodView {
  const normalizedSource = (source ?? '').trim().toLowerCase();
  const normalized = (method ?? explicitLabel ?? '').trim().toLowerCase();

  if (normalizedSource === 'payment_link' || normalized === 'online') {
    return { label: 'ОНЛАЙН ОПЛАТА', tone: 'online', icon: 'bolt' };
  }
  if (normalized === 'cash' || normalized.includes('налич')) {
    return { label: 'НАЛИЧНЫЕ', tone: 'cash', icon: 'payments' };
  }
  if (normalized === 'subscription' || normalized.includes('подпис')) {
    return { label: 'ПОДПИСКА', tone: 'subscription', icon: 'card_membership' };
  }
  if (normalized === 'transfer' || normalized.includes('перев')) {
    return { label: 'ПЕРЕВОД', tone: 'transfer', icon: 'account_balance' };
  }
  if (normalized === 'card' || normalized.includes('карт')) {
    return { label: 'КАРТА', tone: 'card', icon: 'credit_card' };
  }
  if (normalized === 'sbp' || normalized.includes('сбп')) {
    return { label: 'СБП', tone: 'sbp', icon: 'qr_code_2' };
  }
  if (normalized === 'other') {
    return { label: 'БЕЗНАЛ', tone: 'other', icon: 'account_balance_wallet' };
  }
  return {
    label: explicitLabel ? explicitLabel.toLocaleUpperCase('ru-RU') : null,
    tone: explicitLabel ? 'other' : null,
    icon: explicitLabel ? 'account_balance_wallet' : null,
  };
}
