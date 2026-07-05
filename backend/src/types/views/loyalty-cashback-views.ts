import type { LoyaltyProfilesId } from '../generated/public/LoyaltyProfiles.js';
import type { PointsTransactionsId } from '../generated/public/PointsTransactions.js';

export type LoyaltyCashbackCategoryKey =
  | 'documents'
  | 'photos'
  | 'id-photo'
  | 'restoration'
  | 'photoshoot'
  | 'albums';

export type LoyaltyCashbackSource = 'online_order' | 'pos_order' | 'chat_order';

export interface LoyaltyCashbackCategoryOption {
  key: LoyaltyCashbackCategoryKey;
  title: string;
  ratePercent: number;
  description: string;
}

export interface LoyaltyCashbackSelectionRow {
  id: string;
  loyalty_profile_id: LoyaltyProfilesId;
  category_key: LoyaltyCashbackCategoryKey;
  period_month: string;
  selected_at: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface LoyaltyCashbackAwardRow {
  id: string;
  loyalty_profile_id: LoyaltyProfilesId;
  selection_id: string;
  points_transaction_id: PointsTransactionsId | null;
  source: LoyaltyCashbackSource;
  reference_id: string;
  category_key: LoyaltyCashbackCategoryKey;
  period_month: string;
  order_amount: string;
  cashback_rate: string;
  points_awarded: number;
  order_occurred_at: string;
  awarded_at: string;
}

export interface LoyaltyCashbackPeriodRow {
  period_month: string;
}

export interface LoyaltyCashbackInsertRow {
  id: string;
}

export interface LoyaltyPointsTransactionInsertRow {
  id: PointsTransactionsId;
}
