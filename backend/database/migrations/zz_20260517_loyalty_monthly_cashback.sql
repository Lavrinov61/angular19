BEGIN;

ALTER TABLE points_transactions DROP CONSTRAINT IF EXISTS chk_points_action;
ALTER TABLE points_transactions
  ADD CONSTRAINT chk_points_action CHECK (
    action IN (
      'first_visit', 'daily_checkin', 'streak_bonus',
      'referral_bonus', 'referral_welcome',
      'online_order', 'pos_order', 'pos_spend',
      'admin_adjust', 'admin_deduct',
      'chat_order', 'review_bonus', 'achievement_bonus',
      'monthly_cashback'
    )
  );

CREATE TABLE IF NOT EXISTS loyalty_cashback_category_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loyalty_profile_id UUID NOT NULL REFERENCES loyalty_profiles(id) ON DELETE CASCADE,
  category_key VARCHAR(32) NOT NULL,
  period_month DATE NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_loyalty_cashback_selection_category CHECK (
    category_key IN ('documents', 'photos', 'id-photo', 'restoration', 'photoshoot', 'albums')
  ),
  CONSTRAINT uq_loyalty_cashback_selection_period UNIQUE (loyalty_profile_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_cashback_selections_profile_month
  ON loyalty_cashback_category_selections (loyalty_profile_id, period_month DESC);

CREATE TABLE IF NOT EXISTS loyalty_cashback_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loyalty_profile_id UUID NOT NULL REFERENCES loyalty_profiles(id) ON DELETE CASCADE,
  selection_id UUID NOT NULL REFERENCES loyalty_cashback_category_selections(id) ON DELETE RESTRICT,
  points_transaction_id UUID REFERENCES points_transactions(id) ON DELETE SET NULL,
  source VARCHAR(32) NOT NULL,
  reference_id VARCHAR(100) NOT NULL,
  category_key VARCHAR(32) NOT NULL,
  period_month DATE NOT NULL,
  order_amount NUMERIC(12,2) NOT NULL,
  cashback_rate NUMERIC(5,4) NOT NULL DEFAULT 0.1000,
  points_awarded INTEGER NOT NULL,
  order_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_loyalty_cashback_awards_source CHECK (source IN ('online_order', 'pos_order', 'chat_order')),
  CONSTRAINT chk_loyalty_cashback_awards_category CHECK (
    category_key IN ('documents', 'photos', 'id-photo', 'restoration', 'photoshoot', 'albums')
  ),
  CONSTRAINT chk_loyalty_cashback_awards_amount CHECK (order_amount >= 0),
  CONSTRAINT chk_loyalty_cashback_awards_points CHECK (points_awarded > 0),
  CONSTRAINT uq_loyalty_cashback_awards_source_ref UNIQUE (source, reference_id)
);

ALTER TABLE loyalty_cashback_awards
  ADD COLUMN IF NOT EXISTS order_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_loyalty_cashback_awards_profile_period
  ON loyalty_cashback_awards (loyalty_profile_id, period_month DESC);

COMMIT;
