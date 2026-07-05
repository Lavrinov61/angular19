-- Отложенная отправка ссылки на подтверждение очной студ-верификации.
-- После заверения документа у стойки клиенту на следующий день в 09:00 МСК
-- автоматически уходит ссылка в привязанный мессенджер (или SMS).
-- Выделенная очередь, чтобы НЕ засорять Пульт операторскими сообщениями.
-- Идемпотентна (IF NOT EXISTS), применяется один раз на общей БД.

CREATE TABLE IF NOT EXISTS student_inperson_confirm_sends (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id  UUID NOT NULL REFERENCES student_verifications(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  phone_normalized TEXT NOT NULL,
  send_at          TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sending','sent','failed','skipped','canceled')),
  channel_used     TEXT,
  attempts         INT NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at          TIMESTAMPTZ
);

-- Поллер: due-записи к отправке.
CREATE INDEX IF NOT EXISTS idx_sics_due
  ON student_inperson_confirm_sends (send_at)
  WHERE status = 'pending';

-- Идемпотентность: одна запись очереди на одну заявку.
-- Повторный prepare той же pending-заявки = тот же verification_id → UPSERT обновляет.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sics_verification
  ON student_inperson_confirm_sends (verification_id);

-- Анти-дубль живому человеку: быстрый поиск недавних отправок по телефону.
CREATE INDEX IF NOT EXISTS idx_sics_phone_sent
  ON student_inperson_confirm_sends (phone_normalized, sent_at)
  WHERE status = 'sent';
