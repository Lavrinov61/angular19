import type { LoyaltyProfilesId } from '../generated/public/LoyaltyProfiles.js';

export interface LoyaltyBenefitProfileBalanceRow {
  points: number | null;
}

export interface LoyaltyBenefitMonthlyRow {
  period_month: string;
  earned_points: number | string | null;
  spent_points: number | string | null;
  cashback_points: number | string | null;
  referral_points: number | string | null;
  other_earned_points: number | string | null;
  order_spent_points: number | string | null;
  adjustment_spent_points: number | string | null;
  other_spent_points: number | string | null;
}

export type LoyaltyBenefitSummaryMode = 'earned' | 'spent';

export type LoyaltyBenefitBreakdownKey =
  | 'cashback'
  | 'referrals'
  | 'orders'
  | 'adjustments'
  | 'other';

export interface LoyaltyBenefitBreakdownItem {
  key: LoyaltyBenefitBreakdownKey;
  label: string;
  amount: number;
  color: string;
}

export interface LoyaltyBenefitMonth {
  periodMonth: string;
  label: string;
  earned: number;
  spent: number;
  cashback: number;
  referrals: number;
  otherEarned: number;
  orderSpent: number;
  adjustmentSpent: number;
  otherSpent: number;
}

export interface LoyaltyBenefitSummary {
  profileId: LoyaltyProfilesId | string;
  currentBalancePoints: number;
  currentBalanceRubles: number;
  conversionRate: number;
  currentMonth: LoyaltyBenefitMonth;
  months: LoyaltyBenefitMonth[];
  earnedBreakdown: LoyaltyBenefitBreakdownItem[];
  spentBreakdown: LoyaltyBenefitBreakdownItem[];
}
