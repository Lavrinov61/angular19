-- Barrikadnaya-4: positive wording for April 3–5 closure
UPDATE studio_schedule_exceptions sse
SET reason = 'Перерыв 3–5 апреля. С 6 апреля работаем в обычном режиме!'
FROM studios s
WHERE sse.studio_id = s.id
  AND s.location_code = 'barrikadnaya-4'
  AND sse.exception_date IN ('2026-04-03', '2026-04-04', '2026-04-05')
  AND sse.is_closed = true;
