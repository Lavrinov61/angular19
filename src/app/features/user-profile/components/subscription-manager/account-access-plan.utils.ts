import type { MySubscription, SubscriptionPlan } from '../../../../core/services/subscription.service';

export type AccountAccessKind = 'personal' | 'education' | 'business';

const PERSONAL_ACCOUNT_ACCESS_PLAN_SLUGS = new Set(['doc-print-student']);
const EDUCATION_ACCOUNT_ACCESS_PLAN_SLUGS = new Set([
  'education-monthly-199',
  'education-yearly-199',
]);
const ACTIVE_ACCESS_STATUSES = new Set(['active', 'paused']);

type AccountAccessPlanLike = Pick<SubscriptionPlan, 'slug' | 'category' | 'subscriber_discount_percent'>;
type AccountAccessSubscriptionLike = Pick<
  MySubscription,
  'plan_slug' | 'plan_category' | 'subscriber_discount_percent'
>;

function hasAccountAccessPricing(value: Pick<SubscriptionPlan | MySubscription, 'subscriber_discount_percent'>): boolean {
  return Number(value.subscriber_discount_percent ?? 0) <= 0;
}

function isPersonalAccountAccessSlug(slug: string | null | undefined): boolean {
  return Boolean(slug && PERSONAL_ACCOUNT_ACCESS_PLAN_SLUGS.has(slug));
}

function isEducationAccountAccess(
  value: Pick<AccountAccessPlanLike, 'slug' | 'category'> | Pick<AccountAccessSubscriptionLike, 'plan_slug' | 'plan_category'>,
): boolean {
  const slug = 'slug' in value ? value.slug : value.plan_slug;
  const category = 'category' in value ? value.category : value.plan_category;
  return category === 'education' || Boolean(slug && EDUCATION_ACCOUNT_ACCESS_PLAN_SLUGS.has(slug));
}

export function isAccountAccessPlan(plan: AccountAccessPlanLike): boolean {
  return hasAccountAccessPricing(plan) && (
    isPersonalAccountAccessSlug(plan.slug) ||
    isEducationAccountAccess(plan)
  );
}

export function findAccountAccessPlan(plans: readonly SubscriptionPlan[]): SubscriptionPlan | null {
  return plans.find(isAccountAccessPlan) ?? null;
}

export function isAccountAccessSubscription(
  subscription: AccountAccessSubscriptionLike,
): boolean {
  return hasAccountAccessPricing(subscription) && (
    isPersonalAccountAccessSlug(subscription.plan_slug) ||
    isEducationAccountAccess(subscription)
  );
}

export function findActiveAccountAccessSubscription(
  subscriptions: readonly MySubscription[],
  kind: AccountAccessKind,
): MySubscription | null {
  return subscriptions.find((subscription) => {
    if (!ACTIVE_ACCESS_STATUSES.has(subscription.status)) return false;
    if (!isAccountAccessSubscription(subscription)) return false;

    switch (kind) {
      case 'personal':
        return isPersonalAccountAccessSlug(subscription.plan_slug) && subscription.plan_category !== 'education';
      case 'education':
        return isEducationAccountAccess(subscription);
      case 'business':
        return false;
    }
  }) ?? null;
}
