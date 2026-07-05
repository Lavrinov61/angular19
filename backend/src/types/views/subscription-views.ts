/**
 * View types for subscription-related operations.
 */

import type { SubscriptionCreditUsageLogId } from '../generated/public/SubscriptionCreditUsageLog.js';
import type { UserSubscriptionsId } from '../generated/public/UserSubscriptions.js';
import type { SubscriptionCreditsId } from '../generated/public/SubscriptionCredits.js';
import type { ProductsId } from '../generated/public/Products.js';
import type { PosReceiptsId } from '../generated/public/PosReceipts.js';
import type { UsersId } from '../generated/public/Users.js';

/** CloudPayments API response for subscription cancel */
export interface CloudPaymentsCancelResponse {
  Success: boolean;
  Message: string | null;
}

/** Type guard for CloudPayments cancel response */
export function isCloudPaymentsCancelResponse(v: unknown): v is CloudPaymentsCancelResponse {
  if (typeof v !== 'object' || v === null || !('Success' in v)) return false;
  return typeof Reflect.get(v, 'Success') === 'boolean';
}

/** JOIN view: subscription_credit_usage_log + products + pos_receipts + users */
export interface CreditUsageHistoryRow {
  id: SubscriptionCreditUsageLogId;
  subscription_id: UserSubscriptionsId;
  credit_id: SubscriptionCreditsId | null;
  product_id: ProductsId;
  product_name: string;
  quantity: number;
  credit_multiplier: number;
  credits_consumed: number;
  pos_receipt_id: PosReceiptsId | null;
  receipt_number: string | null;
  employee_id: UsersId | null;
  employee_name: string | null;
  description: string | null;
  created_at: string;
}

/** Count result for pagination */
export interface CreditUsageCountRow {
  count: string;
}

/** Lightweight ownership row for subscription access checks */
export interface SubscriptionOwnershipRow {
  id: UserSubscriptionsId;
  user_id: UsersId | null;
}
