-- 104_fingerprint_visitor_id_indexes.sql
-- Purpose: speed up joins/backfills + add partial index for PATCH endpoint
-- Idempotent (IF NOT EXISTS). Safe to run multiple times.

CREATE INDEX IF NOT EXISTS idx_replay_sessions_fp_null
  ON replay_sessions (started_at DESC)
  WHERE fingerprint_visitor_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_replay_sessions_visitor_fp
  ON replay_sessions (visitor_id)
  WHERE fingerprint_visitor_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_replay_sessions_fp_populated
  ON replay_sessions (fingerprint_visitor_id)
  WHERE fingerprint_visitor_id IS NOT NULL;
