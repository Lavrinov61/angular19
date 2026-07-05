-- phone_otp_voice_call.sql
-- Разрешает хранить voice_call как канал доставки OTP для входа по телефону.

ALTER TABLE verification_codes DROP CONSTRAINT IF EXISTS verification_codes_method_check;
ALTER TABLE verification_codes ADD CONSTRAINT verification_codes_method_check
  CHECK (method IN ('sms', 'telegram', 'max', 'flash_call', 'voice_call'));
