-- Category-level degressive pricing
-- Добавляет metadata JSONB в service_categories для конфигурации дегрессии по категории.
-- Идемпотентно.

-- 1. Добавить колонку metadata
ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Заполнить degressive config для photo-docs
--    base_price=700: P(n) = max(310, 700 - 130*(n-1))
--    step=130, min_price=310, scope=category
UPDATE service_categories
SET metadata = COALESCE(metadata, '{}'::jsonb) || '{
  "degressive": {
    "enabled": true,
    "step": 130,
    "min_price": 310,
    "reference_base": 700,
    "scope": "category"
  }
}'::jsonb
WHERE slug = 'photo-docs';
