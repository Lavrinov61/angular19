ALTER TABLE pos_transactions DROP CONSTRAINT IF EXISTS pos_transactions_transaction_type_check;

ALTER TABLE pos_transactions ADD CONSTRAINT pos_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'payment',
    'refund',
    'sbp_payment',
    'sbp_refund',
    'fiscal_sale',
    'fiscal_refund',
    'fiscal_correction',
    'shift_open',
    'shift_close',
    'cash_drawer',
    'bank_settlement'
  ));

CREATE OR REPLACE FUNCTION sync_fiscal_to_receipt() RETURNS trigger AS $$
BEGIN
  IF NEW.transaction_type IN ('fiscal_sale', 'fiscal_refund', 'fiscal_correction')
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
