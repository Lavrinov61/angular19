-- Migration 116 — session_token_hash для conversations (chat-widget isolation P0)
-- Назначение: добавить серверно-проверяемый hash HMAC session token, чтобы отзыв
-- токена при rotate-visitor работал даже при валидной HMAC подписи.
--
-- Zero-downtime strategy:
--   1. (ЭТА МИГРАЦИЯ) Добавить NULLABLE колонку + индексы. Backfill через приложение.
--   2. scripts/backfill-session-tokens.ts — заполняет hash для активных web-сессий.
--   3. Migration 117 (через 24-48h) — CHECK constraint session_token_hash NOT NULL
--      для channel='web' AND status NOT IN ('closed','resolved').
--
-- Идемпотентна: все ALTER / CREATE INDEX используют IF NOT EXISTS.

BEGIN;

-- 2.1 Хэш HMAC session token (SHA-256 hex, 64 chars).
--     Сам токен НЕ хранится — только его SHA-256.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS session_token_hash TEXT;

-- 2.2 Timestamp последней ротации (для audit / forensics).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS session_token_rotated_at TIMESTAMPTZ;

-- 2.3 Уникальный индекс по hash (partial — NULL не ограничивает).
--     Гарантирует: один валидный токен = одна conversation.
CREATE UNIQUE INDEX IF NOT EXISTS ux_conversations_session_token_hash
  ON conversations(session_token_hash)
  WHERE session_token_hash IS NOT NULL;

-- 2.4 Hot-path индекс для bootstrap-резолва по visitor_id + channel + status.
--     Используется в POST /sessions strict AND-запросе.
CREATE INDEX IF NOT EXISTS ix_conversations_visitor_channel_status
  ON conversations(visitor_id, channel, status)
  WHERE status IN ('open', 'waiting', 'active');

COMMIT;
