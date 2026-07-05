/** View types for payment_links (migration 122). */

export interface PaymentLinkCheckRow {
  id: string;
  amount: string;
  status: string;
  expired: boolean;
}

export interface PaymentLinkDedupRow {
  id: string;
  order_ref: string;
}

export interface PaymentLinkInsertRow {
  id: string;
  order_ref: string;
}

export interface PaymentLinkMutationRow {
  id: string;
  order_ref: string;
  amount: string;
  status: string;
  services: unknown;
  description: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  expires_at: Date;
}

/** Снимок акции «Фото на студенческий 4×200», сохранённый на счёте до оплаты. */
export interface StudentIdPhotoPromoSnapshot {
  studentAccountId: string;
  userId: string;
  periodKey: string;
  units: number;
  unitPrice: number;
  discountAmount: number;
}

export interface PaymentLinkPayRow {
  id: string;
  order_ref: string;
  amount: string;
  created_by: string | null;
  employee_shift_id: string | null;
  conversation_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_id: string | null;
  payment_method: string | null;
  services?: unknown;
  student_id_photo_promo?: StudentIdPhotoPromoSnapshot | null;
}

export interface PaymentLinkStatusRow {
  id: string;
  order_ref: string;
  amount: string;
  status: string;
  paid_at: Date | null;
  created_at: Date;
  services: unknown;
  description: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  expires_at: Date;
  metadata: unknown;
}

export interface PaymentLinkTipRow {
  amount: string;
  status: string;
  services: unknown;
  metadata: unknown;
}

export interface PaymentLinkExpireRow {
  id: string;
  order_ref: string;
  conversation_id: string | null;
  amount: string;
}

/** Row returned by GET /links and GET /link/:id (JOIN conversations, users). */
export interface PaymentLinkListRow {
  id: string;
  order_ref: string;
  amount: string;
  currency: string;
  services: unknown;
  description: string | null;
  conversation_id: string | null;
  contact_phone: string | null;
  contact_name: string | null;
  contact_email: string | null;
  created_by: string | null;
  status: string;
  payment_id: string | null;
  payment_method: string | null;
  payment_card_info: string | null;
  paid_at: Date | null;
  expires_at: Date;
  order_ref_linked: string | null;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
  contact_id: string | null;
  created_by_name: string | null;
  studio_id: string | null;
  studio_name: string | null;
  available_channels: string[];
}

export type PaymentLinkDetailRow = PaymentLinkListRow;

/** Row returned by SELECT ... FOR UPDATE in create-order handler. */
export interface PaymentLinkCreateOrderRow {
  id: string;
  order_ref: string;
  amount: string;
  status: string;
  services: unknown;
  description: string | null;
  conversation_id: string | null;
  contact_phone: string | null;
  contact_name: string | null;
  contact_email: string | null;
  payment_id: string | null;
  paid_at: Date | null;
  order_ref_linked: string | null;
  contact_id: string | null;
}

/** Row returned by /resend lookup (payment_links JOIN conversations). */
export interface PaymentLinkResendRow {
  id: string;
  order_ref: string;
  amount: string;
  status: string;
  services: unknown;
  description: string | null;
  conversation_id: string | null;
  contact_id: string | null;
}

/** Row returned by legacy /resend photo_print_orders fallback. */
export interface PaymentLinkLegacyOrderRow {
  order_id: string;
  total_price: string;
  status: string;
  chat_session_id: string | null;
  items: unknown;
}
