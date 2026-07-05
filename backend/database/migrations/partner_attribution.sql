-- Partner Attribution Migration
-- Adds partner_promo_code tracking to orders and bookings,
-- fixes partner_referrals.order_id type from INTEGER to VARCHAR(50),
-- adds uniqueness constraint and protective indexes.

BEGIN;

-- 1. Add partner_promo_code to photo_print_orders
ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS partner_promo_code VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_photo_print_orders_partner_promo
  ON photo_print_orders (partner_promo_code)
  WHERE partner_promo_code IS NOT NULL;

-- 2. Add partner_promo_code to bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS partner_promo_code VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_bookings_partner_promo
  ON bookings (partner_promo_code)
  WHERE partner_promo_code IS NOT NULL;

-- 3. Change partner_referrals.order_id from INTEGER to VARCHAR(50)
--    (order_id in photo_print_orders is a string like 'SF-xxx')
ALTER TABLE partner_referrals
  ALTER COLUMN order_id TYPE VARCHAR(50) USING order_id::VARCHAR(50);

-- 4. Add unique constraint to prevent duplicate referrals for the same order
ALTER TABLE partner_referrals
  ADD CONSTRAINT uq_partner_referral_order
  UNIQUE (partner_id, order_id, order_type);

COMMIT;
