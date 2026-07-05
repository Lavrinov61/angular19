-- Online Payment Attribution: track which employee initiated a chat order
-- Idempotent migration

-- 1. Add initiated_by column for tracking who created order via chat
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS initiated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- 2. Partial index on initiated_by (only non-null rows)
CREATE INDEX IF NOT EXISTS idx_photo_print_orders_initiated_by ON photo_print_orders(initiated_by) WHERE initiated_by IS NOT NULL;

-- 3. Indexes on employee_sales for online source queries
CREATE INDEX IF NOT EXISTS idx_employee_sales_source ON employee_sales(source) WHERE source = 'online';
CREATE INDEX IF NOT EXISTS idx_employee_sales_employee_source_date ON employee_sales(employee_id, source, created_at DESC);
