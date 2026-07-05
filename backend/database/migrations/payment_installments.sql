-- Payment installments — partial payments on orders
CREATE TABLE IF NOT EXISTS payment_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR(100) NOT NULL,
  installment_number INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_id VARCHAR(100),
  payment_status VARCHAR(30) DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  card_info VARCHAR(100),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, installment_number)
);

CREATE INDEX IF NOT EXISTS idx_pi_order ON payment_installments(order_id);

-- Add partial payment tracking columns to orders
ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'full';
