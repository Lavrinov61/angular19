-- Add partial index on photo_format for filtering queries
-- Idempotent: IF NOT EXISTS
CREATE INDEX IF NOT EXISTS idx_ppo_photo_format
  ON photo_print_orders (photo_format) WHERE photo_format IS NOT NULL;
