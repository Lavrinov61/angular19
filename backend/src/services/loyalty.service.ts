import { PoolClient } from 'pg';
import db from '../database/db.js';
import type { TelegramUser } from '../middleware/telegramAuth.js';
import { AppError } from '../middleware/errorHandler.js';
import { generateReferralCode } from '../utils/secure-random.js';
import { LOYALTY_XP_TO_RUB } from './pricing-engine.service.js';
import type { LoyaltyProfilesId } from '../types/generated/public/LoyaltyProfiles.js';
import type { TelegramUsersId } from '../types/generated/public/TelegramUsers.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type { ConversationMetadata } from '../types/jsonb/conversation-jsonb.js';
import type { CountResult } from '../types/views/common-views.js';
import type {
  LoyaltyCashbackCategoryKey,
  LoyaltyCashbackCategoryOption,
  LoyaltyCashbackInsertRow,
  LoyaltyCashbackPeriodRow,
  LoyaltyCashbackSelectionRow,
  LoyaltyCashbackSource,
  LoyaltyPointsTransactionInsertRow,
} from '../types/views/loyalty-cashback-views.js';
import type {
  LoyaltyBenefitBreakdownItem,
  LoyaltyBenefitMonth,
  LoyaltyBenefitMonthlyRow,
  LoyaltyBenefitProfileBalanceRow,
  LoyaltyBenefitSummary,
} from '../types/views/loyalty-benefit-summary-views.js';

// ============================================================================
// Types
// ============================================================================

export type PointsAction =
  | 'first_visit' | 'daily_checkin' | 'streak_bonus'
  | 'referral_bonus' | 'referral_welcome'
  | 'online_order' | 'pos_order' | 'pos_spend'
  | 'admin_adjust' | 'admin_deduct'
  | 'chat_order' | 'review_bonus' | 'achievement_bonus'
  | 'monthly_cashback';

export interface LoyaltyProfileView {
  id: LoyaltyProfilesId;
  points: number;
  totalPointsEarned: number;
  level: number;
  levelName: string;
  currentStreak: number;
  longestStreak: number;
  lastDailyClaim: string | null;
  referralCode: string | null;
  totalOrders: number;
  totalSpent: number;
  conversionRate: number;
  pointsAsRubles: number;
  invitedCount: number;
}

export interface AchievementView {
  achievementId: string;
  unlockedAt: string | null;
}

export interface TransactionView {
  id: string;
  amount: number;
  balanceAfter: number;
  action: string;
  description: string | null;
  referenceId: string | null;
  createdAt: string | null;
}

export interface DailyClaimResult {
  pointsAwarded: number;
  bonusPoints: number;
  newBalance: number;
  newStreak: number;
}

export interface ReferralResult {
  success: boolean;
  message: string;
}

export interface AdminProfileView extends LoyaltyProfileView {
  userId: UsersId | null;
  telegramUserId: TelegramUsersId | null;
  customerId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface LoyaltyStats {
  totalProfiles: number;
  activeProfiles: number;
  totalPointsIssued: number;
  totalPointsSpent: number;
  avgLevel: number;
  levelDistribution: Record<string, number>;
}

export interface LoyaltyCashbackSelectionView {
  categoryKey: LoyaltyCashbackCategoryKey;
  selectedAt: string;
  periodMonth: string;
}

export interface LoyaltyCashbackState {
  ratePercent: number;
  periodMonth: string;
  selection: LoyaltyCashbackSelectionView | null;
  categories: readonly LoyaltyCashbackCategoryOption[];
}

export interface MonthlyCashbackAwardInput {
  profileId: LoyaltyProfilesId | string;
  orderAmount: number;
  source: LoyaltyCashbackSource;
  referenceId?: string | null;
  categoryKey?: LoyaltyCashbackCategoryKey | null;
  occurredAt?: string | null;
}

export type MonthlyCashbackAwardReason =
  | 'no_reference'
  | 'invalid_amount'
  | 'no_category'
  | 'no_selection'
  | 'category_mismatch'
  | 'duplicate';

export interface MonthlyCashbackAwardResult {
  awarded: boolean;
  pointsAwarded: number;
  reason?: MonthlyCashbackAwardReason;
  selectedCategoryKey?: LoyaltyCashbackCategoryKey;
  matchedCategoryKey?: LoyaltyCashbackCategoryKey;
}

const BENEFIT_MONTH_LABELS = [
  'Янв',
  'Фев',
  'Мар',
  'Апр',
  'Май',
  'Июн',
  'Июл',
  'Авг',
  'Сен',
  'Окт',
  'Ноя',
  'Дек',
] as const;

const EARNED_BENEFIT_BREAKDOWN_META = [
  { key: 'cashback', label: 'Кэшбэк', color: '#34c38f' },
  { key: 'referrals', label: 'Рекомендации друзьям', color: '#b45ee8' },
  { key: 'other', label: 'Остальное', color: '#ff9f2e' },
] as const satisfies readonly Pick<LoyaltyBenefitBreakdownItem, 'key' | 'label' | 'color'>[];

const SPENT_BENEFIT_BREAKDOWN_META = [
  { key: 'orders', label: 'Оплата заказов бонусами', color: '#8067f5' },
  { key: 'adjustments', label: 'Корректировки', color: '#ef4444' },
  { key: 'other', label: 'Остальное', color: '#9ca3af' },
] as const satisfies readonly Pick<LoyaltyBenefitBreakdownItem, 'key' | 'label' | 'color'>[];

// ============================================================================
// DB row types (Pick from Kanel)
// ============================================================================

import type LoyaltyProfiles from '../types/generated/public/LoyaltyProfiles.js';
import type PointsTransactions from '../types/generated/public/PointsTransactions.js';
import type UserAchievements from '../types/generated/public/UserAchievements.js';
import type TelegramUsers from '../types/generated/public/TelegramUsers.js';

type ProfileRow = Pick<
  LoyaltyProfiles,
  'id' | 'telegram_user_id' | 'user_id' | 'customer_id' |
  'points' | 'total_points_earned' | 'level' |
  'current_streak' | 'longest_streak' | 'last_daily_claim' |
  'referral_code' | 'referred_by' | 'referred_by_user_id' |
  'total_orders' | 'total_spent' | 'created_at' | 'updated_at'
>;

type TransactionRow = Pick<
  PointsTransactions,
  'id' | 'amount' | 'balance_after' | 'action' | 'description' | 'reference_id' | 'created_at'
>;

type AchievementRow = Pick<UserAchievements, 'achievement_id' | 'unlocked_at'>;

type TelegramUserRow = Pick<
  TelegramUsers,
  'id' | 'telegram_id' | 'telegram_username' | 'first_name' | 'last_name' |
  'visitor_id' | 'photo_url' | 'language_code' | 'is_premium' |
  'first_seen_at' | 'last_seen_at' | 'created_at' | 'updated_at'
>;

type PointsUpdateRow = Pick<LoyaltyProfiles, 'points' | 'total_points_earned' | 'level'>;

type SpendLockRow = Pick<LoyaltyProfiles, 'points'>;

// ============================================================================
// Level system
// ============================================================================

const LEVELS: ReadonlyArray<{ readonly level: number; readonly xp: number; readonly name: string }> = [
  { level: 1, xp: 0, name: 'Новичок' },
  { level: 2, xp: 100, name: 'Любитель' },
  { level: 3, xp: 300, name: 'Знаток' },
  { level: 4, xp: 700, name: 'Эксперт' },
  { level: 5, xp: 1500, name: 'Мастер' },
];

const CASHBACK_RATE_PERCENT = 10;
const CASHBACK_RATE = CASHBACK_RATE_PERCENT / 100;

export const LOYALTY_CASHBACK_CATEGORIES = [
  {
    key: 'documents',
    title: 'Печать документов',
    ratePercent: CASHBACK_RATE_PERCENT,
    description: 'A4, копии, сканы и рабочие файлы',
  },
  {
    key: 'photos',
    title: 'Печать фотографий',
    ratePercent: CASHBACK_RATE_PERCENT,
    description: '10x15, большие форматы и фотобумага',
  },
  {
    key: 'id-photo',
    title: 'Фото на документы',
    ratePercent: CASHBACK_RATE_PERCENT,
    description: 'Паспорт, визы, анкеты и пропуска',
  },
  {
    key: 'restoration',
    title: 'Реставрация',
    ratePercent: CASHBACK_RATE_PERCENT,
    description: 'Восстановление, ретушь и обработка фото',
  },
  {
    key: 'photoshoot',
    title: 'Выездная фотосъёмка',
    ratePercent: CASHBACK_RATE_PERCENT,
    description: 'Съёмка в студии, офисе или на выезде',
  },
  {
    key: 'albums',
    title: 'Фотоальбомы',
    ratePercent: CASHBACK_RATE_PERCENT,
    description: 'Альбомы, фотокниги и семейные подборки',
  },
] as const satisfies readonly LoyaltyCashbackCategoryOption[];

function calculateLevel(totalXp: number): number {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (totalXp >= LEVELS[i].xp) return LEVELS[i].level;
  }
  return 1;
}

