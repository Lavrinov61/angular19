-- Migration 089: Retroactive auto-link photo_approval_sessions to clients
-- Idempotent: all UPDATEs use WHERE client_id IS NULL

-- Step 1: Link by phone (pas.client_phone = users.phone)
UPDATE photo_approval_sessions pas
SET client_id = u.id, updated_at = NOW()
FROM users u
WHERE pas.client_id IS NULL
  AND pas.deleted_at IS NULL
  AND pas.client_phone IS NOT NULL
  AND u.phone = pas.client_phone;

-- Step 2: Link by chat_session_id → conversations.user_id
UPDATE photo_approval_sessions pas
SET client_id = conv.user_id, updated_at = NOW()
FROM conversations conv
WHERE pas.client_id IS NULL
  AND pas.deleted_at IS NULL
  AND pas.chat_session_id IS NOT NULL
  AND conv.id = pas.chat_session_id
  AND conv.user_id IS NOT NULL;

-- Step 3: Link by chat_session_id → conversations.contact_id → contacts.user_id
UPDATE photo_approval_sessions pas
SET client_id = c.user_id, updated_at = NOW()
FROM conversations conv
JOIN contacts c ON c.id = conv.contact_id
WHERE pas.client_id IS NULL
  AND pas.deleted_at IS NULL
  AND pas.chat_session_id IS NOT NULL
  AND conv.id = pas.chat_session_id
  AND c.user_id IS NOT NULL;

-- Step 4: Cascade to photo_approvals
UPDATE photo_approvals pa
SET client_id = pas.client_id
FROM photo_approval_sessions pas
WHERE pa.approval_session_id = pas.id
  AND pa.client_id IS NULL
  AND pas.client_id IS NOT NULL;
