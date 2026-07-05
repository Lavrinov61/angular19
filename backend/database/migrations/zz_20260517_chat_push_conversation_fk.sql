-- Move web chat push subscriptions from legacy visitor_chat_sessions ids
-- to the current conversations ids used by /api/chat.

BEGIN;

LOCK TABLE visitor_push_subscriptions IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE visitor_push_subscriptions
  DROP CONSTRAINT IF EXISTS visitor_push_subscriptions_session_id_fkey;

-- Drop duplicate legacy rows before remapping to avoid unique conflicts.
DELETE FROM visitor_push_subscriptions old_sub
USING conversations c, visitor_push_subscriptions new_sub
WHERE c.legacy_session_id = old_sub.session_id
  AND c.id <> old_sub.session_id
  AND new_sub.session_id = c.id
  AND (
    (old_sub.endpoint IS NOT NULL AND new_sub.endpoint = old_sub.endpoint)
    OR (old_sub.fcm_token IS NOT NULL AND new_sub.fcm_token = old_sub.fcm_token)
  );

-- Existing legacy subscriptions can be preserved when their v2 conversation exists.
UPDATE visitor_push_subscriptions sub
SET session_id = c.id,
    updated_at = NOW()
FROM conversations c
WHERE c.legacy_session_id = sub.session_id
  AND c.id <> sub.session_id;

ALTER TABLE visitor_push_subscriptions
  ADD CONSTRAINT visitor_push_subscriptions_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID;

COMMENT ON CONSTRAINT visitor_push_subscriptions_session_id_fkey ON visitor_push_subscriptions
  IS 'New chat push subscriptions reference conversations.id; NOT VALID preserves historical legacy rows until final cleanup.';

COMMIT;
