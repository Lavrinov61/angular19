-- Staff Chat: чат между сотрудниками CRM
-- 4 таблицы: conversations, participants, messages, read_receipts

-- Чаты (direct и групповые)
CREATE TABLE IF NOT EXISTS staff_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200),
  type VARCHAR(10) NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
  created_by UUID REFERENCES users(id),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_preview TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Участники чатов
CREATE TABLE IF NOT EXISTS staff_conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES staff_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

-- Сообщения
CREATE TABLE IF NOT EXISTS staff_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES staff_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  sender_name VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file')),
  attachment_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Прочтения (upsert-модель)
CREATE TABLE IF NOT EXISTS staff_read_receipts (
  user_id UUID NOT NULL REFERENCES users(id),
  conversation_id UUID NOT NULL REFERENCES staff_conversations(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  last_read_message_id UUID REFERENCES staff_messages(id),
  PRIMARY KEY(user_id, conversation_id)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_staff_participants_user ON staff_conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_participants_conv ON staff_conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_staff_messages_conv ON staff_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_staff_messages_sender ON staff_messages(sender_id);

-- Trigger: при новом сообщении обновляем last_message_at и preview
CREATE OR REPLACE FUNCTION update_staff_conv_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE staff_conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = LEFT(NEW.content, 100)
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_message_update_conv ON staff_messages;
CREATE TRIGGER trg_staff_message_update_conv
  AFTER INSERT ON staff_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_staff_conv_last_message();
