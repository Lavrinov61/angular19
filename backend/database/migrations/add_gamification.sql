-- Gamification: Telegram users + Loyalty system
-- Run: psql -U magnus_user -d magnus_photo_db -f add_gamification.sql

-- Telegram users (links TG user to loyalty)
CREATE TABLE IF NOT EXISTS telegram_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT UNIQUE NOT NULL,
    telegram_username VARCHAR(100),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    visitor_id VARCHAR(64),
    photo_url TEXT,
    language_code VARCHAR(10),
    is_premium BOOLEAN DEFAULT FALSE,
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_users_telegram_id ON telegram_users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_tg_users_visitor_id ON telegram_users(visitor_id);

-- Loyalty profiles
CREATE TABLE IF NOT EXISTS loyalty_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id UUID NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
    points INTEGER DEFAULT 0,
    total_points_earned INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_daily_claim TIMESTAMPTZ,
    referral_code VARCHAR(20) UNIQUE,
    referred_by UUID REFERENCES telegram_users(id),
    total_orders INTEGER DEFAULT 0,
    total_spent DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_telegram_user ON loyalty_profiles(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_referral ON loyalty_profiles(referral_code);

-- Points transactions (audit log)
CREATE TABLE IF NOT EXISTS points_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loyalty_profile_id UUID NOT NULL REFERENCES loyalty_profiles(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    action VARCHAR(50) NOT NULL,
    description TEXT,
    reference_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_points_tx_profile ON points_transactions(loyalty_profile_id);
CREATE INDEX IF NOT EXISTS idx_points_tx_created ON points_transactions(created_at DESC);

-- User achievements
CREATE TABLE IF NOT EXISTS user_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loyalty_profile_id UUID NOT NULL REFERENCES loyalty_profiles(id) ON DELETE CASCADE,
    achievement_id VARCHAR(50) NOT NULL,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(loyalty_profile_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_achievements_profile ON user_achievements(loyalty_profile_id);
