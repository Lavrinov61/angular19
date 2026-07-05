-- Add real POS document type products to "Фото на документы"
-- Problem: POS shows online pricing tiers (Экспресс/Профессиональный/Премиум)
-- but employees need concrete products: Фото на паспорт, Фото на загран, etc.

BEGIN;

-- 1. Create option_group "Тип документа" (sort_order=0 → appears FIRST)
INSERT INTO option_groups (id, service_category_id, slug, name, description, selection_type, is_required, min_selections, max_selections, sort_order, is_active)
SELECT
  gen_random_uuid(), sc.id, 'document-type', 'Тип документа',
  'Конкретный тип фото на документы', 'single', false, 0, 1, 0, true
FROM service_categories sc
WHERE sc.slug = 'photo-docs'
  AND NOT EXISTS (
    SELECT 1 FROM option_groups og
    WHERE og.slug = 'document-type' AND og.service_category_id = sc.id
  );

-- 2. Add POS document types (700₽ each)
WITH grp AS (
  SELECT og.id FROM option_groups og
  JOIN service_categories sc ON sc.id = og.service_category_id
  WHERE og.slug = 'document-type' AND sc.slug = 'photo-docs'
  LIMIT 1
)
INSERT INTO service_options (id, option_group_id, slug, name, description, icon, base_price, price_studio, price_online, popular, features, sort_order, is_active)
SELECT gen_random_uuid(), grp.id, v.slug, v.name, v.descr, v.icon, 700, 700, 890, v.pop, v.feats::jsonb, v.srt, true
FROM grp, (VALUES
  ('passport-rf',     'Фото на паспорт РФ',     'Комплект 4 шт, белый фон',       'badge',            true,  '["3×4","4 шт","Белый фон"]',               1),
  ('passport-zagran', 'Фото на загранпаспорт',   'Комплект 4 шт, белый фон',       'flight_takeoff',   true,  '["3.5×4.5","4 шт","Белый фон"]',           2),
  ('photo-visa',      'Фото на визу',            'По требованиям посольства',       'public',           true,  '["По стандарту","4 шт"]',                  3),
  ('photo-license',   'Фото на права',           'Комплект 4 шт',                  'directions_car',   true,  '["3×4","4 шт"]',                           4),
  ('photo-medbook',   'Фото на медкнижку',       'Комплект 4 шт',                  'medical_services', false, '["3×4","4 шт"]',                           5),
  ('photo-pass',      'Фото для пропуска',       'Фото 3×4 или 4×6',              'credit_card',      false, '["3×4 или 4×6","4 шт"]',                   6),
  ('photo-military',  'Фото на военный билет',   'Комплект 4 шт, уголок',          'military_tech',    false, '["3×4","4 шт","Уголок"]',                  7),
  ('photo-student',   'Фото на студенческий',    'Комплект 4 шт',                  'school',           false, '["3×4","4 шт"]',                           8)
) AS v(slug, name, descr, icon, pop, feats, srt)
WHERE NOT EXISTS (SELECT 1 FROM service_options so WHERE so.slug = v.slug);

-- 3. Unmark online pricing tiers from popular (replaced by document types)
UPDATE service_options SET popular = false, updated_at = now()
WHERE slug IN ('retouch', 'basic', 'vip', 'vip-all-docs')
  AND popular = true;

-- 4. Push existing groups down so "Тип документа" is first
UPDATE option_groups SET sort_order = sort_order + 1, updated_at = now()
WHERE slug IN ('processing-level', 'speed', 'extras')
  AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs');

COMMIT;
