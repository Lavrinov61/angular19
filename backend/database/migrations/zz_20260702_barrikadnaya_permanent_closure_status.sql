-- Barrikadnaya is permanently closed for customers.
-- Keep the historical studio row for shifts, reports and audit, but make the
-- operational status text explicit because AI context reads studios.status_message.
--
-- Rollback if needed:
-- UPDATE studios
-- SET status_message = 'Студия на 2-ой Баррикадной 4 временно закрыта. Ждём вас на Соборном 21, ежедневно с 09:00 до 19:30.'
-- WHERE location_code = 'barrikadnaya-4';

BEGIN;

UPDATE studios
SET status = 'closed',
    status_message = 'На 2-ой Баррикадной 4 больше не работаем. Ждём вас на Соборном 21, ежедневно с 09:00 до 19:30.',
    status_until = NULL,
    updated_at = NOW()
WHERE location_code = 'barrikadnaya-4'
  AND (
    status IS DISTINCT FROM 'closed'
    OR status_message IS DISTINCT FROM 'На 2-ой Баррикадной 4 больше не работаем. Ждём вас на Соборном 21, ежедневно с 09:00 до 19:30.'
    OR status_until IS NOT NULL
  );

COMMIT;
