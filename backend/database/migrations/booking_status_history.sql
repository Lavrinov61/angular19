-- ============================================================
-- booking_status_history — хронология смены статусов записей
-- Применять: sudo -u postgres psql -d magnus_photo_db -f booking_status_history.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  old_status VARCHAR(20),
  new_status VARCHAR(20) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bsh_booking ON booking_status_history(booking_id, changed_at);

-- Seed: начальные events из существующих записей
INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_at)
SELECT id, NULL, status, created_at FROM bookings
ON CONFLICT DO NOTHING;

\echo '✅ booking_status_history created and seeded'
