-- Pricing: degressive document photo pricing
-- Replaces flat bundle "4 for 300₽" with degressive per-set pricing
-- 2026-03-23

BEGIN;

-- 1. Деактивировать старый бандл "На все документы (4 комплекта)"
UPDATE service_options
SET is_active = false
WHERE slug = 'all-docs-bundle';

-- 2. Добавить дегрессивные допкомплекты в extras (photo-docs)
INSERT INTO service_options (
  option_group_id, slug, name, base_price, price_online, price_studio,
  features, sort_order, is_active, description
)
VALUES
  (
    'b54d4bf2-c402-478e-a605-f66a5396d1d8',
    'extra-set-2',
    '+ 2-й комплект (любой документ)',
    570.00, 720.00, 570.00,
    '["Любой тип документа", "4 фото", "Экономия 130₽"]',
    3, true,
    'Дегрессивная цена: 2-й комплект фото на документы'
  ),
  (
    'b54d4bf2-c402-478e-a605-f66a5396d1d8',
    'extra-set-3',
    '+ 3-й комплект',
    440.00, 560.00, 440.00,
    '["Любой тип документа", "4 фото", "Экономия 260₽"]',
    4, true,
    'Дегрессивная цена: 3-й комплект фото на документы'
  ),
  (
    'b54d4bf2-c402-478e-a605-f66a5396d1d8',
    'extra-set-4',
    '+ 4-й комплект',
    310.00, 400.00, 310.00,
    '["Любой тип документа", "4 фото", "Экономия 390₽"]',
    5, true,
    'Дегрессивная цена: 4-й комплект фото на документы'
  )
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_price = EXCLUDED.base_price,
  price_online = EXCLUDED.price_online,
  price_studio = EXCLUDED.price_studio,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active,
  description = EXCLUDED.description;

COMMIT;
