-- Add payment_reminder_sent column to photo_print_orders
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS payment_reminder_sent BOOLEAN DEFAULT FALSE;
