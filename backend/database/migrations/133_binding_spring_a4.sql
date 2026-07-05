-- 133_binding_spring_a4.sql
-- Purpose: завести услугу «Переплёт пружиной пластиковой А4» в каталог
-- и привязать промокод STUD-BIND10 к категории copy-print.
--
-- База: пластиковые пружины разной толщины (6/10/14/19/25/32/38/45/51 мм).
-- В каталоге создаётся одна универсальная опция (минимальная цена);
-- при выборе конкретной толщины администратор корректирует цену вручную
-- или, когда появится прайс-лист по толщинам, мигрируем в отдельные опции.
--
-- Идемпотентно: INSERT ... ON CONFLICT DO UPDATE.

BEGIN;

-- 1) service_option «Переплёт пружиной пластиковой А4»
DO $$
DECLARE
  v_group_id uuid;
BEGIN
  SELECT og.id INTO v_group_id
    FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
   WHERE og.slug = 'copy-print-items' AND sc.slug = 'copy-print';

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'option_group copy-print/copy-print-items not found';
  END IF;

  INSERT INTO service_options (
    option_group_id, slug, name, description,
    base_price, price_studio, price_online,
    is_active, sort_order, estimated_minutes, processing_time
  ) VALUES (
    v_group_id,
    'binding-spring-a4',
    'Переплёт пружиной пластиковой А4',
    'Пластиковая пружина, переплёт документов формата А4. Цена зависит от толщины пружины (6/10/14/19/25/32/38/45/51 мм) и количества листов — уточняется при оформлении.',
    100.00,  -- базовая (минимальная) цена; реальная зависит от толщины, задаётся администратором
    100.00,
    100.00,
    true,
    150,
    10,
    '10 минут'
  )
  ON CONFLICT (option_group_id, slug) DO UPDATE SET
    name              = EXCLUDED.name,
    description       = EXCLUDED.description,
    is_active         = true,
    estimated_minutes = EXCLUDED.estimated_minutes,
    processing_time   = EXCLUDED.processing_time,
    updated_at        = NOW();
    -- base_price и price_* НЕ перезаписываем при повторных запусках:
    -- если администратор скорректировал цену через CRM — сохраняем её.
END $$;

-- 2) Привязываем STUD-BIND10 к категории copy-print, чтобы pricing-engine
--    применял скидку именно на переплёт в копицентре.
UPDATE promotions
   SET service_slug = 'copy-print',
       updated_at   = NOW()
 WHERE promo_code   = 'STUD-BIND10'
   AND kind         = 'public_campaign';

-- 3) Верификация
DO $$
DECLARE
  v_so RECORD;
  v_pr RECORD;
BEGIN
  SELECT so.slug, so.name, so.base_price, so.is_active, og.slug AS group_slug
    INTO v_so
    FROM service_options so
    JOIN option_groups og ON so.option_group_id = og.id
   WHERE so.slug = 'binding-spring-a4';

  SELECT promo_code, service_slug, is_active
    INTO v_pr
    FROM promotions
   WHERE promo_code = 'STUD-BIND10';

  RAISE NOTICE 'service_option % (%₽) active=%, group=%',
    v_so.slug, v_so.base_price, v_so.is_active, v_so.group_slug;
  RAISE NOTICE 'promo %: service_slug=%, active=%',
    v_pr.promo_code, v_pr.service_slug, v_pr.is_active;
END $$;

COMMIT;
