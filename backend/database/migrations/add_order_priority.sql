-- Добавить приоритет заказа для срочных/VIP заказов
-- normal = обычный, urgent = срочный, vip = VIP-обработка
ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NOT NULL DEFAULT 'normal';

-- Индекс для фильтрации по приоритету (срочные/VIP первыми)
CREATE INDEX IF NOT EXISTS idx_ppo_priority
  ON photo_print_orders (priority)
  WHERE priority <> 'normal';

-- Обновляем существующие заказы на основе тарифа в items JSONB
UPDATE photo_print_orders
SET priority = 'vip'
WHERE priority = 'normal'
  AND items::text ILIKE '%vip%';

UPDATE photo_print_orders
SET priority = 'urgent'
WHERE priority = 'normal'
  AND (items::text ILIKE '%срочн%' OR items::text ILIKE '%urgent%');
