-- 073_shift_enterprise_v2.sql
-- Enterprise система смен v2:
-- 1. Обмен сменами (shift swap requests)
-- 2. Audit trail изменений смен (shift history log)
-- 3. Предпочтения сотрудников по доступности
-- 4. Фикс CHECK constraint для 5/2 в schedule_requests
-- Идемпотентная миграция

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. shift_swap_requests — запросы на обмен сменами
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS shift_swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_shift_id uuid NOT NULL REFERENCES employee_shifts(id) ON DELETE CASCADE,
  target_shift_id uuid NOT NULL REFERENCES employee_shifts(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id),
  target_id uuid NOT NULL REFERENCES users(id),
  reason text,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  admin_id uuid REFERENCES users(id),
  admin_comment text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swap_different_shifts CHECK (requester_shift_id != target_shift_id),
  CONSTRAINT swap_different_employees CHECK (requester_id != target_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_swap_requests_status
  ON shift_swap_requests(status, created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_shift_swap_requests_requester
  ON shift_swap_requests(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_swap_requests_target
  ON shift_swap_requests(target_id, created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. shift_history_log — audit trail всех изменений смен
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS shift_history_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES employee_shifts(id) ON DELETE CASCADE,
  action varchar(30) NOT NULL
    CHECK (action IN (
      'created', 'updated', 'cancelled', 'deleted',
      'checked_in', 'checked_out', 'auto_closed',
      'swapped', 'reassigned', 'notes_updated'
    )),
  changed_by uuid REFERENCES users(id),
  old_values jsonb,
  new_values jsonb,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_history_log_shift
  ON shift_history_log(shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_history_log_date
  ON shift_history_log(created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. employee_availability — предпочтения по доступности
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS employee_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week smallint CHECK (day_of_week BETWEEN 0 AND 6),
  preferred_start_time time,
  preferred_end_time time,
  is_available boolean NOT NULL DEFAULT true,
  max_hours_per_week smallint DEFAULT 50 CHECK (max_hours_per_week BETWEEN 1 AND 84),
  preferred_studio_id uuid REFERENCES studios(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_employee_availability_employee
  ON employee_availability(employee_id);

-- ══════════════════════════════════════════════════════════════════════════
-- 4. Фикс: добавить '5/2' в CHECK constraint schedule_requests
-- ══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  ALTER TABLE schedule_requests DROP CONSTRAINT IF EXISTS schedule_requests_shift_pattern_check;
  ALTER TABLE schedule_requests ADD CONSTRAINT schedule_requests_shift_pattern_check
    CHECK (shift_pattern IN ('2/2', '1/1', '3/3', '5/2', 'custom'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Constraint update skipped: %', SQLERRM;
END $$;

COMMIT;
