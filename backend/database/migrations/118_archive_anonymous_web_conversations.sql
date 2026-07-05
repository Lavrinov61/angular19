-- Migration 118 — archive anonymous web conversations (chat-auth-only P1)
--
-- Цель: в auth-only архитектуре не может быть анонимных web-чатов.
-- Все web conversations должны иметь contact_id (гарантия после 107 — NOT NULL).
-- Эта миграция — safety net: если вдруг есть анонимный web чат (не должно быть),
-- перевести его в archived чтобы CRM не показывал.
--
-- Ожидаемый результат: 0 rows affected (research = 0 на 2026-04-19).
-- Если > 0 — означает регрессию в 107 constraint; залогируется в NOTICE.
--
-- Идемпотентна: status != 'archived' в WHERE.
-- Rollback: нет семантически осмысленного (не знаем оригинальный status).

BEGIN;

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM conversations
  WHERE channel = 'web'
    AND contact_id IS NULL
    AND status IS DISTINCT FROM 'archived';

  RAISE NOTICE 'migration 118: found % anonymous web conversations to archive', v_count;

  IF v_count > 0 THEN
    UPDATE conversations
    SET status     = 'archived',
        updated_at = NOW()
    WHERE channel = 'web'
      AND contact_id IS NULL
      AND status IS DISTINCT FROM 'archived';

    RAISE NOTICE 'migration 118: archived % rows', v_count;
  ELSE
    RAISE NOTICE 'migration 118: no-op (no anonymous web conversations)';
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- Verification
-- ============================================================
-- Ожидаем: 0
-- SELECT COUNT(*) FROM conversations
-- WHERE channel='web' AND contact_id IS NULL AND status != 'archived';
