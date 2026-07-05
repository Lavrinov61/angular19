import db from '../database/db.js';
import type { ExistsResult } from '../types/db-common.types.js';
import type {
  AccountDiscountJsonb,
  AccountDiscountProfile,
  AccountDiscountRule,
  AccountDiscountUserRow,
  CustomerAccountType,
} from '../types/views/account-discount-views.js';
import { EDUCATION_ACCESS_PLAN_SLUGS } from './subscription.service.js';

interface AccountDiscountConfig {
  label: string;
  documentPrintDiscountPercent: number;
  photoPrintDiscountPercent: number;
}

interface AccountDiscountSubscriptionRequirement {
  category: 'doc-print' | 'education';
  billingPeriod: 'monthly' | 'yearly';
  price: number;
  planSlugs?: readonly string[];
}

export const ACCOUNT_DISCOUNT_CONFIG: Readonly<Record<CustomerAccountType, AccountDiscountConfig>> = {
  personal: { label: 'Личный аккаунт', documentPrintDiscountPercent: 20, photoPrintDiscountPercent: 10 },
  business: { label: 'Бизнес аккаунт', documentPrintDiscountPercent: 40, photoPrintDiscountPercent: 15 },
  education: { label: 'Образовательный аккаунт', documentPrintDiscountPercent: 70, photoPrintDiscountPercent: 50 },
};

/**
 * Образовательный тариф «без подписки»: пользователь подтвердил студенческий статус,
 * но НЕ оформил подписку. Документы −50% (вместо −70% у подписчиков), фотопечать −30%
 * (вместо −50%). Лимиты те же (rolling-30: 100 документов + 100 фото), «супер»-фото
 * исключены, переплёт 10 ₽ (как у подписчиков). accountType остаётся 'education', поэтому
 * исключение «супер»-фото в resolveAccountItemDiscount наследуется автоматически.
 */
const EDUCATION_VERIFIED_ONLY_CONFIG: AccountDiscountConfig = {
  label: 'Образовательный (без подписки)',
  documentPrintDiscountPercent: 50,
  photoPrintDiscountPercent: 30,
};

const ACCOUNT_DISCOUNT_SUBSCRIPTION_REQUIREMENTS: Readonly<Record<CustomerAccountType, AccountDiscountSubscriptionRequirement>> = {
  personal: { category: 'doc-print', billingPeriod: 'monthly', price: 199 },
  business: { category: 'doc-print', billingPeriod: 'monthly', price: 199 },
  education: { category: 'education', billingPeriod: 'monthly', price: 199, planSlugs: EDUCATION_ACCESS_PLAN_SLUGS },
};

const NO_ACCOUNT_PROFILE: AccountDiscountProfile = {
  accountType: 'personal',
  label: 'Без аккаунта',
  discountPercent: 0,
  documentPrintDiscountPercent: 0,
  photoPrintDiscountPercent: 0,
  source: 'none',
};

interface AccountDiscountItemTarget {
  slug: string;
  name: string;
  categorySlug?: string | null;
  groupSlug?: string | null;
}

const DOCUMENT_PRINT_LABEL = 'документы А4';
const PHOTO_PRINT_LABEL = 'фотопечать до А4';

const DOCUMENT_PRINT_SLUGS = new Set([
  'km-а4-ксерокопия',
  'km-а4-до-15-цвет',
  'km-а4-ксерокопия-цветная',
  'km-а4-до-75',
  'km-а4-ксерокопия-фото-цветная',
  'km-а4-печать-документа',
  'km-а4-печать-до-15-цвет',
  'km-а4-печать-документа-цветная',
  'km-а4-печать-до-75',
  'km-а4-фото-документ',
]);

