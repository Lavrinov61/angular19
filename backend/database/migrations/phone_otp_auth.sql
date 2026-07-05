-- phone_otp_auth.sql
-- Поддержка входа и регистрации по номеру телефона (Phone OTP Auth)
-- Дата: 2026-02-27

-- 1. Добавить 'phone_login' в допустимые purposes для verification_codes
ALTER TABLE verification_codes DROP CONSTRAINT IF EXISTS verification_codes_purpose_check;
ALTER TABLE verification_codes ADD CONSTRAINT verification_codes_purpose_check
  CHECK (purpose IN ('phone_verify', 'two_factor', 'booking_confirm', 'phone_login'));

-- 2. Добавить 'max' в допустимые methods (для будущего MAX Business OTP)
ALTER TABLE verification_codes DROP CONSTRAINT IF EXISTS verification_codes_method_check;
ALTER TABLE verification_codes ADD CONSTRAINT verification_codes_method_check
  CHECK (method IN ('sms', 'telegram', 'max'));

-- 3. Индекс для быстрого поиска пользователя по номеру телефона при логине
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
