-- Order delay compensation tracking
-- Tracks operator-initiated delay notifications with optional loyalty compensation

CREATE TABLE IF NOT EXISTS order_delay_compensations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR(100) NOT NULL,
  reason VARCHAR(100) NOT NULL,
  compensation_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  message_sent BOOLEAN NOT NULL DEFAULT false,
  chat_session_id UUID,
  credited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_delay_order ON order_delay_compensations(order_id);
CREATE INDEX IF NOT EXISTS idx_order_delay_created ON order_delay_compensations(created_at DESC);

-- Daily total view for limit enforcement
CREATE OR REPLACE VIEW order_delay_daily_total AS
  SELECT credited_by, DATE(created_at) AS day, SUM(compensation_amount) AS total
  FROM order_delay_compensations
  WHERE created_at >= CURRENT_DATE
  GROUP BY credited_by, DATE(created_at);