function getLevelName(level: number): string {
  const entry = LEVELS.find((l) => l.level === level);
  return entry?.name ?? 'Новичок';
}

// ============================================================================
// Conversion helper (re-exported for external use)
// ============================================================================

export function pointsToRubles(points: number): number {
  return Math.floor(points * LOYALTY_XP_TO_RUB);
}

function toBenefitInteger(value: number | string | null | undefined): number {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.trunc(numericValue));
}

function formatBenefitMonthLabel(periodMonth: string): string {
  const [year, month] = periodMonth.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return periodMonth;
  }
  return BENEFIT_MONTH_LABELS[month - 1];
}

function toBenefitMonth(row: LoyaltyBenefitMonthlyRow): LoyaltyBenefitMonth {
  const earned = toBenefitInteger(row.earned_points);
  const spent = toBenefitInteger(row.spent_points);
  const cashback = toBenefitInteger(row.cashback_points);
  const referrals = toBenefitInteger(row.referral_points);
  const orderSpent = toBenefitInteger(row.order_spent_points);
  const adjustmentSpent = toBenefitInteger(row.adjustment_spent_points);

  return {
    periodMonth: row.period_month,
    label: formatBenefitMonthLabel(row.period_month),
    earned,
    spent,
    cashback,
    referrals,
    otherEarned: toBenefitInteger(row.other_earned_points),
    orderSpent,
    adjustmentSpent,
    otherSpent: toBenefitInteger(row.other_spent_points),
  };
}

function emptyBenefitMonth(periodMonth: string): LoyaltyBenefitMonth {
  return {
    periodMonth,
    label: formatBenefitMonthLabel(periodMonth),
    earned: 0,
    spent: 0,
    cashback: 0,
    referrals: 0,
    otherEarned: 0,
    orderSpent: 0,
    adjustmentSpent: 0,
    otherSpent: 0,
  };
}

function benefitBreakdown(
  meta: readonly Pick<LoyaltyBenefitBreakdownItem, 'key' | 'label' | 'color'>[],
  amounts: Record<LoyaltyBenefitBreakdownItem['key'], number>,
): LoyaltyBenefitBreakdownItem[] {
  return meta.map(item => ({
    ...item,
    amount: amounts[item.key],
  }));
}

export function normalizeCashbackCategoryKey(value: string | null | undefined): LoyaltyCashbackCategoryKey | null {
  switch (value) {
    case 'documents':
    case 'photos':
    case 'id-photo':
    case 'restoration':
    case 'photoshoot':
    case 'albums':
      return value;
    default:
      return null;
  }
}

function normalizeCategoryText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/×/g, 'x');
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectCashbackTextParts(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap(item => collectCashbackTextParts(item));
  }
  if (!isObject(value)) return [];

  const keys = [
    'category_slug',
    'categorySlug',
    'slug',
    'mode',
    'service',
    'serviceName',
    'service_type',
    'tariff',
    'name',
    'product_name',
    'productName',
    'document',
    'format',
    'paperType',
    'type',
    'description',
  ] as const;

  return keys.flatMap((key) => collectCashbackTextParts(Reflect.get(value, key)));
}

function textHasAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => text.includes(pattern));
}

export function detectCashbackCategoryKey(input: {
  categorySlug?: string | null;
  serviceName?: string | null;
  items?: unknown;
}): LoyaltyCashbackCategoryKey | null {
  const directKey = normalizeCashbackCategoryKey(input.categorySlug ?? undefined);
  if (directKey) return directKey;

  const text = normalizeCategoryText([
    input.categorySlug,
    input.serviceName,
    ...collectCashbackTextParts(input.items),
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' '));

  if (!text) return null;

  if (textHasAny(text, ['restoration', 'retouch', 'ретуш', 'реставрац', 'восстанов'])) return 'restoration';
  if (textHasAny(text, ['photoshoot', 'photo-shoot', 'studio-special', 'фотосесс', 'фотосъем', 'фотосъём', 'съемк', 'съёмк', 'выезд'])) return 'photoshoot';
  if (textHasAny(text, ['album', 'albums', 'photobook', 'фотоальбом', 'альбом', 'фотокниг'])) return 'albums';
  if (textHasAny(text, ['id-photo', 'photo-doc', 'document-photo', 'foto-na-dokument', 'фото на документ', 'фото-на-документ', 'паспорт', 'виза', 'анкета', 'пропуск'])) return 'id-photo';
  if (textHasAny(text, ['copy-print', 'scan-services', 'document', 'documents', 'mfp', 'копир', 'ксерокоп', 'документ', 'скан', 'чертеж', 'чертёж', 'распечат', 'a4', 'а4', 'a3', 'а3'])) return 'documents';
  if (textHasAny(text, ['photo-print', 'photo-formats', 'photo', 'photos', 'фотопеч', 'печать фото', 'печать фотографии', 'фотограф', '10x15', '13x18', '20x30', '30x40'])) return 'photos';

  return null;
}

function toCashbackSelectionView(row: LoyaltyCashbackSelectionRow | null): LoyaltyCashbackSelectionView | null {
  if (!row) return null;
  return {
    categoryKey: row.category_key,
    selectedAt: row.selected_at,
    periodMonth: row.period_month,
  };
}

function getCashbackCategoryTitle(categoryKey: LoyaltyCashbackCategoryKey): string {
  return LOYALTY_CASHBACK_CATEGORIES.find(category => category.key === categoryKey)?.title ?? categoryKey;
}

// ============================================================================
// Internal mapper
// ============================================================================

function toProfileView(row: ProfileRow, invitedCount = 0): LoyaltyProfileView {
  const points = row.points ?? 0;
  const totalXp = row.total_points_earned ?? 0;
  const level = row.level ?? calculateLevel(totalXp);
  return {
    id: row.id,
    points,
    totalPointsEarned: totalXp,
    level,
    levelName: getLevelName(level),
    currentStreak: row.current_streak ?? 0,
    longestStreak: row.longest_streak ?? 0,
    lastDailyClaim: row.last_daily_claim,
    referralCode: row.referral_code,
    totalOrders: row.total_orders ?? 0,
    totalSpent: Number(row.total_spent ?? 0),
    conversionRate: LOYALTY_XP_TO_RUB,
    pointsAsRubles: Math.floor(points * LOYALTY_XP_TO_RUB),
    invitedCount,
  };
}

