-- ============================================================================
-- fix_constraints.sql — Исправление проблем idempotency и ссылочной целостности
-- Применяется поверх: marketplace_services.sql, service_work_materials.sql,
--                     schedule_requests.sql, order_workflow.sql
-- ============================================================================

-- 1. UNIQUE на product_categories(name) — предотвращает дубликаты при повторном запуске миграций
ALTER TABLE product_categories
  ADD CONSTRAINT uq_product_categories_name UNIQUE (name);

-- 2. UNIQUE на products(name, category_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_name_category
  ON products (name, category_id);

-- 3. UNIQUE на price_modifiers(name, service_category_id) — предотвращает дублирование модификаторов
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_modifiers_name_category
  ON price_modifiers (name, service_category_id)
  WHERE service_category_id IS NOT NULL;

-- 4. FK: bookings.service_category_slug → service_categories(slug)
--    ON UPDATE CASCADE — если slug переименован, обновляется везде
--    ON DELETE SET NULL — если категория удалена, запись остаётся (история)
ALTER TABLE bookings
  ADD CONSTRAINT fk_bookings_service_category
    FOREIGN KEY (service_category_slug)
    REFERENCES service_categories(slug)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

-- 5. Триггеры автообновления updated_at
--    (функция update_updated_at_column() уже существует в схеме)

CREATE TRIGGER trg_schedule_requests_updated_at
  BEFORE UPDATE ON schedule_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_order_assignments_updated_at
  BEFORE UPDATE ON order_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. Добавить updated_at в service_work_logs (её не было при создании)
ALTER TABLE service_work_logs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TRIGGER trg_service_work_logs_updated_at
  BEFORE UPDATE ON service_work_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Partial unique index: один активный assignment на заказ
--    Предотвращает дублирование активных назначений одного заказа
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_assignment_active
  ON order_assignments (order_id, order_type)
  WHERE status NOT IN ('completed', 'cancelled');
