-- ============================================================
-- ПЛАН 7: Личный кабинет клиента — телефон, 2FA
-- ============================================================

-- 1. Поля 2FA в таблице users
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_method VARCHAR(20)
  CHECK (two_factor_method IN ('sms', 'telegram'));

-- 2. Таблица кодов верификации (телефон + 2FA + бронирование)
CREATE TABLE IF NOT EXISTS verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  method VARCHAR(20) NOT NULL CHECK (method IN ('sms', 'telegram')),
  purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('phone_verify', 'two_factor', 'booking_confirm')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_phone
  ON verification_codes(phone, purpose) WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verification_codes_user
  ON verification_codes(user_id) WHERE used_at IS NULL;

-- 3. Автоочистка: TTL-индекс на expires_at (для фоновых задач)
CREATE INDEX IF NOT EXISTS idx_verification_codes_expires
  ON verification_codes(expires_at) WHERE used_at IS NULL;
