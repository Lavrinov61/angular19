/** JSONB contracts for users.preferences, users.personal_data, users.linked_accounts */

export interface UserPreferences {
  notifications?: { email?: boolean; push?: boolean; telegram?: boolean };
  theme?: 'light' | 'dark';
  language?: string;
  phoneRequirementSkippedAt?: string;
  phoneRequirementSkipReason?: string;
  phoneRequirementSkipSource?: string;
  /** Transitional: frontend may send additional fields. Remove after full frontend typing. */
  [key: string]: unknown;
}

export interface UserPersonalData {
  birthDate?: string;
  address?: string;
  city?: string;
  /** Transitional: frontend may send additional fields. Remove after full frontend typing. */
  [key: string]: unknown;
}

export interface LinkedAccounts {
  telegram_chat_id?: string;
  /** Transitional: frontend may send additional fields. Remove after full frontend typing. */
  [key: string]: unknown;
}
