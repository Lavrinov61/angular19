-- Payment events log — tracks all payment lifecycle events per order
-- Used for: payment timeline UI in order details, analytics, debugging

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  transaction_id VARCHAR(100),
  amount DECIMAL(10,2),
  card_info VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pe_order_created ON payment_events(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pe_event_type ON payment_events(event_type);
