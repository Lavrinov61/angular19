-- Dynamic Pricing System — Phase 1-4
-- Конфигурация, очередь обработки, priority purchases, price locks

-- ============================================================================
-- Phase 1: Dynamic Pricing Config
-- ============================================================================

CREATE TABLE IF NOT EXISTS dynamic_pricing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key VARCHAR(100) UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed: конфигурация градиента ночных скидок
INSERT INTO dynamic_pricing_config (config_key, config_value, description) VALUES
  ('time_gradient', '{"working_hours":{"start":"09:00","end":"19:30"},"gradient":[{"hour":20,"discount":5},{"hour":21,"discount":10},{"hour":22,"discount":15},{"hour":23,"discount":20},{"hour":0,"discount":25},{"hour":1,"discount":28},{"hour":2,"discount":30}],"floor_percent":70}', 'Градиент скидки по времени суток (нерабочие часы)'),
  ('priority_pricing', '{"per_position_percent":10,"max_surcharge_percent":50}', 'Наценка за приоритет в очереди (% от суммы за позицию)'),
  ('demand_config', '{"low_threshold":30,"medium_threshold":60,"low_discount":10,"early_bird_days":3,"early_bird_discount":5,"last_minute_hours":2,"last_minute_discount":25}', 'Demand-based параметры (early bird, last-minute, low-demand)')
ON CONFLICT (config_key) DO NOTHING;

-- Seed: модификаторы в существующую таблицу price_modifiers
INSERT INTO price_modifiers (name, modifier_type, scope, modifier_action, modifier_value, conditions, priority, is_active) VALUES
  ('Ночная скидка', 'time_of_day', 'global', 'multiply', 0.85, '{"type":"off_hours"}', 10, true),
  ('VIP-множитель (×1.5 к скидке)', 'customer_segment', 'global', 'multiply', 1.5, '{"min_loyalty_level":3,"applies_to":"discount_only"}', 5, true),
  ('Подписчик — без ночной скидки', 'customer_segment', 'global', 'override', 1.0, '{"is_subscriber":true,"no_time_discount":true}', 20, false),
  ('Low-demand скидка', 'seasonal', 'global', 'multiply', 0.90, '{"type":"demand_based","threshold":30}', 8, true),
  ('Early Bird (3+ дней)', 'time_of_day', 'global', 'multiply', 0.95, '{"type":"early_bird","min_days":3}', 7, true),
  ('Last-Minute (2ч)', 'time_of_day', 'global', 'multiply', 0.75, '{"type":"last_minute","max_hours":2}', 9, true),
  ('Bundle (2+ услуги)', 'volume', 'global', 'multiply', 0.95, '{"min_services":2}', 6, true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Phase 2: Processing Queue
-- ============================================================================

ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS queue_position INT,
  ADD COLUMN IF NOT EXISTS estimated_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_duration_minutes INT;

ALTER TABLE service_options
  ADD COLUMN IF NOT EXISTS estimated_minutes INT DEFAULT 30;

-- История статусов заказа (трекинг клиентом)
CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR(100) NOT NULL,
  old_status VARCHAR(30),
  new_status VARCHAR(30) NOT NULL,
  changed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_osh_order ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_osh_created ON order_status_history(created_at DESC);

-- Индекс для очереди
CREATE INDEX IF NOT EXISTS idx_ppo_queue ON photo_print_orders(queue_position)
  WHERE status IN ('paid', 'processing') AND payment_status = 'paid';

CREATE INDEX IF NOT EXISTS idx_ppo_priority_queue ON photo_print_orders(priority DESC, created_at ASC)
  WHERE payment_status = 'paid' AND status IN ('paid', 'processing');

-- ============================================================================
-- Phase 3: Priority Purchase + Price Lock
-- ============================================================================

CREATE TABLE IF NOT EXISTS priority_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR(100) NOT NULL,
  positions_skipped INT NOT NULL,
  surcharge_amount DECIMAL(10,2) NOT NULL,
  payment_id VARCHAR(100),
  payment_status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pp_order ON priority_purchases(order_id);

CREATE TABLE IF NOT EXISTS price_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id VARCHAR(100),
  user_id UUID REFERENCES users(id),
  category_slug VARCHAR(100) NOT NULL,
  locked_price DECIMAL(10,2) NOT NULL,
  lock_fee DECIMAL(10,2) DEFAULT 50,
  lock_fee_paid BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  used_order_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pl_visitor ON price_locks(visitor_id, category_slug)
  WHERE used = false AND expires_at > NOW();

CREATE INDEX IF NOT EXISTS idx_pl_user ON price_locks(user_id, category_slug)
  WHERE used = false AND expires_at > NOW();
