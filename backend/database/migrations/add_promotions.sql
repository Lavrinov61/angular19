-- Миграция: таблица акций/спецпредложений

CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  image_url VARCHAR(500),
  discount_percent INTEGER,
  discount_amount NUMERIC(10,2),
  original_price NUMERIC(10,2),
  promo_price NUMERIC(10,2),
  promo_code VARCHAR(50),
  usage_limit INTEGER,
  usage_count INTEGER DEFAULT 0,
  service_slug VARCHAR(100),
  cta_text VARCHAR(100) DEFAULT 'Подробнее',
  cta_url VARCHAR(500),
  conditions TEXT,
  starts_at TIMESTAMP WITH TIME ZONE,
  ends_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions (is_active, sort_order, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotions_slug ON promotions (slug);
