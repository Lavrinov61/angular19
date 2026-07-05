-- Close barrikadnaya-4 until end of week (through 2026-04-20)
-- Global status + today's exception (17-20 already exist from migration 088)

-- 1. Global closure with auto-expiry
UPDATE studios
SET status = 'closed',
    status_message = 'Точка временно закрыта. Ждём вас на Соборном 21!',
    status_until = '2026-04-20'
WHERE location_code = 'barrikadnaya-4';

-- 2. Add today (04/16) to per-date exceptions
INSERT INTO studio_schedule_exceptions (studio_id, exception_date, is_closed, reason)
SELECT id, '2026-04-16'::date, true, 'Точка временно закрыта. Ждём вас на Соборном 21!'
FROM studios WHERE location_code = 'barrikadnaya-4'
ON CONFLICT (studio_id, exception_date) DO UPDATE
  SET is_closed = true, reason = EXCLUDED.reason;
