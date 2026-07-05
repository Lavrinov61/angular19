-- chat_enterprise.sql — Enterprise Chat: denormalization, indexes, archive tables
-- Migration: 2026-03-04

-- ============================================================================
-- 2.1 Денормализация visitor_chat_sessions — убираем N+1 подзапросы
-- ============================================================================

ALTER TABLE visitor_chat_sessions
  ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_message_content TEXT;

-- Backfill message_count
UPDATE visitor_chat_sessions s SET message_count = (
  SELECT COUNT(*) FROM visitor_chat_messages m WHERE m.session_id = s.id
) WHERE message_count = 0 OR message_count IS NULL;

-- Backfill unread_count (visitor messages unread by operator)
UPDATE visitor_chat_sessions s SET unread_count = (
  SELECT COUNT(*) FROM visitor_chat_messages m
  WHERE m.session_id = s.id AND m.sender_type = 'visitor' AND m.is_read = false
) WHERE unread_count = 0 OR unread_count IS NULL;

-- Backfill last_message_content
UPDATE visitor_chat_sessions s SET last_message_content = sub.content
FROM (
  SELECT DISTINCT ON (session_id) session_id, content
  FROM visitor_chat_messages
  ORDER BY session_id, created_at DESC
) sub
WHERE sub.session_id = s.id AND s.last_message_content IS NULL;

-- Trigger: auto-update denormalized columns on INSERT into visitor_chat_messages
CREATE OR REPLACE FUNCTION trg_chat_msg_insert() RETURNS trigger AS $$
BEGIN
  UPDATE visitor_chat_sessions SET
    message_count = message_count + 1,
    unread_count = CASE WHEN NEW.sender_type = 'visitor' THEN unread_count + 1 ELSE unread_count END,
    last_message_content = NEW.content,
    last_message_at = COALESCE(NEW.created_at, NOW()),
    updated_at = NOW()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_msg_after_insert ON visitor_chat_messages;
CREATE TRIGGER trg_chat_msg_after_insert
  AFTER INSERT ON visitor_chat_messages
  FOR EACH ROW EXECUTE FUNCTION trg_chat_msg_insert();

-- Trigger: auto-update on DELETE from visitor_chat_messages
CREATE OR REPLACE FUNCTION trg_chat_msg_delete() RETURNS trigger AS $$
BEGIN
  UPDATE visitor_chat_sessions SET
    message_count = GREATEST(message_count - 1, 0),
    unread_count = CASE WHEN OLD.sender_type = 'visitor' AND OLD.is_read = false THEN GREATEST(unread_count - 1, 0) ELSE unread_count END,
    updated_at = NOW()
  WHERE id = OLD.session_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_msg_after_delete ON visitor_chat_messages;
CREATE TRIGGER trg_chat_msg_after_delete
  AFTER DELETE ON visitor_chat_messages
  FOR EACH ROW EXECUTE FUNCTION trg_chat_msg_delete();

-- ============================================================================
-- 2.2 Курсорный индекс для пагинации сообщений
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vcm_session_cursor
  ON visitor_chat_messages(session_id, created_at DESC, id DESC);

-- ============================================================================
-- 2.3 Full-text search (trigram) индекс для поиска в чате
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vcm_content_trgm
  ON visitor_chat_messages USING gin (content gin_trgm_ops);

-- ============================================================================
-- 2.4 Архивные таблицы (LIKE ... INCLUDING ALL копирует все колонки, индексы и constraints)
-- ============================================================================

CREATE TABLE IF NOT EXISTS visitor_chat_messages_archive (
  LIKE visitor_chat_messages INCLUDING ALL
);

CREATE TABLE IF NOT EXISTS visitor_chat_sessions_archive (
  LIKE visitor_chat_sessions INCLUDING ALL
);
