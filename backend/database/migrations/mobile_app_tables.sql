-- Mobile App Support Tables (Phase 0)
-- mobile_push_tokens: FCM/HMS/RuStore push token registry
-- feature_flags: runtime feature flags for mobile + web

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- mobile_push_tokens — реестр push-токенов мобильных устройств
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mobile_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  visitor_id VARCHAR(255),
  device_id VARCHAR(255) NOT NULL,
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('android', 'ios')),
  push_provider VARCHAR(20) NOT NULL CHECK (push_provider IN ('fcm', 'hms', 'rustore', 'apns')),
  token TEXT NOT NULL,
  app_version VARCHAR(20),
  device_model VARCHAR(100),
  os_version VARCHAR(20),
  locale VARCHAR(10) DEFAULT 'ru',
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Один токен на устройство+провайдер (upsert)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_push_tokens_device_provider
  ON mobile_push_tokens(device_id, push_provider);

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_user
  ON mobile_push_tokens(user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_visitor
  ON mobile_push_tokens(visitor_id) WHERE visitor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_active
  ON mobile_push_tokens(is_active) WHERE is_active = true;

-- ══════════════════════════════════════════════════════════════
-- feature_flags — runtime feature flags
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN DEFAULT false,
  platforms TEXT[] DEFAULT NULL, -- NULL = все платформы; ['android','ios','web']
  min_app_version VARCHAR(20) DEFAULT NULL, -- минимальная версия приложения для флага
  rollout_percentage INT DEFAULT 100 CHECK (rollout_percentage BETWEEN 0 AND 100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled
  ON feature_flags(enabled) WHERE enabled = true;

-- ══════════════════════════════════════════════════════════════
-- Триггер updated_at
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_mobile_push_tokens_updated_at ON mobile_push_tokens;
CREATE TRIGGER trigger_mobile_push_tokens_updated_at
  BEFORE UPDATE ON mobile_push_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_feature_flags_updated_at ON feature_flags;
CREATE TRIGGER trigger_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
