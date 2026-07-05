-- Chat → Client/Booking linking
-- Adds booking_id FK and indexes for efficient client-session lookups

ALTER TABLE visitor_chat_sessions
  ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id);

CREATE INDEX IF NOT EXISTS idx_vcs_booking_id
  ON visitor_chat_sessions(booking_id) WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vcs_user_id_status
  ON visitor_chat_sessions(user_id, status) WHERE user_id IS NOT NULL;
