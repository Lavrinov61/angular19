-- Fix (SEV1): операторские ответы в веб-чат падали с 500 «value too long for type character varying(40)».
-- В chat-admin.routes.ts ai_agent_mode_set_by пишется как 'operator:' || <uuid> = 45 символов
-- (9 + 36), что не влезало в varchar(40). Вся транзакция (UPDATE conversations + INSERT messages)
-- откатывалась → сообщение оператора НЕ сохранялось → в UI появлялось и исчезало.
-- Расширяем колонку до varchar(64) (покрывает 'operator:'/'agent_handoff:' + uuid с запасом).
-- Идемпотентно; расширение varchar — catalog-only, без перезаписи таблицы и потери данных.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversations'
      AND column_name = 'ai_agent_mode_set_by'
      AND character_maximum_length < 64
  ) THEN
    ALTER TABLE conversations ALTER COLUMN ai_agent_mode_set_by TYPE varchar(64);
  END IF;
END $$;
