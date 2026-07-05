-- backend/database/migrations/107_conversations_contact_fk_restrict.sql
-- Tighten conversations.contact_id FK: SET NULL → RESTRICT.
-- Safe: contact_id is NOT NULL for 100% of rows (verified 2515/2515).
-- No DELETE FROM contacts in codebase.
-- Also drop redundant partial idx_conv_contact (covered by idx_conversations_contact_id).

BEGIN;

-- 1. Заменить FK rule
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_contact_id_fkey;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE RESTRICT;

-- 2. Удалить избыточный partial index
DROP INDEX IF EXISTS idx_conv_contact;

COMMIT;
