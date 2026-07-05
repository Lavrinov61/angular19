-- Allow non-fiscal bank transfer payments in POS receipts.
ALTER TABLE pos_receipt_payments
  DROP CONSTRAINT IF EXISTS pos_receipt_payments_payment_type_check;

ALTER TABLE pos_receipt_payments
  ADD CONSTRAINT pos_receipt_payments_payment_type_check
  CHECK (payment_type IN ('cash', 'card', 'sbp', 'online', 'subscription', 'transfer'));
