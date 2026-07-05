-- Migration: pos_receipts.print_order_id integer → uuid
-- Reason: photo_print_orders.id is uuid, so FK must match type
-- Safe: table has 0 rows, no existing FK on this column

-- Step 1: Change column type from integer to uuid
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pos_receipts'
      AND column_name = 'print_order_id'
      AND udt_name = 'int4'
  ) THEN
    ALTER TABLE public.pos_receipts
      ALTER COLUMN print_order_id TYPE uuid USING NULL;
  END IF;
END $$;

-- Step 2: Add FK constraint (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_pos_receipts_print_order'
  ) THEN
    ALTER TABLE public.pos_receipts
      ADD CONSTRAINT fk_pos_receipts_print_order
      FOREIGN KEY (print_order_id) REFERENCES public.photo_print_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Step 3: Index for FK lookups (idempotent)
CREATE INDEX IF NOT EXISTS idx_pos_receipts_print_order
  ON public.pos_receipts(print_order_id)
  WHERE print_order_id IS NOT NULL;
