-- file-ack: момент последнего сервисного подтверждения получения файлов ботом.
-- timestamp + cooldown (НЕ boolean): постоянный клиент при повторном обращении через
-- cooldown снова получает подтверждение, а не висит в тишине навсегда.
-- Идемпотентно (IF NOT EXISTS), безопасно на общей dev/prod БД.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS files_ack_at timestamptz NULL;

COMMENT ON COLUMN conversations.files_ack_at IS
  'Последнее сервисное подтверждение получения файлов ботом (file-ack). Cooldown анти-спам.';
