-- Добавить user_id в loyalty_profiles для поддержки веб-пользователей (не только Telegram)
ALTER TABLE loyalty_profiles ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_user_id ON loyalty_profiles(user_id) WHERE user_id IS NOT NULL;

-- telegram_user_id теперь nullable — у web-пользователей нет Telegram
ALTER TABLE loyalty_profiles ALTER COLUMN telegram_user_id DROP NOT NULL;
