-- Автономная система записи для CRM ФотоПульт
-- Разрешает создание записей без привязки к users/photographers (walk-in, телефон, сайт)

-- Снять обязательность FK
ALTER TABLE bookings ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE bookings ALTER COLUMN photographer_id DROP NOT NULL;

-- Новые поля для автономной записи
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS studio_id UUID REFERENCES studios(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_name VARCHAR(255);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_phone VARCHAR(20);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_name VARCHAR(255);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'crm';

-- CHECK constraint на source (добавляем через ALTER т.к. колонка может уже существовать)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_source_check'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_source_check
      CHECK (source IN ('crm', 'website', 'telegram', 'phone', 'walk_in'));
  END IF;
END$$;

-- Индекс для быстрой проверки занятости по студии и дате
CREATE INDEX IF NOT EXISTS idx_bookings_studio_time
  ON bookings (studio_id, start_time, end_time)
  WHERE status NOT IN ('cancelled');

-- Индекс для поиска по телефону клиента
CREATE INDEX IF NOT EXISTS idx_bookings_client_phone
  ON bookings (client_phone)
  WHERE client_phone IS NOT NULL;
