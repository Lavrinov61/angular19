-- Migration: gallery_photos
-- Таблица для хранения фотографий галереи портфолио

CREATE TABLE IF NOT EXISTS gallery_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            VARCHAR(255) UNIQUE NOT NULL,
  file_url        TEXT NOT NULL,
  thumbnail_url   TEXT,
  title           VARCHAR(500) NOT NULL,
  description     TEXT,
  category        VARCHAR(100) NOT NULL DEFAULT 'other',
  tags            TEXT[] DEFAULT '{}',
  photographer_id UUID REFERENCES photographers(id) ON DELETE SET NULL,
  is_public       BOOLEAN NOT NULL DEFAULT true,
  is_featured     BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  width           INTEGER,
  height          INTEGER,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gallery_photos_category    ON gallery_photos(category);
CREATE INDEX IF NOT EXISTS idx_gallery_photos_is_public   ON gallery_photos(is_public);
CREATE INDEX IF NOT EXISTS idx_gallery_photos_is_featured ON gallery_photos(is_featured);
CREATE INDEX IF NOT EXISTS idx_gallery_photos_sort_order  ON gallery_photos(sort_order);
CREATE INDEX IF NOT EXISTS idx_gallery_photos_slug        ON gallery_photos(slug);

-- Триггер автообновления updated_at (функция уже создана в предыдущих миграциях)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'gallery_photos_updated_at'
  ) THEN
    CREATE TRIGGER gallery_photos_updated_at
      BEFORE UPDATE ON gallery_photos
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;