function toAdminProfileView(row: ProfileRow, invitedCount = 0): AdminProfileView {
  return {
    ...toProfileView(row, invitedCount),
    userId: row.user_id,
    telegramUserId: row.telegram_user_id,
    customerId: row.customer_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// 4. findProfile
// ============================================================================

interface FindProfileOpts {
  profileId?: string;
  userId?: string;
  telegramUserId?: string;
  customerId?: string;
  phone?: string;
}

function normalizePhoneTail(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export async function findProfile(opts: FindProfileOpts): Promise<LoyaltyProfileView | null> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.profileId) {
    conditions.push(`lp.id = $${idx++}`);
    params.push(opts.profileId);
  }
  if (opts.userId) {
    conditions.push(`lp.user_id = $${idx++}`);
    params.push(opts.userId);
  }
  if (opts.telegramUserId) {
    conditions.push(`lp.telegram_user_id = $${idx++}`);
    params.push(opts.telegramUserId);
  }
  if (opts.customerId) {
    conditions.push(`lp.customer_id = $${idx++}`);
    params.push(opts.customerId);
  }
  if (opts.phone) {
    const phoneTail = normalizePhoneTail(opts.phone);
    if (phoneTail) {
      conditions.push(`(
        lp.customer_id IN (
          SELECT id
          FROM customers
          WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $${idx}
        )
        OR lp.user_id IN (
          SELECT id
          FROM users
          WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $${idx}
        )
      )`);
      params.push(phoneTail);
      idx++;
    }
  }

  if (conditions.length === 0) return null;

  const where = conditions.join(' OR ');
  const row = await db.queryOne<ProfileRow>(
    `SELECT id, telegram_user_id, user_id, customer_id,
            points, total_points_earned, level,
            current_streak, longest_streak, last_daily_claim,
            referral_code, referred_by, referred_by_user_id,
            total_orders, total_spent, created_at, updated_at
     FROM loyalty_profiles lp
     WHERE ${where}
     LIMIT 1`,
    params,
  );
  if (!row) return null;

  const invitedCount = await getInvitedCount(row);
  return toProfileView(row, invitedCount);
}

// ============================================================================
// 5. getOrCreateByTelegram (was getOrCreateProfile)
// ============================================================================

export async function getOrCreateByTelegram(tgUser: TelegramUser): Promise<{
  telegramUser: TelegramUserRow;
  profile: LoyaltyProfileView;
  achievements: AchievementView[];
}> {
  // Upsert telegram_users
  let tgRow = await db.queryOne<TelegramUserRow>(
    `INSERT INTO telegram_users (telegram_id, telegram_username, first_name, last_name, photo_url, language_code, is_premium, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (telegram_id) DO UPDATE SET
       telegram_username = EXCLUDED.telegram_username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       photo_url = EXCLUDED.photo_url,
       language_code = EXCLUDED.language_code,
       is_premium = EXCLUDED.is_premium,
       last_seen_at = NOW(),
       updated_at = NOW()
     RETURNING id, telegram_id, telegram_username, first_name, last_name,
               visitor_id, photo_url, language_code, is_premium,
               first_seen_at, last_seen_at, created_at, updated_at`,
    [
      tgUser.id,
      tgUser.username ?? null,
      tgUser.first_name ?? null,
      tgUser.last_name ?? null,
      tgUser.photo_url ?? null,
      tgUser.language_code ?? null,
      tgUser.is_premium ?? false,
    ],
  );

  if (!tgRow) {
    tgRow = await db.queryOne<TelegramUserRow>(
      `SELECT id, telegram_id, telegram_username, first_name, last_name,
              visitor_id, photo_url, language_code, is_premium,
              first_seen_at, last_seen_at, created_at, updated_at
       FROM telegram_users WHERE telegram_id = $1`,
      [tgUser.id],
    );
    if (!tgRow) throw new AppError(500, 'Failed to upsert telegram user');
  }

  // Get or create loyalty profile
  let profile = await db.queryOne<ProfileRow>(
    `SELECT id, telegram_user_id, user_id, customer_id,
            points, total_points_earned, level,
            current_streak, longest_streak, last_daily_claim,
            referral_code, referred_by, referred_by_user_id,
            total_orders, total_spent, created_at, updated_at
     FROM loyalty_profiles WHERE telegram_user_id = $1`,
    [tgRow.id],
  );

  if (!profile) {
    const code = generateReferralCode();
    profile = await db.queryOne<ProfileRow>(
      `INSERT INTO loyalty_profiles (telegram_user_id, referral_code)
       VALUES ($1, $2)
       RETURNING id, telegram_user_id, user_id, customer_id,
                 points, total_points_earned, level,
                 current_streak, longest_streak, last_daily_claim,
                 referral_code, referred_by, referred_by_user_id,
                 total_orders, total_spent, created_at, updated_at`,
      [tgRow.id, code],
    );
    if (!profile) throw new AppError(500, 'Failed to create loyalty profile');

    // Award first_visit +50 bonuses
    await addPoints(profile.id, 50, 'first_visit', 'Первый визит в приложение');
    await unlockAchievement(profile.id, 'first_visit');

    // Refresh after points
    profile = await db.queryOne<ProfileRow>(
      `SELECT id, telegram_user_id, user_id, customer_id,
              points, total_points_earned, level,
              current_streak, longest_streak, last_daily_claim,
              referral_code, referred_by, referred_by_user_id,
              total_orders, total_spent, created_at, updated_at
       FROM loyalty_profiles WHERE id = $1`,
      [profile.id],
    );
    if (!profile) throw new AppError(500, 'Profile not found after creation');
  }

  // Check achievements on each load
  await checkAndAwardAchievements(profile.id);

  const achievements = await db.query<AchievementRow>(
    'SELECT achievement_id, unlocked_at FROM user_achievements WHERE loyalty_profile_id = $1',
    [profile.id],
  );

  const invitedCount = await getInvitedCount(profile);

  return {
    telegramUser: tgRow,
    profile: toProfileView(profile, invitedCount),
    achievements: achievements.map((a) => ({
      achievementId: a.achievement_id,
      unlockedAt: a.unlocked_at,
    })),
  };
}

/** Backward-compat alias used by loyalty.routes.ts */
export const getOrCreateProfile = getOrCreateByTelegram;

// ============================================================================
// 6. getOrCreateByUserId
// ============================================================================

export async function getOrCreateByUserId(userId: string): Promise<{
  profile: LoyaltyProfileView;
  achievements: AchievementView[];
}> {
  let profile = await db.queryOne<ProfileRow>(
    `SELECT id, telegram_user_id, user_id, customer_id,
            points, total_points_earned, level,
            current_streak, longest_streak, last_daily_claim,
            referral_code, referred_by, referred_by_user_id,
            total_orders, total_spent, created_at, updated_at
     FROM loyalty_profiles WHERE user_id = $1`,
    [userId],
  );

  if (!profile) {
    const code = generateReferralCode();
    profile = await db.queryOne<ProfileRow>(
      `INSERT INTO loyalty_profiles (user_id, referral_code)
       VALUES ($1, $2)
       RETURNING id, telegram_user_id, user_id, customer_id,
                 points, total_points_earned, level,
                 current_streak, longest_streak, last_daily_claim,
                 referral_code, referred_by, referred_by_user_id,
                 total_orders, total_spent, created_at, updated_at`,
      [userId, code],
    );
    if (!profile) throw new AppError(500, 'Failed to create loyalty profile');

    await addPoints(profile.id, 50, 'first_visit', 'Первый визит в приложение');
    await unlockAchievement(profile.id, 'first_visit');

    profile = await db.queryOne<ProfileRow>(
      `SELECT id, telegram_user_id, user_id, customer_id,
              points, total_points_earned, level,
              current_streak, longest_streak, last_daily_claim,
              referral_code, referred_by, referred_by_user_id,
              total_orders, total_spent, created_at, updated_at
       FROM loyalty_profiles WHERE id = $1`,
      [profile.id],
    );
    if (!profile) throw new AppError(500, 'Profile not found after creation');
  }

  await checkAndAwardAchievements(profile.id);

  const achievements = await db.query<AchievementRow>(
    'SELECT achievement_id, unlocked_at FROM user_achievements WHERE loyalty_profile_id = $1',
    [profile.id],
  );

  const invitedCount = await getInvitedCount(profile);

  return {
    profile: toProfileView(profile, invitedCount),
    achievements: achievements.map((a) => ({
      achievementId: a.achievement_id,
      unlockedAt: a.unlocked_at,
    })),
  };
}

// ============================================================================
// 7. getOrCreateByCustomerId
// ============================================================================

export async function getOrCreateByCustomerId(customerId: string): Promise<{
  profile: LoyaltyProfileView;
  achievements: AchievementView[];
}> {
  let profile = await db.queryOne<ProfileRow>(
    `SELECT id, telegram_user_id, user_id, customer_id,
            points, total_points_earned, level,
            current_streak, longest_streak, last_daily_claim,
            referral_code, referred_by, referred_by_user_id,
            total_orders, total_spent, created_at, updated_at
     FROM loyalty_profiles WHERE customer_id = $1`,
    [customerId],
  );

  if (!profile) {
    const code = generateReferralCode();
    profile = await db.queryOne<ProfileRow>(
      `INSERT INTO loyalty_profiles (customer_id, referral_code)
       VALUES ($1, $2)
       RETURNING id, telegram_user_id, user_id, customer_id,
                 points, total_points_earned, level,
                 current_streak, longest_streak, last_daily_claim,
                 referral_code, referred_by, referred_by_user_id,
                 total_orders, total_spent, created_at, updated_at`,
      [customerId, code],
    );
    if (!profile) throw new AppError(500, 'Failed to create loyalty profile');
  }

  const achievements = await db.query<AchievementRow>(
    'SELECT achievement_id, unlocked_at FROM user_achievements WHERE loyalty_profile_id = $1',
    [profile.id],
  );

  const invitedCount = await getInvitedCount(profile);

  return {
    profile: toProfileView(profile, invitedCount),
    achievements: achievements.map((a) => ({
      achievementId: a.achievement_id,
      unlockedAt: a.unlocked_at,
    })),
  };
}

// ============================================================================
// 8. addPoints
// ============================================================================

export async function addPoints(
  profileId: LoyaltyProfilesId | string,
  amount: number,
  action: PointsAction | string,
  description?: string,
  referenceId?: string,
): Promise<{ newBalance: number; newLevel: number }> {
  const updated = await db.queryOne<PointsUpdateRow>(
    `UPDATE loyalty_profiles SET
       points = COALESCE(points, 0) + $2,
       total_points_earned = COALESCE(total_points_earned, 0) + $2,
       updated_at = NOW()
     WHERE id = $1
     RETURNING points, total_points_earned, level`,
    [profileId, amount],
  );
  if (!updated) throw new AppError(404, 'Loyalty profile not found');

  const newBalance = updated.points ?? 0;
  const totalXp = updated.total_points_earned ?? 0;
  const newLevel = calculateLevel(totalXp);

  if (newLevel !== (updated.level ?? 1)) {
    await db.query(
      'UPDATE loyalty_profiles SET level = $2, updated_at = NOW() WHERE id = $1',
      [profileId, newLevel],
    );
  }

  await db.query(
    `INSERT INTO points_transactions (loyalty_profile_id, amount, balance_after, action, description, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [profileId, amount, newBalance, action, description ?? null, referenceId ?? null],
  );

  return { newBalance, newLevel };
}

// ============================================================================
// 9. spendPoints (ATOMIC with SELECT FOR UPDATE)
// ============================================================================

export async function spendPoints(
  profileId: LoyaltyProfilesId | string,
  amount: number,
  referenceId?: string,
): Promise<{ newBalance: number; rublesDeducted: number }> {
  return db.transaction(async (client: PoolClient) => {
    const lockResult = await client.query<SpendLockRow>(
      'SELECT points FROM loyalty_profiles WHERE id = $1 FOR UPDATE',
      [profileId],
    );
    const row = lockResult.rows[0];
    if (!row) throw new AppError(404, 'Loyalty profile not found');

    const currentPoints = row.points ?? 0;
    if (currentPoints < amount) {
      throw new AppError(400, 'Insufficient loyalty points');
    }

    const newBalance = currentPoints - amount;
    await client.query(
      'UPDATE loyalty_profiles SET points = $2, updated_at = NOW() WHERE id = $1',
      [profileId, newBalance],
    );

    await client.query(
      `INSERT INTO points_transactions (loyalty_profile_id, amount, balance_after, action, description, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [profileId, -amount, newBalance, 'pos_spend' satisfies PointsAction, 'Списание бонусов', referenceId ?? null],
    );

    return {
      newBalance,
      rublesDeducted: Math.floor(amount * LOYALTY_XP_TO_RUB),
    };
  });
}

