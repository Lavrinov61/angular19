-- Sprint 4: 4 новых combo пакета (sweet spot 1000-1499₽)
-- Идемпотентная миграция: ON CONFLICT DO UPDATE / DO NOTHING

BEGIN;

-- 1. "Документ Стандарт" — passport-rf + retouch базовая
INSERT INTO combo_packages (slug, name, description, combo_price, original_total, savings_label, display_channels, sort_order, is_active)
VALUES (
  'doc-standard',
  'Документ Стандарт',
  'Фото на паспорт РФ с базовой обработкой',
  1290.00,
  1590.00,
  'Экономия 300₽',
  '{crm,pos,website}',
  2,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  combo_price = EXCLUDED.combo_price,
  original_total = EXCLUDED.original_total,
  savings_label = EXCLUDED.savings_label,
  display_channels = EXCLUDED.display_channels,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO combo_package_items (combo_package_id, service_option_id, quantity, sort_order)
VALUES
  ((SELECT id FROM combo_packages WHERE slug = 'doc-standard'), 'c82d0724-c6a3-4cbd-aa3e-6bd7322de028', 1, 1),
  ((SELECT id FROM combo_packages WHERE slug = 'doc-standard'), 'e69d76bb-1143-4e29-ad6c-fc79f0a551af', 1, 2)
ON CONFLICT (combo_package_id, service_option_id) DO NOTHING;

-- 2. "Документ VIP" — passport-rf + retouch + urgent + print-delivery
INSERT INTO combo_packages (slug, name, description, combo_price, original_total, savings_label, display_channels, sort_order, is_active)
VALUES (
  'doc-vip',
  'Документ VIP',
  'Фото на паспорт РФ с обработкой, срочной готовностью и доставкой',
  1790.00,
  2170.00,
  'Экономия 380₽',
  '{crm,pos,website}',
  3,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  combo_price = EXCLUDED.combo_price,
  original_total = EXCLUDED.original_total,
  savings_label = EXCLUDED.savings_label,
  display_channels = EXCLUDED.display_channels,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO combo_package_items (combo_package_id, service_option_id, quantity, sort_order)
VALUES
  ((SELECT id FROM combo_packages WHERE slug = 'doc-vip'), 'c82d0724-c6a3-4cbd-aa3e-6bd7322de028', 1, 1),
  ((SELECT id FROM combo_packages WHERE slug = 'doc-vip'), 'e69d76bb-1143-4e29-ad6c-fc79f0a551af', 1, 2),
  ((SELECT id FROM combo_packages WHERE slug = 'doc-vip'), '9ae6016e-622b-44b2-8e58-312ce9f0e226', 1, 3),
  ((SELECT id FROM combo_packages WHERE slug = 'doc-vip'), 'cec2d0e3-f03b-4ba1-b219-d112c2a7368b', 1, 4)
ON CONFLICT (combo_package_id, service_option_id) DO NOTHING;

-- 3. "Бизнес Портфолио" — portrait-photo + studio-retouch-pro + portrait-20x30-premium
INSERT INTO combo_packages (slug, name, description, combo_price, original_total, savings_label, display_channels, sort_order, is_active)
VALUES (
  'business-portfolio',
  'Бизнес Портфолио',
  'Портретное фото с профессиональной ретушью и печатью 20×30 премиум',
  1490.00,
  1917.00,
  'Экономия 427₽',
  '{crm,pos,website}',
  4,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  combo_price = EXCLUDED.combo_price,
  original_total = EXCLUDED.original_total,
  savings_label = EXCLUDED.savings_label,
  display_channels = EXCLUDED.display_channels,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO combo_package_items (combo_package_id, service_option_id, quantity, sort_order)
VALUES
  ((SELECT id FROM combo_packages WHERE slug = 'business-portfolio'), '5ba24368-80bd-4d6e-a6d9-50fdf5ccf90d', 1, 1),
  ((SELECT id FROM combo_packages WHERE slug = 'business-portfolio'), '5ff81490-e9fe-4e39-9f49-37613e0a684b', 1, 2),
  ((SELECT id FROM combo_packages WHERE slug = 'business-portfolio'), '506af9bb-5fc4-49f7-adc7-d5b8ff9269e6', 1, 3)
ON CONFLICT (combo_package_id, service_option_id) DO NOTHING;

-- 4. "Семейная Память" — portrait-photo + studio-retouch-basic + холст 30x40
INSERT INTO combo_packages (slug, name, description, combo_price, original_total, savings_label, display_channels, sort_order, is_active)
VALUES (
  'family-memory',
  'Семейная Память',
  'Портретное фото с базовой ретушью и печатью на холсте 30×40 см',
  3190.00,
  3700.00,
  'Экономия 510₽',
  '{crm,pos,website}',
  5,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  combo_price = EXCLUDED.combo_price,
  original_total = EXCLUDED.original_total,
  savings_label = EXCLUDED.savings_label,
  display_channels = EXCLUDED.display_channels,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO combo_package_items (combo_package_id, service_option_id, quantity, sort_order)
VALUES
  ((SELECT id FROM combo_packages WHERE slug = 'family-memory'), '5ba24368-80bd-4d6e-a6d9-50fdf5ccf90d', 1, 1),
  ((SELECT id FROM combo_packages WHERE slug = 'family-memory'), 'ebe67da1-dfe7-40c8-be18-361e497f732b', 1, 2),
  ((SELECT id FROM combo_packages WHERE slug = 'family-memory'), 'f383a7b5-f592-4658-a4bd-0f095a32c0ef', 1, 3)
ON CONFLICT (combo_package_id, service_option_id) DO NOTHING;

COMMIT;
