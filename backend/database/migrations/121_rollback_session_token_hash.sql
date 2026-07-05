-- Migration 121 — rollback session_token_hash (chat-auth-only P1)
--
-- Отменяет migration 116. В auth-only архитектуре HMAC session tokens
-- заменены на JWT из /auth/login — hash колонки больше не используются.
--
-- ПРЕДУСЛОВИЕ: backend cleanup завершён (grep session_token_hash = 0),
-- все visitors мигрированы на auth-only flow.
--
-- Snapshot на 2026-04-19: 212 conversations имели session_token_hash.
-- После применения эти колонки удаляются — ротация невозможна,
-- но это уже не нужно (auth даёт stable identity через user_id).
--
-- Идемпотентна: DROP INDEX IF EXISTS, DROP COLUMN IF EXISTS.
-- Rollback: восстановить колонки (без данных).

BEGIN;

-- Snapshot для аудита:
DO $$
DECLARE
  v_active INTEGER;
  v_rotated INTEGER;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE session_token_hash IS NOT NULL),
    COUNT(*) FILTER (WHERE session_token_rotated_at IS NOT NULL)
  INTO v_active, v_rotated
  FROM conversations;

  RAISE NOTICE 'migration 121: dropping session_token_hash (% active, % rotated tokens)',
               v_active, v_rotated;
END
$$;

-- 1. Drop unique index (partial)
DROP INDEX IF EXISTS ux_conversations_session_token_hash;

-- 2. Drop columns
ALTER TABLE conversations DROP COLUMN IF EXISTS session_token_hash;
ALTER TABLE conversations DROP COLUMN IF EXISTS session_token_rotated_at;

COMMIT;

-- ============================================================
-- Verification
-- ============================================================
-- Ожидаем: 0 rows
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='conversations'
--   AND column_name IN ('session_token_hash','session_token_rotated_at');
--
-- Ожидаем: 0 rows
-- SELECT indexname FROM pg_indexes
-- WHERE indexname = 'ux_conversations_session_token_hash';
