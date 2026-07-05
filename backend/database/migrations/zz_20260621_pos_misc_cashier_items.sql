-- Add requested miscellaneous items to the POS cashier catalog.
-- Items 4-6 are intentionally seeded with 0.00 sell_price as "no fixed price".

BEGIN;

DO $$
DECLARE
  v_category_id uuid;
  v_seeded_count integer;
BEGIN
  INSERT INTO product_categories (name, sort_order, icon, is_active)
  VALUES ('Услуги', 21, 'miscellaneous_services', true)
  ON CONFLICT (name) DO UPDATE SET
    is_active = true,
    icon = COALESCE(product_categories.icon, EXCLUDED.icon)
  RETURNING id INTO v_category_id;

  WITH requested_items(name, product_type, code, sell_price, sort_order, requires_manual_price) AS (
    VALUES
      ('Папка скоросшиватель', 'product', 'pos-folder-skorosshivatel', 150.00::numeric, 211, false),
      ('Мягкий переплёт', 'service', 'pos-soft-binding', 100.00::numeric, 212, false),
      ('Обложка для переплёта', 'product', 'pos-binding-cover', 100.00::numeric, 213, false),
      ('Монтаж', 'service', 'pos-montage', 0.00::numeric, 214, true),
      ('Листовка A5', 'service', 'pos-flyer-a5', 0.00::numeric, 215, true),
      ('Листовка A6', 'service', 'pos-flyer-a6', 0.00::numeric, 216, true)
  )
  UPDATE products p
     SET code = ri.code,
         product_type = ri.product_type,
         unit = 'piece',
         sell_price = ri.sell_price,
         vat_rate = 'NoVat',
         tax_system = 'StsIncome',
         is_discount_allowed = true,
         is_bonus_allowed = true,
         is_subscription_eligible = false,
         sort_order = ri.sort_order,
         is_active = true,
         metadata = COALESCE(p.metadata, '{}'::jsonb) || jsonb_build_object(
           'source', 'manual_pos_request_2026_06_21',
           'requires_manual_price', ri.requires_manual_price
         ),
         updated_at = NOW()
    FROM requested_items ri
   WHERE p.category_id = v_category_id
     AND p.name = ri.name
     AND p.code IS DISTINCT FROM ri.code
     AND NOT EXISTS (
       SELECT 1
         FROM products existing
        WHERE existing.code = ri.code
          AND existing.id <> p.id
     );

  WITH requested_items(name, product_type, code, sell_price, sort_order, requires_manual_price) AS (
    VALUES
      ('Папка скоросшиватель', 'product', 'pos-folder-skorosshivatel', 150.00::numeric, 211, false),
      ('Мягкий переплёт', 'service', 'pos-soft-binding', 100.00::numeric, 212, false),
      ('Обложка для переплёта', 'product', 'pos-binding-cover', 100.00::numeric, 213, false),
      ('Монтаж', 'service', 'pos-montage', 0.00::numeric, 214, true),
      ('Листовка A5', 'service', 'pos-flyer-a5', 0.00::numeric, 215, true),
      ('Листовка A6', 'service', 'pos-flyer-a6', 0.00::numeric, 216, true)
  )
  INSERT INTO products (
    category_id,
    name,
    product_type,
    code,
    unit,
    sell_price,
    cost_price,
    vat_rate,
    tax_system,
    is_discount_allowed,
    is_bonus_allowed,
    is_subscription_eligible,
    sort_order,
    is_active,
    is_favorite,
    metadata
  )
  SELECT
    v_category_id,
    ri.name,
    ri.product_type,
    ri.code,
    'piece',
    ri.sell_price,
    NULL,
    'NoVat',
    'StsIncome',
    true,
    true,
    false,
    ri.sort_order,
    true,
    false,
    jsonb_build_object(
      'source', 'manual_pos_request_2026_06_21',
      'requires_manual_price', ri.requires_manual_price
    )
  FROM requested_items ri
  ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE SET
    category_id = EXCLUDED.category_id,
    name = EXCLUDED.name,
    product_type = EXCLUDED.product_type,
    unit = EXCLUDED.unit,
    sell_price = EXCLUDED.sell_price,
    vat_rate = EXCLUDED.vat_rate,
    tax_system = EXCLUDED.tax_system,
    is_discount_allowed = EXCLUDED.is_discount_allowed,
    is_bonus_allowed = EXCLUDED.is_bonus_allowed,
    is_subscription_eligible = EXCLUDED.is_subscription_eligible,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    metadata = COALESCE(products.metadata, '{}'::jsonb) || EXCLUDED.metadata,
    updated_at = NOW();

  SELECT COUNT(*)
    INTO v_seeded_count
    FROM products
   WHERE code IN (
     'pos-folder-skorosshivatel',
     'pos-soft-binding',
     'pos-binding-cover',
     'pos-montage',
     'pos-flyer-a5',
     'pos-flyer-a6'
   )
     AND is_active = true;

  IF v_seeded_count <> 6 THEN
    RAISE EXCEPTION 'Expected 6 active miscellaneous POS cashier items, got %', v_seeded_count;
  END IF;

  RAISE NOTICE 'Seeded % miscellaneous POS cashier items in category %', v_seeded_count, v_category_id;
END $$;

COMMIT;