// ============================================================================
// 10. getBenefitSummary
// ============================================================================

export async function getBenefitSummary(
  profileId: LoyaltyProfilesId | string,
  months = 6,
): Promise<LoyaltyBenefitSummary> {
  const requestedMonths = Number.isFinite(months) ? Math.trunc(months) : 6;
  const monthCount = Math.min(12, Math.max(1, requestedMonths));
  const balance = await db.queryOne<LoyaltyBenefitProfileBalanceRow>(
    'SELECT points FROM loyalty_profiles WHERE id = $1',
    [profileId],
  );
  if (!balance) throw new AppError(404, 'Loyalty profile not found');

  const rows = await db.query<LoyaltyBenefitMonthlyRow>(
    `WITH month_bounds AS (
       SELECT
         date_trunc('month', NOW() AT TIME ZONE 'Europe/Moscow')::date AS current_month,
         $2::int AS months_count
     ),
     month_series AS (
       SELECT generate_series(
         current_month - ((months_count - 1) * INTERVAL '1 month'),
         current_month,
         INTERVAL '1 month'
       )::date AS period_month
       FROM month_bounds
     ),
     tx AS (
       SELECT
         date_trunc('month', pt.created_at AT TIME ZONE 'Europe/Moscow')::date AS period_month,
         pt.action,
         pt.amount::int AS amount
       FROM points_transactions pt
       CROSS JOIN month_bounds mb
       WHERE pt.loyalty_profile_id = $1
         AND pt.created_at >= ((mb.current_month - ((mb.months_count - 1) * INTERVAL '1 month'))::timestamp AT TIME ZONE 'Europe/Moscow')
         AND pt.created_at < ((mb.current_month + INTERVAL '1 month')::timestamp AT TIME ZONE 'Europe/Moscow')
     )
     SELECT
       ms.period_month::text AS period_month,
       COALESCE(SUM(CASE WHEN tx.amount > 0 THEN tx.amount ELSE 0 END), 0)::int AS earned_points,
       COALESCE(SUM(CASE WHEN tx.amount < 0 THEN ABS(tx.amount) ELSE 0 END), 0)::int AS spent_points,
       COALESCE(SUM(CASE WHEN tx.amount > 0 AND tx.action = 'monthly_cashback' THEN tx.amount ELSE 0 END), 0)::int AS cashback_points,
       COALESCE(SUM(CASE WHEN tx.amount > 0 AND tx.action IN ('referral_bonus', 'referral_welcome') THEN tx.amount ELSE 0 END), 0)::int AS referral_points,
       COALESCE(SUM(CASE WHEN tx.amount > 0 AND tx.action NOT IN ('monthly_cashback', 'referral_bonus', 'referral_welcome') THEN tx.amount ELSE 0 END), 0)::int AS other_earned_points,
       COALESCE(SUM(CASE WHEN tx.amount < 0 AND tx.action = 'pos_spend' THEN ABS(tx.amount) ELSE 0 END), 0)::int AS order_spent_points,
       COALESCE(SUM(CASE WHEN tx.amount < 0 AND tx.action IN ('admin_adjust', 'admin_deduct') THEN ABS(tx.amount) ELSE 0 END), 0)::int AS adjustment_spent_points,
       COALESCE(SUM(CASE WHEN tx.amount < 0 AND tx.action NOT IN ('pos_spend', 'admin_adjust', 'admin_deduct') THEN ABS(tx.amount) ELSE 0 END), 0)::int AS other_spent_points
     FROM month_series ms
     LEFT JOIN tx ON tx.period_month = ms.period_month
     GROUP BY ms.period_month
     ORDER BY ms.period_month ASC`,
    [profileId, monthCount],
  );

  const benefitMonths = rows.map(toBenefitMonth);
  const currentMonth = benefitMonths.at(-1) ?? emptyBenefitMonth(await getCurrentCashbackPeriodMonth());
  const currentBalancePoints = toBenefitInteger(balance.points);

  return {
    profileId,
    currentBalancePoints,
    currentBalanceRubles: pointsToRubles(currentBalancePoints),
    conversionRate: LOYALTY_XP_TO_RUB,
    currentMonth,
    months: benefitMonths,
    earnedBreakdown: benefitBreakdown(EARNED_BENEFIT_BREAKDOWN_META, {
      cashback: currentMonth.cashback,
      referrals: currentMonth.referrals,
      other: currentMonth.otherEarned,
      orders: 0,
      adjustments: 0,
    }),
    spentBreakdown: benefitBreakdown(SPENT_BENEFIT_BREAKDOWN_META, {
      cashback: 0,
      referrals: 0,
      other: currentMonth.otherSpent,
      orders: currentMonth.orderSpent,
      adjustments: currentMonth.adjustmentSpent,
    }),
  };
}

