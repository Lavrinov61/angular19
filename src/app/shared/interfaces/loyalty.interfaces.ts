export interface LoyaltyProfile {
  id: string;
  points: number;
  totalPointsEarned: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lastDailyClaim: string | null;
  referralCode: string;
  referredBy: string | null;
  totalOrders: number;
  totalSpent: number;
  invitedCount: number;
  conversionRate: number;
  pointsAsRubles: number;
  levelName: string;
}

export interface Achievement {
  achievementId: string;
  unlockedAt: string;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  xpReward?: number;
}

export interface AchievementBadge extends AchievementDef {
  unlocked: boolean;
  unlockedAt?: string;
  /** Прогресс 0-100 для частично выполненных достижений */
  progress?: number;
}

export interface LoyaltyTransaction {
  amount: number;
  balance_after: number;
  action: string;
  description: string;
  created_at: string;
}

/** Компактный профиль для sidebar и dashboard */
export interface LoyaltyMiniProfile {
  level: number;
  levelName: string;
  levelIcon: string;
  points: number;
  xpProgress: number;
  currentXp: number;
  nextLevelXp: number;
  pointsAsRubles: number;
  currentStreak: number;
  canClaimDaily: boolean;
}

export interface LevelInfo {
  level: number;
  name: string;
  icon: string;
  minXp: number;
  maxXp: number;
  bonus?: string;
}