const PHOTO_PRINT_SLUGS = new Set([
  'km-фото-10x15-премиум',
  'km-фото-10x15-супер',
  'km-в-стиле-полароид',
  'km-фото-15x20-премиум',
  'km-фото-15x20-супер',
  'km-фото-20x30-премиум',
  'km-фото-20x30-супер',
  'portrait-10x15-premium',
  'portrait-10x15-super',
  'portrait-15x20-premium',
  'portrait-15x20-super',
  'portrait-20x30-premium',
  'portrait-20x30-super',
  'photo-10x15',
  'photo-15x20',
  'photo-20x30',
  '10x15',
  '15x20',
  '20x30',
  'a4',
]);

// «Супер»-форматы фотопечати (премиальная обработка) — образовательная скидка на них
// не распространяется. Личный/бизнес аккаунты скидку на «супер» сохраняют, поэтому
// эти слаги остаются в PHOTO_PRINT_SLUGS, а исключение применяется точечно в
// resolveAccountItemDiscount только для accountType === 'education'.
const SUPER_PHOTO_SLUGS = new Set([
  'km-фото-10x15-супер',
  'km-фото-15x20-супер',
  'km-фото-20x30-супер',
  'portrait-10x15-super',
  'portrait-15x20-super',
  'portrait-20x30-super',
]);

function isSuperPhotoTarget(target: AccountDiscountItemTarget): boolean {
  const slug = normalizeDiscountText(target.slug);
  if (SUPER_PHOTO_SLUGS.has(slug)) return true;
  // Подстраховка на случай иной слаговой схемы: суффикс «-супер»/«-super».
  if (slug.endsWith('-супер') || slug.endsWith('-super')) return true;
  // Имя/название с явным токеном «супер»/«super» (например «Фото 20×30 супер»).
  return /(?:^|\s)(?:супер|super)(?:\s|$)/.test(normalizeDiscountText(target.name));
}

export function normalizeCustomerAccountType(value: unknown): CustomerAccountType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'personal':
    case 'education':
    case 'business':
      return normalized;
    default:
      return null;
  }
}

export function createAccountDiscountProfile(
  accountType: CustomerAccountType,
  source: AccountDiscountProfile['source'],
): AccountDiscountProfile {
  const config = ACCOUNT_DISCOUNT_CONFIG[accountType];
  const discountPercent = Math.max(
    config.documentPrintDiscountPercent,
    config.photoPrintDiscountPercent,
  );
  return {
    accountType,
    label: config.label,
    discountPercent,
    documentPrintDiscountPercent: config.documentPrintDiscountPercent,
    photoPrintDiscountPercent: config.photoPrintDiscountPercent,
    source,
  };
}

/**
 * Профиль образовательного тарифа «без подписки» (подтверждён, но не оплатил подписку):
 * документы −50%, фото −30%. accountType='education' сохраняется, чтобы наследовать
 * исключение «супер»-фото и rolling-30 кап (кап реально приходит из studentState/льготы).
 */
export function createEducationVerifiedOnlyProfile(): AccountDiscountProfile {
  const config = EDUCATION_VERIFIED_ONLY_CONFIG;
  return {
    accountType: 'education',
    label: config.label,
    discountPercent: Math.max(config.documentPrintDiscountPercent, config.photoPrintDiscountPercent),
    documentPrintDiscountPercent: config.documentPrintDiscountPercent,
    photoPrintDiscountPercent: config.photoPrintDiscountPercent,
    source: 'education_verified_only',
  };
}

function normalizeDiscountText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/×/g, 'x');
}

function combinedTargetText(target: AccountDiscountItemTarget): string {
  return [
    target.slug,
    target.name,
    target.categorySlug ?? '',
    target.groupSlug ?? '',
  ].map(normalizeDiscountText).join(' ');
}

