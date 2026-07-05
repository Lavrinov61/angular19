-- Migration: Единая таблица клиентов (customers)
-- Объединяет идентификацию клиентов из всех каналов:
-- сайт (visitor_id), Telegram (telegram_user_id), WhatsApp/POS (phone)

-- ========================================
-- ТАБЛИЦА КЛИЕНТОВ
-- ========================================

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20),
    email VARCHAR(255),
    name VARCHAR(255),
    visitor_ids TEXT[] DEFAULT '{}',          -- browser fingerprints (может быть несколько)
    telegram_user_id BIGINT,
    telegram_username VARCHAR(255),
    -- Статистика
    total_orders INTEGER DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0,
    first_order_at TIMESTAMPTZ,
    last_order_at TIMESTAMPTZ,
    -- Промо-трекинг
    used_basic_promo BOOLEAN DEFAULT false,   -- использовал акцию 100₽ за "Без обработки"
    -- Meta
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Уникальность по телефону (если указан)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone
  ON customers(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_email
  ON customers(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_telegram
  ON customers(telegram_user_id) WHERE telegram_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_visitor_ids
  ON customers USING GIN(visitor_ids);

-- Trigger для updated_at
CREATE OR REPLACE FUNCTION update_customers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_customers_updated_at();

-- ========================================
-- РАСШИРЕНИЕ photo_print_orders
-- ========================================

-- Связь с customers
ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS idx_ppo_customer
  ON photo_print_orders(customer_id) WHERE customer_id IS NOT NULL;

-- Колонка service_type для аналитики (раньше не было — suggestRepeatOrder падал)
ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS service_type VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_ppo_service_type
  ON photo_print_orders(service_type) WHERE service_type IS NOT NULL;

-- Backfill service_type из JSONB items для существующих заказов
UPDATE photo_print_orders
  SET service_type = items->0->>'tariff'
  WHERE service_type IS NULL
    AND items IS NOT NULL
    AND jsonb_array_length(items) > 0
    AND items->0->>'tariff' IS NOT NULL;

-- ========================================
-- BACKFILL: Создать customer-записи для существующих оплаченных заказов
-- ========================================

-- Создаём customers для visitor_id из оплаченных заказов
INSERT INTO customers (visitor_ids, name, total_orders, total_spent, first_order_at, last_order_at, used_basic_promo)
SELECT
  ARRAY[vcs.visitor_id],
  MAX(vcs.visitor_name),
  COUNT(po.id)::int,
  COALESCE(SUM(po.total_price), 0),
  MIN(po.created_at),
  MAX(po.created_at),
  BOOL_OR(po.service_type = 'Без обработки' OR po.service_type LIKE 'Без обработки%')
FROM visitor_chat_sessions vcs
JOIN photo_print_orders po ON po.chat_session_id = vcs.id
WHERE po.payment_status = 'paid'
  AND vcs.visitor_id IS NOT NULL
GROUP BY vcs.visitor_id
ON CONFLICT DO NOTHING;

-- Связываем существующие заказы с customers
UPDATE photo_print_orders po
SET customer_id = c.id
FROM visitor_chat_sessions vcs, customers c
WHERE po.chat_session_id = vcs.id
  AND vcs.visitor_id = ANY(c.visitor_ids)
  AND po.customer_id IS NULL;
