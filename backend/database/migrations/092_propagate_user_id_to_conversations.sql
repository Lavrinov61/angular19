-- Migration 092: Propagate user_id from approval sessions to conversations
-- If a conversation has an approval session with client_id, set conversation.user_id

UPDATE conversations conv
SET user_id = pas.client_id, updated_at = NOW()
FROM photo_approval_sessions pas
WHERE conv.id = pas.chat_session_id
  AND conv.user_id IS NULL
  AND pas.client_id IS NOT NULL
  AND pas.deleted_at IS NULL;

-- Also: contacts.user_id from conversations.user_id
UPDATE contacts c
SET user_id = conv.user_id, updated_at = NOW()
FROM conversations conv
WHERE conv.contact_id = c.id
  AND c.user_id IS NULL
  AND conv.user_id IS NOT NULL;
