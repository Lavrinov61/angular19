-- 071_shift_enterprise.sql
-- Enterprise-улучшения системы смен:
-- 1. Кэш онлайн-выручки в employee_shifts
-- 2. Индексы для быстрых запросов
-- 3. schedule_requests: отдельные колонки start_time/end_time
-- Идемпотентная миграция

BEGIN;

-- 1. employee_shifts: кэш онлайн-выручки за смену
ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS online_earnings numeric(12,2) DEFAULT 0;
ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS online_count integer DEFAULT 0;

-- 2. schedule_requests: start_time/end_time для е��инообразия
ALTER TABLE schedule_requests ADD COLUMN IF NOT EXISTS start_time time DEFAULT '09:00';
ALTER TABLE schedule_requests ADD COLUMN IF NOT EXISTS end_time time DEFAULT '19:30';

-- 3. Индекс: быстрый lookup активных смен сотрудника на сегодня
CREATE INDEX IF NOT EXISTS idx_employee_shifts_active_today
  ON employee_shifts (employee_id, shift_date)
  WHERE status IN ('scheduled', 'active');

-- 4. Индекс: смены по дате для team-schedule grid
CREATE INDEX IF NOT EXISTS idx_employee_shifts_date_range
  ON employee_shifts (shift_date, studio_id)
  WHERE status != 'cancelled';

-- 5. Индекс: schedule_requests pending для admin panel
CREATE INDEX IF NOT EXISTS idx_schedule_requests_pending
  ON schedule_requests (status, created_at DESC)
  WHERE status = 'pending';

COMMIT;
