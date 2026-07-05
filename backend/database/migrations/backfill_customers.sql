-- Migration: Backfill customers — привязка исторических заказов к единой таблице клиентов.
-- Дополняет add_customers.sql, который создал customer-записи по visitor_id.
-- Эта миграция обрабатывает заказы с contact_phone, но без customer_id.

-- ========================================
-- 1. Создать customer-записи для заказов с contact_phone
-- ========================================

INSERT INTO customers (phone, name, total_orders, total_spent, first_order_at, last_order_at, used_basic_promo)
SELECT
  ppo.contact_phone,
  MAX(ppo.contact_name),
  COUNT(*) FILTER (WHERE ppo.payment_status = 'paid'),
  COALESCE(SUM(ppo.total_price) FILTER (WHERE ppo.payment_status = 'paid'), 0),
  MIN(ppo.created_at) FILTER (WHERE ppo.payment_status = 'paid'),
  MAX(ppo.created_at) FILTER (WHERE ppo.payment_status = 'paid'),
  BOOL_OR(ppo.service_type LIKE 'Без обработки%' AND ppo.payment_status = 'paid')
FROM photo_print_orders ppo
WHERE ppo.contact_phone IS NOT NULL
  AND ppo.contact_phone != ''
  AND ppo.customer_id IS NULL
GROUP BY ppo.contact_phone
ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET
  total_orders = customers.total_orders + EXCLUDED.total_orders,
  total_spent = customers.total_spent + EXCLUDED.total_spent,
  first_order_at = LEAST(customers.first_order_at, EXCLUDED.first_order_at),
  last_order_at = GREATEST(customers.last_order_at, EXCLUDED.last_order_at),
  used_basic_promo = customers.used_basic_promo OR EXCLUDED.used_basic_promo;

-- ========================================
-- 2. Привязать заказы к customer_id по phone
-- ========================================

UPDATE photo_print_orders ppo
SET customer_id = c.id
FROM customers c
WHERE ppo.contact_phone = c.phone
  AND ppo.contact_phone IS NOT NULL
  AND ppo.contact_phone != ''
  AND ppo.customer_id IS NULL;

-- ========================================
-- 3. Дополнить visitor_ids из chat_sessions
-- ========================================

-- Для каждого customer с привязанными заказами через chat_session_id —
-- добавляем visitor_id если его ещё нет в массиве.
UPDATE customers c
SET visitor_ids = array_append(c.visitor_ids, vcs.visitor_id)
FROM visitor_chat_sessions vcs
JOIN photo_print_orders ppo ON ppo.chat_session_id = vcs.id
WHERE ppo.customer_id = c.id
  AND vcs.visitor_id IS NOT NULL
  AND vcs.visitor_id != ''
  AND NOT (vcs.visitor_id = ANY(c.visitor_ids));

-- ========================================
-- 4. Добавить customer_id в pos_receipts
-- ========================================

ALTER TABLE pos_receipts ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_pos_receipts_customer_id ON pos_receipts(customer_id) WHERE customer_id IS NOT NULL;

-- Привязать существующие POS-чеки к customers по phone
UPDATE pos_receipts pr
SET customer_id = c.id
FROM customers c
WHERE pr.customer_phone = c.phone
  AND pr.customer_phone IS NOT NULL
  AND pr.customer_phone != ''
  AND pr.customer_id IS NULL;

-- ========================================
-- 5. Добавить visitor_phone в visitor_chat_sessions (если отсутствует)
-- ========================================

ALTER TABLE visitor_chat_sessions ADD COLUMN IF NOT EXISTS visitor_phone VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_vcs_visitor_phone ON visitor_chat_sessions(visitor_phone) WHERE visitor_phone IS NOT NULL;
