-- In-person student verification without storing document scans.
-- Employee prepares/certifies a physical document; student activates from own phone session.

BEGIN;

ALTER TABLE student_verifications
  DROP CONSTRAINT IF EXISTS student_verifications_status_check,
  ADD CONSTRAINT student_verifications_status_check
    CHECK (status IN ('pending', 'pending_in_person', 'approved', 'rejected', 'cancelled'));

ALTER TABLE student_verifications
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'online_upload',
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT,
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS referral_channel VARCHAR(40),
  ADD COLUMN IF NOT EXISTS referred_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_by_employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_by_student_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS in_person_prepared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS student_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_version TEXT,
  ADD COLUMN IF NOT EXISTS consented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_ip TEXT,
  ADD COLUMN IF NOT EXISTS consent_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS employee_ip TEXT,
  ADD COLUMN IF NOT EXISTS employee_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS education_fields_cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audit_retention_until TIMESTAMPTZ;

ALTER TABLE student_verifications
  ALTER COLUMN account_id DROP NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN document_photo_key DROP NOT NULL,
  ALTER COLUMN document_photo_content_type DROP NOT NULL,
  ALTER COLUMN document_photo_size_bytes DROP NOT NULL;

ALTER TABLE student_verifications
  DROP CONSTRAINT IF EXISTS student_verifications_document_photo_size_bytes_check,
  ADD CONSTRAINT student_verifications_document_photo_size_bytes_check
    CHECK (document_photo_size_bytes IS NULL OR document_photo_size_bytes > 0),
  DROP CONSTRAINT IF EXISTS student_verifications_source_check,
  ADD CONSTRAINT student_verifications_source_check
    CHECK (source IN ('online_upload', 'in_person')),
  DROP CONSTRAINT IF EXISTS student_verifications_document_type_check,
  ADD CONSTRAINT student_verifications_document_type_check
    CHECK (
      document_type IS NULL
      OR document_type IN (
        'student_card',
        'grade_book',
        'study_certificate',
        'teacher_id',
        'admission_document',
        'other'
      )
    ),
  DROP CONSTRAINT IF EXISTS student_verifications_referral_channel_check,
  ADD CONSTRAINT student_verifications_referral_channel_check
    CHECK (
      referral_channel IS NULL
      OR referral_channel IN (
        'classmate',
        'friend',
        'social',
        'repeat_customer',
        'walk_in',
        'employee_told',
        'other'
      )
    );

DROP INDEX IF EXISTS idx_student_verifications_one_pending;
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_verifications_one_pending
  ON student_verifications(user_id)
  WHERE user_id IS NOT NULL AND status IN ('pending', 'pending_in_person');

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_verifications_one_pending_phone
  ON student_verifications(phone_normalized)
  WHERE phone_normalized IS NOT NULL AND status = 'pending_in_person';

CREATE INDEX IF NOT EXISTS idx_student_verifications_in_person_employee
  ON student_verifications(verified_by_employee_id, submitted_at DESC)
  WHERE source = 'in_person';

COMMENT ON COLUMN student_verifications.source IS
  'Verification source: online_upload stores a document image; in_person stores employee certification metadata without a scan.';
COMMENT ON COLUMN student_verifications.phone_normalized IS
  'Full normalized phone used to bind pending in-person verification to the student OTP session.';
COMMENT ON COLUMN student_verifications.consent_version IS
  'Student program consent version accepted by the student client session.';
COMMENT ON COLUMN student_verifications.education_fields_cleared_at IS
  'When education metadata was cleared/anonymized after expiry, revocation, or consent withdrawal.';

COMMIT;
