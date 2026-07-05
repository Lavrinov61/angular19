-- 080: Fiscal Pipeline Fix — connect backend to MQTT fiscal flow
-- Идемпотентная миграция

-- 1. Studio fiscal settings
ALTER TABLE studios ADD COLUMN IF NOT EXISTS inn VARCHAR(12);
ALTER TABLE studios ADD COLUMN IF NOT EXISTS kpp VARCHAR(9);
ALTER TABLE studios ADD COLUMN IF NOT EXISTS taxation_system VARCHAR(30) DEFAULT 'osn';
ALTER TABLE studios ADD COLUMN IF NOT EXISTS fiscal_enabled BOOLEAN DEFAULT false;
ALTER TABLE studios ADD COLUMN IF NOT EXISTS legal_name VARCHAR(255);

-- 2. payment_method in pos_transactions (если нет)
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'card';

-- 3. Make agent_id nullable — backend-initiated fiscal transactions don't have an agent
ALTER TABLE pos_transactions ALTER COLUMN agent_id DROP NOT NULL;

-- 4. Trigger: sync fiscal results from pos_transactions → pos_receipts
-- Колонки pos_transactions: fiscal_receipt_url, fiscal_number, fiscal_sign, error_message, status
-- Колонки pos_receipts: fiscal_receipt_url, fiscal_receipt_number, fiscal_sign, fiscal_status, fiscal_last_error
CREATE OR REPLACE FUNCTION sync_fiscal_to_receipt() RETURNS trigger AS $$
BEGIN
  IF NEW.transaction_type IN ('fiscal_sale', 'fiscal_refund')
     AND NEW.status IN ('completed', 'failed')
     AND NEW.receipt_id IS NOT NULL
  THEN
    UPDATE pos_receipts SET
      fiscal_status = CASE WHEN NEW.status = 'completed' THEN 'success' ELSE 'failed' END,
      fiscal_receipt_url = COALESCE(NEW.fiscal_receipt_url, fiscal_receipt_url),
      fiscal_receipt_number = COALESCE(NEW.fiscal_number, fiscal_receipt_number),
      fiscal_sign = COALESCE(NEW.fiscal_sign, fiscal_sign),
      fiscal_last_error = CASE WHEN NEW.status = 'failed' THEN NEW.error_message ELSE NULL END
    WHERE id = NEW.receipt_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_fiscal_receipt ON pos_transactions;
CREATE TRIGGER trg_sync_fiscal_receipt
  AFTER UPDATE ON pos_transactions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_fiscal_to_receipt();

-- 5. paper_source for print_jobs
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS paper_source VARCHAR(30) DEFAULT 'auto';
