-- Migration 091: Backfill missing channel_users and contacts for conversations
-- 145 Telegram conversations have no channel_users record because
-- upsertChannelUserAndLinkAccount() was fire-and-forget and silently failed.
-- Idempotent: all operations use ON CONFLICT DO NOTHING or WHERE ... IS NULL.

-- Step 1: Create missing contacts for conversations that have no channel_user
-- Use visitor_name from conversations as display_name
INSERT INTO contacts (id, display_name, source, created_at, updated_at)
SELECT
  gen_random_uuid(),
  conv.visitor_name,
  conv.channel::text,
  conv.created_at,
  NOW()
FROM conversations conv
LEFT JOIN channel_users cu
  ON cu.channel = conv.channel::text
  AND cu.external_user_id = conv.external_chat_id
WHERE cu.id IS NULL
  AND conv.external_chat_id IS NOT NULL
  AND conv.contact_id IS NULL
-- Deduplicate by (channel, external_chat_id) — one contact per unique messenger user
AND conv.id = (
  SELECT c2.id FROM conversations c2
  WHERE c2.channel = conv.channel
    AND c2.external_chat_id = conv.external_chat_id
  ORDER BY c2.created_at ASC
  LIMIT 1
);

-- Step 2: Create missing channel_users records, linking to the new contacts
-- Match by source + display_name + created_at to find the contacts we just created
INSERT INTO channel_users (id, channel, external_user_id, display_name, contact_id)
SELECT
  gen_random_uuid(),
  conv.channel::text,
  conv.external_chat_id,
  conv.visitor_name,
  ct.id
FROM conversations conv
JOIN contacts ct
  ON ct.source = conv.channel::text
  AND ct.display_name = conv.visitor_name
  AND ct.created_at = conv.created_at
LEFT JOIN channel_users cu
  ON cu.channel = conv.channel::text
  AND cu.external_user_id = conv.external_chat_id
WHERE cu.id IS NULL
  AND conv.external_chat_id IS NOT NULL
  AND conv.contact_id IS NULL
AND conv.id = (
  SELECT c2.id FROM conversations c2
  WHERE c2.channel = conv.channel
    AND c2.external_chat_id = conv.external_chat_id
  ORDER BY c2.created_at ASC
  LIMIT 1
)
ON CONFLICT (channel, external_user_id) DO UPDATE
SET contact_id = COALESCE(channel_users.contact_id, EXCLUDED.contact_id);

-- Step 3: Link ALL conversations to contacts via channel_users (re-run of migration 090 step 1)
UPDATE conversations conv
SET contact_id = cu.contact_id, updated_at = NOW()
FROM channel_users cu
WHERE conv.contact_id IS NULL
  AND cu.channel = conv.channel::text
  AND cu.external_user_id = conv.external_chat_id
  AND cu.contact_id IS NOT NULL;

-- Step 4: Fill contact_id on approval sessions from now-linked conversations
UPDATE photo_approval_sessions pas
SET contact_id = conv.contact_id, updated_at = NOW()
FROM conversations conv
WHERE pas.chat_session_id = conv.id
  AND pas.contact_id IS NULL
  AND pas.deleted_at IS NULL
  AND conv.contact_id IS NOT NULL;
