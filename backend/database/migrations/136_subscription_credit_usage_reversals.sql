-- Track subscription credit restoration rows for POS void/refund flows.

ALTER TABLE subscription_credit_usage_log
  ADD COLUMN IF NOT EXISTS reversal_of_usage_log_id UUID REFERENCES subscription_credit_usage_log(id),
  ADD COLUMN IF NOT EXISTS reversed_by_usage_log_id UUID REFERENCES subscription_credit_usage_log(id),
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_usage_one_reversal
  ON subscription_credit_usage_log(reversal_of_usage_log_id)
  WHERE reversal_of_usage_log_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_usage_pos_receipt
  ON subscription_credit_usage_log(pos_receipt_id);

CREATE INDEX IF NOT EXISTS idx_credit_usage_reversed_by
  ON subscription_credit_usage_log(reversed_by_usage_log_id)
  WHERE reversed_by_usage_log_id IS NOT NULL;
