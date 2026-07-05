-- Портретная съёмка: добавить ТИПЫ РЕТУШИ (лесенку уровней обработки + «Супер»).
-- Было: одна multi-опция «Ретушь 900» (portrait-retouch-option в группе portrait-retouch).
-- Стало: новая single-группа processing-level (тот же slug, что у photo-docs — UNIQUE по
--   (service_category_id, slug) это разрешает, категории разные) с зеркальными уровнями
--   Без обработки / Базовая 700 / Расширенная 950 / Максимальная 1400 / Супер 3000.
-- Цены — те же, что в photo-docs (решение владельца). «Супер» включает тот же конфигуратор
--   ретуши, что и в photo-docs (super_retouch_checklist_items — общий каталог, не трогаем).
-- БЕЗ service_option_features для portrait: уровни = фикс-цена price_studio (без скидочных
--   под-фич). Фронт получит features=[] → пустой processingTierSubs → без чекбоксов-скидок;
--   backend для опций без feature-rows (hasFeatures=false) принимает клиентскую цену.
-- Старую «Ретушь 900» НЕ удаляем (история заказов) — деактивируем (is_active=false).
-- Идемпотентно (ON CONFLICT DO UPDATE / WHERE is_active). БД общая dev/prod — один прогон.

BEGIN;

-- 1. Новая группа уровней обработки у portrait (single)
INSERT INTO option_groups (service_category_id, slug, name, selection_type, is_required, min_selections, max_selections, sort_order, is_active)
SELECT sc.id, 'processing-level', 'Уровень обработки', 'single', false, 0, 1, 1, true
FROM service_categories sc
WHERE sc.slug = 'portrait'
ON CONFLICT (service_category_id, slug) DO UPDATE
  SET name = EXCLUDED.name,
      selection_type = 'single',
      is_active = true,
      updated_at = now();

-- 2. Опции-уровни (зеркало photo-docs: slug + price). price_online = price_studio.
WITH g AS (
  SELECT og.id
  FROM option_groups og
  JOIN service_categories sc ON sc.id = og.service_category_id
  WHERE sc.slug = 'portrait' AND og.slug = 'processing-level'
)
INSERT INTO service_options (option_group_id, slug, name, base_price, price_online, price_studio, sort_order, estimated_minutes, is_active, features)
SELECT g.id, v.slug, v.name, v.price, v.price, v.price, v.sort_order, v.est, true, '[]'::jsonb
FROM g, (VALUES
  ('processing-none',     'Без обработки',          0,    5,  30),
  ('processing-basic',    'Базовая обработка',      700,  10, 30),
  ('processing-extended', 'Расширенная обработка',  950,  20, 30),
  ('processing-max',      'Максимальная обработка', 1400, 30, 30),
  ('processing-super',    'Супер обработка',        3000, 40, 60)
) AS v(slug, name, price, sort_order, est)
ON CONFLICT (option_group_id, slug) DO UPDATE
  SET name = EXCLUDED.name,
      base_price = EXCLUDED.base_price,
      price_online = EXCLUDED.price_online,
      price_studio = EXCLUDED.price_studio,
      sort_order = EXCLUDED.sort_order,
      estimated_minutes = EXCLUDED.estimated_minutes,
      is_active = true,
      updated_at = now();

-- 3. Деактивировать старую опцию «Ретушь 900» (НЕ удалять — история заказов).
UPDATE service_options so
SET is_active = false, updated_at = now()
FROM option_groups og, service_categories sc
WHERE so.option_group_id = og.id
  AND og.service_category_id = sc.id
  AND sc.slug = 'portrait'
  AND og.slug = 'portrait-retouch'
  AND so.slug = 'portrait-retouch-option';

-- 4. Деактивировать пустую группу portrait-retouch, если в ней не осталось активных опций.
UPDATE option_groups og
SET is_active = false, updated_at = now()
FROM service_categories sc
WHERE og.service_category_id = sc.id
  AND sc.slug = 'portrait'
  AND og.slug = 'portrait-retouch'
  AND NOT EXISTS (
    SELECT 1 FROM service_options s WHERE s.option_group_id = og.id AND s.is_active = true
  );

COMMIT;
