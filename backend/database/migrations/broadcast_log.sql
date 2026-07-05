-- Broadcast log — tracks mass message sends for auditing and rate limiting
-- Idempotent: safe to run multiple times

CREATE TABLE IF NOT EXISTS broadcast_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id),
  user_name     text,
  channels      text[] NOT NULL,              -- e.g. {'telegram','vk','max','whatsapp'}
  message       text NOT NULL,
  total         int NOT NULL DEFAULT 0,        -- total recipients matched
  queued        int NOT NULL DEFAULT 0,        -- actually enqueued
  dry_run       boolean NOT NULL DEFAULT false,
  min_last_activity date,                      -- filter used
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_log_created_at ON broadcast_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcast_log_user_id ON broadcast_log (user_id);
