-- Allow POS receipts without a shift (shift-less cash/card/sbp payments)
-- Idempotent: safe to run multiple times

-- Drop the FK constraint first, then alter the column
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pos_receipts'
      AND column_name = 'shift_id'
      AND is_nullable = 'NO'
  ) THEN
    -- Drop FK constraint if exists
    ALTER TABLE pos_receipts DROP CONSTRAINT IF EXISTS pos_receipts_shift_id_fkey;
    -- Make shift_id nullable
    ALTER TABLE pos_receipts ALTER COLUMN shift_id DROP NOT NULL;
    -- Re-add FK constraint (nullable)
    ALTER TABLE pos_receipts ADD CONSTRAINT pos_receipts_shift_id_fkey
      FOREIGN KEY (shift_id) REFERENCES pos_shifts(id);
  END IF;
END $$;
