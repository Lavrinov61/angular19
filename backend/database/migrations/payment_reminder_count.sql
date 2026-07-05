-- Add payment_reminder_count to track how many reminders were sent (max 3)
-- Uses reminder_sent_at (timestamptz) for last reminder timestamp (already exists)
ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS payment_reminder_count int NOT NULL DEFAULT 0;

-- Update index to cover reminder_count for scheduler queries
CREATE INDEX IF NOT EXISTS idx_ppo_payment_reminders
  ON photo_print_orders (created_at, reminder_sent_at, payment_reminder_count)
  WHERE payment_status IN ('pending_payment', 'none')
    AND status NOT IN ('completed', 'cancelled', 'expired');
