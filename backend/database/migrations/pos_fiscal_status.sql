-- F38: Fiscal retry queue — add fiscal status tracking to pos_receipts
ALTER TABLE pos_receipts ADD COLUMN IF NOT EXISTS fiscal_status TEXT DEFAULT 'pending'
  CHECK (fiscal_status IN ('pending', 'queued', 'processing', 'success', 'failed', 'skipped'));
ALTER TABLE pos_receipts ADD COLUMN IF NOT EXISTS fiscal_attempts INT DEFAULT 0;
ALTER TABLE pos_receipts ADD COLUMN IF NOT EXISTS fiscal_last_error TEXT;
ALTER TABLE pos_receipts ADD COLUMN IF NOT EXISTS fiscal_queued_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_pos_receipts_fiscal_pending ON pos_receipts(fiscal_status) WHERE fiscal_status IN ('pending', 'queued', 'failed');
