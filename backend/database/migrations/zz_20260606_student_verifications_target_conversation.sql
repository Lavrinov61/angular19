-- Очная студ-верификация из чата: целевой канал доставки ссылки подтверждения.
-- Хранит, в какой диалог (мессенджер) слать next-day ссылку — задаётся сотрудником
-- при регистрации прямо из чата клиента. ON DELETE SET NULL: если диалог хард-удалят,
-- target деградирует в fallback (resolveBestMessengerForUser), удаление не блокируется.
BEGIN;
ALTER TABLE student_verifications
  ADD COLUMN IF NOT EXISTS target_conversation_id uuid
    REFERENCES conversations(id) ON DELETE SET NULL;
COMMIT;
