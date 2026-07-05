-- Настройки расписания фотографа
-- Используется GET/PUT /api/schedules/preferences/:photographerId

CREATE TABLE IF NOT EXISTS schedule_preferences (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auto_accept_bookings    BOOLEAN NOT NULL DEFAULT false,
  buffer_time_minutes     INT NOT NULL DEFAULT 30,
  max_daily_bookings      INT NOT NULL DEFAULT 5,
  advance_booking_days    INT NOT NULL DEFAULT 30,
  same_day_booking_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_schedule_prefs_photographer UNIQUE (photographer_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_preferences_photographer
  ON schedule_preferences(photographer_id);
