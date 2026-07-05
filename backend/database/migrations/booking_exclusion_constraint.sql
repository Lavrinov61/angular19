-- Booking: EXCLUDE constraint для защиты от двойной записи (race condition)
-- Идемпотентная миграция

-- 1. Устанавливаем расширение btree_gist (нужно для EXCLUDE с = оператором на uuid)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Добавляем EXCLUDE constraint: запрещаем пересечение временных диапазонов
--    для одной студии среди активных записей
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_no_overlap
      EXCLUDE USING gist (
        studio_id WITH =,
        tstzrange(start_time, end_time) WITH &&
      )
      WHERE (status NOT IN ('cancelled', 'no-show'));
  END IF;
END $$;