function isDocumentPrintTarget(target: AccountDiscountItemTarget): boolean {
  const slug = normalizeDiscountText(target.slug);
  if (DOCUMENT_PRINT_SLUGS.has(slug)) return true;

  const categorySlug = normalizeDiscountText(target.categorySlug);
  const groupSlug = normalizeDiscountText(target.groupSlug);
  const text = combinedTargetText(target);
  const isCopyPrintScope = categorySlug === 'copy-print' || groupSlug === 'copy-print-items';
  const hasA4 = text.includes('а4') || text.includes('a4');
  const hasFillTier = /(?:до\s*)?(?:15|50|75|100)\s*%/.test(text);
  const hasPrintSignal = text.includes('печать') || text.includes('ксерокоп');
  const excluded = text.includes('чертеж')
    || text.includes('переплет')
    || text.includes('переплёт')
    || text.includes('скан')
    || text.includes('ламинир');

  return isCopyPrintScope && hasA4 && hasFillTier && hasPrintSignal && !excluded;
}

function isPhotoPrintTarget(target: AccountDiscountItemTarget): boolean {
  const slug = normalizeDiscountText(target.slug);
  if (PHOTO_PRINT_SLUGS.has(slug)) return true;

  const categorySlug = normalizeDiscountText(target.categorySlug);
  const groupSlug = normalizeDiscountText(target.groupSlug);
  const text = combinedTargetText(target);
  const isPhotoPrintScope = categorySlug === 'photo-print-format'
    || categorySlug === 'photo-print'
    || groupSlug === 'photo-formats'
    || groupSlug === 'portrait-format'
    || slug.startsWith('km-фото-')
    || slug.startsWith('portrait-');
  const hasAllowedFormat = /(?:^|\D)(?:10\s*[xх]\s*15|15\s*[xх]\s*20|15\s*[xх]\s*21|20\s*[xх]\s*30|21\s*[xх]\s*30|а4|a4)(?:\D|$)/.test(text);
  const excluded = /(?:^|\D)(?:30\s*[xх]\s*40|40\s*[xх]\s*50|42\s*[xх]\s*60|а2|a2)(?:\D|$)/.test(text)
    || text.includes('документ')
    || text.includes('холст')
    || text.includes('canvas');

  return isPhotoPrintScope && hasAllowedFormat && !excluded;
}

export function resolveAccountItemDiscount(
  profile: AccountDiscountProfile,
  target: AccountDiscountItemTarget,
): AccountDiscountRule | null {
  if (profile.source === 'none') return null;

  if (isDocumentPrintTarget(target) && profile.documentPrintDiscountPercent > 0) {
    return {
      kind: 'document_print',
      label: DOCUMENT_PRINT_LABEL,
      percent: profile.documentPrintDiscountPercent,
    };
  }

  if (isPhotoPrintTarget(target) && profile.photoPrintDiscountPercent > 0) {
    // Образовательная скидка действует только на «премиум»-фотопечать; «супер»
    // (премиальная обработка) исключена. Личный/бизнес аккаунты «супер» сохраняют.
    if (profile.accountType === 'education' && isSuperPhotoTarget(target)) {
      return null;
    }
    return {
      kind: 'photo_print',
      label: PHOTO_PRINT_LABEL,
      percent: profile.photoPrintDiscountPercent,
    };
  }

  return null;
}

function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('8') && digits.length === 11) digits = '7' + digits.slice(1);
  if (digits.length === 10) digits = '7' + digits;
  return digits;
}

function readJsonAccountType(value: AccountDiscountJsonb | null): CustomerAccountType | null {
  if (!value) return null;
  const direct = normalizeCustomerAccountType(value.account_type ?? value.accountType);
  if (direct) return direct;
  return readJsonAccountType(value.preferences ?? null);
}

