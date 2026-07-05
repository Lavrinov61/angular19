-- 138_student_print_promo_100_sheets.sql
-- Purpose: align STUD-PRINT3 with the /students landing:
-- first 100 A4 black-and-white sheets at 3 rubles with up to 15% fill.
-- Supersedes the original 10-sheet seed from migration 132.

BEGIN;

INSERT INTO promotions (
  slug, title, description, promo_code, service_slug,
  discount_amount, discount_percent,
  is_active, starts_at, ends_at, usage_limit, sort_order, kind, conditions
) VALUES (
  'stud-print3-first-10-sheets',
  'Студентам: первые 100 листов печати по 3₽',
  'Первые 100 листов чёрно-белой печати документов А4 по 3₽ при заливке до 15%. Для студентов. Действует до 30 сентября 2026.',
  'STUD-PRINT3',
  'copy-print',
  400, NULL,
  true, '2026-04-30 00:00:00+03', '2026-09-30 23:59:59+03',
  NULL, 201,
  'public_campaign',
  'До 100 листов А4 ч/б печати по 3₽ при заливке до 15%. При заливке больше 15% применяется стандартный тариф. Один раз на клиента по номеру телефона.'
)
ON CONFLICT (slug) DO UPDATE SET
  title            = EXCLUDED.title,
  description      = EXCLUDED.description,
  promo_code       = EXCLUDED.promo_code,
  service_slug     = EXCLUDED.service_slug,
  discount_amount  = EXCLUDED.discount_amount,
  discount_percent = EXCLUDED.discount_percent,
  is_active        = EXCLUDED.is_active,
  starts_at        = EXCLUDED.starts_at,
  ends_at          = EXCLUDED.ends_at,
  usage_limit      = EXCLUDED.usage_limit,
  sort_order       = EXCLUDED.sort_order,
  kind             = EXCLUDED.kind,
  conditions       = EXCLUDED.conditions,
  updated_at       = NOW();

DO $$
DECLARE
  v_print RECORD;
BEGIN
  SELECT promo_code, title, discount_amount, is_active, starts_at, ends_at, kind, service_slug
    INTO v_print
    FROM promotions
   WHERE slug = 'stud-print3-first-10-sheets';

  IF v_print IS NULL THEN
    RAISE EXCEPTION 'STUD-PRINT3 promotion was not seeded';
  END IF;

  RAISE NOTICE 'STUD-PRINT3: % (%), discount=% active=% % -> %, kind=%, service=%',
    v_print.promo_code,
    v_print.title,
    v_print.discount_amount,
    v_print.is_active,
    v_print.starts_at,
    v_print.ends_at,
    v_print.kind,
    COALESCE(v_print.service_slug, '<generic>');
END $$;

COMMIT;
