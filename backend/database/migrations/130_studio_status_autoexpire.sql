-- Migration 130: Studio status auto-expiry (idempotent)
--
-- Fixes orphan studio statuses: когда админ закрыл студию с status_until в прошлом,
-- БД продолжает хранить status='closed'. getStudios() применяет CASE WHEN expiry,
-- но getAvailableSlots/createBooking читают raw status — и бронь не проходит.
--
-- Этот скрипт:
--   1) Разово вытирает все истёкшие закрытия (reopen).
--   2) Создаёт partial index для фонового scheduler-а (studio-scheduler.service.ts)
--      с фильтром status != 'open' AND status_until IS NOT NULL — сканирование только
--      потенциальных кандидатов на reopen (обычно 0-5 строк).
BEGIN;

UPDATE studios
SET status = 'open',
    status_message = NULL,
    status_until = NULL,
    updated_at = NOW()
WHERE status != 'open'
  AND status_until IS NOT NULL
  AND status_until < CURRENT_DATE;

CREATE INDEX IF NOT EXISTS idx_studios_status_expired
  ON studios (status_until)
  WHERE status != 'open' AND status_until IS NOT NULL;

COMMIT;
