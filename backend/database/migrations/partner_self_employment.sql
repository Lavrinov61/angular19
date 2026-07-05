-- Partner self-employment verification fields
-- Проверка статуса самозанятого через ФНС API

ALTER TABLE partners ADD COLUMN IF NOT EXISTS inn VARCHAR(12);

ALTER TABLE partners ADD COLUMN IF NOT EXISTS self_employed_status VARCHAR(20)
  DEFAULT 'not_checked'
  CHECK (self_employed_status IN ('not_checked', 'pending', 'verified', 'rejected'));

ALTER TABLE partners ADD COLUMN IF NOT EXISTS self_employed_verified_at TIMESTAMPTZ;

ALTER TABLE partners ADD COLUMN IF NOT EXISTS self_employed_checked_by VARCHAR(50);
-- values: 'fns_api' | 'admin_manual'

CREATE INDEX IF NOT EXISTS idx_partners_inn ON partners(inn) WHERE inn IS NOT NULL;
