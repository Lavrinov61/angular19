-- Migration: Add delivery fields to photo_print_orders
-- Date: 2026-02-13

ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS delivery_cost DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS delivery_postal_code VARCHAR(10);
