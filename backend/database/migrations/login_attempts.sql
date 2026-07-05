-- Security: per-email login attempt tracking for brute-force protection
CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  ip VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time
  ON login_attempts(email, created_at DESC)
  WHERE success = false;

CREATE INDEX IF NOT EXISTS idx_login_attempts_cleanup
  ON login_attempts(created_at);
