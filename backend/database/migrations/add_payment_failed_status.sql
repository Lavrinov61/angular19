-- Миграция: добавить статус 'payment_failed' + колонка fail_reason

ALTER TABLE photo_print_orders DROP CONSTRAINT IF EXISTS photo_print_orders_status_check;
ALTER TABLE photo_print_orders ADD CONSTRAINT photo_print_orders_status_check
  CHECK (status IN ('new', 'pending_payment', 'payment_failed', 'paid', 'processing', 'ready', 'completed', 'cancelled'));

ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS fail_reason TEXT;
