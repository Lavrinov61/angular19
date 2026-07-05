-- Email legacy archive: rename email_messages/email_attachments → *_archived
-- Применять после 7 дней наблюдения за v2 email routes
-- Миграция: email_legacy_archive.sql
-- Дата: 2026-03-12
--
-- ВНИМАНИЕ: Эта миграция НЕ применяется автоматически.
-- Применить вручную после подтверждения стабильности v2:
--   psql "$DATABASE_URL" -f database/migrations/email_legacy_archive.sql

-- Rename tables
ALTER TABLE IF EXISTS email_messages RENAME TO email_messages_archived;
ALTER TABLE IF EXISTS email_attachments RENAME TO email_attachments_archived;

-- Rename indexes (email_messages)
ALTER INDEX IF EXISTS email_messages_pkey RENAME TO email_messages_archived_pkey;
ALTER INDEX IF EXISTS idx_email_messages_direction_status RENAME TO idx_email_messages_archived_direction_status;
ALTER INDEX IF EXISTS idx_email_messages_thread_id RENAME TO idx_email_messages_archived_thread_id;
ALTER INDEX IF EXISTS idx_email_messages_message_id RENAME TO idx_email_messages_archived_message_id;
ALTER INDEX IF EXISTS idx_email_messages_created_at RENAME TO idx_email_messages_archived_created_at;
ALTER INDEX IF EXISTS idx_email_messages_customer_phone RENAME TO idx_email_messages_archived_customer_phone;

-- Rename indexes (email_attachments)
ALTER INDEX IF EXISTS email_attachments_pkey RENAME TO email_attachments_archived_pkey;
ALTER INDEX IF EXISTS idx_email_attachments_email_id RENAME TO idx_email_attachments_archived_email_id;

-- Rename foreign key constraint
ALTER TABLE IF EXISTS email_attachments_archived
  RENAME CONSTRAINT email_attachments_email_id_fkey TO email_attachments_archived_email_id_fkey;
