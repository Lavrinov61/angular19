// ── Subscription Offer Dialog Models ──

export interface SubscriptionPlanItem {
  readonly id: string;
  readonly plan_id: string;
  readonly product_id: string;
  readonly product_name?: string;
  readonly product_price?: number;
  readonly included_quantity: number;
  readonly credit_price: number | null;
  readonly is_required: boolean;
}

export type AccountSubscriptionKind = 'personal' | 'business' | 'education';

export interface SubscriptionPlan {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly base_price: number;
  readonly billing_period: string;
  readonly subscriber_discount_percent: number;
  readonly features: string[];
  readonly category: string;
  readonly icon: string;
  readonly savings_label: string | null;
  readonly is_popular: boolean;
  readonly items?: SubscriptionPlanItem[];
  readonly account_subscription_kind?: AccountSubscriptionKind;
  readonly account_subscription_info_only?: boolean;
}

export interface PlansApiResponse {
  readonly success: boolean;
  readonly plans: SubscriptionPlan[];
}

export interface OfferApiResponse {
  readonly success: boolean;
  readonly offer_id: string;
  readonly token: string;
}

export interface GiftPromoApiResponse {
  readonly success: boolean;
  readonly promo_code: string;
  readonly redeem_url: string;
  readonly expires_at: string | null;
  readonly plan_id: string;
  readonly plan_name: string;
}

export interface AccountAccessInfoApiResponse {
  readonly success: boolean;
  readonly account_type: AccountSubscriptionKind;
  readonly message_id: string | null;
}

export type SubscriptionOfferDialogMode = 'offer' | 'gift';

export interface SubscriptionOfferDialogData {
  readonly sessionId: string;
  readonly phone: string;
  readonly clientName: string;
  readonly mode?: SubscriptionOfferDialogMode;
}

export type SubscriptionOfferDialogResult =
  | { readonly type: 'sent'; readonly offerId: string }
  | { readonly type: 'gifted'; readonly promoCode: string }
  | { readonly type: 'account-info-sent'; readonly accountType: AccountSubscriptionKind }
  | { readonly type: 'cancelled' };

export interface CategoryMeta {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
}

export const ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY = 'account-subscriptions';

export const SUBSCRIPTION_CATEGORIES: readonly CategoryMeta[] = [
  { key: 'doc-print', label: 'Печать документов A4', icon: 'print' },
  { key: 'photo-print', label: 'Печать фотографий', icon: 'photo_library' },
  { key: ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY, label: 'Подписки', icon: 'card_membership' },
] as const;
