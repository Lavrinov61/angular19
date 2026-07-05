-- Add 'crm' to photo_print_orders mode CHECK constraint
ALTER TABLE photo_print_orders DROP CONSTRAINT IF EXISTS photo_print_orders_mode_check;
ALTER TABLE photo_print_orders ADD CONSTRAINT photo_print_orders_mode_check CHECK (mode IN ('simple', 'custom', 'crm'));
