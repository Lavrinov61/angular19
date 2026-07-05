-- Block barrikadnaya-4 until end of week (2026-04-17 to 2026-04-20 inclusive)
-- Reason: maintenance/renovations scheduled until Sunday
INSERT INTO studio_schedule_exceptions (studio_id, exception_date, is_closed, reason)
SELECT id, dates.exception_date, true, 'Адрес на перерыве до конца недели. Ждём вас на Соборном 21!'
FROM studios s
CROSS JOIN (
  SELECT '2026-04-17'::date AS exception_date UNION ALL
  SELECT '2026-04-18'::date UNION ALL
  SELECT '2026-04-19'::date UNION ALL
  SELECT '2026-04-20'::date
) dates
WHERE s.location_code = 'barrikadnaya-4'
ON CONFLICT DO NOTHING;
