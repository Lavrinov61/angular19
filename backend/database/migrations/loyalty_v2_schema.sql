-- Loyalty v2: constraints, indexes, action enum
-- Idempotent: safe to run multiple times

-- 1. FK для customer_id → customers(id) ON DELETE SET NULL
DO $$ BEGIN
  ALTER TABLE loyalty_profiles
    ADD CONSTRAINT fk_loyalty_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. UNIQUE index для customer_id (заменяем обычный на unique)
DROP INDEX IF EXISTS idx_loyalty_profiles_customer_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_profiles_customer_id_unique
  ON loyalty_profiles(customer_id) WHERE customer_id IS NOT NULL;

-- 3. CHECK constraint на points_transactions.action
-- Существующие actions (daily_checkin, first_visit, online_order) все входят в список
DO $$ BEGIN
  ALTER TABLE points_transactions
    ADD CONSTRAINT chk_points_action CHECK (
      action IN (
        'first_visit', 'daily_checkin', 'streak_bonus',
        'referral_bonus', 'referral_welcome',
        'online_order', 'pos_order', 'pos_spend',
        'admin_adjust', 'admin_deduct',
        'chat_order', 'review_bonus', 'achievement_bonus'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Composite index для transaction history
CREATE INDEX IF NOT EXISTS idx_points_tx_profile_created
  ON points_transactions(loyalty_profile_id, created_at DESC);
