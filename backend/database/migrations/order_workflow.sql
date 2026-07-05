-- Plan 6: Order Workflow + Employee Skills + Inventory Receipts
-- order_assignments: назначение заказов сотрудникам
-- inventory_receipts: приёмка товара

-- 1. Навыки сотрудников
ALTER TABLE users ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}';
-- Возможные навыки: 'photographer','retoucher','artist','artist_expert','printer_operator','manager'

-- 2. Назначения заказов
CREATE TABLE IF NOT EXISTS order_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR(100) NOT NULL,
  order_type VARCHAR(30) NOT NULL
    CHECK (order_type IN ('print','retouch','photo','marketplace','scan','design','other')),
  order_summary TEXT,
  source VARCHAR(20) DEFAULT 'online'
    CHECK (source IN ('online','pos','chat','phone','walk_in')),
  studio_id UUID REFERENCES studios(id),
  assigned_to UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ,
  estimated_minutes INT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','help_needed','completed','cancelled')),
  completed_at TIMESTAMPTZ,
  help_request TEXT,
  help_requested_at TIMESTAMPTZ,
  helpers UUID[] DEFAULT '{}',
  priority INT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_assignments_status
  ON order_assignments(status)
  WHERE status IN ('pending','in_progress','help_needed');
CREATE INDEX IF NOT EXISTS idx_order_assignments_assigned
  ON order_assignments(assigned_to)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_assignments_studio
  ON order_assignments(studio_id);
CREATE INDEX IF NOT EXISTS idx_order_assignments_deadline
  ON order_assignments(deadline_at)
  WHERE status NOT IN ('completed','cancelled');

-- 3. Приёмка товара
CREATE TABLE IF NOT EXISTS inventory_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id),
  studio_id UUID NOT NULL REFERENCES studios(id),
  supplier VARCHAR(255),
  invoice_number VARCHAR(100),
  items JSONB NOT NULL DEFAULT '[]',
  -- каждый элемент: {"product_id":"uuid","product_name":"str","quantity":10,"condition":"good|damaged","notes":""}
  total_items INT DEFAULT 0,
  notes TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_receipts_studio ON inventory_receipts(studio_id);
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_date ON inventory_receipts(received_at);
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_employee ON inventory_receipts(employee_id);
