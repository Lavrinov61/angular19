/**
 * View types for customer account discount resolution.
 */

import type { UsersId } from '../generated/public/Users.js';

export type CustomerAccountType = 'personal' | 'education' | 'business';

export type AccountDiscountSource =
  | 'none'
  | 'default'
  | 'explicit'
  | 'education_verification'
  | 'education_verified_only';
export type AccountDiscountKind = 'document_print' | 'photo_print';

export interface AccountDiscountJsonb {
  account_type?: unknown;
  accountType?: unknown;
  preferences?: AccountDiscountJsonb | null;
  [key: string]: unknown;
}

export interface AccountDiscountUserRow {
  id: UsersId;
  phone: string | null;
  account_type: string | null;
  personal_data: AccountDiscountJsonb | null;
  preferences: AccountDiscountJsonb | null;
}

export interface AccountDiscountProfile {
  accountType: CustomerAccountType;
  label: string;
  discountPercent: number;
  documentPrintDiscountPercent: number;
  photoPrintDiscountPercent: number;
  source: AccountDiscountSource;
}

export interface AccountDiscountRule {
  kind: AccountDiscountKind;
  label: string;
  percent: number;
}

export interface AccountDiscountLineSummary {
  serviceOptionId: string;
  name: string;
  kind: AccountDiscountKind;
  label: string;
  percent: number;
  amount: number;
  quantity: number;
}

export interface AccountDiscountSummary extends Pick<AccountDiscountProfile, 'accountType' | 'label' | 'source'> {
  percent: number;
  amount: number;
  description: string;
  lines: AccountDiscountLineSummary[];
}
