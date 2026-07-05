-- 140_student_verification_monthly_allowance.sql
-- Photo-based student verification and monthly student print allowance.

BEGIN;

CREATE TABLE IF NOT EXISTS student_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected', 'revoked', 'expired')),
  institution_name TEXT,
  document_number TEXT,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reject_reason TEXT,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_student_accounts_status
  ON student_accounts(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_student_accounts_reviewer
  ON student_accounts(reviewer_id)
  WHERE reviewer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS student_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES student_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  institution_name TEXT NOT NULL,
  document_expires_at DATE,
  document_photo_key TEXT NOT NULL,
  document_photo_content_type TEXT NOT NULL,
  document_photo_size_bytes INTEGER NOT NULL CHECK (document_photo_size_bytes > 0),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reject_reason TEXT,
  review_notes TEXT,
  retention_delete_after TIMESTAMPTZ,
  photo_deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_verifications_one_pending
  ON student_verifications(user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_student_verifications_status_submitted
  ON student_verifications(status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_verifications_account
  ON student_verifications(account_id, submitted_at DESC);

ALTER TABLE student_discount_entitlements
  ADD COLUMN IF NOT EXISTS student_account_id UUID REFERENCES student_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_student_discount_entitlements_student_account
  ON student_discount_entitlements(student_account_id)
  WHERE student_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS student_allowance_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id UUID NOT NULL REFERENCES student_discount_entitlements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  sheet_limit INTEGER NOT NULL DEFAULT 100 CHECK (sheet_limit >= 0),
  sheet_price NUMERIC(10,2) NOT NULL DEFAULT 3 CHECK (sheet_price >= 0),
  sheets_used INTEGER NOT NULL DEFAULT 0 CHECK (sheets_used >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entitlement_id, period_start),
  CHECK (period_end > period_start),
  CHECK (sheets_used <= sheet_limit)
);

CREATE INDEX IF NOT EXISTS idx_student_allowance_periods_user_period
  ON student_allowance_periods(user_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_student_allowance_periods_current
  ON student_allowance_periods(period_start, period_end);

INSERT INTO student_allowance_periods (
  entitlement_id,
  user_id,
  period_start,
  period_end,
  sheet_limit,
  sheet_price,
  sheets_used
)
SELECT
  s.id,
  s.user_id,
  date_trunc('month', NOW() AT TIME ZONE 'Europe/Moscow')::date,
  (date_trunc('month', NOW() AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 month')::date,
  100,
  3,
  LEAST(GREATEST(s.print_sheets_used, 0), 100)
FROM student_discount_entitlements s
WHERE s.status = 'active'
ON CONFLICT (entitlement_id, period_start) DO NOTHING;

ALTER TABLE student_discount_redemptions
  ADD COLUMN IF NOT EXISTS allowance_period_id UUID REFERENCES student_allowance_periods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS print_fill_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'pos'
    CHECK (source IN ('pos', 'online_print')),
  ADD COLUMN IF NOT EXISTS print_order_id UUID REFERENCES photo_print_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_student_discount_redemptions_allowance
  ON student_discount_redemptions(allowance_period_id)
  WHERE allowance_period_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_discount_redemptions_print_order
  ON student_discount_redemptions(print_order_id)
  WHERE print_order_id IS NOT NULL;

ALTER TABLE pos_receipt_items
  ADD COLUMN IF NOT EXISTS print_fill_percent NUMERIC(5,2);

COMMENT ON TABLE student_accounts IS
  'Verified student account lifecycle separate from discount entitlement counters.';
COMMENT ON TABLE student_verifications IS
  'Photo-document submissions and staff review audit trail for student status.';
COMMENT ON TABLE student_allowance_periods IS
  'Monthly A4 black-and-white student allowance: 100 sheets at 3 RUB by default.';
COMMENT ON COLUMN student_discount_redemptions.print_fill_percent IS
  'Observed or declared print fill percentage used to enforce the student <=15% rule.';
COMMENT ON COLUMN pos_receipt_items.print_fill_percent IS
  'Observed or declared print fill percentage for student print pricing.';

COMMIT;
