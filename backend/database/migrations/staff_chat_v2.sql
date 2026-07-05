-- Staff Chat v2: general channel, file uploads, reply-to
-- 2026-03-05

-- 1. Add 'general' to conversation type CHECK
ALTER TABLE staff_conversations DROP CONSTRAINT IF EXISTS staff_conversations_type_check;
ALTER TABLE staff_conversations ADD CONSTRAINT staff_conversations_type_check
  CHECK (type IN ('direct', 'group', 'general'));

-- 2. Expand message_type for video/audio
ALTER TABLE staff_messages DROP CONSTRAINT IF EXISTS staff_messages_message_type_check;
ALTER TABLE staff_messages ADD CONSTRAINT staff_messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'file', 'video', 'audio'));

-- 3. Reply-to support
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES staff_messages(id);
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS reply_to_content TEXT;
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS reply_to_sender_name VARCHAR(200);

-- 4. Original filename for downloads
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS original_filename VARCHAR(500);

-- 5. Index for reply lookups
CREATE INDEX IF NOT EXISTS idx_staff_messages_reply ON staff_messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;

-- 6. Seed the General channel
INSERT INTO staff_conversations (id, title, type, created_by, last_message_preview)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Своё Фото — Команда',
  'general',
  NULL,
  'Общий чат команды'
)
ON CONFLICT (id) DO NOTHING;

-- 7. Add all existing staff to general channel
INSERT INTO staff_conversation_participants (conversation_id, user_id)
SELECT '00000000-0000-0000-0000-000000000001', id
FROM users
WHERE role IN ('admin', 'manager', 'employee', 'photographer')
  AND is_active = true
ON CONFLICT (conversation_id, user_id) DO NOTHING;
