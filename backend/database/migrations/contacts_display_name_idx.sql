-- Index for duplicate contact detection by display_name
CREATE INDEX IF NOT EXISTS idx_contacts_display_name_lower
  ON contacts(LOWER(TRIM(display_name)))
  WHERE display_name IS NOT NULL AND deleted_at IS NULL;
