-- Migration 090: Fix conversations.contact_id + retroactive approval session linking
-- 96% conversations (2281/2377) missing contact_id due to fire-and-forget in pipeline

-- Step 1: Link conversations to contacts via channel_users
-- channel_users.contact_id is populated for 706 of 744 Telegram records
UPDATE conversations conv
SET contact_id = cu.contact_id, updated_at = NOW()
FROM channel_users cu
WHERE conv.contact_id IS NULL
  AND cu.channel = conv.channel::text
  AND cu.external_user_id = conv.external_chat_id
  AND cu.contact_id IS NOT NULL;

-- Step 2: Link approval sessions by contact chain (conv -> contact -> user)
UPDATE photo_approval_sessions pas
SET client_id = c.user_id, updated_at = NOW()
FROM conversations conv
JOIN contacts c ON c.id = conv.contact_id
WHERE pas.chat_session_id = conv.id
  AND pas.client_id IS NULL
  AND pas.deleted_at IS NULL
  AND c.user_id IS NOT NULL;

-- Step 3: Link approval sessions via telegram_id
UPDATE photo_approval_sessions pas
SET client_id = u.id, updated_at = NOW()
FROM conversations conv
JOIN users u ON u.telegram_id = conv.external_chat_id
WHERE pas.chat_session_id = conv.id
  AND conv.channel = 'telegram'
  AND pas.client_id IS NULL
  AND pas.deleted_at IS NULL
  AND u.telegram_id IS NOT NULL;

-- Step 4: Fill contact_id on approval sessions from conversations
UPDATE photo_approval_sessions pas
SET contact_id = conv.contact_id, updated_at = NOW()
FROM conversations conv
WHERE pas.chat_session_id = conv.id
  AND pas.contact_id IS NULL
  AND pas.deleted_at IS NULL
  AND conv.contact_id IS NOT NULL;

-- Step 5: Cascade client_id to photo_approvals
UPDATE photo_approvals pa
SET client_id = pas.client_id
FROM photo_approval_sessions pas
WHERE pa.approval_session_id = pas.id
  AND pa.client_id IS NULL
  AND pas.client_id IS NOT NULL;
