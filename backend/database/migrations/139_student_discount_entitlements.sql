-- 139_student_discount_entitlements.sql
-- Account-level student discount activated by the special /students link.
-- This is intentionally separate from flyer promo codes in promotions.

BEGIN;

CREATE TABLE IF NOT EXISTS student_discount_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  source_token VARCHAR(64) NOT NULL DEFAULT 'student-2026',
  source_url TEXT,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT '2026-09-30 23:59:59+03',
  print_sheets_used INTEGER NOT NULL DEFAULT 0 CHECK (print_sheets_used >= 0),
  binding_uses INTEGER NOT NULL DEFAULT 0 CHECK (binding_uses >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_student_discount_entitlements_status
  ON student_discount_entitlements(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_student_discount_entitlements_source_token
  ON student_discount_entitlements(source_token);

COMMENT ON TABLE student_discount_entitlements IS
  'Account-level student discount status activated by a special registration link, separate from flyer promo codes.';
COMMENT ON COLUMN student_discount_entitlements.status IS
  'active = student pricing can be applied; expired/revoked = keep history but do not apply.';
COMMENT ON COLUMN student_discount_entitlements.print_sheets_used IS
  'How many A4 black-and-white student-price sheets were consumed from the 100-sheet account allowance.';
COMMENT ON COLUMN student_discount_entitlements.binding_uses IS
  'How many first-binding student-price uses were consumed from the account allowance.';

CREATE TABLE IF NOT EXISTS student_discount_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id UUID NOT NULL REFERENCES student_discount_entitlements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pos_receipt_id UUID REFERENCES pos_receipts(id) ON DELETE SET NULL,
  customer_phone VARCHAR(20),
  benefit_type VARCHAR(30) NOT NULL
    CHECK (benefit_type IN ('print_a4_bw', 'binding_spring_a4')),
  units INTEGER NOT NULL CHECK (units > 0),
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_discount_redemptions_entitlement
  ON student_discount_redemptions(entitlement_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_discount_redemptions_receipt
  ON student_discount_redemptions(pos_receipt_id)
  WHERE pos_receipt_id IS NOT NULL;

COMMENT ON TABLE student_discount_redemptions IS
  'Audit trail for student account discounts applied in POS receipts.';

COMMIT;
