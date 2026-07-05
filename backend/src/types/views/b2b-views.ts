import type { B2BJsonObject, B2BReconciliationPayload, B2BVerificationSnapshot } from '../jsonb/b2b-jsonb.js';

export type B2BOrganizationStatus = 'draft' | 'active' | 'suspended' | 'closed';
export type B2BOrganizationVerificationStatus =
  | 'unverified'
  | 'pending'
  | 'bank_identity_verified'
  | 'verified'
  | 'mismatch'
  | 'manual_review'
  | 'rejected';

export type B2BMemberRole = 'owner' | 'accountant' | 'manager' | 'employee';
export type B2BMemberStatus = 'active' | 'invited' | 'disabled';
export type B2BBillingPaymentMode = 'prepaid' | 'postpaid' | 'mixed';
export type B2BBillingAccountStatus = 'active' | 'blocked' | 'closed';

export type B2BVerificationProviderCode = 'sber_business_id' | 'alfa_business_id' | 'tbank_business_id';
export type B2BVerificationProviderStatus = 'configured' | 'planned';
export type B2BOrganizationVerificationAttemptStatus =
  | 'pending'
  | 'redirected'
  | 'authorized'
  | 'verified'
  | 'mismatch'
  | 'insufficient_permissions'
  | 'expired'
  | 'revoked'
  | 'failed'
  | 'rejected';

export type B2BInvoiceStatus = 'draft' | 'issued' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled';
export type B2BDocumentPackageStatus =
  | 'draft'
  | 'generated'
  | 'sent'
  | 'delivered'
  | 'signed'
  | 'rejected'
  | 'corrected'
  | 'cancelled';
export type B2BDocumentType = 'invoice' | 'act' | 'upd' | 'reconciliation' | 'correction';
export type B2BReconciliationTaskStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled';
export type B2BReconciliationTaskPriority = 'low' | 'normal' | 'high' | 'critical';
export type B2BBankTransactionStatus = 'new' | 'matched' | 'ignored' | 'reversed';
export type B2BLedgerDirection = 'credit' | 'debit';
export type B2BLedgerEntryType =
  | 'top_up'
  | 'print_usage'
  | 'invoice_charge'
  | 'payment_apply'
  | 'refund'
  | 'correction'
  | 'hold'
  | 'release'
  | 'document_adjustment';

export interface B2BOrganizationRow {
  id: string;
  status: B2BOrganizationStatus;
  verification_status: B2BOrganizationVerificationStatus;
  inn: string;
  kpp: string | null;
  ogrn: string | null;
  legal_name: string;
  short_name: string | null;
  legal_address: string | null;
  postal_address: string | null;
  accountant_email: string | null;
  accountant_phone: string | null;
  edo_provider: string | null;
  edo_operator_id: string | null;
  tax_system: string | null;
  vat_rate: number;
  metadata: B2BJsonObject;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface B2BOrganizationSummaryRow extends B2BOrganizationRow {
  member_id: string;
  member_role: B2BMemberRole;
  billing_account_id: string;
  billing_status: B2BBillingAccountStatus;
  payment_mode: B2BBillingPaymentMode;
  credit_limit: number;
  balance: number;
}

export interface B2BBillingAccountRow {
  id: string;
  organization_id: string;
  status: B2BBillingAccountStatus;
  payment_mode: B2BBillingPaymentMode;
  currency: string;
  credit_limit: number;
  block_reason: string | null;
  metadata: B2BJsonObject;
  created_at: string;
  updated_at: string;
}

export interface B2BMembershipAccessRow {
  organization_id: string;
  member_id: string;
  role: B2BMemberRole;
  organization_status: B2BOrganizationStatus;
  billing_account_id: string;
  billing_status: B2BBillingAccountStatus;
  payment_mode: B2BBillingPaymentMode;
  credit_limit: number;
}

export interface B2BOrganizationMemberRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  cost_center_id: string | null;
  role: B2BMemberRole;
  status: B2BMemberStatus;
  invited_email: string | null;
  invited_at: string | null;
  joined_at: string | null;
  disabled_at: string | null;
  metadata: B2BJsonObject;
  created_at: string;
  updated_at: string;
  user_email: string | null;
  user_display_name: string | null;
}

