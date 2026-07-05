-- Add telegram_notified_at to infra_alerts for dispatcher deduplication
-- Idempotent migration

ALTER TABLE infra_alerts ADD COLUMN IF NOT EXISTS telegram_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_infra_alerts_unnotified_critical
  ON infra_alerts(created_at DESC)
  WHERE severity = 'critical'
    AND is_acknowledged = FALSE
    AND telegram_notified_at IS NULL
    AND resolved_at IS NULL;
