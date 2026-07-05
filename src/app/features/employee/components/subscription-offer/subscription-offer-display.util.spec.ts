import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY,
  buildSubscriptionOfferPlanList,
  buildSubscriptionBenefitLines,
  getAccountSubscriptionDisplay,
  getAccountSubscriptionKind,
  getSubscriptionGiftHeader,
  getSubscriptionGiftPrimaryText,
  getSubscriptionOfferCategoryKey,
} from './subscription-offer-display.util';
import type { SubscriptionPlan } from './models/subscription-offer.models';

const PERSONAL_ACCOUNT_PLAN: SubscriptionPlan = {
  id: 'plan-personal',
  name: 'Аккаунт 199',
  slug: 'doc-print-student',
  description: null,
  base_price: 199,
  billing_period: 'month',
  subscriber_discount_percent: 0,
  features: [],
  category: 'doc-print',
  icon: 'print',
  savings_label: 'активация скидок аккаунта',
  is_popular: true,
  items: [
    {
      id: 'item-a4-bw',
      plan_id: 'plan-personal',
      product_id: 'a4-bw',
      product_name: 'Печать A4 ч/б',
      product_price: 10,
      included_quantity: 0,
      credit_price: 8,
      is_required: true,
    },
  ],
};

const DOC_PRINT_PACKAGE_PLAN: SubscriptionPlan = {
  id: 'plan-doc-package',
  name: '80 листов A4',
  slug: 'launch-printscan-lite',
  description: null,
  base_price: 199,
  billing_period: 'month',
  subscriber_discount_percent: 0,
  features: [],
  category: 'doc-print',
  icon: 'print',
  savings_label: 'скидка на объём',
  is_popular: true,
  items: [],
};

describe('subscription offer display helpers', () => {
  it('describes personal account gifts by percent without paid tariff names or rubles', () => {
    const renderedText = [
      getSubscriptionGiftHeader(PERSONAL_ACCOUNT_PLAN),
      getSubscriptionGiftPrimaryText(PERSONAL_ACCOUNT_PLAN),
      ...buildSubscriptionBenefitLines(PERSONAL_ACCOUNT_PLAN),
    ].join('\n');

    expect(renderedText).toContain('Личная подписка на 1 месяц');
    expect(renderedText).toContain('Скидка на печать документов — 20%, на печать фотографий — 10%.');
    expect(renderedText).not.toContain('Аккаунт 199');
    expect(renderedText).not.toContain('199');
    expect(renderedText).not.toContain('₽');
  });

  it('moves personal account activation plans from print packages to account subscriptions', () => {
    expect(getSubscriptionOfferCategoryKey(PERSONAL_ACCOUNT_PLAN)).toBe(ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY);
    expect(getSubscriptionOfferCategoryKey(DOC_PRINT_PACKAGE_PLAN)).toBe('doc-print');
  });

  it('adds all three account subscription cards to the subscriptions section', () => {
    const plans = buildSubscriptionOfferPlanList([
      PERSONAL_ACCOUNT_PLAN,
      DOC_PRINT_PACKAGE_PLAN,
    ]);

    const accountPlans = plans.filter(plan => getSubscriptionOfferCategoryKey(plan) === ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY);
    const printPackagePlans = plans.filter(plan => getSubscriptionOfferCategoryKey(plan) === 'doc-print');

    expect(accountPlans.map(plan => getAccountSubscriptionKind(plan))).toEqual(['personal', 'business', 'education']);
    expect(accountPlans.map(plan => getAccountSubscriptionDisplay(plan)?.name)).toEqual([
      'Личная подписка',
      'Бизнес-аккаунт',
      'Образовательная',
    ]);
    expect(printPackagePlans.map(plan => plan.slug)).toEqual(['launch-printscan-lite']);
  });

  it('describes account subscription cards by discount percent without rubles', () => {
    const renderedText = buildSubscriptionOfferPlanList([PERSONAL_ACCOUNT_PLAN])
      .filter(plan => getSubscriptionOfferCategoryKey(plan) === ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY)
      .flatMap(plan => [
        getAccountSubscriptionDisplay(plan)?.amount,
        getAccountSubscriptionDisplay(plan)?.period,
        ...buildSubscriptionBenefitLines(plan),
      ])
      .filter((line): line is string => Boolean(line))
      .join('\n');

    expect(renderedText).toContain('−20% / −10%');
    expect(renderedText).toContain('−40% / −15%');
    expect(renderedText).toContain('−70% / −50%');
    expect(renderedText).not.toContain('₽');
    expect(renderedText).not.toContain('руб');
  });
});
