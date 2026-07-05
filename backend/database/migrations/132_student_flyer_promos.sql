-- 132_student_flyer_promos.sql
-- Purpose: студенческие акции к флайерам (старт 30.04.2026).
--   STUD-BIND10  — Первый переплёт документов за 10₽
--   STUD-PRINT3  — Первые 10 листов печати документов по 3₽
-- Оба промокода: kind=public_campaign, одно применение на клиента (обеспечивается
-- уникальным индексом idx_pr_phone_promo_unique на promo_redemptions).
-- Идемпотентно: INSERT ... ON CONFLICT DO NOTHING + UPDATE на повторном запуске.

BEGIN;

INSERT INTO promotions (
  slug, title, description, promo_code, service_slug,
  discount_amount, discount_percent,
  is_active, starts_at, ends_at, usage_limit, sort_order, kind, conditions
) VALUES
  (
    'stud-bind10-first-binding',
    'Студентам: первый переплёт за 10₽',
    'Первый переплёт документов формата А4 за 10₽ по промокоду. Акция для студентов. Действует с 30 апреля 2026.',
    'STUD-BIND10',
    NULL,
    NULL, NULL,
    true, '2026-04-30 00:00:00+03', '2026-09-30 23:59:59+03',
    NULL, 200,
    'public_campaign',
    'Только при первом обращении. Один переплёт по промокоду на одного клиента. Для оформления назовите промокод администратору.'
  ),
  (
    'stud-print3-first-10-sheets',
    'Студентам: первые 10 листов печати по 3₽',
    'Первые 10 листов чёрно-белой печати документов А4 по 3₽ по промокоду (вместо 7₽/лист студенческой цены). Для студентов. Действует с 30 апреля 2026.',
    'STUD-PRINT3',
    'copy-print',
    40, NULL,
    true, '2026-04-30 00:00:00+03', '2026-09-30 23:59:59+03',
    NULL, 201,
    'public_campaign',
    'До 10 листов А4 ч/б печати по 3₽ вместо 7₽. Один раз на клиента по номеру телефона.'
  )
ON CONFLICT (slug) DO UPDATE SET
  title          = EXCLUDED.title,
  description    = EXCLUDED.description,
  promo_code     = EXCLUDED.promo_code,
  service_slug   = EXCLUDED.service_slug,
  discount_amount= EXCLUDED.discount_amount,
  discount_percent = EXCLUDED.discount_percent,
  is_active      = EXCLUDED.is_active,
  starts_at      = EXCLUDED.starts_at,
  ends_at        = EXCLUDED.ends_at,
  usage_limit    = EXCLUDED.usage_limit,
  sort_order     = EXCLUDED.sort_order,
  kind           = EXCLUDED.kind,
  conditions     = EXCLUDED.conditions,
  updated_at     = NOW();

DO $$
DECLARE
  v_bind  RECORD;
  v_print RECORD;
BEGIN
  SELECT promo_code, is_active, starts_at, ends_at, kind, service_slug
    INTO v_bind  FROM promotions WHERE slug = 'stud-bind10-first-binding';
  SELECT promo_code, is_active, starts_at, ends_at, kind, service_slug
    INTO v_print FROM promotions WHERE slug = 'stud-print3-first-10-sheets';
  RAISE NOTICE 'STUD-BIND10: % active=% % → %, kind=%, service=%',
    v_bind.promo_code, v_bind.is_active, v_bind.starts_at, v_bind.ends_at, v_bind.kind, COALESCE(v_bind.service_slug,'<generic>');
  RAISE NOTICE 'STUD-PRINT3: % active=% % → %, kind=%, service=%',
    v_print.promo_code, v_print.is_active, v_print.starts_at, v_print.ends_at, v_print.kind, COALESCE(v_print.service_slug,'<generic>');
END $$;

COMMIT;
