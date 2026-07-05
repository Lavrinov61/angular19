export type PaymentMethod = 'cash' | 'card' | 'sbp' | 'transfer' | 'subscription';
export type PosView = 'catalog' | 'cart';

export interface SubscriptionCoverage {
  productId: string;
  productName: string;
  quantity: number;
  creditsConsumed?: number;
  creditMultiplier?: number;
  coverageMultiplier?: number;
  coveragePercent?: number | null;
  coveredQty: number;
  remainingQty: number;
  savedAmount: number;
}
