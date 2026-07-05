-- Add copy/print service option "Размещение" for POS payment dialog.
-- Idempotent: reruns keep the service active and update its fixed catalog price.

BEGIN;

DO $$
DECLARE
  v_group_id uuid;
  v_option_id uuid;
BEGIN
  SELECT og.id INTO v_group_id
    FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
   WHERE sc.slug = 'copy-print'
     AND og.slug = 'copy-print-items';

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'option_group copy-print/copy-print-items not found';
  END IF;

  INSERT INTO service_options (
    option_group_id,
    slug,
    name,
    description,
    icon,
    base_price,
    price_studio,
    price_online,
    features,
    popular,
    is_active,
    sort_order,
    estimated_minutes,
    processing_time
  ) VALUES (
    v_group_id,
    'placement-10',
    'Размещение',
    'Размещение макета или изображения перед печатью.',
    'sell',
    10.00,
    10.00,
    10.00,
    '[]'::jsonb,
    false,
    true,
    23,
    0,
    'сразу'
  )
  ON CONFLICT (option_group_id, slug) DO UPDATE SET
    name              = EXCLUDED.name,
    description       = EXCLUDED.description,
    icon              = EXCLUDED.icon,
    base_price        = EXCLUDED.base_price,
    price_studio      = EXCLUDED.price_studio,
    price_online      = EXCLUDED.price_online,
    features          = EXCLUDED.features,
    popular           = EXCLUDED.popular,
    is_active         = true,
    sort_order        = EXCLUDED.sort_order,
    estimated_minutes = EXCLUDED.estimated_minutes,
    processing_time   = EXCLUDED.processing_time,
    updated_at        = NOW()
  RETURNING id INTO v_option_id;

  INSERT INTO products (
    name,
    product_type,
    code,
    unit,
    sell_price,
    vat_rate,
    tax_system,
    is_discount_allowed,
    is_bonus_allowed,
    is_active,
    sort_order,
    metadata
  )
  SELECT
    so.name,
    'service',
    so.slug,
    'piece',
    COALESCE(so.price_studio, so.base_price),
    'NoVat',
    'StsIncome',
    true,
    true,
    true,
    so.sort_order,
    jsonb_build_object(
      'service_option_slug', so.slug,
      'service_category_slug', sc.slug,
      'price_online', so.price_online,
      'price_studio', so.price_studio,
      'price_base', so.base_price
    )
  FROM service_options so
  JOIN option_groups og ON og.id = so.option_group_id
  JOIN service_categories sc ON sc.id = og.service_category_id
  WHERE so.id = v_option_id
  ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE SET
    name                = EXCLUDED.name,
    sell_price          = EXCLUDED.sell_price,
    is_discount_allowed = EXCLUDED.is_discount_allowed,
    is_bonus_allowed    = EXCLUDED.is_bonus_allowed,
    is_active           = true,
    sort_order          = EXCLUDED.sort_order,
    metadata            = EXCLUDED.metadata,
    updated_at          = NOW();

  UPDATE service_options so
     SET product_id = p.id,
         updated_at = NOW()
    FROM products p
   WHERE so.id = v_option_id
     AND p.code = 'placement-10';
END $$;

DO $$
DECLARE
  v_service RECORD;
BEGIN
  SELECT so.slug, so.name, so.price_studio, so.product_id, so.is_active
    INTO v_service
    FROM service_options so
    JOIN option_groups og ON og.id = so.option_group_id
    JOIN service_categories sc ON sc.id = og.service_category_id
   WHERE sc.slug = 'copy-print'
     AND og.slug = 'copy-print-items'
     AND so.slug = 'placement-10';

  RAISE NOTICE 'service_option %: name=%, price_studio=%, product_id=%, active=%',
    v_service.slug, v_service.name, v_service.price_studio, v_service.product_id, v_service.is_active;
END $$;

COMMIT;
