/** View types for payment route ad-hoc projections. */

export interface SubscriptionPaymentCheckRow {
  id: string;
  monthly_price: string;
  status: string;
  age_hours?: string | null;
}

export interface PaymentUserContactRow {
  phone: string | null;
  email: string | null;
}

export interface ConversationVisitorRow {
  visitor_id: string | null;
}

export interface AppOrderPaymentRow {
  id?: string;
  total_amount: string | number | null;
  metadata: unknown;
  client_id: string | null;
  [key: string]: unknown;
}

export interface PaymentIdRow {
  id: string;
}

export interface NotificationUserRow {
  id: string;
}

export interface SubscriptionOwnerRow {
  id: string;
  user_id: string | null;
}

export interface SubscriptionWidgetConfirmRow {
  id: string;
  user_id: string | null;
  status: string | null;
  monthly_price: string;
  cloudpayments_subscription_id: string | null;
  cloudpayments_token: string | null;
}

export interface AbandonedPaymentOrderRow {
  order_id: string;
  total_price: string;
  chat_session_id: string | null;
}

export interface WorkTaskPaymentSourceRow {
  chat_session_id: string | null;
  client_id: string | null;
}

export interface ManualChatPaymentConversationRow {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
}

export interface ConversationAttributionRow {
  visitor_id: string | null;
  visitor_phone: string | null;
}

export interface UserPhoneRow {
  phone: string | null;
}

export interface PrintPaymentStatusRow {
  order_id: string;
  status: string | null;
  payment_status: string | null;
  total_price: string | null;
  tip_amount: string | null;
  paid_at: string | null;
  created_at: string | null;
  items: unknown;
  delivery_address: string | null;
  delivery_method: string | null;
  delivery_cost: string | null;
  receipt_url: string | null;
  payment_card_info: string | null;
  contact_name: string | null;
  contact_email: string | null;
  promo_code: string | null;
  promo_discount: string | null;
  description: string | null;
}

export interface FiscalReceiptOrderLookupRow {
  order_id: string;
  total_price: string | null;
  receipt_url: string | null;
  created_at: string | null;
}
