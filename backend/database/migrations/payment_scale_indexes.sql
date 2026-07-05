-- Payment system scale-up indexes for 1M DAU
-- Idempotent: all CREATE INDEX IF NOT EXISTS

-- 1. Cleanup abandoned orders — partial index for the hourly cleanup query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ppo_abandoned
  ON photo_print_orders(created_at)
  WHERE status = 'pending_payment';

-- 2. Chat order lookup by session
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ppo_session_created
  ON photo_print_orders(chat_session_id, created_at DESC)
  WHERE chat_session_id IS NOT NULL;

-- 3. Reminder queries — 2h/22h pending payment reminders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ppo_reminders
  ON photo_print_orders(created_at, reminder_sent_at)
  WHERE status IN ('pending_payment', 'payment_failed');

-- 4. Installment order+status lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pi_order_status
  ON payment_installments(order_id, payment_status);

-- 5. Active subscription lookup by phone
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_phone_active
  ON user_subscriptions(phone)
  WHERE status = 'active' AND phone IS NOT NULL;

-- 6. Webhook idempotency cleanup by date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_idem_ttl
  ON webhook_idempotency(created_at);
