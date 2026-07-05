-- Добавляем колонки uniform_type и photo_format в photo_print_orders
-- uniform_type: тип формы (для военной ретуши), напр. "Сухопутные войска"
-- photo_format: размер фото (для документов), напр. "35×45 мм"
-- Эти данные ранее дублировались в JSON items — теперь единый source of truth

ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS uniform_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS photo_format VARCHAR(50);

-- Бэкфил из существующих items JSON (если есть данные)
UPDATE photo_print_orders
SET uniform_type = items->0->>'uniformType'
WHERE uniform_type IS NULL
  AND items->0->>'uniformType' IS NOT NULL;

UPDATE photo_print_orders
SET photo_format = items->0->>'format'
WHERE photo_format IS NULL
  AND items->0->>'format' IS NOT NULL;

-- Индекс для аналитических запросов по service_type + uniform_type
CREATE INDEX IF NOT EXISTS idx_ppo_service_uniform
  ON photo_print_orders (service_type, uniform_type)
  WHERE service_type IS NOT NULL;
