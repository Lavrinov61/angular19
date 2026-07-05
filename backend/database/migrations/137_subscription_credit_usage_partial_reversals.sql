-- Allow multiple partial reversal rows for one original credit usage row.

DROP INDEX IF EXISTS idx_credit_usage_one_reversal;

CREATE INDEX IF NOT EXISTS idx_credit_usage_reversal_of
  ON subscription_credit_usage_log(reversal_of_usage_log_id)
  WHERE reversal_of_usage_log_id IS NOT NULL;
