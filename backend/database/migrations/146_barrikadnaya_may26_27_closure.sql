-- Barrikadnaya-4 closure 2026-05-26..27.
-- Soborny remains the daily working address during the closure.

UPDATE studios
SET status = 'closed',
    status_message = 'Работает ежедневно на Соборном 21',
    status_until = '2026-05-27',
    updated_at = NOW()
WHERE location_code = 'barrikadnaya-4';

INSERT INTO studio_schedule_exceptions (studio_id, exception_date, is_closed, reason)
SELECT s.id, d.exception_date, true, 'Работает ежедневно на Соборном 21'
FROM studios s
CROSS JOIN (
  VALUES
    ('2026-05-26'::date),
    ('2026-05-27'::date)
) AS d(exception_date)
WHERE s.location_code = 'barrikadnaya-4'
ON CONFLICT (studio_id, exception_date) DO UPDATE
  SET is_closed = true,
      open_time = NULL,
      close_time = NULL,
      reason = EXCLUDED.reason;
