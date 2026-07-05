/** View types for photo print orders — composed from Kanel + OrderItem. */

import type PhotoPrintOrders from '../generated/public/PhotoPrintOrders.js';
import type { PhotoPrintOrdersId } from '../generated/public/PhotoPrintOrders.js';
import type { OrderItem } from '../../utils/order-item.js';

// Re-export branded ID
export type { PhotoPrintOrdersId } from '../generated/public/PhotoPrintOrders.js';

// ── Status enums ───────────────────────────────────────────────────────────

export const PhotoPrintOrderStatus = {
  NEW: 'new',
  PENDING_PAYMENT: 'pending_payment',
  PAYMENT_FAILED: 'payment_failed',
  PAID: 'paid',
  PROCESSING: 'processing',
  READY: 'ready',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;
export type PhotoPrintOrderStatus = (typeof PhotoPrintOrderStatus)[keyof typeof PhotoPrintOrderStatus];

export const PaymentStatus = {
  NONE: 'none',
  PENDING: 'pending',
  PAID: 'paid',
  PARTIAL: 'partial',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const ShipmentStatus = {
  NONE: 'none',
  CREATED: 'created',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  ERROR: 'error',
} as const;
export type ShipmentStatus = (typeof ShipmentStatus)[keyof typeof ShipmentStatus];

export const DeliveryMethod = {
  ELECTRONIC: 'electronic',
  PICKUP: 'pickup',
  POSTAL: 'postal',
} as const;
export type DeliveryMethod = (typeof DeliveryMethod)[keyof typeof DeliveryMethod];

// ── Main interface (JSONB override for items) ──────────────────────────────

/** PhotoPrintOrders with typed items JSONB. */
export interface PhotoPrintOrder extends Omit<PhotoPrintOrders, 'items'> {
  items: OrderItem[];
}

export interface PhotoPrintOrderPaymentRow extends PhotoPrintOrder {
  employee_shift_id: string | null;
}

// ── Partial types for specific queries ─────────────────────────────────────

export type OrderCheckRow = Pick<PhotoPrintOrder,
  'order_id' | 'total_price' | 'status' | 'contact_email'
> & { age_hours?: string };

export type OrderInstallmentRow = Pick<PhotoPrintOrder,
  'paid_amount' | 'total_price' | 'contact_name'
>;

export type OrderPaymentUpdateRow = Pick<PhotoPrintOrder,
  'order_id' | 'id' | 'total_price' | 'status' | 'payment_status' |
  'contact_name' | 'contact_phone' | 'contact_email' | 'chat_session_id' |
  'items' | 'service_type' | 'mode' | 'priority' | 'partner_promo_code' |
  'delivery_method' | 'delivery_address' | 'telegram_user_id' | 'telegram_username' |
  'promo_code' | 'promo_discount' | 'delivery_cost' | 'receipt_url' | 'created_at' |
  'assigned_employee_id' | 'initiated_by'
>;
