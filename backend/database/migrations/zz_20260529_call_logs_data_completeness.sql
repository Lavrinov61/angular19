-- Voximplant audit P0: расширение call_logs для полноты данных звонка + индексы.
-- Идемпотентно. Колонки заполняются reconciliation-джобой (P1) и webhook'ами;
-- в P0 добавляем только схему (фундамент) и индексы (немедленный выигрыш выборок Пульта).
BEGIN;

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS call_session_history_id BIGINT,        -- Voximplant CDR id (связь с getCallHistory)
  ADD COLUMN IF NOT EXISTS studio_id UUID,                        -- привязка звонка к точке
  ADD COLUMN IF NOT EXISTS end_reason_code INT,                   -- код причины завершения (Voximplant)
  ADD COLUMN IF NOT EXISTS end_reason_details TEXT,               -- текст причины завершения
  ADD COLUMN IF NOT EXISTS cost NUMERIC(10,4),                    -- стоимость звонка
  ADD COLUMN IF NOT EXISTS finish_reason TEXT,                    -- finishReason сессии
  ADD COLUMN IF NOT EXISTS audio_quality TEXT,                    -- качество аудио
  ADD COLUMN IF NOT EXISTS recording_storage VARCHAR(20) NOT NULL DEFAULT 'voximplant', -- voximplant|s3|local
  ADD COLUMN IF NOT EXISTS recording_voximplant_url TEXT,         -- исходный URL до архивации в свой S3
  ADD COLUMN IF NOT EXISTS recording_archived_at TIMESTAMPTZ,     -- когда запись архивирована в S3
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;             -- когда сверено с Voximplant CDR

-- FK на studios без падения при гонке/отсутствии (добавляем отдельно, IF NOT EXISTS через каталог).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'call_logs_studio_id_fkey'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'studios'
  ) THEN
    ALTER TABLE public.call_logs
      ADD CONSTRAINT call_logs_studio_id_fkey
      FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Индексы под операторские выборки (сейчас seq scan).
CREATE INDEX IF NOT EXISTS idx_call_logs_direction_status
  ON public.call_logs (direction, status);
CREATE INDEX IF NOT EXISTS idx_call_logs_direction_started
  ON public.call_logs (direction, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_studio_started
  ON public.call_logs (studio_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_session_history
  ON public.call_logs (call_session_history_id) WHERE call_session_history_id IS NOT NULL;
-- Частичные индексы под фоновые джобы (P1).
CREATE INDEX IF NOT EXISTS idx_call_logs_recon_pending
  ON public.call_logs (started_at) WHERE reconciled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_call_logs_archive_pending
  ON public.call_logs (recording_archived_at)
  WHERE recording_url IS NOT NULL AND recording_storage = 'voximplant';

-- Обратный поиск «все звонки по заказу/задаче».
CREATE INDEX IF NOT EXISTS idx_call_entity_links_entity
  ON public.call_entity_links (entity_id, entity_type);

COMMIT;
