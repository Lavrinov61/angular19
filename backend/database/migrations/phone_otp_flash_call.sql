-- phone_otp_flash_call.sql
-- Phone login OTP via Voximplant flash calls.
-- Date: 2026-04-23

ALTER TABLE verification_codes DROP CONSTRAINT IF EXISTS verification_codes_method_check;
ALTER TABLE verification_codes ADD CONSTRAINT verification_codes_method_check
  CHECK (method IN ('sms', 'telegram', 'max', 'flash_call'));
