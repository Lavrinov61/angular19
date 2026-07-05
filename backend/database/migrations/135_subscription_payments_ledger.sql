-- Subscription payment ledger: provider events and period-level credit idempotency.

CREATE TABLE IF NOT EXISTS subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES user_subscriptions(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL DEFAULT 'cloudpayments',
  provider_subscription_id VARCHAR(100),
  provider_transaction_id VARCHAR(100),
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'RUB',
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('paid', 'failed', 'refunded', 'cancelled')),
  kind VARCHAR(20) NOT NULL
    CHECK (kind IN ('initial', 'renewal', 'manual')),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_payments_provider_tx_unique
  ON subscription_payments(provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL AND provider_transaction_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_payments_paid_period_unique
  ON subscription_payments(subscription_id, period_start, period_end)
  WHERE status = 'paid' AND period_start IS NOT NULL AND period_end IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_payments_subscription_created
  ON subscription_payments(subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_provider_subscription
  ON subscription_payments(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- Normalize historical duplicate credit rows before adding future guards.
WITH duplicate_groups AS (
  SELECT
    (ARRAY_AGG(id ORDER BY id))[1] AS keep_id,
    ARRAY_AGG(id) AS ids
  FROM subscription_credits
  WHERE rolled_over_from IS NULL
  GROUP BY subscription_id, product_id, period_start, period_end
  HAVING COUNT(*) > 1
),
aggregated AS (
  SELECT
    dg.keep_id,
    SUM(sc.total_credits) AS total_credits,
    SUM(sc.used_credits) AS used_credits,
    MAX(sc.expires_at) AS expires_at
  FROM duplicate_groups dg
  JOIN subscription_credits sc ON sc.id = ANY(dg.ids)
  GROUP BY dg.keep_id
),
relinked_usage AS (
  UPDATE subscription_credit_usage_log log
  SET credit_id = dg.keep_id
  FROM duplicate_groups dg
  WHERE log.credit_id = ANY(dg.ids)
    AND log.credit_id <> dg.keep_id
  RETURNING log.id
),
merged_kept AS (
  UPDATE subscription_credits sc
  SET total_credits = ag.total_credits,
      used_credits = LEAST(ag.used_credits, ag.total_credits),
      expires_at = ag.expires_at
  FROM aggregated ag
  WHERE sc.id = ag.keep_id
  RETURNING sc.id
)
DELETE FROM subscription_credits sc
USING duplicate_groups dg
WHERE sc.id = ANY(dg.ids)
  AND sc.id <> dg.keep_id;

WITH duplicate_groups AS (
  SELECT
    (ARRAY_AGG(id ORDER BY id))[1] AS keep_id,
    ARRAY_AGG(id) AS ids
  FROM subscription_credits
  WHERE rolled_over_from IS NOT NULL
  GROUP BY rolled_over_from
  HAVING COUNT(*) > 1
),
aggregated AS (
  SELECT
    dg.keep_id,
    SUM(sc.total_credits) AS total_credits,
    SUM(sc.used_credits) AS used_credits,
    MAX(sc.expires_at) AS expires_at
  FROM duplicate_groups dg
  JOIN subscription_credits sc ON sc.id = ANY(dg.ids)
  GROUP BY dg.keep_id
),
relinked_usage AS (
  UPDATE subscription_credit_usage_log log
  SET credit_id = dg.keep_id
  FROM duplicate_groups dg
  WHERE log.credit_id = ANY(dg.ids)
    AND log.credit_id <> dg.keep_id
  RETURNING log.id
),
merged_kept AS (
  UPDATE subscription_credits sc
  SET total_credits = ag.total_credits,
      used_credits = LEAST(ag.used_credits, ag.total_credits),
      expires_at = ag.expires_at
  FROM aggregated ag
  WHERE sc.id = ag.keep_id
  RETURNING sc.id
)
DELETE FROM subscription_credits sc
USING duplicate_groups dg
WHERE sc.id = ANY(dg.ids)
  AND sc.id <> dg.keep_id;

-- New period credits are unique per product and period. Rollover credits are
-- protected separately by the source credit id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_credits_period_product_unique
  ON subscription_credits(subscription_id, product_id, period_start, period_end)
  WHERE rolled_over_from IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_credits_rollover_source_unique
  ON subscription_credits(rolled_over_from)
  WHERE rolled_over_from IS NOT NULL;
