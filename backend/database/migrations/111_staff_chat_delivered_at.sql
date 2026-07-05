-- Migration 111: staff chat — двойная галочка (delivered/read)
-- Дата: 2026-04-17
-- Цель: добавить столбец delivered_at в staff_read_receipts для отображения "delivered"
--       отдельно от "read" (last_read_at). Нужен для real-time двойной галочки как в WhatsApp:
--         1 галочка (sent)      — сообщение записано в БД
--         2 галочки (delivered) — получатель открыл чат (GET /messages)
--         2 синих  (read)       — получатель проскроллил до сообщения (PUT /read)
--
-- Backfill: все уже прочитанные сообщения (last_read_at IS NOT NULL) по определению были доставлены,
--           поэтому delivered_at = last_read_at для них.
--
-- Индексы:
--   * idx_staff_read_receipts_conv_user       — ускоряет lookup receipt по (conv, user) при GET/PUT
--   * idx_staff_read_receipts_conv_delivered  — partial-index для быстрого выбора "ещё не доставлено"

ALTER TABLE staff_read_receipts ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_staff_read_receipts_conv_user
  ON staff_read_receipts (conversation_id, user_id);

CREATE INDEX IF NOT EXISTS idx_staff_read_receipts_conv_delivered
  ON staff_read_receipts (conversation_id) WHERE delivered_at IS NULL;

-- Backfill: read => delivered
UPDATE staff_read_receipts
  SET delivered_at = last_read_at
  WHERE delivered_at IS NULL AND last_read_at IS NOT NULL;
