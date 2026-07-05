-- Allow an employee to close a shift and open another one on the same day.
-- Still keep the invariant: only one scheduled/active shift per employee per day.

BEGIN;

ALTER TABLE ONLY employee_shifts
  DROP CONSTRAINT IF EXISTS employee_shifts_employee_id_shift_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS employee_shifts_employee_id_shift_date_open_key
  ON employee_shifts (employee_id, shift_date)
  WHERE status IN ('scheduled', 'active');

COMMIT;

-- Rollback:
-- DROP INDEX IF EXISTS employee_shifts_employee_id_shift_date_open_key;
-- ALTER TABLE ONLY employee_shifts
--   ADD CONSTRAINT employee_shifts_employee_id_shift_date_key UNIQUE (employee_id, shift_date);
