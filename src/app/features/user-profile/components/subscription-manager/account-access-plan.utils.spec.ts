import { describe, expect, it } from 'vitest';

import type { SubscriptionPlan } from '../../../../core/services/subscription.service';
import {
  findActiveAccountAccessSubscription,
  findAccountAccessPlan,
  isAccountAccessPlan,
  isAccountAccessSubscription,
} from './account-access-plan.utils';

function plan(overrides: Partial<SubscriptionPlan>): SubscriptionPlan {
  return {
    id: overrides.id ?? 'plan-id',
    name: overrides.name ?? 'Plan',
    slug: overrides.slug ?? 'plan-slug',
    base_price: overrides.base_price ?? 199,
    billing_period: overrides.billing_period ?? 'monthly',
    description: overrides.description ?? '',
    features: overrides.features ?? [],
    is_popular: overrides.is_popular ?? false,
    icon: overrides.icon ?? 'print',
    savings_label: overrides.savings_label ?? null,
    subscriber_discount_percent: overrides.subscriber_discount_percent ?? 0,
    category: overrides.category ?? 'doc-print',
    credits_rollover_months: overrides.credits_rollover_months ?? 0,
    usage_policy: overrides.usage_policy ?? null,
    items: overrides.items ?? [],
  };
}

describe('account access plan selection', () => {
  it('recognizes the paid account activation plan without treating print packages as access plans', () => {
    expect(isAccountAccessPlan(plan({ slug: 'doc-print-student', subscriber_discount_percent: 0 }))).toBe(true);
    expect(isAccountAccessPlan(plan({
      slug: 'education-monthly-199',
      category: 'education',
      billing_period: 'monthly',
      subscriber_discount_percent: 0,
    }))).toBe(true);
    expect(isAccountAccessPlan(plan({ slug: 'doc-print-student', subscriber_discount_percent: 15 }))).toBe(false);
    expect(isAccountAccessPlan(plan({ slug: 'launch-printscan-lite', subscriber_discount_percent: 0 }))).toBe(false);
  });

  it('finds the personal account access plan from the loaded sale plans', () => {
    const plans = [
      plan({ id: 'package', slug: 'launch-printscan-lite', subscriber_discount_percent: 0 }),
      plan({ id: 'access', slug: 'doc-print-student', subscriber_discount_percent: 0 }),
    ];

    expect(findAccountAccessPlan(plans)?.id).toBe('access');
  });

  it('recognizes an active account access subscription from the same plan slug', () => {
    expect(isAccountAccessSubscription({
      id: 'sub-id',
      plan_name: 'Аккаунт 199',
      plan_slug: 'doc-print-student',
      plan_category: 'doc-print',
      monthly_price: 199,
      status: 'active',
      current_period_start: '2026-05-18T00:00:00.000Z',
      current_period_end: '2026-06-18T00:00:00.000Z',
      next_payment_date: '2026-06-18T00:00:00.000Z',
      subscriber_discount_percent: 0,
    })).toBe(true);
  });

  it('recognizes an active educational monthly subscription as account access', () => {
    expect(isAccountAccessSubscription({
      id: 'education-sub-id',
      plan_name: 'Образовательный доступ',
      plan_slug: 'education-monthly-199',
      plan_category: 'education',
      monthly_price: 199,
      status: 'active',
      current_period_start: '2026-05-18T00:00:00.000Z',
      current_period_end: '2026-06-18T00:00:00.000Z',
      next_payment_date: '2026-06-18T00:00:00.000Z',
      subscriber_discount_percent: 0,
    })).toBe(true);
  });

  it('selects the active educational access subscription and ignores stale pending attempts', () => {
    const pendingEducation = {
      id: 'pending-education-sub-id',
      plan_name: 'Образовательный доступ',
      plan_slug: 'education-monthly-199',
      plan_category: 'education',
      monthly_price: 199,
      status: 'pending',
      current_period_start: '',
      current_period_end: '',
      next_payment_date: null,
      subscriber_discount_percent: 0,
    };
    const activeEducation = {
      ...pendingEducation,
      id: 'active-education-sub-id',
      status: 'active',
      current_period_start: '2026-05-18T00:00:00.000Z',
      current_period_end: '2026-06-18T00:00:00.000Z',
      next_payment_date: '2026-06-18T00:00:00.000Z',
    };

    expect(findActiveAccountAccessSubscription(
      [pendingEducation, activeEducation],
      'education',
    )?.id).toBe('active-education-sub-id');
  });
});
