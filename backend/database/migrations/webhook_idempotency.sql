-- Webhook idempotency — prevents double processing of payment webhooks
-- Key = {webhook_type}:{TransactionId} — unique per webhook delivery

CREATE TABLE IF NOT EXISTS webhook_idempotency (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  webhook_type    VARCHAR(50)   NOT NULL,
  order_id        VARCHAR(100),
  response_code   INT,
  response_body   JSONB,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_idem_created ON webhook_idempotency(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_idem_order   ON webhook_idempotency(order_id);
