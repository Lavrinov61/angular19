-- Расширение таблицы app_logs для CRM error tracking
-- 2026-03-04

ALTER TABLE app_logs ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'frontend';
ALTER TABLE app_logs ADD COLUMN IF NOT EXISTS service VARCHAR(100);
ALTER TABLE app_logs ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE app_logs ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE app_logs ADD COLUMN IF NOT EXISTS http_status INTEGER;
ALTER TABLE app_logs ADD COLUMN IF NOT EXISTS http_method VARCHAR(10);
ALTER TABLE app_logs ADD COLUMN IF NOT EXISTS http_url TEXT;
ALTER TABLE app_logs ADD COLUMN IF NOT EXISTS stack_trace TEXT;
ALTER TABLE app_logs ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(64);

-- Индексы для запросов
CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level);
CREATE INDEX IF NOT EXISTS idx_app_logs_service ON app_logs(service);
CREATE INDEX IF NOT EXISTS idx_app_logs_fingerprint ON app_logs(fingerprint);
CREATE INDEX IF NOT EXISTS idx_app_logs_user_id ON app_logs(user_id);
