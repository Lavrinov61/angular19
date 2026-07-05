import { LevelInfo, LoyaltyMiniProfile, LoyaltyProfile, AchievementBadge, AchievementDef } from '../interfaces/loyalty.interfaces';

export const LEVELS: LevelInfo[] = [
  { level: 1, name: 'Новичок',  icon: 'level-sprout', minXp: 0,    maxXp: 100,  bonus: 'Базовые возможности' },
  { level: 2, name: 'Любитель', icon: 'level-camera', minXp: 100,  maxXp: 300,  bonus: '+5% к кэшбэку' },
  { level: 3, name: 'Знаток',   icon: 'level-target', minXp: 300,  maxXp: 700,  bonus: '+10% к кэшбэку' },
  { level: 4, name: 'Эксперт',  icon: 'level-star',   minXp: 700,  maxXp: 1500, bonus: 'Приоритетное обслуживание' },
  { level: 5, name: 'Мастер',   icon: 'level-crown',  minXp: 1500, maxXp: Infinity, bonus: 'Максимальные привилегии' },
];

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: 'first_visit',      name: 'Первый визит',      description: 'Добро пожаловать!',              icon: 'ach-wave',    xpReward: 10 },
  { id: 'first_booking',    name: 'Первый заказ',       description: 'Первый шаг к шедевру',           icon: 'ach-shutter', xpReward: 50 },
  { id: 'first_print',      name: 'Первая печать',      description: 'Воплотили в жизнь',              icon: 'ach-frame',   xpReward: 30 },
  { id: 'loyal_customer',   name: 'Постоянный клиент',  description: '5 или более заказов',            icon: 'ach-heart',   xpReward: 100 },
  { id: 'photo_master',     name: 'Фотомастер',         description: '10 или более заказов',           icon: 'ach-trophy',  xpReward: 200 },
  { id: 'weekly_streak',    name: 'Недельная серия',    description: '7 дней подряд входил в сервис',  icon: 'ach-flame',   xpReward: 50 },
  { id: 'social_butterfly', name: 'Амбассадор',         description: 'Пригласил друга',                icon: 'ach-link',    xpReward: 75 },
];

export function getLevelInfo(level: number): LevelInfo {
  return LEVELS[Math.min(level - 1, LEVELS.length - 1)] ?? LEVELS[0];
}

export function getLevelName(level: number): string {
  return getLevelInfo(level).name;
}

export function getLevelIcon(level: number): string {
  return getLevelInfo(level).icon;
}

/** Порог бонусов для следующего уровня. Для макс. уровня, текущий minXp. */
export function getNextLevelXp(level: number): number {
  const next = LEVELS[level]; // level 1-based, массив 0-based → LEVELS[level] = следующий
  return next ? next.minXp : LEVELS[LEVELS.length - 1].minXp;
}

/** Прогресс в процентах (0-100) внутри текущего уровня */
export function getLevelProgress(points: number, level: number): number {
  const info = getLevelInfo(level);
  if (info.maxXp === Infinity) return 100;
  const range = info.maxXp - info.minXp;
  const progress = points - info.minXp;
  return Math.min(100, Math.max(0, Math.round((progress / range) * 100)));
}

/** Можно ли получить ежедневную награду (не более одного раза в день) */
export function canClaimDaily(lastDailyClaim: string | null): boolean {
  if (!lastDailyClaim) return true;
  const last = new Date(lastDailyClaim);
  const now = new Date();
  return last.toDateString() !== now.toDateString();
}

/** Собрать компактный профиль для sidebar/dashboard */
export function buildMiniProfile(profile: LoyaltyProfile): LoyaltyMiniProfile {
  const levelInfo = getLevelInfo(profile.level);
  const nextInfo = LEVELS[profile.level]; // следующий уровень
  return {
    level: profile.level,
    levelName: levelInfo.name,
    levelIcon: levelInfo.icon,
    points: profile.points,
    xpProgress: getLevelProgress(profile.totalPointsEarned, profile.level),
    currentXp: profile.totalPointsEarned,
    nextLevelXp: nextInfo ? nextInfo.minXp : levelInfo.minXp,
    pointsAsRubles: profile.pointsAsRubles ?? Math.floor(profile.points * (profile.conversionRate ?? 1)),
    currentStreak: profile.currentStreak,
    canClaimDaily: canClaimDaily(profile.lastDailyClaim),
  };
}

/** Объединить определения достижений с разблокированными */
export function buildAchievementBadges(
  unlocked: { achievementId: string; unlockedAt: string }[]
): AchievementBadge[] {
  const unlockedMap = new Map(unlocked.map(u => [u.achievementId, u.unlockedAt]));
  return ACHIEVEMENT_DEFS.map(def => ({
    ...def,
    unlocked: unlockedMap.has(def.id),
    unlockedAt: unlockedMap.get(def.id),
  }));
}
