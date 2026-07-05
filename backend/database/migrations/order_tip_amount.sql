-- Add tip_amount to photo_print_orders for clean separation of service cost vs tip/donation
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN photo_print_orders.tip_amount IS 'Tip/donation amount (e.g. "Support team" +39). Separate from total_price for accounting.';
