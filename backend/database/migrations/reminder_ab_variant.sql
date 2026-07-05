-- 22h A/B reminder: add variant tracking column
-- Idempotent: safe to run multiple times

ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS reminder_ab_variant varchar(1);

COMMENT ON COLUMN photo_print_orders.reminder_ab_variant
  IS 'A/B test variant: A=standard, B=volume+urgency';
