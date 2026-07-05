BEGIN;

-- employee_sales is used as an attribution ledger for POS and online sources.
-- Online payments store their source entity UUID (payment_links/photo_print_orders)
-- in receipt_id, so the historic POS-only FK must not block them.
ALTER TABLE employee_sales
  DROP CONSTRAINT IF EXISTS employee_sales_receipt_id_fkey;

COMMENT ON COLUMN employee_sales.receipt_id IS
  'Source entity UUID for sale attribution. POS uses pos_receipts.id; online sources may use payment_links.id or photo_print_orders.id.';

ALTER TABLE employee_shifts
  ADD COLUMN IF NOT EXISTS shift_kind varchar(20) NOT NULL DEFAULT 'studio';

ALTER TABLE employee_shifts
  DROP CONSTRAINT IF EXISTS employee_shifts_shift_kind_check;

ALTER TABLE employee_shifts
  ADD CONSTRAINT employee_shifts_shift_kind_check
  CHECK (shift_kind IN ('studio', 'virtual'));

CREATE INDEX IF NOT EXISTS idx_employee_shifts_virtual
  ON employee_shifts (employee_id, shift_date)
  WHERE shift_kind = 'virtual';

COMMIT;
