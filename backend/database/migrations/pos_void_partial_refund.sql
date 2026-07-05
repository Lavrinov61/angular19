-- POS Void & Partial Refund support
-- Void columns for receipt cancellation
ALTER TABLE pos_receipts
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID;

-- Partial refund: link to original receipt + specific items
ALTER TABLE pos_receipts
  ADD COLUMN IF NOT EXISTS refund_items JSONB;  -- [{product_id, quantity, amount}] for partial

-- Index for shift reports (voided receipts)
CREATE INDEX IF NOT EXISTS idx_pos_receipts_voided
  ON pos_receipts(shift_id) WHERE voided_at IS NOT NULL;

-- Index for refund lookups
CREATE INDEX IF NOT EXISTS idx_pos_receipts_refund_receipt
  ON pos_receipts(refund_receipt_id) WHERE refund_receipt_id IS NOT NULL;
