-- 142_student_allowance_rolling_periods.sql
-- Student print allowance now resets individually every 30 days from activation.

BEGIN;

DO $$
DECLARE
  period_start_type text;
  period_end_type text;
BEGIN
  SELECT udt_name
  INTO period_start_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'student_allowance_periods'
    AND column_name = 'period_start';

  SELECT udt_name
  INTO period_end_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'student_allowance_periods'
    AND column_name = 'period_end';

  IF period_start_type = 'date' OR period_end_type = 'date' THEN
    IF period_start_type <> 'date' OR period_end_type <> 'date' THEN
      RAISE EXCEPTION
        'student_allowance_periods period columns have mixed types: period_start=%, period_end=%',
        period_start_type,
        period_end_type;
    END IF;

    ALTER TABLE student_allowance_periods
      ALTER COLUMN period_start TYPE TIMESTAMPTZ
        USING (period_start::timestamp AT TIME ZONE 'Europe/Moscow'),
      ALTER COLUMN period_end TYPE TIMESTAMPTZ
        USING (period_end::timestamp AT TIME ZONE 'Europe/Moscow');
  END IF;
END $$;

CREATE TEMP TABLE tmp_student_allowance_rolling_periods ON COMMIT DROP AS
SELECT
  s.id AS entitlement_id,
  s.user_id,
  s.activated_at + (
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - s.activated_at)) / 2592000)::integer)
    * INTERVAL '30 days'
  ) AS period_start,
  s.activated_at + (
    (GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - s.activated_at)) / 2592000)::integer) + 1)
    * INTERVAL '30 days'
  ) AS period_end,
  LEAST(GREATEST(s.print_sheets_used, 0), 100) AS entitlement_sheets_used,
  p.id AS legacy_period_id,
  CASE
    WHEN p.id IS NULL THEN NULL
    ELSE LEAST(GREATEST(p.sheets_used, 0), 100)
  END AS legacy_sheets_used
FROM student_discount_entitlements s
LEFT JOIN LATERAL (
  SELECT id, sheets_used
  FROM student_allowance_periods
  WHERE entitlement_id = s.id
    AND period_start <= NOW()
    AND period_end > NOW()
  ORDER BY created_at DESC
  LIMIT 1
) p ON TRUE
WHERE s.status = 'active'
  AND s.expires_at >= NOW()
  AND EXISTS (
    SELECT 1
    FROM student_accounts a
    WHERE a.id = s.student_account_id
      AND a.user_id = s.user_id
      AND a.status = 'verified'
      AND (a.expires_at IS NULL OR a.expires_at >= NOW())
  );

UPDATE student_allowance_periods existing
SET period_end = m.period_end,
    sheet_limit = 100,
    sheet_price = 3,
    sheets_used = LEAST(
      100,
      GREATEST(
        existing.sheets_used,
        COALESCE(m.legacy_sheets_used, m.entitlement_sheets_used, 0)
      )
    ),
    updated_at = NOW()
FROM tmp_student_allowance_rolling_periods m
WHERE existing.entitlement_id = m.entitlement_id
  AND existing.period_start = m.period_start
  AND (m.legacy_period_id IS NULL OR existing.id <> m.legacy_period_id);

UPDATE student_discount_redemptions r
SET allowance_period_id = existing.id
FROM tmp_student_allowance_rolling_periods m
JOIN student_allowance_periods existing
  ON existing.entitlement_id = m.entitlement_id
 AND existing.period_start = m.period_start
WHERE m.legacy_period_id IS NOT NULL
  AND existing.id <> m.legacy_period_id
  AND r.allowance_period_id = m.legacy_period_id;

UPDATE student_allowance_periods p
SET period_start = m.period_start,
    period_end = m.period_end,
    sheet_limit = 100,
    sheet_price = 3,
    sheets_used = LEAST(
      100,
      GREATEST(
        p.sheets_used,
        COALESCE(m.legacy_sheets_used, m.entitlement_sheets_used, 0)
      )
    ),
    updated_at = NOW()
FROM tmp_student_allowance_rolling_periods m
WHERE p.id = m.legacy_period_id
  AND NOT EXISTS (
    SELECT 1
    FROM student_allowance_periods existing
    WHERE existing.entitlement_id = m.entitlement_id
      AND existing.period_start = m.period_start
      AND existing.id <> p.id
  );

INSERT INTO student_allowance_periods (
  entitlement_id,
  user_id,
  period_start,
  period_end,
  sheet_limit,
  sheet_price,
  sheets_used
)
SELECT
  entitlement_id,
  user_id,
  period_start,
  period_end,
  100,
  3,
  COALESCE(legacy_sheets_used, entitlement_sheets_used, 0)
FROM tmp_student_allowance_rolling_periods
ON CONFLICT (entitlement_id, period_start) DO UPDATE SET
  period_end = EXCLUDED.period_end,
  sheet_limit = EXCLUDED.sheet_limit,
  sheet_price = EXCLUDED.sheet_price,
  sheets_used = LEAST(
    EXCLUDED.sheet_limit,
    GREATEST(student_allowance_periods.sheets_used, EXCLUDED.sheets_used)
  ),
  updated_at = NOW();

COMMENT ON TABLE student_allowance_periods IS
  'Rolling 30-day A4 black-and-white student allowance: 100 sheets at 3 RUB by default.';
COMMENT ON COLUMN student_allowance_periods.period_start IS
  'Exact start of the user-specific 30-day allowance period, anchored to entitlement activation.';
COMMENT ON COLUMN student_allowance_periods.period_end IS
  'Exact reset timestamp for the user-specific 30-day allowance period.';

COMMIT;
