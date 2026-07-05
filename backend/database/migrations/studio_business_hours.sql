-- Studio business hours: fill operating_hours + schedule exceptions table
-- Idempotent: safe to re-run

-- Fill operating_hours for existing studios with empty/null values
UPDATE studios SET operating_hours = '{
  "default": {"open": "09:00", "close": "19:30"},
  "monday": {"open": "09:00", "close": "19:30"},
  "tuesday": {"open": "09:00", "close": "19:30"},
  "wednesday": {"open": "09:00", "close": "19:30"},
  "thursday": {"open": "09:00", "close": "19:30"},
  "friday": {"open": "09:00", "close": "19:30"},
  "saturday": {"open": "09:00", "close": "19:30"},
  "sunday": {"open": "09:00", "close": "19:30"}
}'::jsonb
WHERE operating_hours IS NULL OR operating_hours = '{}'::jsonb;

-- Schedule exceptions (holidays, shortened days)
CREATE TABLE IF NOT EXISTS studio_schedule_exceptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio_id uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  is_closed boolean DEFAULT false,
  open_time time,
  close_time time,
  reason varchar(255),
  created_at timestamptz DEFAULT now(),
  UNIQUE(studio_id, exception_date)
);