// ============================================================================
// 11. claimDailyReward
// ============================================================================

export async function claimDailyReward(profileId: LoyaltyProfilesId | string): Promise<DailyClaimResult | null> {
  const profile = await db.queryOne<Pick<
    LoyaltyProfiles,
    'id' | 'current_streak' | 'longest_streak' | 'last_daily_claim'
  >>(
    'SELECT id, current_streak, longest_streak, last_daily_claim FROM loyalty_profiles WHERE id = $1',
    [profileId],
  );
  if (!profile) return null;

  // Check if already claimed today
  if (profile.last_daily_claim) {
    const last = new Date(profile.last_daily_claim);
    const now = new Date();
    if (last.toDateString() === now.toDateString()) {
      return null;
    }
  }

  // Calculate streak
  let newStreak = 1;
  if (profile.last_daily_claim) {
    const last = new Date(profile.last_daily_claim);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (last.toDateString() === yesterday.toDateString()) {
      newStreak = (profile.current_streak ?? 0) + 1;
    }
  }

  const longestStreak = Math.max(newStreak, profile.longest_streak ?? 0);

  await db.query(
    `UPDATE loyalty_profiles SET
       current_streak = $2,
       longest_streak = $3,
       last_daily_claim = NOW(),
       updated_at = NOW()
     WHERE id = $1`,
    [profileId, newStreak, longestStreak],
  );

  // Base award: 10 bonuses
  const basePoints = 10;
  const { newBalance } = await addPoints(profileId, basePoints, 'daily_checkin', `Ежедневный вход (серия: ${newStreak})`);

  // Streak bonus: +50 bonuses every 7 days
  let bonusPoints = 0;
  if (newStreak > 0 && newStreak % 7 === 0) {
    bonusPoints = 50;
    await addPoints(profileId, bonusPoints, 'streak_bonus', `Бонус за ${newStreak}-дневную серию`);
  }

  // Streak achievement
  if (newStreak >= 7) {
    await unlockAchievement(profileId, 'weekly_streak');
  }

  return {
    pointsAwarded: basePoints,
    bonusPoints,
    newBalance: bonusPoints > 0 ? newBalance + bonusPoints : newBalance,
    newStreak,
  };
}

// ============================================================================
// 12. monthly cashback
// ============================================================================

async function getCashbackPeriodMonthFor(occurredAt?: string | null, client?: PoolClient): Promise<string> {
  const sql = `SELECT date_trunc('month', COALESCE($1::timestamptz, NOW()) AT TIME ZONE 'Europe/Moscow')::date::text AS period_month`;
  const params: unknown[] = [occurredAt ?? null];
  const row = client
    ? (await client.query<LoyaltyCashbackPeriodRow>(sql, params)).rows[0]
    : await db.queryOne<LoyaltyCashbackPeriodRow>(sql, params);
  if (!row) throw new AppError(500, 'Failed to resolve cashback period');
  return row.period_month;
}

async function getCurrentCashbackPeriodMonth(): Promise<string> {
  return getCashbackPeriodMonthFor(null);
}

export async function getCashbackState(profileId: LoyaltyProfilesId | string): Promise<LoyaltyCashbackState> {
  const periodMonth = await getCurrentCashbackPeriodMonth();
  const selection = await db.queryOne<LoyaltyCashbackSelectionRow>(
    `SELECT id, loyalty_profile_id, category_key, period_month::text AS period_month,
            selected_at::text AS selected_at, created_at::text AS created_at, updated_at::text AS updated_at
     FROM loyalty_cashback_category_selections
     WHERE loyalty_profile_id = $1 AND period_month = $2::date`,
    [profileId, periodMonth],
  );

  return {
    ratePercent: CASHBACK_RATE_PERCENT,
    periodMonth,
    selection: toCashbackSelectionView(selection),
    categories: LOYALTY_CASHBACK_CATEGORIES,
  };
}

export async function selectCashbackCategory(
  profileId: LoyaltyProfilesId | string,
  categoryKey: LoyaltyCashbackCategoryKey | string,
): Promise<LoyaltyCashbackState> {
  const normalizedCategoryKey = normalizeCashbackCategoryKey(String(categoryKey));
  if (!normalizedCategoryKey) {
    throw new AppError(400, 'Unknown cashback category');
  }

  const periodMonth = await getCurrentCashbackPeriodMonth();
  const insertedSelection = await db.queryOne<LoyaltyCashbackSelectionRow>(
    `INSERT INTO loyalty_cashback_category_selections (loyalty_profile_id, category_key, period_month)
     VALUES ($1, $2, $3::date)
     ON CONFLICT (loyalty_profile_id, period_month)
     DO NOTHING
     RETURNING id, loyalty_profile_id, category_key, period_month::text AS period_month,
               selected_at::text AS selected_at, created_at::text AS created_at, updated_at::text AS updated_at`,
    [profileId, normalizedCategoryKey, periodMonth],
  );

  if (!insertedSelection) {
    const existingSelection = await db.queryOne<LoyaltyCashbackSelectionRow>(
      `SELECT id, loyalty_profile_id, category_key, period_month::text AS period_month,
              selected_at::text AS selected_at, created_at::text AS created_at, updated_at::text AS updated_at
       FROM loyalty_cashback_category_selections
       WHERE loyalty_profile_id = $1 AND period_month = $2::date`,
      [profileId, periodMonth],
    );

    if (existingSelection && existingSelection.category_key !== normalizedCategoryKey) {
      throw new AppError(
        409,
        'Категория кэшбэка уже выбрана на этот месяц',
        'CASHBACK_CATEGORY_LOCKED',
      );
    }
  }

  return getCashbackState(profileId);
}

