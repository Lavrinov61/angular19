-- Таблица для хранения агрегированной статистики отзывов с внешних платформ
-- Данные обновляются автоматически раз в сутки через парсинг 2ГИС и Яндекс

CREATE TABLE IF NOT EXISTS review_platform_stats (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(50) NOT NULL,
    location_slug VARCHAR(100) NOT NULL,
    location_name VARCHAR(255),
    external_url TEXT NOT NULL,
    rating NUMERIC(2,1),
    review_count INTEGER DEFAULT 0,
    last_synced_at TIMESTAMPTZ,
    sync_error TEXT,
    raw_response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(platform, location_slug)
);

CREATE INDEX IF NOT EXISTS idx_review_platform_stats_platform ON review_platform_stats(platform);
