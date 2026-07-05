-- Pending OAuth account links — require email confirmation before linking
-- Prevents OAuth Account Takeover (attacker creates OAuth with victim's email)

CREATE TABLE IF NOT EXISTS pending_oauth_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_oauth_token ON pending_oauth_links(token);
CREATE INDEX IF NOT EXISTS idx_pending_oauth_expires ON pending_oauth_links(expires_at) WHERE used = false;

-- Cleanup old expired records (run periodically)
-- DELETE FROM pending_oauth_links WHERE expires_at < NOW() - INTERVAL '7 days';