export async function awardMonthlyCashback(input: MonthlyCashbackAwardInput): Promise<MonthlyCashbackAwardResult> {
  const orderAmount = Number(input.orderAmount);
  const referenceId = input.referenceId?.trim();
  const matchedCategoryKey = input.categoryKey ?? null;

  if (!referenceId) {
    return { awarded: false, pointsAwarded: 0, reason: 'no_reference', matchedCategoryKey: matchedCategoryKey ?? undefined };
  }
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
    return { awarded: false, pointsAwarded: 0, reason: 'invalid_amount', matchedCategoryKey: matchedCategoryKey ?? undefined };
  }
  if (!matchedCategoryKey) {
    return { awarded: false, pointsAwarded: 0, reason: 'no_category' };
  }

  return db.transaction(async (client: PoolClient) => {
    const orderOccurredAt = input.occurredAt ?? null;
    const periodMonth = await getCashbackPeriodMonthFor(orderOccurredAt, client);

    const selectionResult = await client.query<LoyaltyCashbackSelectionRow>(
      `SELECT id, loyalty_profile_id, category_key, period_month::text AS period_month,
              selected_at::text AS selected_at, created_at::text AS created_at, updated_at::text AS updated_at
       FROM loyalty_cashback_category_selections
       WHERE loyalty_profile_id = $1 AND period_month = $2::date
       FOR UPDATE`,
      [input.profileId, periodMonth],
    );
    const selection = selectionResult.rows[0];
    if (!selection) {
      return { awarded: false, pointsAwarded: 0, reason: 'no_selection', matchedCategoryKey };
    }
    if (selection.category_key !== matchedCategoryKey) {
      return {
        awarded: false,
        pointsAwarded: 0,
        reason: 'category_mismatch',
        selectedCategoryKey: selection.category_key,
        matchedCategoryKey,
      };
    }

    const pointsAwarded = Math.floor(orderAmount * CASHBACK_RATE);
    if (pointsAwarded <= 0) {
      return {
        awarded: false,
        pointsAwarded: 0,
        reason: 'invalid_amount',
        selectedCategoryKey: selection.category_key,
        matchedCategoryKey,
      };
    }

    const awardResult = await client.query<LoyaltyCashbackInsertRow>(
      `INSERT INTO loyalty_cashback_awards (
         loyalty_profile_id, selection_id, source, reference_id, category_key,
         period_month, order_amount, cashback_rate, points_awarded, order_occurred_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, COALESCE($10::timestamptz, NOW()))
       ON CONFLICT (source, reference_id) DO NOTHING
       RETURNING id`,
      [
        input.profileId,
        selection.id,
        input.source,
        referenceId,
        matchedCategoryKey,
        periodMonth,
        orderAmount,
        CASHBACK_RATE,
        pointsAwarded,
        orderOccurredAt,
      ],
    );
    const award = awardResult.rows[0];
    if (!award) {
      return {
        awarded: false,
        pointsAwarded: 0,
        reason: 'duplicate',
        selectedCategoryKey: selection.category_key,
        matchedCategoryKey,
      };
    }

    const updatedResult = await client.query<PointsUpdateRow>(
      `UPDATE loyalty_profiles SET
         points = COALESCE(points, 0) + $2,
         total_points_earned = COALESCE(total_points_earned, 0) + $2,
         updated_at = NOW()
       WHERE id = $1
       RETURNING points, total_points_earned, level`,
      [input.profileId, pointsAwarded],
    );
    const updated = updatedResult.rows[0];
    if (!updated) throw new AppError(404, 'Loyalty profile not found');

    const newBalance = updated.points ?? 0;
    const totalXp = updated.total_points_earned ?? 0;
    const newLevel = calculateLevel(totalXp);

    if (newLevel !== (updated.level ?? 1)) {
      await client.query(
        'UPDATE loyalty_profiles SET level = $2, updated_at = NOW() WHERE id = $1',
        [input.profileId, newLevel],
      );
    }

    const transactionResult = await client.query<LoyaltyPointsTransactionInsertRow>(
      `INSERT INTO points_transactions (loyalty_profile_id, amount, balance_after, action, description, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.profileId,
        pointsAwarded,
        newBalance,
        'monthly_cashback' satisfies PointsAction,
        `Кэшбэк ${CASHBACK_RATE_PERCENT}%: ${getCashbackCategoryTitle(matchedCategoryKey)}`,
        referenceId,
      ],
    );
    const transaction = transactionResult.rows[0];
    if (!transaction) throw new AppError(500, 'Failed to create cashback transaction');

    await client.query(
      'UPDATE loyalty_cashback_awards SET points_transaction_id = $2 WHERE id = $1',
      [award.id, transaction.id],
    );

    return {
      awarded: true,
      pointsAwarded,
      selectedCategoryKey: selection.category_key,
      matchedCategoryKey,
    };
  });
}

// ============================================================================
// 12. awardOrderPoints
// ============================================================================

export async function awardOrderPoints(
  profileId: LoyaltyProfilesId | string,
  orderAmount: number,
  source: 'online_order' | 'pos_order' | 'chat_order',
  referenceId?: string,
  cashbackCategoryKey?: LoyaltyCashbackCategoryKey | null,
  occurredAt?: string | null,
): Promise<{ newBalance: number; newLevel: number; pointsAwarded: number; cashback: MonthlyCashbackAwardResult | null }> {
  const pointsAwarded = Math.max(1, Math.floor(orderAmount / 10));

  const { newBalance, newLevel } = await addPoints(profileId, pointsAwarded, source, undefined, referenceId);

  // Update total_orders and total_spent
  await db.query(
    `UPDATE loyalty_profiles SET
       total_orders = COALESCE(total_orders, 0) + 1,
       total_spent = (COALESCE(total_spent, '0')::numeric + $2)::text,
       updated_at = NOW()
     WHERE id = $1`,
    [profileId, orderAmount],
  );

  const cashback = await awardMonthlyCashback({
    profileId,
    orderAmount,
    source,
    referenceId,
    categoryKey: cashbackCategoryKey ?? null,
    occurredAt: occurredAt ?? null,
  });

  return { newBalance, newLevel, pointsAwarded, cashback };
}

// ============================================================================
// 13. applyReferralCode
// ============================================================================

export async function applyReferralCode(
  profileId: LoyaltyProfilesId | string,
  code: string,
): Promise<ReferralResult & { pointsAwarded?: number; error?: string }> {
  // Find referrer by code
  const referrer = await db.queryOne<Pick<LoyaltyProfiles, 'id' | 'telegram_user_id' | 'user_id'>>(
    'SELECT id, telegram_user_id, user_id FROM loyalty_profiles WHERE referral_code = $1',
    [code.toUpperCase()],
  );
  if (!referrer) {
    return { success: false, message: 'Неверный реферальный код', error: 'invalid_code' };
  }

  // Get current profile
  const currentProfile = await db.queryOne<Pick<LoyaltyProfiles, 'id' | 'referred_by' | 'referred_by_user_id'>>(
    'SELECT id, referred_by, referred_by_user_id FROM loyalty_profiles WHERE id = $1',
    [profileId],
  );
  if (!currentProfile) {
    return { success: false, message: 'Профиль не найден', error: 'profile_not_found' };
  }

  // Self-referral check
  if (referrer.id === currentProfile.id) {
    return { success: false, message: 'Нельзя использовать собственный код', error: 'self_referral' };
  }

  // Already referred check
  if (currentProfile.referred_by || currentProfile.referred_by_user_id) {
    return { success: false, message: 'Вы уже использовали реферальный код', error: 'already_referred' };
  }

  // Monthly referral cap: max 10 per month
  const monthCount = await db.queryOne<CountResult>(
    `SELECT COUNT(*)::text AS count FROM points_transactions
     WHERE loyalty_profile_id = $1
       AND action = 'referral_bonus'
       AND created_at >= date_trunc('month', NOW())`,
    [referrer.id],
  );
  if (parseInt(monthCount?.count ?? '0', 10) >= 10) {
    return { success: false, message: 'У реферера достигнут лимит приглашений за месяц', error: 'monthly_limit_reached' };
  }

  // Link profiles
  await db.query(
    `UPDATE loyalty_profiles
     SET referred_by = $2,
         referred_by_user_id = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [profileId, referrer.telegram_user_id, referrer.user_id],
  );

  // Award referrer +1000 bonuses (+1000 rub)
  await addPoints(referrer.id, 1000, 'referral_bonus', 'Бонус за приглашённого друга (+1000₽)');

  // Award new user +500 bonuses (+500 rub)
  await addPoints(profileId, 500, 'referral_welcome', 'Бонус нового клиента по реферальной ссылке (+500₽)');

  // Check social_butterfly achievement for referrer
  await unlockAchievement(referrer.id, 'social_butterfly');

  return { success: true, message: 'Реферальный код применён', pointsAwarded: 500 };
}

// ============================================================================
// 13. getTransactions
// ============================================================================

export async function getTransactions(
  profileId: LoyaltyProfilesId | string,
  limit = 20,
  offset = 0,
): Promise<TransactionView[]> {
  const rows = await db.query<TransactionRow>(
    `SELECT id, amount, balance_after, action, description, reference_id, created_at
     FROM points_transactions
     WHERE loyalty_profile_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [profileId, limit, offset],
  );
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    balanceAfter: r.balance_after,
    action: r.action,
    description: r.description,
    referenceId: r.reference_id,
    createdAt: r.created_at,
  }));
}

// ============================================================================
// 14. checkAndAwardAchievements
// ============================================================================

export async function checkAndAwardAchievements(profileId: LoyaltyProfilesId | string): Promise<string[]> {
  const newAchievements: string[] = [];

  const profile = await db.queryOne<Pick<
    LoyaltyProfiles,
    'id' | 'telegram_user_id' | 'user_id' | 'total_orders'
  >>(
    'SELECT id, telegram_user_id, user_id, total_orders FROM loyalty_profiles WHERE id = $1',
    [profileId],
  );
  if (!profile) return newAchievements;

  let orderCount = profile.total_orders ?? 0;

  // Count orders from conversations (telegram path)
  if (profile.telegram_user_id) {
    const tgUser = await db.queryOne<Pick<TelegramUsers, 'telegram_id'>>(
      'SELECT telegram_id FROM telegram_users WHERE id = $1',
      [profile.telegram_user_id],
    );
    if (tgUser) {
      const sessionsCount = await db.queryOne<CountResult>(
        `SELECT COUNT(*)::text AS count FROM conversations
         WHERE visitor_id LIKE $1
           AND (
             selected_service IS NOT NULL
             OR (metadata IS NOT NULL AND (
               metadata->>'orderNumber' IS NOT NULL
               OR metadata->>'order_number' IS NOT NULL
               OR metadata->>'globalOrderCounter' IS NOT NULL
             ))
           )`,
        [`tg_%_${tgUser.telegram_id}`],
      );
      if (sessionsCount) {
        orderCount = Math.max(orderCount, parseInt(sessionsCount.count, 10));
      }
    }
  }

  // Count orders from orders table (app user path)
  if (profile.user_id) {
    const ordersCount = await db.queryOne<CountResult>(
      'SELECT COUNT(*)::text AS count FROM orders WHERE client_id = $1',
      [profile.user_id],
    );
    if (ordersCount) {
      orderCount = Math.max(orderCount, parseInt(ordersCount.count, 10));
    }
  }

  // Update total_orders if we found more
  if (orderCount > (profile.total_orders ?? 0)) {
    await db.query(
      'UPDATE loyalty_profiles SET total_orders = $2, updated_at = NOW() WHERE id = $1',
      [profileId, orderCount],
    );
  }

  // first_booking — at least 1 order
  if (orderCount >= 1) {
    if (await unlockAchievement(profileId, 'first_booking')) newAchievements.push('first_booking');
    if (await unlockAchievement(profileId, 'first_print')) newAchievements.push('first_print');
  }

  // loyal_customer — 5+ orders
  if (orderCount >= 5) {
    if (await unlockAchievement(profileId, 'loyal_customer')) newAchievements.push('loyal_customer');
  }

  // photo_master — 10+ orders
  if (orderCount >= 10) {
    if (await unlockAchievement(profileId, 'photo_master')) newAchievements.push('photo_master');
  }

  // social_butterfly — has referrals
  const invitedCount = await getInvitedCount(profile);
  if (invitedCount >= 1) {
    if (await unlockAchievement(profileId, 'social_butterfly')) newAchievements.push('social_butterfly');
  }

  return newAchievements;
}

// ============================================================================
// 15. adjustPoints (admin)
// ============================================================================

export async function adjustPoints(
  profileId: LoyaltyProfilesId | string,
  amount: number,
  reason: string,
  adminId: string,
): Promise<{ newBalance: number; newLevel: number }> {
  const action: PointsAction = amount >= 0 ? 'admin_adjust' : 'admin_deduct';
  const description = `${action === 'admin_adjust' ? 'Начисление' : 'Списание'} администратором: ${reason}`;

  if (amount < 0) {
    // For negative adjustments, check balance first
    const profile = await db.queryOne<Pick<LoyaltyProfiles, 'points'>>(
      'SELECT points FROM loyalty_profiles WHERE id = $1',
      [profileId],
    );
    if (!profile) throw new AppError(404, 'Loyalty profile not found');
    if ((profile.points ?? 0) + amount < 0) {
      throw new AppError(400, 'Insufficient points for deduction');
    }
  }

  return addPoints(profileId, amount, action, description, `admin:${adminId}`);
}

// ============================================================================
// 16. getAllProfiles (admin list)
// ============================================================================

interface GetAllProfilesFilters {
  search?: string;
  level?: number;
  sortBy?: 'points' | 'total_points_earned' | 'level' | 'created_at';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export async function getAllProfiles(filters: GetAllProfilesFilters = {}): Promise<{
  items: AdminProfileView[];
  total: number;
}> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.search) {
    conditions.push(`(
      lp.referral_code ILIKE $${idx} OR
      tu.telegram_username ILIKE $${idx} OR
      tu.first_name ILIKE $${idx} OR
      u.display_name ILIKE $${idx}
    )`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  if (filters.level !== undefined) {
    conditions.push(`lp.level = $${idx++}`);
    params.push(filters.level);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = filters.sortBy ?? 'created_at';
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  const countResult = await db.queryOne<CountResult>(
    `SELECT COUNT(*)::text AS count
     FROM loyalty_profiles lp
     LEFT JOIN telegram_users tu ON lp.telegram_user_id = tu.id
     LEFT JOIN users u ON lp.user_id = u.id
     ${where}`,
    params,
  );
  const total = parseInt(countResult?.count ?? '0', 10);

  const rows = await db.query<ProfileRow>(
    `SELECT lp.id, lp.telegram_user_id, lp.user_id, lp.customer_id,
            lp.points, lp.total_points_earned, lp.level,
            lp.current_streak, lp.longest_streak, lp.last_daily_claim,
            lp.referral_code, lp.referred_by, lp.referred_by_user_id,
            lp.total_orders, lp.total_spent, lp.created_at, lp.updated_at
     FROM loyalty_profiles lp
     LEFT JOIN telegram_users tu ON lp.telegram_user_id = tu.id
     LEFT JOIN users u ON lp.user_id = u.id
     ${where}
     ORDER BY lp.${sortCol} ${sortDir} NULLS LAST
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  );

  const items = rows.map((row) => toAdminProfileView(row));

  return { items, total };
}

// ============================================================================
// 17. getStats (admin)
// ============================================================================

export async function getStats(): Promise<LoyaltyStats> {
  interface StatsRow {
    total_profiles: string;
    active_profiles: string;
    total_points_issued: string;
    total_points_spent: string;
    avg_level: string;
  }

  const row = await db.queryOne<StatsRow>(
    `SELECT
       COUNT(*)::text AS total_profiles,
       COUNT(*) FILTER (WHERE total_points_earned > 0)::text AS active_profiles,
       COALESCE(SUM(total_points_earned), 0)::text AS total_points_issued,
       COALESCE(SUM(total_points_earned) - SUM(points), 0)::text AS total_points_spent,
       COALESCE(AVG(level), 1)::text AS avg_level
     FROM loyalty_profiles`,
    [],
  );

  interface LevelDistRow {
    level: number;
    cnt: string;
  }

  const levelDist = await db.query<LevelDistRow>(
    `SELECT level, COUNT(*)::text AS cnt
     FROM loyalty_profiles
     GROUP BY level
     ORDER BY level`,
    [],
  );

  const levelDistribution: Record<string, number> = {};
  for (const ld of levelDist) {
    levelDistribution[String(ld.level)] = parseInt(ld.cnt, 10);
  }

  return {
    totalProfiles: parseInt(row?.total_profiles ?? '0', 10),
    activeProfiles: parseInt(row?.active_profiles ?? '0', 10),
    totalPointsIssued: parseInt(row?.total_points_issued ?? '0', 10),
    totalPointsSpent: parseInt(row?.total_points_spent ?? '0', 10),
    avgLevel: parseFloat(row?.avg_level ?? '1'),
    levelDistribution,
  };
}

// ============================================================================
// Utility: unlockAchievement
// ============================================================================

export async function unlockAchievement(
  profileId: LoyaltyProfilesId | string,
  achievementId: string,
): Promise<boolean> {
  const result = await db.queryOne<Pick<UserAchievements, 'id'>>(
    `INSERT INTO user_achievements (loyalty_profile_id, achievement_id)
     VALUES ($1, $2) ON CONFLICT (loyalty_profile_id, achievement_id) DO NOTHING
     RETURNING id`,
    [profileId, achievementId],
  );
  return !!result;
}

// ============================================================================
// Utility: getReferralStats (backward compat)
// ============================================================================

export async function getReferralStats(telegramUserId: TelegramUsersId | string): Promise<number> {
  const result = await db.queryOne<CountResult>(
    'SELECT COUNT(*)::text AS count FROM loyalty_profiles WHERE referred_by = $1',
    [telegramUserId],
  );
  return parseInt(result?.count ?? '0', 10);
}

// ============================================================================
// Utility: getOrdersForTelegramUser (backward compat)
// ============================================================================

interface PrintOrderView {
  orderId: string;
  type: 'print';
  status: string;
  totalPrice: number;
  itemCount: number;
  createdAt: string | null;
}

interface ChatOrderView {
  sessionId: string;
  type: 'chat_order';
  status: string;
  serviceName: string;
  orderNumber: string | null;
  price: number | null;
  createdAt: string | null;
}

interface PrintOrderRow {
  order_id: string;
  status: string;
  total_price: string | null;
  items: unknown[] | null;
  created_at: string | null;
}

interface ChatOrderRow {
  session_id: string;
  status: string;
  selected_service: string | null;
  selected_price: string | null;
  metadata: ConversationMetadata | null;
  created_at: string | null;
}

export async function getOrdersForTelegramUser(telegramId: number): Promise<{
  printOrders: PrintOrderView[];
  chatOrders: ChatOrderView[];
}> {
  const tgUser = await db.queryOne<Pick<TelegramUsers, 'id' | 'visitor_id'>>(
    'SELECT id, visitor_id FROM telegram_users WHERE telegram_id = $1',
    [telegramId],
  );
  if (!tgUser) return { printOrders: [], chatOrders: [] };

  const visitorPattern = `tg_%_${telegramId}`;

  // Print orders
  let printOrders: PrintOrderRow[] = [];
  try {
    printOrders = await db.query<PrintOrderRow>(
      `SELECT ppo.order_id, ppo.status, ppo.total_price, ppo.items, ppo.created_at
       FROM photo_print_orders ppo
       WHERE ppo.contact_phone IN (
         SELECT DISTINCT metadata->>'phone'
         FROM conversations
         WHERE visitor_id LIKE $1
         AND metadata->>'phone' IS NOT NULL
       )
       ORDER BY ppo.created_at DESC
       LIMIT 20`,
      [visitorPattern],
    );
  } catch {
    // table may not exist
  }

  // Chat orders
  let chatOrders: ChatOrderRow[] = [];
  try {
    chatOrders = await db.query<ChatOrderRow>(
      `SELECT
         id as session_id, status, selected_service, selected_price,
         metadata, created_at
       FROM conversations
       WHERE visitor_id LIKE $1
         AND (
           selected_service IS NOT NULL
           OR (metadata IS NOT NULL AND (
             metadata->>'orderNumber' IS NOT NULL
             OR metadata->>'order_number' IS NOT NULL
             OR metadata->>'globalOrderCounter' IS NOT NULL
             OR metadata->>'pendingOrder' IS NOT NULL
             OR metadata->>'pending_order' IS NOT NULL
           ))
         )
       ORDER BY created_at DESC
       LIMIT 20`,
      [visitorPattern],
    );
  } catch {
    // table may not exist
  }

  return {
    printOrders: printOrders.map((o) => ({
      orderId: o.order_id,
      type: 'print' as const,
      status: o.status,
      totalPrice: Number(o.total_price ?? 0),
      itemCount: Array.isArray(o.items) ? o.items.length : 0,
      createdAt: o.created_at,
    })),
    chatOrders: chatOrders.map((o) => {
      const meta = o.metadata ?? {};
      const pending = meta.pendingOrder ?? meta.pending_order;
      return {
        sessionId: o.session_id,
        type: 'chat_order' as const,
        status: o.status,
        serviceName: pending?.service ?? o.selected_service ?? 'Заказ',
        orderNumber: meta.orderNumber ?? meta.order_number ?? null,
        price: pending?.price ?? (o.selected_price ? Number(o.selected_price) : null),
        createdAt: o.created_at,
      };
    }),
  };
}

// ============================================================================
// Internal: getInvitedCount (unified for both TG and user_id referrals)
// ============================================================================

async function getInvitedCount(profile: Pick<LoyaltyProfiles, 'telegram_user_id' | 'user_id'>): Promise<number> {
  let count = 0;

  if (profile.telegram_user_id) {
    const r = await db.queryOne<CountResult>(
      'SELECT COUNT(*)::text AS count FROM loyalty_profiles WHERE referred_by = $1',
      [profile.telegram_user_id],
    );
    count += parseInt(r?.count ?? '0', 10);
  }

  if (profile.user_id) {
    const r = await db.queryOne<CountResult>(
      'SELECT COUNT(*)::text AS count FROM loyalty_profiles WHERE referred_by_user_id = $1',
      [profile.user_id],
    );
    count += parseInt(r?.count ?? '0', 10);
  }

  return count;
}
