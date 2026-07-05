export type AuthProvider = 'yandex' | 'telegram' | 'google' | 'apple' | 'vk' | 'sber' | 'mts' | 'email' | 'phone';
export type UserRole = 'client' | 'employee' | 'admin' | 'photographer';

export interface UtmSourceBucket {
  source: string;
  count: number;
}

export interface DailyBucket {
  day: string;
  count: number;
}

export interface RoleBucket {
  role: string;
  count: number;
}

export interface RegistrationSummary {
  totalUsers: number;
  newInPeriod: number;
  previousPeriodNew: number;
  clients: number;
  staff: number;
  viaYandex: number;
  viaTelegram: number;
  viaGoogle: number;
  viaApple: number;
  viaVk: number;
  viaSber: number;
  viaMts: number;
  viaPhone: number;
  viaEmail: number;
  viaEmailUnverified: number;
  emailVerified: number;
  hasPhone: number;
  conversionPct: number;
  avgDaysToConversion: number | null;
  repeatVisitors: number;
  topUtmSources: UtmSourceBucket[];
}

export interface RegistrationStatsResponse {
  success: true;
  period: string;
  summary: RegistrationSummary;
  daily: DailyBucket[];
  byRole: RoleBucket[];
}

export interface RecentQueryFilters {
  role?: string;
  provider?: AuthProvider;
  search?: string;
  verified?: boolean;
  hasOrder?: boolean;
}

export interface RecentUserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: string;
  email_verified: boolean;
  phone_verified: boolean;
  is_active: boolean;
  auth_provider: AuthProvider;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  has_order: boolean;
  created_at: string;
}

export interface RecentResponse {
  success: true;
  data: RecentUserRow[];
  total: number;
  page: number;
  limit: number;
}

export type FunnelStageKey = 'registered' | 'emailVerified' | 'hasPhone' | 'hasOrder';

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  count: number;
  pct: number;
}

export interface FunnelResponse {
  success: true;
  period: string;
  stages: FunnelStage[];
}