export interface B2BOrganizationVerificationRow {
  id: string;
  organization_id: string;
  provider_type: string;
  provider_code: string | null;
  status: B2BOrganizationVerificationAttemptStatus;
  external_subject_hash: string | null;
  state_hash: string | null;
  nonce_hash: string | null;
  requested_scope: string[];
  consented_scope: string[];
  snapshot: B2BVerificationSnapshot;
  error_code: string | null;
  error_message: string | null;
  started_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface B2BBankIdentityProviderDescriptor {
  code: B2BVerificationProviderCode;
  title: string;
  status: B2BVerificationProviderStatus;
  is_configured: boolean;
  required_env: string[];
}

export interface B2BBankIdentityStartResult {
  provider: B2BBankIdentityProviderDescriptor;
  verification: B2BOrganizationVerificationRow;
  authorization_url: string;
  expires_at: string;
}

export interface B2BInvoiceRow {
  id: string;
  organization_id: string;
  billing_account_id: string;
  invoice_number: string;
  status: B2BInvoiceStatus;
  payment_purpose: string;
  amount: number;
  paid_amount: number;
  currency: string;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
  created_by: string | null;
  metadata: B2BJsonObject;
  created_at: string;
  updated_at: string;
}

export interface B2BInvoiceLineRow {
  id: string;
  invoice_id: string;
  line_number: number;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  vat_rate: number;
  metadata: B2BJsonObject;
  created_at: string;
}

export interface B2BInvoiceDetailsRow extends B2BInvoiceRow {
  lines: B2BInvoiceLineRow[];
}

export interface B2BDocumentPackageRow {
  id: string;
  organization_id: string;
  service_period_id: string | null;
  invoice_id: string | null;
  document_type: B2BDocumentType;
  package_number: string;
  version: number;
  status: B2BDocumentPackageStatus;
  total_amount: number;
  currency: string;
  generated_at: string | null;
  sent_at: string | null;
  signed_at: string | null;
  metadata: B2BJsonObject;
  created_at: string;
  updated_at: string;
}

export interface B2BDocumentFileRow {
  id: string;
  document_package_id: string;
  file_kind: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  sha256_hash: string;
  version: number;
  created_at: string;
}

export interface B2BDocumentPackageDetailsRow extends B2BDocumentPackageRow {
  files: B2BDocumentFileRow[];
}

export interface B2BPrintJobUsageRow {
  id: string;
  organization_id: string;
  billing_account_id: string;
  service_period_id: string | null;
  print_job_id: string | null;
  user_id: string | null;
  member_id: string | null;
  cost_center_id: string | null;
  printer_id: string | null;
  occurred_at: string;
  service_slug: string | null;
  pages: number;
  copies: number;
  color_mode: string | null;
  paper_size: string | null;
  duplex: boolean | null;
  unit_price: number;
  amount: number;
  vat_rate: number;
  currency: string;
  status: string;
  tariff_snapshot: B2BJsonObject;
  metadata: B2BJsonObject;
  created_at: string;
  updated_at: string;
}

export interface B2BBankTransactionRow {
  id: string;
  provider_code: string;
  external_transaction_id: string | null;
  operation_date: string;
  posted_at: string | null;
  payer_inn: string | null;
  payer_kpp: string | null;
  payer_name: string | null;
  amount: number;
  currency: string;
  payment_purpose: string | null;
  direction: string;
  status: B2BBankTransactionStatus;
  created_at: string;
  updated_at: string;
}

export interface B2BBalanceLedgerRow {
  id: string;
  organization_id: string;
  billing_account_id: string;
  entry_type: B2BLedgerEntryType;
  direction: B2BLedgerDirection;
  amount: number;
  currency: string;
  invoice_id: string | null;
  bank_transaction_id: string | null;
  print_job_usage_id: string | null;
  source_type: string | null;
  source_id: string | null;
  idempotency_key: string | null;
  description: string | null;
  created_by: string | null;
  metadata: B2BJsonObject;
  created_at: string;
}

export interface B2BBalanceSummary {
  organization_id: string;
  billing_account_id: string;
  currency: string;
  balance: number;
  credit_limit: number;
  available: number;
  last_entry_at: string | null;
}

export interface B2BReconciliationTaskRow {
  id: string;
  organization_id: string | null;
  task_type: string;
  status: B2BReconciliationTaskStatus;
  priority: B2BReconciliationTaskPriority;
  bank_transaction_id: string | null;
  invoice_id: string | null;
  verification_id: string | null;
  document_package_id: string | null;
  assigned_to: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  payload: B2BReconciliationPayload;
  created_at: string;
  updated_at: string;
}

export interface B2BCountRow {
  total: number;
}

export interface B2BNextSequenceRow {
  value: string;
}

export interface B2BMutationIdRow {
  id: string;
}

export interface B2BListResult<T> {
  rows: T[];
  total: number;
}
