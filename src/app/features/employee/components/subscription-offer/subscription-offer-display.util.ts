import {
  ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY,
  type AccountSubscriptionKind,
  type SubscriptionPlan,
  type SubscriptionPlanItem,
} from './models/subscription-offer.models';

export { ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY };

const PERSONAL_ACCOUNT_PLAN_SLUG = 'doc-print-student';
const PERSONAL_ACCOUNT_GIFT_HEADER = 'Личная подписка на 1 месяц';
const PERSONAL_ACCOUNT_GIFT_PRIMARY_TEXT = 'Персональная скидка';
const PERSONAL_ACCOUNT_DISCOUNT_LINE = 'Скидка на печать документов — 20%, на печать фотографий — 10%.';
const BUSINESS_ACCOUNT_PLAN_SLUG = 'account-access-business';
const EDUCATION_ACCOUNT_PLAN_SLUG = 'education-monthly-199';
const EDUCATION_ACCOUNT_PLAN_SLUGS = new Set([
  EDUCATION_ACCOUNT_PLAN_SLUG,
  'education-yearly-199',
]);
const SYNTHETIC_ACCOUNT_PLAN_ID_PREFIX = 'account-subscription';

const ACCOUNT_SUBSCRIPTION_ORDER: readonly AccountSubscriptionKind[] = [
  'personal',
  'business',
  'education',
];

export type SubscriptionOfferDisplayMode = 'offer' | 'gift';

export interface AccountSubscriptionDisplay {
  readonly kind: AccountSubscriptionKind;
  readonly name: string;
  readonly amount: string;
  readonly period: string;
  readonly icon: string;
  readonly savingsLabel: string;
  readonly primaryText: string;
  readonly offerHeader: string;
  readonly giftHeader: string;
  readonly ctaText: string;
  readonly benefitLines: readonly string[];
}

const ACCOUNT_SUBSCRIPTION_DISPLAY: Readonly<Record<AccountSubscriptionKind, AccountSubscriptionDisplay>> = {
  personal: {
    kind: 'personal',
    name: 'Личная подписка',
    amount: '−20% / −10%',
    period: 'A4 / фото',
    icon: 'person',
    savingsLabel: 'активация скидок аккаунта',
    primaryText: PERSONAL_ACCOUNT_GIFT_PRIMARY_TEXT,
    offerHeader: 'Личная подписка Своё Фото',
    giftHeader: PERSONAL_ACCOUNT_GIFT_HEADER,
    ctaText: '→ Активировать по промокоду',
    benefitLines: [PERSONAL_ACCOUNT_DISCOUNT_LINE],
  },
  business: {
    kind: 'business',
    name: 'Бизнес-аккаунт',
    amount: '−40% / −15%',
    period: 'A4 / фото',
    icon: 'business_center',
    savingsLabel: 'для организаций',
    primaryText: 'Корпоративные условия',
    offerHeader: 'Бизнес-аккаунт Своё Фото',
    giftHeader: 'Бизнес-аккаунт Своё Фото',
    ctaText: '→ Подключить бизнес-аккаунт',
    benefitLines: [
      'Бизнес-скидка: документы A4 −40%, фото 10×15 −15%.',
      'Реквизиты, сотрудники, счета и закрывающие документы.',
    ],
  },
  education: {
    kind: 'education',
    name: 'Образовательная',
    amount: '−70% / −50%',
    period: 'A4 / премиум-фото',
    icon: 'school',
    savingsLabel: 'после подтверждения статуса',
    primaryText: 'Образовательная скидка',
    offerHeader: 'Образовательная подписка Своё Фото',
    giftHeader: 'Образовательная подписка Своё Фото',
    ctaText: '→ Подтвердить образовательный статус',
    benefitLines: [
      'Образовательная скидка: документы A4 −70%, премиум-фото 10×15 −50%.',
      'Для студентов, преподавателей и образовательных организаций после проверки.',
    ],
  },
};

export function isPersonalAccountActivationPlan(
  plan: Pick<SubscriptionPlan, 'slug' | 'subscriber_discount_percent'>,
): boolean {
  return plan.slug === PERSONAL_ACCOUNT_PLAN_SLUG && getNumericDiscount(plan.subscriber_discount_percent) <= 0;
}

export function isPersonalAccountGift(
  plan: Pick<SubscriptionPlan, 'slug' | 'subscriber_discount_percent'>,
  mode: SubscriptionOfferDisplayMode,
): boolean {
  return mode === 'gift' && isPersonalAccountActivationPlan(plan);
}

export function getAccountSubscriptionKind(
  plan: Pick<SubscriptionPlan, 'slug' | 'subscriber_discount_percent' | 'category' | 'account_subscription_kind'>,
): AccountSubscriptionKind | null {
  if (plan.account_subscription_kind) {
    return plan.account_subscription_kind;
  }

  if (isPersonalAccountActivationPlan(plan)) {
    return 'personal';
  }

  if (plan.slug === BUSINESS_ACCOUNT_PLAN_SLUG || plan.slug === 'doc-print-business') {
    return 'business';
  }

  if (EDUCATION_ACCOUNT_PLAN_SLUGS.has(plan.slug) || plan.category === 'education') {
    return 'education';
  }

  return null;
}

