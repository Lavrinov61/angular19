-- Migration 109: Registration source tracking (UTM, referrer, IP) + perf indexes
-- Idempotent. Safe to re-apply.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_source VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(256);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_ip INET;

COMMENT ON COLUMN users.utm_source IS 'UTM source captured at registration (e.g. google, direct, instagram)';
COMMENT ON COLUMN users.utm_medium IS 'UTM medium captured at registration (e.g. cpc, organic, social)';
COMMENT ON COLUMN users.utm_campaign IS 'UTM campaign captured at registration';
COMMENT ON COLUMN users.referrer IS 'HTTP Referer header captured at registration';
COMMENT ON COLUMN users.registration_ip IS 'IP address captured at registration';

CREATE INDEX IF NOT EXISTS idx_users_role_created_at ON users(role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email_verified_created_at ON users(created_at DESC) WHERE email_verified = true;
CREATE INDEX IF NOT EXISTS idx_users_created_at_desc ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_utm_source_created_at ON users(utm_source, created_at DESC) WHERE utm_source IS NOT NULL;

COMMIT;
