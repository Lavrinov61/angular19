/** JSONB contracts for subscription_payments.raw_payload */
export interface SubscriptionPaymentRawPayload {
  provider?: 'cloudpayments' | string;
  event?: string;
  transactionId?: string | number | null;
  subscriptionId?: string | null;
  invoiceId?: string | null;
  reason?: string | null;
  payload?: unknown;
  [key: string]: unknown;
}
