-- Plan 4: Service Work Timer + Material Usage
-- service_work_logs: поминутный расчёт работы
-- material_usage: учёт расхода материалов

-- 1. Таблица логов работы по услугам
CREATE TABLE IF NOT EXISTS service_work_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID REFERENCES pos_receipts(id) ON DELETE SET NULL,
  employee_id UUID NOT NULL REFERENCES users(id),
  studio_id UUID NOT NULL REFERENCES studios(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_minutes INT,
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 2000.00,
  calculated_amount NUMERIC(10,2),
  is_custom_order BOOLEAN NOT NULL DEFAULT false,
  custom_surcharge NUMERIC(10,2) DEFAULT 0,
  custom_surcharge_reason TEXT,
  order_description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_work_logs_employee ON service_work_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_service_work_logs_status ON service_work_logs(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_service_work_logs_receipt ON service_work_logs(receipt_id) WHERE receipt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_work_logs_started ON service_work_logs(started_at);

-- 2. Таблица расхода материалов
CREATE TABLE IF NOT EXISTS material_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID REFERENCES pos_receipts(id) ON DELETE SET NULL,
  work_log_id UUID REFERENCES service_work_logs(id) ON DELETE SET NULL,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity NUMERIC(10,3) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'sheets'
    CHECK (unit IN ('sheets', 'ml', 'pieces', 'meters')),
  studio_id UUID NOT NULL REFERENCES studios(id),
  employee_id UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_usage_product ON material_usage(product_id);
CREATE INDEX IF NOT EXISTS idx_material_usage_studio ON material_usage(studio_id);
CREATE INDEX IF NOT EXISTS idx_material_usage_created ON material_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_material_usage_work_log ON material_usage(work_log_id) WHERE work_log_id IS NOT NULL;

-- 3. Расширение product_stock для учёта чернил
ALTER TABLE product_stock ADD COLUMN IF NOT EXISTS estimated_ink_ml NUMERIC(10,1);
ALTER TABLE product_stock ADD COLUMN IF NOT EXISTS last_refill_at TIMESTAMPTZ;

-- 4. Категории расходников для фотостудий
INSERT INTO product_categories (name, sort_order, icon, is_active)
VALUES
  ('Фотобумага', 10, 'photo', true),
  ('Обычная бумага', 11, 'description', true),
  ('Чернила и тонеры', 12, 'ink_pen', true),
  ('Рамки', 13, 'crop_portrait', true),
  ('Сувенирная продукция', 14, 'redeem', true)
ON CONFLICT DO NOTHING;

-- 5. Предзаполнение фотобумаги
INSERT INTO products (name, product_type, unit, category_id, sell_price, cost_price, is_active, metadata)
SELECT vals.name, 'product', 'sheet', pc.id, vals.sell_price, vals.cost_price, true, vals.metadata::jsonb
FROM product_categories pc
CROSS JOIN (VALUES
  ('Фотобумага 10x15 Premium', 5.00, 2.50, '{"size":"10x15","type":"premium","gsm":260}'),
  ('Фотобумага 10x15 Super', 8.00, 4.00, '{"size":"10x15","type":"super","gsm":300}'),
  ('Фотобумага 15x21 Premium', 12.00, 6.00, '{"size":"15x21","type":"premium","gsm":260}'),
  ('Фотобумага 15x21 Super', 18.00, 9.00, '{"size":"15x21","type":"super","gsm":300}'),
  ('Фотобумага 21x30 (A4) Premium', 25.00, 12.00, '{"size":"21x30","type":"premium","gsm":260}'),
  ('Фотобумага 30x40 Premium', 60.00, 30.00, '{"size":"30x40","type":"premium","gsm":260}'),
  ('Фотобумага 40x50 Premium', 100.00, 50.00, '{"size":"40x50","type":"premium","gsm":260}')
) AS vals(name, sell_price, cost_price, metadata)
WHERE pc.name = 'Фотобумага'
ON CONFLICT DO NOTHING;

-- 6. Предзаполнение обычной бумаги
INSERT INTO products (name, product_type, unit, category_id, sell_price, cost_price, is_active, metadata)
SELECT vals.name, 'product', 'sheet', pc.id, vals.sell_price, vals.cost_price, true, vals.metadata::jsonb
FROM product_categories pc
CROSS JOIN (VALUES
  ('Бумага A4 80g офисная', 0.50, 0.30, '{"size":"A4","gsm":80}'),
  ('Бумага A3 80g офисная', 1.00, 0.60, '{"size":"A3","gsm":80}'),
  ('Бумага A4 матовая 120g', 2.00, 1.00, '{"size":"A4","gsm":120,"type":"matte"}'),
  ('Бумага A4 глянцевая 150g', 3.00, 1.50, '{"size":"A4","gsm":150,"type":"glossy"}')
) AS vals(name, sell_price, cost_price, metadata)
WHERE pc.name = 'Обычная бумага'
ON CONFLICT DO NOTHING;
