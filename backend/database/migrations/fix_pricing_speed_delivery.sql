-- fix_pricing_speed_delivery.sql
-- Align public copy with realistic processing times and national delivery scope.

-- Speed options for photo-docs: realistic lead times.
UPDATE service_options
SET
  name = 'Обычная (2-3 часа)',
  description = 'Стандартное время готовности',
  features = '["Готово за 2-3 часа"]'::jsonb
WHERE slug = 'normal'
  AND option_group_id = (
    SELECT og.id
    FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'speed' AND sc.slug = 'photo-docs'
  );

UPDATE service_options
SET
  name = 'Срочная (1 час)',
  description = 'Ускоренная обработка заказа',
  features = '["Готово за 1 час"]'::jsonb
WHERE slug = 'urgent'
  AND option_group_id = (
    SELECT og.id
    FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'speed' AND sc.slug = 'photo-docs'
  );

-- Delivery wording: city -> Russia.
UPDATE service_options
SET
  description = 'Печать фото и доставка по России',
  features = '["Печать на фотобумаге", "Доставка по России"]'::jsonb
WHERE slug = 'print-delivery'
  AND option_group_id = (
    SELECT og.id
    FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'extras' AND sc.slug = 'photo-docs'
  );

-- Clarify all-docs bundle expectations.
UPDATE service_options
SET
  description = '4 комплекта на разные документы с нужными размерами',
  features = '["Паспорт, загран, права, виза", "Каждое фото - по своим размерам"]'::jsonb
WHERE slug = 'all-docs-bundle'
  AND option_group_id = (
    SELECT og.id
    FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'extras' AND sc.slug = 'photo-docs'
  );

-- Basic processing feature text update.
UPDATE service_options
SET
  features = '["Замена фона на белый", "Комплект 4-6 фото", "Готово за 2-3 часа"]'::jsonb
WHERE slug = 'basic'
  AND option_group_id = (
    SELECT og.id
    FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs'
  );
