-- Link subscription credit usage to online/photo print orders.

ALTER TABLE subscription_credit_usage_log
  ADD COLUMN IF NOT EXISTS print_order_id UUID REFERENCES photo_print_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sub_credit_usage_print_order
  ON subscription_credit_usage_log(print_order_id)
  WHERE print_order_id IS NOT NULL;

COMMENT ON COLUMN subscription_credit_usage_log.print_order_id IS
  'Photo print order that consumed or restored subscription credits outside POS receipts.';
