-- pos_transactions Phase 5: Extend existing table for POS Agent MQTT integration
-- Original table from Phase 0 has: id, studio_id, agent_id, transaction_type, amount,
--   currency, terminal_response, fiscal_receipt, order_id, status, error_message,
--   initiated_at, completed_at

-- Add Phase 5 columns for terminal-level tracking
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES pos_receipts(id);
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS approval_code VARCHAR(20);
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS rrn VARCHAR(30);
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS card_mask VARCHAR(30);
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS sbp_qr_data TEXT;
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS sbp_paid BOOLEAN DEFAULT FALSE;
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS fiscal_number VARCHAR(50);
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS fiscal_sign VARCHAR(50);
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS fiscal_receipt_url TEXT;
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS initiated_by UUID REFERENCES users(id);

-- Extend transaction_type check to include fiscal operations
ALTER TABLE pos_transactions DROP CONSTRAINT IF EXISTS pos_transactions_transaction_type_check;
ALTER TABLE pos_transactions ADD CONSTRAINT pos_transactions_transaction_type_check
  CHECK (transaction_type IN ('payment','refund','sbp_payment','sbp_refund','fiscal_sale','fiscal_refund'));

-- Extend status check to include timeout
ALTER TABLE pos_transactions DROP CONSTRAINT IF EXISTS pos_transactions_status_check;
ALTER TABLE pos_transactions ADD CONSTRAINT pos_transactions_status_check
  CHECK (status IN ('pending','processing','completed','failed','timeout','cancelled'));

-- Index for receipt lookup
CREATE INDEX IF NOT EXISTS idx_pos_transactions_receipt ON pos_transactions(receipt_id) WHERE receipt_id IS NOT NULL;

-- Trigger: NOTIFY on new pending transaction (for PG LISTEN → MQTT dispatch)
CREATE OR REPLACE FUNCTION notify_pos_transaction_new() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM pg_notify('pos_transactions_new', json_build_object(
      'id', NEW.id,
      'studio_id', NEW.studio_id,
      'agent_id', NEW.agent_id,
      'transaction_type', NEW.transaction_type,
      'amount', NEW.amount,
      'status', NEW.status
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pos_transaction_new ON pos_transactions;
CREATE TRIGGER trg_pos_transaction_new
  AFTER INSERT ON pos_transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_pos_transaction_new();
