-- Add 'photographer_page' to bookings source constraint
-- Idempotent: drops and recreates the constraint
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_source_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_source_check
  CHECK (source IN ('crm', 'website', 'telegram', 'phone', 'walk_in', 'photographer_page'));
