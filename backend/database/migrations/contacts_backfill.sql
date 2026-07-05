-- Backfill contacts from existing data
-- Safe to run multiple times (idempotent)

-- 1. Create contacts from registered client users
INSERT INTO contacts (display_name, phone, email, user_id, source, first_seen_at, created_at)
SELECT u.display_name, u.phone, u.email, u.id, 'web', u.created_at, u.created_at
FROM users u
WHERE u.role = 'client'
  AND u.is_active = TRUE
  AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.user_id = u.id)
  AND (u.phone IS NOT NULL OR u.email IS NOT NULL)
ON CONFLICT DO NOTHING;

\echo '1/6: contacts from users'

-- 2. Create contacts from channel_users with phone (WhatsApp etc.)
INSERT INTO contacts (display_name, phone, source, first_seen_at, created_at)
SELECT DISTINCT ON (cu.phone)
  cu.display_name, cu.phone, cu.channel, cu.first_seen_at, cu.created_at
FROM channel_users cu
WHERE cu.phone IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.phone = cu.phone)
ORDER BY cu.phone, cu.last_seen_at DESC NULLS LAST
ON CONFLICT DO NOTHING;

\echo '2/6: contacts from channel_users (with phone)'

-- 3. Create contacts from channel_users without phone (Telegram, VK, etc.)
INSERT INTO contacts (display_name, source, first_seen_at, created_at)
SELECT cu.display_name, cu.channel, cu.first_seen_at, cu.created_at
FROM channel_users cu
WHERE cu.phone IS NULL
  AND cu.contact_id IS NULL;

\echo '3/6: contacts from channel_users (no phone)'

-- 4. Link channel_users → contacts by phone
UPDATE channel_users cu SET contact_id = c.id
FROM contacts c
WHERE c.phone = cu.phone
  AND cu.phone IS NOT NULL
  AND cu.contact_id IS NULL;

-- 4b. Link channel_users → contacts for phoneless entries (by recently created)
UPDATE channel_users cu SET contact_id = c.id
FROM contacts c
WHERE cu.contact_id IS NULL
  AND cu.phone IS NULL
  AND c.display_name = cu.display_name
  AND c.source = cu.channel
  AND c.phone IS NULL;

\echo '4/6: channel_users linked'

-- 5. Link visitor_chat_sessions → contacts by user_id
UPDATE visitor_chat_sessions vcs SET contact_id = c.id
FROM contacts c
WHERE c.user_id = vcs.user_id
  AND vcs.user_id IS NOT NULL
  AND vcs.contact_id IS NULL;

\echo '5/6: sessions linked by user_id'

-- 6. Link visitor_chat_sessions → contacts by phone
UPDATE visitor_chat_sessions vcs SET contact_id = c.id
FROM contacts c
WHERE c.phone = vcs.visitor_phone
  AND vcs.visitor_phone IS NOT NULL
  AND vcs.contact_id IS NULL;

\echo '6/6: sessions linked by phone'

-- Stats
SELECT 'contacts' AS table_name, count(*) FROM contacts
UNION ALL
SELECT 'channel_users linked', count(*) FROM channel_users WHERE contact_id IS NOT NULL
UNION ALL
SELECT 'sessions linked', count(*) FROM visitor_chat_sessions WHERE contact_id IS NOT NULL;

\echo '✅ contacts backfill complete'
