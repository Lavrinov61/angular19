-- Unified Contacts: единая идентичность клиентов CRM
-- 1 контакт = 1 физическое лицо (может иметь 0..N каналов, 0..N чат-сессий)

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(255),
  phone VARCHAR(20),
  email VARCHAR(255),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source VARCHAR(30) NOT NULL,
  avatar_url TEXT,
  metadata JSONB DEFAULT '{}',
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phone is the primary unifier across channels (normalized: 7xxxxxxxxxx)
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_phone
  ON contacts(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_user
  ON contacts(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_source
  ON contacts(source);
CREATE INDEX IF NOT EXISTS idx_contacts_last_seen
  ON contacts(last_seen_at DESC);

-- FK: channel_users → contacts
ALTER TABLE channel_users
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_channel_users_contact
  ON channel_users(contact_id) WHERE contact_id IS NOT NULL;

-- FK: visitor_chat_sessions → contacts
ALTER TABLE visitor_chat_sessions
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vcs_contact
  ON visitor_chat_sessions(contact_id) WHERE contact_id IS NOT NULL;

-- FK: photo_approval_sessions → contacts (for photo delivery to non-registered clients)
ALTER TABLE photo_approval_sessions
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

\echo '✅ contacts table created, FK added to channel_users, visitor_chat_sessions, photo_approval_sessions'
