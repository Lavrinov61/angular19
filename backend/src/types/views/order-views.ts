/** View types for order/payment domain — composed from Kanel + JSONB contracts. */

import type Orders from '../generated/public/Orders.js';
import type { OrdersId } from '../generated/public/Orders.js';
import type RefundRequests from '../generated/public/RefundRequests.js';
import type { RefundRequestsId } from '../generated/public/RefundRequests.js';
import type PaymentInstallments from '../generated/public/PaymentInstallments.js';
import type { PaymentInstallmentsId } from '../generated/public/PaymentInstallments.js';
import type { OrderMetadata } from '../jsonb/order-metadata.js';

// Re-export branded IDs
export type { OrdersId } from '../generated/public/Orders.js';
export type { RefundRequestsId } from '../generated/public/RefundRequests.js';
export type { PaymentInstallmentsId } from '../generated/public/PaymentInstallments.js';

// ── Orders ─────────────────────────────────────────────────────────────────

/** Order row projection (list queries). */
export type OrderRow = Pick<Orders, 'id' | 'client_id' | 'type' | 'status' | 'payment_status' | 'total_amount' | 'created_at'>;

/** Order with typed metadata JSONB. */
export interface OrderWithMeta extends Omit<Orders, 'metadata'> {
  metadata: OrderMetadata | null;
}

// ── Payments ───────────────────────────────────────────────────────────────

export interface SavedPaymentMethod {
  id: string;
  card_first_six: string;
  card_last_four: string;
  card_type: string;
  is_default: boolean;
  last_used_at: string | null;
}

export type RefundRequestRow = Pick<RefundRequests, 'id' | 'order_id' | 'reason' | 'status' | 'created_at'> & {
  amount: string;
};

export type InstallmentRow = Pick<PaymentInstallments, 'id' | 'installment_number' | 'amount' | 'paid_at'> & {
  due_date: string;
  status: string;
};

export interface PaymentEventRow {
  id: string;
  order_id: string;
  event_type: string;
  amount: string;
  status: string;
  provider_data: unknown;
  created_at: string;
}

// ── Loyalty ────────────────────────────────────────────────────────────────

export interface LoyaltyProfile {
  id: string;
  user_id: string;
  level: number;
  total_points: number;
  current_streak: number;
  total_orders: number;
  referred_by: string | null;
}

export interface PointsTransaction {
  id: string;
  user_id: string;
  amount: number;
  type: string;
  created_at: string;
}

/** User ID lookup from order → conversation JOIN (payment.service.ts) */
export interface OrderUserIdLookup {
  user_id: string;
}
