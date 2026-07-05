-- A4 low-coverage color tier and education-access color benefit.

BEGIN;

DO $$
DECLARE
  benefit_constraint_name text;
BEGIN
  FOR benefit_constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'student_discount_redemptions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%benefit_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.student_discount_redemptions DROP CONSTRAINT IF EXISTS %I',
      benefit_constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE student_discount_redemptions
  ADD CONSTRAINT student_discount_redemptions_benefit_type_check
    CHECK (benefit_type IN ('print_a4_bw', 'print_a4_color', 'binding_spring_a4'));

INSERT INTO service_options (
  option_group_id,
  slug,
  name,
  description,
  icon,
  color,
  base_price,
  price_online,
  price_studio,
  popular,
  features,
  sort_order,
  is_active,
  satisfies_requires
)
SELECT
  option_group_id,
  'km-а4-до-15-цвет',
  'А4 цветной текст',
  'Цветная печать или копия А4: текст, таблицы и схемы без плотного фона',
  icon,
  color,
  12,
  12,
  12,
  false,
  '["Цветной текст и схемы"]'::jsonb,
  2,
  true,
  true
FROM service_options
WHERE slug = 'km-а4-ксерокопия'
LIMIT 1
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  price_online = EXCLUDED.price_online,
  price_studio = EXCLUDED.price_studio,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  satisfies_requires = EXCLUDED.satisfies_requires,
  updated_at = now();

INSERT INTO service_options (
  option_group_id,
  slug,
  name,
  description,
  icon,
  color,
  base_price,
  price_online,
  price_studio,
  popular,
  features,
  sort_order,
  is_active,
  satisfies_requires
)
SELECT
  option_group_id,
  'km-а4-печать-до-15-цвет',
  'А4 печать цветного текста',
  'Цветная печать документа А4: текст, таблицы и схемы без плотного фона',
  icon,
  color,
  12,
  12,
  12,
  false,
  '["Цветной текст и схемы"]'::jsonb,
  8,
  true,
  true
FROM service_options
WHERE slug = 'km-а4-печать-документа'
LIMIT 1
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  price_online = EXCLUDED.price_online,
  price_studio = EXCLUDED.price_studio,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  satisfies_requires = EXCLUDED.satisfies_requires,
  updated_at = now();

UPDATE service_options AS so
SET sort_order = ordered.sort_order,
    updated_at = now()
FROM (
  VALUES
    ('km-а4-ксерокопия', 1),
    ('km-а4-до-15-цвет', 2),
    ('km-а4-ксерокопия-цветная', 3),
    ('km-а4-до-75', 4),
    ('km-а4-ксерокопия-фото-цветная', 5),
    ('km-а4-печать-документа', 7),
    ('km-а4-печать-до-15-цвет', 8),
    ('km-а4-печать-документа-цветная', 9),
    ('km-а4-печать-до-75', 10),
    ('km-а4-фото-документ', 11)
) AS ordered(slug, sort_order)
WHERE so.slug = ordered.slug;

WITH selected_options AS (
  SELECT
    so.name,
    so.slug,
    COALESCE(so.price_studio, so.base_price) AS sell_price,
    so.price_online,
    so.price_studio,
    so.base_price,
    sc.slug AS category_slug
  FROM service_options so
  JOIN option_groups og ON og.id = so.option_group_id
  JOIN service_categories sc ON sc.id = og.service_category_id
  WHERE so.slug IN ('km-а4-до-15-цвет', 'km-а4-печать-до-15-цвет')
)
INSERT INTO products (
  name,
  product_type,
  code,
  unit,
  sell_price,
  vat_rate,
  tax_system,
  is_discount_allowed,
  is_active,
  metadata
)
SELECT
  name,
  'service',
  slug,
  'piece',
  sell_price,
  'NoVat',
  'StsIncome',
  true,
  true,
  jsonb_build_object(
    'service_option_slug', slug,
    'service_category_slug', category_slug,
    'price_online', price_online,
    'price_studio', price_studio,
    'price_base', base_price
  )
FROM selected_options
ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE SET
  name = EXCLUDED.name,
  sell_price = EXCLUDED.sell_price,
  vat_rate = EXCLUDED.vat_rate,
  tax_system = EXCLUDED.tax_system,
  is_discount_allowed = EXCLUDED.is_discount_allowed,
  is_active = EXCLUDED.is_active,
  metadata = COALESCE(products.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  updated_at = now();

UPDATE service_options AS so
SET product_id = p.id,
    updated_at = now()
FROM products p
WHERE so.slug IN ('km-а4-до-15-цвет', 'km-а4-печать-до-15-цвет')
  AND (p.code = so.slug OR p.metadata->>'service_option_slug' = so.slug);

UPDATE subscription_plans
SET features = '["199 ₽ в год", "Ч/б учебный А4 по 3 ₽", "Цветной учебный А4 по 4 ₽", "Первый переплёт за 10 ₽", "Для студентов, учителей и преподавателей"]'::jsonb,
    updated_at = now()
WHERE slug = 'education-yearly-199';

COMMENT ON TABLE student_allowance_periods IS
  'Rolling 30-day shared A4 low-fill education allowance.';
COMMENT ON COLUMN student_discount_redemptions.print_fill_percent IS
  'Observed or declared print fill percentage used to enforce the education <=15% rule.';

COMMIT;
