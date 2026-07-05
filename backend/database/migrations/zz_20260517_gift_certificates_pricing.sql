-- Gift certificates as orderable pricing items for POS/CRM checkout.

BEGIN;

INSERT INTO service_categories (
  slug,
  name,
  description,
  icon,
  gradient,
  image_url,
  price_range,
  display_channels,
  sort_order,
  is_active
) VALUES (
  'gift-certificates',
  'Подарочные сертификаты',
  'Готовые сертификаты на услуги Своё Фото: набор СВО, фото на документы и печать конкретного количества фотографий.',
  'card_giftcard',
  NULL,
  NULL,
  'от 700 ₽',
  ARRAY['website', 'chatbot', 'crm', 'pos']::text[],
  9,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  price_range = EXCLUDED.price_range,
  display_channels = EXCLUDED.display_channels,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'service_categories'
      AND column_name = 'crm_orderable'
  ) THEN
    UPDATE service_categories
    SET crm_orderable = true,
        updated_at = now()
    WHERE slug = 'gift-certificates';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'service_categories'
      AND column_name = 'valid_delivery_methods'
  ) THEN
    UPDATE service_categories
    SET valid_delivery_methods = ARRAY['electronic', 'pickup']::text[],
        updated_at = now()
    WHERE slug = 'gift-certificates';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'service_categories'
      AND column_name = 'processing_time'
  ) THEN
    UPDATE service_categories
    SET processing_time = 'сразу после оплаты',
        updated_at = now()
    WHERE slug = 'gift-certificates';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'service_categories'
      AND column_name = 'metadata'
  ) THEN
    UPDATE service_categories
    SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"certificate": true}'::jsonb,
        updated_at = now()
    WHERE slug = 'gift-certificates';
  END IF;
END $$;

INSERT INTO option_groups (
  service_category_id,
  slug,
  name,
  description,
  selection_type,
  is_required,
  min_selections,
  max_selections,
  sort_order,
  is_active
)
SELECT
  sc.id,
  'certificate-type',
  'Сертификат',
  'Выберите готовый набор или номинал сертификата',
  'single',
  true,
  1,
  1,
  1,
  true
FROM service_categories sc
WHERE sc.slug = 'gift-certificates'
ON CONFLICT (service_category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  selection_type = EXCLUDED.selection_type,
  is_required = EXCLUDED.is_required,
  min_selections = EXCLUDED.min_selections,
  max_selections = EXCLUDED.max_selections,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

WITH target_group AS (
  SELECT og.id
  FROM option_groups og
  JOIN service_categories sc ON sc.id = og.service_category_id
  WHERE sc.slug = 'gift-certificates'
    AND og.slug = 'certificate-type'
),
certificate_options AS (
  SELECT *
  FROM (VALUES
    (
      'gift-svo-full',
      'Сертификат СВО: форма, качество, медали',
      'Готовый сертификат для участника СВО: подстановка формы, улучшение качества фото, медали, награды и базовая обработка.',
      'military_tech',
      '#d9960b',
      2330.00::numeric,
      '["Подстановка парадной формы", "Подстановка офисной формы", "Улучшение качества фото", "Медали и награды", "Коррекция освещения"]'::jsonb,
      true,
      1
    ),
    (
      'gift-photo-docs',
      'Сертификат: фото на документы',
      'Сертификат на базовый комплект фото на документы в студии.',
      'badge',
      '#2563eb',
      700.00::numeric,
      '["Фото на документы", "Базовая обработка", "Подходит для подарка"]'::jsonb,
      false,
      2
    ),
    (
      'gift-photo-print-50-10x15',
      'Сертификат: 50 фото 10x15',
      'Сертификат на печать 50 фотографий 10x15.',
      'photo_library',
      '#16a34a',
      1000.00::numeric,
      '["50 фото 10x15", "Фотопечать", "Матовая или глянцевая бумага"]'::jsonb,
      false,
      3
    ),
    (
      'gift-photo-print-150-10x15',
      'Сертификат: 150 фото 10x15',
      'Сертификат на печать 150 фотографий 10x15.',
      'photo_library',
      '#0f766e',
      3000.00::numeric,
      '["150 фото 10x15", "Фотопечать", "Матовая или глянцевая бумага"]'::jsonb,
      false,
      4
    ),
    (
      'gift-photo-print-260-10x15-premium',
      'Сертификат: 260 фото 10x15 премиум',
      'Сертификат на печать 260 фотографий 10x15 премиум.',
      'photo_library',
      '#7c3aed',
      5070.00::numeric,
      '["260 фото 10x15", "Премиум фотобумага", "Матовая или глянцевая бумага"]'::jsonb,
      true,
      5
    )
  ) AS v(slug, name, description, icon, color, price, features, popular, sort_order)
)
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
  price_next_unit,
  price_max,
  features,
  popular,
  original_price,
  discount_percent,
  sort_order,
  is_active
)
SELECT
  target_group.id,
  certificate_options.slug,
  certificate_options.name,
  certificate_options.description,
  certificate_options.icon,
  certificate_options.color,
  certificate_options.price,
  certificate_options.price,
  certificate_options.price,
  NULL,
  NULL,
  certificate_options.features,
  certificate_options.popular,
  NULL,
  NULL,
  certificate_options.sort_order,
  true
