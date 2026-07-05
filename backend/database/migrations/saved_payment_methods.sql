-- Saved payment methods — tokenized cards for repeat purchases
CREATE TABLE IF NOT EXISTS saved_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(500) NOT NULL,
  card_first_six VARCHAR(6),
  card_last_four VARCHAR(4),
  card_type VARCHAR(30),
  card_exp_date VARCHAR(10),
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  UNIQUE(user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_spm_user ON saved_payment_methods(user_id);

-- Ensure only one default per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_spm_default
  ON saved_payment_methods(user_id) WHERE is_default = true;