export function getSubscriptionOfferCategoryKey(plan: SubscriptionPlan): string {
  return getAccountSubscriptionKind(plan) ? ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY : plan.category;
}

export function getAccountSubscriptionDisplay(plan: SubscriptionPlan): AccountSubscriptionDisplay | null {
  const kind = getAccountSubscriptionKind(plan);
  return kind ? ACCOUNT_SUBSCRIPTION_DISPLAY[kind] : null;
}

export function isAccountSubscriptionInfoOnly(plan: SubscriptionPlan): boolean {
  const kind = getAccountSubscriptionKind(plan);
  if (!kind) {
    return false;
  }

  return plan.account_subscription_info_only === true || kind === 'business' || kind === 'education';
}

export function buildSubscriptionOfferPlanList(plans: readonly SubscriptionPlan[]): SubscriptionPlan[] {
  const accountPlans = ACCOUNT_SUBSCRIPTION_ORDER.map(kind => buildAccountSubscriptionPlan(kind, plans));
  const printPackagePlans = plans.filter(plan => !getAccountSubscriptionKind(plan));
  return [...accountPlans, ...printPackagePlans];
}

export function getSubscriptionGiftHeader(plan: SubscriptionPlan): string {
  const accountDisplay = getAccountSubscriptionDisplay(plan);
  if (accountDisplay) {
    return accountDisplay.giftHeader;
  }

  return `Подарок "${plan.name}"`;
}

export function getSubscriptionGiftPrimaryText(plan: SubscriptionPlan): string {
  const accountDisplay = getAccountSubscriptionDisplay(plan);
  if (accountDisplay) {
    return accountDisplay.primaryText;
  }

  return '1 месяц бесплатно';
}

export function buildSubscriptionBenefitLines(plan: SubscriptionPlan, maxItems = 5): string[] {
  const accountDisplay = getAccountSubscriptionDisplay(plan);
  if (accountDisplay) {
    return accountDisplay.benefitLines.slice(0, maxItems);
  }

  if (plan.items && plan.items.length > 0) {
    return plan.items.slice(0, maxItems).map(buildItemBenefitLine);
  }

  return plan.features.slice(0, maxItems);
}

function buildAccountSubscriptionPlan(
  kind: AccountSubscriptionKind,
  plans: readonly SubscriptionPlan[],
): SubscriptionPlan {
  const display = ACCOUNT_SUBSCRIPTION_DISPLAY[kind];
  const existing = plans.find(plan => getAccountSubscriptionKind(plan) === kind);
  const isSynthetic = !existing;

  return {
    id: existing?.id ?? `${SYNTHETIC_ACCOUNT_PLAN_ID_PREFIX}-${kind}`,
    name: existing?.name ?? display.name,
    slug: existing?.slug ?? getSyntheticAccountPlanSlug(kind),
    description: existing?.description ?? null,
    base_price: existing?.base_price ?? 0,
    billing_period: existing?.billing_period ?? 'info',
    subscriber_discount_percent: existing?.subscriber_discount_percent ?? 0,
    features: existing?.features.length ? existing.features : [...display.benefitLines],
    category: ACCOUNT_SUBSCRIPTIONS_CATEGORY_KEY,
    icon: display.icon,
    savings_label: existing?.savings_label ?? display.savingsLabel,
    is_popular: existing?.is_popular ?? kind === 'personal',
    items: existing?.items ?? [],
    account_subscription_kind: kind,
    account_subscription_info_only: isSynthetic || kind !== 'personal',
  };
}

function getSyntheticAccountPlanSlug(kind: AccountSubscriptionKind): string {
  switch (kind) {
    case 'personal':
      return PERSONAL_ACCOUNT_PLAN_SLUG;
    case 'business':
      return BUSINESS_ACCOUNT_PLAN_SLUG;
    case 'education':
      return EDUCATION_ACCOUNT_PLAN_SLUG;
  }
}

function buildItemBenefitLine(item: SubscriptionPlanItem): string {
  const productName = item.product_name || 'Услуга';
  const discountPercent = getItemDiscountPercent(item);

  if (discountPercent === null) {
    return `${productName} дешевле по подписке`;
  }

  return `${productName} −${formatPercent(discountPercent)}%`;
}

function getItemDiscountPercent(item: Pick<SubscriptionPlanItem, 'product_price' | 'credit_price'>): number | null {
  const productPrice = Number(item.product_price ?? 0);
  const creditPrice = Number(item.credit_price ?? 0);

  if (
    !Number.isFinite(productPrice)
    || !Number.isFinite(creditPrice)
    || productPrice <= 0
    || creditPrice <= 0
    || creditPrice >= productPrice
  ) {
    return null;
  }

  return ((productPrice - creditPrice) / productPrice) * 100;
}

function getNumericDiscount(discount: string | number | null | undefined): number {
  const value = Number(discount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function formatPercent(percent: number): string {
  return Number.isInteger(percent)
    ? percent.toLocaleString('ru-RU')
    : percent.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
