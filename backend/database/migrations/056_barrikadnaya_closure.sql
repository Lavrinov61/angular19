-- Barrikadnaya-4 closure 2026-04-03..04 (technical reasons)
INSERT INTO studio_schedule_exceptions (id, studio_id, exception_date, is_closed, reason, created_at)
SELECT gen_random_uuid(), s.id, d::date, true, 'Закрыто по техническим причинам', now()
FROM studios s
CROSS JOIN (VALUES ('2026-04-03'::date), ('2026-04-04'::date)) AS dates(d)
WHERE s.location_code = 'barrikadnaya-4'
ON CONFLICT (studio_id, exception_date) DO UPDATE
  SET is_closed = true, reason = EXCLUDED.reason;