FROM target_group
CROSS JOIN certificate_options
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  base_price = EXCLUDED.base_price,
  price_online = EXCLUDED.price_online,
  price_studio = EXCLUDED.price_studio,
  price_next_unit = EXCLUDED.price_next_unit,
  price_max = EXCLUDED.price_max,
  features = EXCLUDED.features,
  popular = EXCLUDED.popular,
  original_price = EXCLUDED.original_price,
  discount_percent = EXCLUDED.discount_percent,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

UPDATE service_options so
SET is_active = false,
    updated_at = now()
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND sc.slug = 'gift-certificates'
  AND og.slug = 'certificate-type'
  AND so.slug IN (
    'gift-photo-print-1000',
    'gift-photo-print-3000',
    'gift-photo-print-5000'
  );

DO $$
DECLARE
  v_seed_user_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'order_templates'
  ) THEN
    SELECT id
      INTO v_seed_user_id
      FROM users
      ORDER BY CASE WHEN role = 'admin' THEN 0 WHEN role = 'manager' THEN 1 ELSE 2 END,
               created_at
      LIMIT 1;

    IF v_seed_user_id IS NOT NULL THEN
      UPDATE order_templates ot
      SET name = 'Фотопечать 260 фото',
          icon = 'photo_library',
          description = 'Подарочный сертификат на печать 260 фото 10x15 премиум',
          option_slugs = ARRAY['gift-photo-print-260-10x15-premium']::text[],
          sort_order = 5,
          is_active = true,
          updated_at = now()
      WHERE ot.scope = 'shared'
        AND ot.name = 'Фотопечать 5 000'
        AND NOT EXISTS (
          SELECT 1
          FROM order_templates existing
          WHERE existing.scope = 'shared'
            AND existing.name = 'Фотопечать 260 фото'
        );

      UPDATE order_templates ot
      SET is_active = false,
          updated_at = now()
      WHERE ot.scope = 'shared'
        AND ot.name = 'Фотопечать 5 000';

      WITH template_rows AS (
        SELECT *
        FROM (VALUES
          ('Сертификат СВО', 'card_giftcard', 'Готовый набор для участника СВО', ARRAY['gift-svo-full']::text[], 4),
          ('Фотопечать 260 фото', 'photo_library', 'Подарочный сертификат на печать 260 фото 10x15 премиум', ARRAY['gift-photo-print-260-10x15-premium']::text[], 5)
        ) AS v(name, icon, description, option_slugs, sort_order)
      )
      UPDATE order_templates ot
      SET icon = template_rows.icon,
          description = template_rows.description,
          option_slugs = template_rows.option_slugs,
          sort_order = template_rows.sort_order,
          is_active = true,
          updated_at = now()
      FROM template_rows
      WHERE ot.scope = 'shared'
        AND ot.name = template_rows.name;

      WITH template_rows AS (
        SELECT *
        FROM (VALUES
          ('Сертификат СВО', 'card_giftcard', 'Готовый набор для участника СВО', ARRAY['gift-svo-full']::text[], 4),
          ('Фотопечать 260 фото', 'photo_library', 'Подарочный сертификат на печать 260 фото 10x15 премиум', ARRAY['gift-photo-print-260-10x15-premium']::text[], 5)
        ) AS v(name, icon, description, option_slugs, sort_order)
      )
      INSERT INTO order_templates (
        name,
        icon,
        description,
        scope,
        option_slugs,
        sort_order,
        created_by
      )
      SELECT
        template_rows.name,
        template_rows.icon,
        template_rows.description,
        'shared',
        template_rows.option_slugs,
        template_rows.sort_order,
        v_seed_user_id
      FROM template_rows
      WHERE NOT EXISTS (
        SELECT 1
        FROM order_templates ot
        WHERE ot.scope = 'shared'
          AND ot.name = template_rows.name
      );
    END IF;
  END IF;
END $$;

COMMIT;
