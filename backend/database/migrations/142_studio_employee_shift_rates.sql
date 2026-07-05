-- Base employee payout for one completed shift depends on studio address.
-- Sales commission remains employee-wide and is configured in employee_compensation.

ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS employee_shift_rate numeric(10,2);

UPDATE studios
SET employee_shift_rate = 1500
WHERE location_code = 'soborny'
  AND employee_shift_rate IS NULL;

UPDATE studios
SET employee_shift_rate = 2000
WHERE location_code = 'barrikadnaya-4'
  AND employee_shift_rate IS NULL;

UPDATE studios
SET employee_shift_rate = 1500
WHERE employee_shift_rate IS NULL;

COMMENT ON COLUMN studios.employee_shift_rate IS
  'Base employee payout for one completed shift at this studio address.';