async function loadUser(params: { userId?: string; phone?: string }): Promise<AccountDiscountUserRow | null> {
  if (params.userId) {
    const user = await db.queryOne<AccountDiscountUserRow>(
      `SELECT id, phone, account_type, personal_data, preferences
       FROM users
       WHERE id = $1`,
      [params.userId],
    );
    if (user) return user;
  }

  if (!params.phone) return null;
  const phone = normalizePhone(params.phone);
  return db.queryOne<AccountDiscountUserRow>(
    `SELECT id, phone, account_type, personal_data, preferences
     FROM users
     WHERE phone = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [phone],
  );
}

export async function hasVerifiedEducationAccount(userId: string): Promise<boolean> {
  const result = await db.queryOne<ExistsResult>(
    `SELECT EXISTS(
       SELECT 1
       FROM student_accounts
       WHERE user_id = $1
         AND status = 'verified'
         AND (expires_at IS NULL OR expires_at >= NOW())
       UNION ALL
       SELECT 1
       FROM student_discount_entitlements
       WHERE user_id = $1
         AND status = 'active'
         AND expires_at >= NOW()
     ) AS has`,
    [userId],
  );
  return Boolean(result?.has);
}

async function hasActiveAccountDiscountSubscription(params: {
  userId: string;
  phone?: string | null;
  accountType: CustomerAccountType;
}): Promise<boolean> {
  const requirement = ACCOUNT_DISCOUNT_SUBSCRIPTION_REQUIREMENTS[params.accountType];
  const phone = params.phone ? normalizePhone(params.phone) : null;
  const result = await db.queryOne<ExistsResult>(
    `SELECT EXISTS(
       SELECT 1
       FROM user_subscriptions us
       LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
       WHERE us.status = 'active'
         AND (us.user_id = $1 OR ($2::text IS NOT NULL AND us.phone = $2))
         AND (us.current_period_end IS NULL OR us.current_period_end >= NOW())
         AND COALESCE(sp.category, 'doc-print') = $3
         AND (
           -- Education и т.п.: явный allowlist слагов авторитетен — любой активный
           -- план из списка даёт скидку (и месячный, и годовой), без привязки к
           -- billing_period/цене (годовой 1999 ≠ месячный 199, но это та же льгота).
           ($5::text[] IS NOT NULL AND sp.slug = ANY($5::text[]))
           OR
           -- Personal/Business: allowlist'а нет — сверяем период оплаты и цену.
           ($5::text[] IS NULL
             AND COALESCE(sp.billing_period, 'monthly') = $4
             AND (
               ABS(COALESCE(us.monthly_price::numeric, 0::numeric) - $6::numeric) < 0.01
               OR ABS(COALESCE(sp.base_price::numeric, 0::numeric) - $6::numeric) < 0.01
             ))
         )
     ) AS has`,
    [
      params.userId,
      phone,
      requirement.category,
      requirement.billingPeriod,
      requirement.planSlugs ? [...requirement.planSlugs] : null,
      requirement.price,
    ],
  );
  return Boolean(result?.has);
}

export async function resolveAccountDiscountProfile(params: {
  userId?: string;
  phone?: string;
}): Promise<AccountDiscountProfile> {
  const user = await loadUser(params);
  if (!user) return NO_ACCOUNT_PROFILE;

  const explicitType = normalizeCustomerAccountType(user.account_type)
    ?? readJsonAccountType(user.preferences)
    ?? readJsonAccountType(user.personal_data);

  const hasEducationAccess = await hasVerifiedEducationAccount(user.id);
  let accountType: CustomerAccountType = explicitType ?? 'personal';
  let source: AccountDiscountProfile['source'] = explicitType ? 'explicit' : 'default';

  if (hasEducationAccess) {
    accountType = 'education';
    source = 'education_verification';
  } else if (accountType === 'education') {
    return NO_ACCOUNT_PROFILE;
  }

  const hasActivationSubscription = await hasActiveAccountDiscountSubscription({
    userId: user.id,
    phone: params.phone ?? user.phone,
    accountType,
  });
  if (!hasActivationSubscription) {
    // Подтверждённый образовательный статус БЕЗ активной подписки → тариф «без подписки»
    // (документы −50%, фото −30%). Личный/бизнес без подписки скидки не получают.
    // Гейтим строго на hasEducationAccess (реальная верификация), не на accountType,
    // чтобы простое объявление account_type='education' без верификации не давало скидку.
    if (hasEducationAccess) {
      return createEducationVerifiedOnlyProfile();
    }
    return NO_ACCOUNT_PROFILE;
  }

  return createAccountDiscountProfile(accountType, source);
}
