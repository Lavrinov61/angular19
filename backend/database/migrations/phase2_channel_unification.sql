-- Phase 2: Channel Unification
-- Заменяем концепцию channel на source + delivery_method
--
-- source = откуда пришла сессия (web, telegram, max)
-- delivery_method = атрибут ЗАКАЗА (electronic, pickup, postal)
-- entry_context = pre-selection с лендинга (category, delivery hint)

BEGIN;

-- 1. service_categories: допустимые delivery methods
ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS valid_delivery_methods TEXT[] DEFAULT '{electronic,pickup,postal}';

-- Заполнить для существующих категорий:
-- photo-docs: все три (электронный, самовывоз, почта)
-- neuro-photo: только электронный
-- photo-restore: только электронный
UPDATE service_categories
SET valid_delivery_methods = '{electronic}'
WHERE slug IN ('neuro-photo', 'photo-restore');

UPDATE service_categories
SET valid_delivery_methods = '{electronic,pickup,postal}'
WHERE slug = 'photo-docs';

-- 2. photo_print_orders: явный delivery_method
ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(20) DEFAULT 'electronic';

-- Заполнить для существующих заказов на основе имеющихся данных
-- Если есть delivery_address → postal, иначе если chat_session с channel='studio' → pickup, иначе electronic
UPDATE photo_print_orders
SET delivery_method = CASE
  WHEN delivery_address IS NOT NULL AND delivery_address != '' THEN 'postal'
  WHEN EXISTS (
    SELECT 1 FROM visitor_chat_sessions vcs
    WHERE vcs.id = photo_print_orders.chat_session_id
    AND vcs.channel = 'studio'
  ) THEN 'pickup'
  ELSE 'electronic'
END
WHERE delivery_method IS NULL OR delivery_method = 'electronic';

-- Добавить CHECK constraint
ALTER TABLE photo_print_orders
  DROP CONSTRAINT IF EXISTS photo_print_orders_delivery_method_check;
ALTER TABLE photo_print_orders
  ADD CONSTRAINT photo_print_orders_delivery_method_check
  CHECK (delivery_method IN ('electronic', 'pickup', 'postal'));

-- 3. visitor_chat_sessions: source + entry_context
-- channel остаётся для backward compat (не удаляем), но source — новое каноническое поле
ALTER TABLE visitor_chat_sessions
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'web';

ALTER TABLE visitor_chat_sessions
  ADD COLUMN IF NOT EXISTS entry_context JSONB DEFAULT '{}';

-- Заполнить source из channel для существующих сессий
UPDATE visitor_chat_sessions
SET source = 'web'
WHERE source IS NULL OR source = 'web';

-- Для сессий пришедших из внешних каналов (если channel не online/studio)
UPDATE visitor_chat_sessions
SET source = channel
WHERE channel NOT IN ('online', 'studio') AND channel IS NOT NULL;

-- Индекс на source для фильтрации
CREATE INDEX IF NOT EXISTS idx_visitor_chat_sessions_source
  ON visitor_chat_sessions(source);

-- Индекс на delivery_method для аналитики
CREATE INDEX IF NOT EXISTS idx_photo_print_orders_delivery_method
  ON photo_print_orders(delivery_method);

COMMIT;
