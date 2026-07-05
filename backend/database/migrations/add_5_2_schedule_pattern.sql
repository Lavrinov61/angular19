-- Add 5/2 (Mon-Fri) schedule pattern support
-- Idempotent migration: recreate CHECK constraint

ALTER TABLE schedule_requests
  DROP CONSTRAINT IF EXISTS schedule_requests_shift_pattern_check;

ALTER TABLE schedule_requests
  ADD CONSTRAINT schedule_requests_shift_pattern_check
    CHECK (shift_pattern IN ('2/2', '1/1', '3/3', '5/2', 'custom'));
