import type { StudentDiscountRedemptionMetadata } from '../jsonb/student-discount-jsonb.js';

export type StudentDiscountStatus = 'active' | 'expired' | 'revoked';
export type StudentDiscountBenefitType = 'print_a4_bw' | 'print_a4_color' | 'binding_spring_a4' | 'photo_print';
export type StudentAccountStatus = 'pending' | 'verified' | 'rejected' | 'revoked' | 'expired';
export type StudentVerificationStatus = 'pending' | 'pending_in_person' | 'approved' | 'rejected' | 'cancelled';
export type StudentVerificationSource = 'online_upload' | 'in_person';
export type EducationRole = 'student' | 'applicant' | 'teacher' | 'lecturer' | 'staff';
export type EducationDocumentType =
  | 'student_card'
  | 'grade_book'
  | 'study_certificate'
  | 'teacher_id'
  | 'admission_document'
  | 'other';
export type StudentReferralChannel =
  | 'classmate'
  | 'friend'
  | 'social'
  | 'repeat_customer'
  | 'walk_in'
  | 'employee_told'
  | 'other';

export interface StudentDiscountEntitlementRow {
  id: string;
  user_id: string;
  status: StudentDiscountStatus;
  source_token: string;
  source_url: string | null;
  student_account_id: string | null;
  activated_at: string;
  expires_at: string;
  print_sheets_used: number | string;
  binding_uses: number | string;
  created_at: string;
  updated_at: string;
}

export interface StudentDiscountUserLookupRow {
  id: string;
  user_id: string;
  status: StudentDiscountStatus;
  source_token: string;
  source_url: string | null;
  student_account_id: string | null;
  activated_at: string;
  expires_at: string;
  print_sheets_used: number | string;
  binding_uses: number | string;
  created_at: string;
  updated_at: string;
}

export interface StudentDiscountReceiptItemLookupRow {
  product_id: string;
  service_option_slug: string | null;
  service_option_name: string | null;
}

export interface StudentDiscountRedemptionUsageRow {
  entitlement_id: string;
  user_id: string;
  allowance_period_id: string | null;
  benefit_type: StudentDiscountBenefitType;
  units: number | string;
}

export interface StudentDiscountPartialRedemptionRow extends StudentDiscountRedemptionUsageRow {
  id: string;
  discount_amount: number | string;
  metadata: StudentDiscountRedemptionMetadata | null;
}

export interface StudentAllowancePeriodRow {
  id: string;
  entitlement_id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  sheet_limit: number | string;
  sheet_price: number | string;
  sheets_used: number | string;
  photo_limit: number | string;
  photos_used: number | string;
  created_at: string;
  updated_at: string;
}

export interface StudentAllowancePeriodUpdateRow {
  id: string;
}

export interface StudentAccountRow {
  id: string;
  user_id: string;
  status: StudentAccountStatus;
  education_role: EducationRole;
  institution_name: string | null;
  document_number: string | null;
  verified_at: string | null;
  expires_at: string | null;
  reviewer_id: string | null;
  reject_reason: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentVerificationRow {
  id: string;
  account_id: string | null;
  user_id: string | null;
  status: StudentVerificationStatus;
  source: StudentVerificationSource;
  education_role: EducationRole;
  institution_name: string;
  document_type: EducationDocumentType | null;
  document_expires_at: string | null;
  document_photo_key: string | null;
  document_photo_content_type: string | null;
  document_photo_size_bytes: number | string | null;
  phone_normalized: string | null;
  referral_channel: StudentReferralChannel | null;
  referred_by_user_id: string | null;
  verified_by_employee_id: string | null;
  confirmed_by_student_user_id: string | null;
  in_person_prepared_at: string | null;
  student_confirmed_at: string | null;
  consent_version: string | null;
  consented_at: string | null;
  consent_ip: string | null;
  consent_user_agent: string | null;
  employee_ip: string | null;
  employee_user_agent: string | null;
  education_fields_cleared_at: string | null;
  audit_retention_until: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_id: string | null;
  reject_reason: string | null;
  review_notes: string | null;
  retention_delete_after: string | null;
  photo_deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
