-- Категория "Ламинирование" в AI-каталоге (service_categories), чтобы бот мог называть
-- цену из инструмента calculate_price, а не выдумывать. Ранее ламинирование было только в
-- POS-таблице service_catalog (касса), бот его НЕ видел.
-- Цены из POS service_catalog: laminate-a4 = 100, laminate-a5 = 70.
-- Категория автономна: группа is_required=false (не ломает расчёт других категорий),
-- нет degressive/option_rules. base_price=price_studio=price_online (одна цена при любом канале).
-- valid_delivery_methods={pickup} => НЕ попадёт в публичный онлайн-заказ (фильтр electronic/postal).
-- display_channels включает chatbot (бот видит; для getCategories решает is_active).
-- Идемпотентно (ON CONFLICT по существующим UNIQUE).

-- 1) Категория
INSERT INTO service_categories
  (slug, name, description, icon, display_channels, sort_order, is_active,
   valid_delivery_methods, crm_orderable, metadata)
VALUES
  ('lamination', 'Ламинирование',
   'Ламинирование документов и фотографий, форматы A4 и A5.',
   'description',
   ARRAY['website','chatbot','pos']::text[],
   9, true,
   ARRAY['pickup']::text[],
   false,
   jsonb_build_object('ai_aliases', jsonb_build_array(
     'ламинирование','ламинация','ламинировать','заламинировать','ламинат',
     'ламинированный','laminate','lamination')))
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      display_channels = EXCLUDED.display_channels,
      valid_delivery_methods = EXCLUDED.valid_delivery_methods,
      is_active = true,
      metadata = COALESCE(service_categories.metadata, '{}'::jsonb) || EXCLUDED.metadata,
      updated_at = NOW();

-- 2) Группа опций (выбор формата). По образцу copy-print-items: single, не required.
INSERT INTO option_groups
  (service_category_id, slug, name, selection_type, is_required,
   min_selections, max_selections, sort_order, is_active)
SELECT sc.id, 'lamination-format', 'Формат ламинирования', 'single', false, 0, 1, 1, true
FROM service_categories sc WHERE sc.slug = 'lamination'
ON CONFLICT (service_category_id, slug) DO UPDATE
  SET name = EXCLUDED.name,
      selection_type = EXCLUDED.selection_type,
      is_required = EXCLUDED.is_required,
      min_selections = EXCLUDED.min_selections,
      max_selections = EXCLUDED.max_selections,
      is_active = true,
      updated_at = NOW();

-- 3) Опции: A4 (100) и A5 (70). base_price+price_studio+price_online одинаковы.
INSERT INTO service_options
  (option_group_id, slug, name, base_price, price_studio, price_online,
   sort_order, is_active, estimated_minutes, processing_time)
SELECT og.id, v.slug, v.name, v.price, v.price, v.price, v.sort_order, true, 5, 'сразу'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id AND sc.slug = 'lamination'
CROSS JOIN (VALUES
   ('laminate-a4', 'Ламинирование A4', 100.00, 1),
   ('laminate-a5', 'Ламинирование A5',  70.00, 2)
 ) AS v(slug, name, price, sort_order)
WHERE og.slug = 'lamination-format'
ON CONFLICT (option_group_id, slug) DO UPDATE
  SET name = EXCLUDED.name,
      base_price = EXCLUDED.base_price,
      price_studio = EXCLUDED.price_studio,
      price_online = EXCLUDED.price_online,
      sort_order = EXCLUDED.sort_order,
      is_active = true,
      updated_at = NOW();
