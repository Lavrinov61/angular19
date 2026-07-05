-- Studio status: open / closed / maintenance
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS status_message TEXT;

DO $$ BEGIN
  ALTER TABLE studios ADD CONSTRAINT studios_status_check
    CHECK (status IN ('open', 'closed', 'maintenance'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Barrikadnaya-4 is closed 3-5 April 2026
UPDATE studios
SET status = 'closed',
    status_message = 'Адрес не работает. Ждём вас на Соборном 21!'
WHERE location_code = 'barrikadnaya-4';
