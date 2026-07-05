-- Добавить поля промокода в photo_print_orders
ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS promo_discount NUMERIC(10,2) DEFAULT 0;
