import type OrderTemplates from '../generated/public/OrderTemplates.js';
import type OptionGroups from '../generated/public/OptionGroups.js';
import type ServiceOptions from '../generated/public/ServiceOptions.js';

/** Admin category tree option group with aggregated service options JSON. */
export interface PricingOptionGroupWithOptionsRow extends OptionGroups {
  options: ServiceOptions[];
}

/** Subscription rows affected by an admin price edit. */
export interface SubscriptionPlanPriceWarningRow {
  plan_name: string;
  active_count: string;
  credit_price: string;
}

/** Count lookup for active unused price locks. */
export interface UnusedPriceLockCountRow {
  count: string;
}

/** Minimal order template row for ownership and scope checks. */
export interface OrderTemplateAccessRow {
  id: OrderTemplates['id'];
  created_by: OrderTemplates['created_by'];
  scope: OrderTemplates['scope'];
}
