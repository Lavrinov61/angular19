-- Subscription credit usage log: audit trail for every credit deduction
-- Tracks WHO consumed credits, WHEN, for WHAT order, and HOW MANY

CREATE TABLE IF NOT EXISTS subscription_credit_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES user_subscriptions(id),
  credit_id UUID REFERENCES subscription_credits(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INT NOT NULL,
  credit_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1,
  credits_consumed INT NOT NULL,
  pos_receipt_id UUID REFERENCES pos_receipts(id),
  employee_id UUID REFERENCES users(id),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_usage_subscription ON subscription_credit_usage_log(subscription_id);
CREATE INDEX IF NOT EXISTS idx_credit_usage_created ON subscription_credit_usage_log(created_at DESC);
