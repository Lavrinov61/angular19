-- 070_unified_shift_commission.sql
-- Связь employee_shifts <-> pos_shifts, атрибуция продаж к сменам
-- Идемпотентная миграция

BEGIN;

-- 1a. employee_sales: shift_id для привязки к смене
ALTER TABLE employee_sales ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES employee_shifts(id);
CREATE INDEX IF NOT EXISTS idx_employee_sales_shift_id ON employee_sales(shift_id) WHERE shift_id IS NOT NULL;

-- 1b. employee_sales: source (pos/online/manual)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_sales' AND column_name = 'source'
  ) THEN
    ALTER TABLE employee_sales ADD COLUMN source varchar(20) DEFAULT 'pos'
      CHECK (source IN ('pos', 'online', 'manual'));
  END IF;
END $$;

-- 1c. employee_shifts: pos_shift_id для связи с POS
ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS pos_shift_id uuid REFERENCES pos_shifts(id);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_pos_shift_id ON employee_shifts(pos_shift_id) WHERE pos_shift_id IS NOT NULL;

-- 1d. employee_shifts: кэш commission_total, sales_total, receipts_count
ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS commission_total numeric(12,2) DEFAULT 0;
ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS sales_total numeric(12,2) DEFAULT 0;
ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS receipts_count integer DEFAULT 0;

-- 1e. Индекс для быстрого поиска online-продаж по assigned_employee_id
CREATE INDEX IF NOT EXISTS idx_orders_assigned_period
  ON photo_print_orders(assigned_employee_id, created_at DESC)
  WHERE assigned_employee_id IS NOT NULL AND payment_status = 'paid';

COMMIT;
