-- Channel Health Probes — active credential verification fields
-- Applied: 2026-03-13

ALTER TABLE channel_accounts
  ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_check_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS health_check_error TEXT;

COMMENT ON COLUMN channel_accounts.last_health_check_at IS 'Timestamp of last active health probe';
COMMENT ON COLUMN channel_accounts.health_check_ok IS 'Result of last credential verification';
COMMENT ON COLUMN channel_accounts.health_check_error IS 'Error message from last failed health probe';
