-- Rename voennaya-retush option labels to simpler user-facing wording
-- Keeps slugs and pricing intact; updates only visible names/text

BEGIN;

UPDATE option_groups
SET name = 'Обработка фото',
    description = 'Выберите, как сильно обработать фотографию'
WHERE slug = 'retouching'
  AND service_category_id = (
    SELECT id FROM service_categories WHERE slug = 'voennaya-retush'
  );

UPDATE service_options
SET name = 'Простая обработка',
    description = 'Улучшаем лицо, выравниваем цвет и очищаем фон',
    features = '["Улучшение лица", "Выравнивание цвета", "Чистый фон"]'::jsonb
WHERE slug = 'simple'
  AND option_group_id = (
    SELECT id
    FROM option_groups
    WHERE slug = 'retouching'
      AND service_category_id = (
        SELECT id FROM service_categories WHERE slug = 'voennaya-retush'
      )
  );

UPDATE service_options
SET name = 'Художественная обработка',
    description = 'Детальная обработка, красивый свет и аккуратные детали',
    features = '["Детальная обработка лица", "Красивое освещение", "Четкость и яркий цвет"]'::jsonb
WHERE slug = 'artistic'
  AND option_group_id = (
    SELECT id
    FROM option_groups
    WHERE slug = 'retouching'
      AND service_category_id = (
        SELECT id FROM service_categories WHERE slug = 'voennaya-retush'
      )
  );

UPDATE service_options
SET name = 'Восстановление + обработка',
    description = 'Восстановим старое или поврежденное фото и аккуратно обработаем',
    features = '["Восстановление поврежденного фото", "Раскрашивание ч/б фото", "Художественная обработка"]'::jsonb
WHERE slug = 'restoration'
  AND option_group_id = (
    SELECT id
    FROM option_groups
    WHERE slug = 'retouching'
      AND service_category_id = (
        SELECT id FROM service_categories WHERE slug = 'voennaya-retush'
      )
  );

COMMIT;
