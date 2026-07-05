-- Migration: Add payment fields to photo_print_orders
-- Adds CloudPayments payment tracking and Telegram user info

-- 1. Expand status constraint to include payment-related statuses
ALTER TABLE photo_print_orders DROP CONSTRAINT IF EXISTS photo_print_orders_status_check;
ALTER TABLE photo_print_orders ADD CONSTRAINT photo_print_orders_status_check
  CHECK (status IN ('new', 'pending_payment', 'paid', 'processing', 'ready', 'completed', 'cancelled'));

-- 2. Payment tracking fields
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'none';
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS payment_id VARCHAR(100);
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS payment_amount DECIMAL(10, 2);
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS payment_card_info VARCHAR(100);

-- 3. Telegram user info
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT;
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(255);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_ppo_payment_status ON photo_print_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_ppo_telegram_user ON photo_print_orders(telegram_user_id);
