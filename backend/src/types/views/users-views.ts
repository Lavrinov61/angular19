import type { UsersId } from '../generated/public/Users.js';
import type { LinkedAccounts, UserPersonalData, UserPreferences } from '../jsonb/user-jsonb.js';

export interface EducationEligibilityRow {
  id: UsersId;
}

export interface CreatedStaffUserRow {
  id: UsersId;
  email: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  department: string | null;
  phone: string | null;
  role: string;
  is_active: boolean | null;
  created_at: string | null;
}

export interface StaffUserIdRow {
  id: UsersId;
}

export interface StaffListUserRow {
  id: UsersId;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  department: string | null;
  photo_url: string | null;
  role: string;
}

export interface DeletedSelfUserRow {
  id: UsersId;
  email: string | null;
  display_name: string | null;
  is_active: boolean | null;
}

export interface PhoneRequirementSkipUserRow {
  id: UsersId;
  email: string | null;
  username: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  department: string | null;
  phone: string | null;
  photo_url: string | null;
  role: string;
  email_verified: boolean | null;
  phone_verified: boolean | null;
  is_active: boolean | null;
  account_type: string | null;
  personal_data: UserPersonalData | null;
  preferences: UserPreferences | null;
  linked_accounts: LinkedAccounts | null;
  created_at: string | null;
  updated_at: string | null;
}
