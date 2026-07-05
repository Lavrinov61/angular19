-- F20b: Fix unique phone index to exclude soft-deleted contacts
-- Required for Contact Merge: soft-deleted contacts keep merged_phone in metadata,
-- but phone column is NULLed. This index ensures correctness even if phone is not NULLed.

DROP INDEX IF EXISTS idx_contacts_phone;
CREATE UNIQUE INDEX idx_contacts_phone
  ON contacts(phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
