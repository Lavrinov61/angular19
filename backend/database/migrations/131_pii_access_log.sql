-- Migration 131 — pii_access_log (append-only audit trail for PII reads)
-- Used by backend/src/middleware/pii-audit.ts — fire-and-forget inserts from CRM endpoints.

CREATE TABLE IF NOT EXISTS pii_access_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID,
  user_role    TEXT,
  target_type  TEXT NOT NULL,
  target_id    TEXT,
  action       TEXT NOT NULL DEFAULT 'read',
  ip           INET,
  user_agent   TEXT,
  accessed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pii_audit_accessed
  ON pii_access_log (accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pii_audit_user
  ON pii_access_log (user_id, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pii_audit_target
  ON pii_access_log (target_type, target_id);

-- WORM: reject UPDATE / DELETE so audit log stays append-only.
CREATE OR REPLACE FUNCTION pii_access_log_worm()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pii_access_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS pii_access_log_no_update ON pii_access_log;
CREATE TRIGGER pii_access_log_no_update
  BEFORE UPDATE ON pii_access_log
  FOR EACH ROW
  EXECUTE FUNCTION pii_access_log_worm();

DROP TRIGGER IF EXISTS pii_access_log_no_delete ON pii_access_log;
CREATE TRIGGER pii_access_log_no_delete
  BEFORE DELETE ON pii_access_log
  FOR EACH ROW
  EXECUTE FUNCTION pii_access_log_worm();
