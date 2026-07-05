-- zz_20260602_education_verified_backfill.sql
-- Образовательный тариф «без подписки» (source_token='education_verified').
-- Бэкафилл льготы + текущего rolling-30 периода для каждого верифицированного
-- непросроченного student_account, у которого НЕТ активной education-льготы.
--
-- ЗАЧЕМ: после расширения resolveAccountDiscountProfile верифицированный без подписки
-- получает тариф −50%/−30%. Кап (100 документов + 100 фото / 30 дней) реально приходит
-- из studentState, а тот требует активной льготы + начисленного периода. Без бэкафилла
-- такой пользователь получил бы профиль без studentState, и защита pricing-engine
-- обнулила бы скидку (а до защиты — была бы «бесконечная» скидка). student_account_id
-- ОБЯЗАТЕЛЕН (NOT NULL), иначе VERIFIED_STUDENT_ACCOUNT_SQL отфильтрует льготу.
--
-- Идемпотентно: повторный прогон даёт no-op (NOT EXISTS / ON CONFLICT).
-- БД общая для dev и prod, миграция применяется один раз.

BEGIN;

-- 1) Льгота verified-only. ON CONFLICT(user_id) DO NOTHING не трогает существующие
--    'education_subscription' (они и так исключены через NOT EXISTS).
INSERT INTO student_discount_entitlements
  (user_id, status, source_token, source_url, student_account_id, activated_at, expires_at)
SELECT sa.user_id, 'active', 'education_verified', NULL, sa.id, NOW(), sa.expires_at
FROM student_accounts sa
WHERE sa.status = 'verified'
  AND sa.expires_at >= NOW()
  AND NOT EXISTS (
    SELECT 1 FROM student_discount_entitlements e
    WHERE e.user_id = sa.user_id
      AND e.status = 'active'
      AND e.source_token IN ('education_subscription', 'education_verified')
  )
ON CONFLICT (user_id) DO NOTHING;

-- 2) Текущий rolling-30 период для новых verified-only льгот. sheet_price = 5 (тариф
--    «без подписки»), лимиты 100/100. ON CONFLICT обновляет цену (self-heal).
INSERT INTO student_allowance_periods
  (entitlement_id, user_id, period_start, period_end, sheet_limit, sheet_price, photo_limit)
SELECT
  s.id,
  s.user_id,
  s.activated_at + (
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - s.activated_at)) / (30*24*60*60))::integer)
    * INTERVAL '30 days'
  ) AS period_start,
  s.activated_at + (
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - s.activated_at)) / (30*24*60*60))::integer)
    * INTERVAL '30 days'
  ) + INTERVAL '30 days' AS period_end,
  100, 5, 100
FROM student_discount_entitlements s
WHERE s.status = 'active'
  AND s.source_token = 'education_verified'
  AND s.expires_at >= NOW()
  AND EXISTS (
    SELECT 1 FROM student_accounts a
    WHERE a.id = s.student_account_id
      AND a.user_id = s.user_id
      AND a.status = 'verified'
      AND (a.expires_at IS NULL OR a.expires_at >= NOW())
  )
ON CONFLICT (entitlement_id, period_start) DO UPDATE SET
  sheet_limit = EXCLUDED.sheet_limit,
  sheet_price = EXCLUDED.sheet_price,
  photo_limit = EXCLUDED.photo_limit;

COMMIT;
