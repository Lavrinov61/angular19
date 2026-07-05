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
