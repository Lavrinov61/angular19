-- Session Replay + Поведенческая аналитика + Heatmap
-- Версия: v0.50.0
-- Применить: psql -U magnus_user -d magnus_photo_db -f session_replay.sql

-- ─── replay_sessions ───────────────────────────────────────────────────────────
-- Метаданные записей (1 строка/визит)

CREATE TABLE IF NOT EXISTS replay_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id            VARCHAR(64)  NOT NULL,
  fingerprint_visitor_id VARCHAR(128),
  user_id               UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Данные визита
  landing_page          TEXT,
  user_agent            TEXT,
  screen_width          INT,
  screen_height         INT,
  device_type           VARCHAR(20) DEFAULT 'desktop', -- 'mobile' | 'tablet' | 'desktop'

  -- Временны́е метки
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at              TIMESTAMPTZ,
  duration_seconds      INT,

  -- Агрегаты (обновляются при добавлении чанков)
  total_pages           INT NOT NULL DEFAULT 0,
  total_clicks          INT NOT NULL DEFAULT 0,
  chunk_count           INT NOT NULL DEFAULT 0,
  total_size_bytes      BIGINT NOT NULL DEFAULT 0,

  -- Связи с заказами и чатами
  chat_session_id       VARCHAR(128),
  order_ids             UUID[] DEFAULT '{}',

  -- Флаги
  has_error             BOOLEAN NOT NULL DEFAULT FALSE,
  is_complete           BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_replay_sessions_visitor   ON replay_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_replay_sessions_fp        ON replay_sessions(fingerprint_visitor_id) WHERE fingerprint_visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_replay_sessions_started   ON replay_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_replay_sessions_user      ON replay_sessions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_replay_sessions_complete  ON replay_sessions(is_complete, started_at DESC);

-- ─── replay_chunks ─────────────────────────────────────────────────────────────
-- Чанки rrweb (6–20 на сессию, ~15–50 КБ JSONB каждый)

CREATE TABLE IF NOT EXISTS replay_chunks (
  id           BIGSERIAL PRIMARY KEY,
  session_id   UUID NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  chunk_index  INT  NOT NULL,

  events       JSONB NOT NULL,           -- массив rrweb событий
  event_count  INT NOT NULL DEFAULT 0,
  size_bytes   INT NOT NULL DEFAULT 0,

  start_time   BIGINT,  -- unix ms первого события в чанке
  end_time     BIGINT,  -- unix ms последнего события в чанке

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (session_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_replay_chunks_session ON replay_chunks(session_id, chunk_index);

-- ─── behavior_events ──────────────────────────────────────────────────────────
-- Структурированные события для AI-анализа и heatmap

CREATE TABLE IF NOT EXISTS behavior_events (
  id                BIGSERIAL PRIMARY KEY,
  session_id        UUID NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  visitor_id        VARCHAR(64) NOT NULL,

  -- Классификация события
  event_type        VARCHAR(50)  NOT NULL,  -- page_view | click | scroll_depth | rage_click | js_error | chat_open | ...
  event_category    VARCHAR(30),            -- navigation | engagement | error | conversion

  -- Контекст страницы
  page_path         TEXT,
  page_title        TEXT,
  element_selector  TEXT,   -- CSS selector элемента (для click)
  element_text      TEXT,   -- Видимый текст элемента (truncated 200 chars)

  -- Числовые и текстовые значения
  value_numeric     NUMERIC,  -- scroll %, duration ms, price, etc.
  value_text        TEXT,
  properties        JSONB DEFAULT '{}',

  -- Координаты клика (для heatmap)
  click_x           INT,
  click_y           INT,
  viewport_width    INT,
  viewport_height   INT,

  -- Временны́е метки
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_on_page_ms   INT  -- время на странице до этого события
);

CREATE INDEX IF NOT EXISTS idx_behavior_events_session    ON behavior_events(session_id);
CREATE INDEX IF NOT EXISTS idx_behavior_events_visitor    ON behavior_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_behavior_events_type       ON behavior_events(event_type);
CREATE INDEX IF NOT EXISTS idx_behavior_events_page       ON behavior_events(page_path);
CREATE INDEX IF NOT EXISTS idx_behavior_events_timestamp  ON behavior_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_events_heatmap    ON behavior_events(page_path, event_type, timestamp DESC)
  WHERE click_x IS NOT NULL AND click_y IS NOT NULL;
