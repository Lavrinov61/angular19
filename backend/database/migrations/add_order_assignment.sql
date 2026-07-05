-- Add order assignment support
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS assigned_employee_id UUID REFERENCES users(id);
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_assigned ON photo_print_orders(assigned_employee_id) WHERE assigned_employee_id IS NOT NULL;
