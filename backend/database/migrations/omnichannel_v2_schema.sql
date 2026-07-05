-- Omnichannel Messaging Engine v2 — Phase 0: Schema Foundation
-- Creates 7 new tables for unified messaging pipeline
-- Idempotent: safe to re-run (IF NOT EXISTS, DO NOTHING)

-- ============================================================================
-- 0. Prerequisites
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 1. channel_type ENUM
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE channel_type AS ENUM (
    'telegram', 'vk', 'whatsapp', 'instagram', 'max', 'email', 'web'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. channel_accounts — подключённые каналы с credentials
-- ============================================================================

CREATE TABLE IF NOT EXISTS channel_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel channel_type NOT NULL,
  name VARCHAR(200) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  credentials JSONB NOT NULL DEFAULT '{}',
  rate_limit_max INTEGER DEFAULT 30,
  rate_limit_duration_ms INTEGER DEFAULT 1000,
  capabilities JSONB DEFAULT '{}',
  token_expires_at TIMESTAMPTZ,
  token_refreshed_at TIMESTAMPTZ,
  webhook_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (channel, name)
);

CREATE INDEX IF NOT EXISTS idx_channel_accounts_channel
  ON channel_accounts(channel);
CREATE INDEX IF NOT EXISTS idx_channel_accounts_active
  ON channel_accounts(is_active) WHERE is_active = true;

-- ============================================================================
-- 3. webhook_events — сырые payload'ы для replay/debugging
-- ============================================================================

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel channel_type NOT NULL,
  account_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL,
  raw_headers JSONB NOT NULL DEFAULT '{}',
  raw_body JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'failed', 'skipped', 'replaying')),
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  idempotency_key VARCHAR(255),
  source_ip INET,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_idempotency
  ON webhook_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_status
  ON webhook_events(status) WHERE status != 'processed';
CREATE INDEX IF NOT EXISTS idx_webhook_events_channel
  ON webhook_events(channel, created_at DESC);

-- ============================================================================
-- 4. conversations — unified conversations (замена visitor_chat_sessions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel channel_type NOT NULL,
  account_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL,
  external_chat_id VARCHAR(255),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Display (backward compat с visitor_chat_sessions)
  visitor_id VARCHAR(64),
  visitor_name VARCHAR(200),
  visitor_phone VARCHAR(20),
  visitor_email VARCHAR(255),

  -- Workflow
  status VARCHAR(20) DEFAULT 'open'
    CHECK (status IN ('open', 'waiting', 'active', 'resolved', 'closed')),
  assigned_operator_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Source context
  source VARCHAR(20) DEFAULT 'web',
  entry_context JSONB DEFAULT '{}',
  page_url VARCHAR(500),
  selected_service VARCHAR(100),
  selected_price INTEGER,

  -- Denormalized counters (trigger-maintained)
  message_count INTEGER DEFAULT 0,
  unread_count INTEGER DEFAULT 0,
  last_message_content TEXT,
  last_message_at TIMESTAMPTZ,

  -- SLA
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,

  -- CSAT
  csat_score SMALLINT,
  csat_comment TEXT,

  -- Bot engine state
  context JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',

  -- Legacy FK
  booking_id UUID,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address INET,

  -- Migration bridge: ссылка на исходную visitor_chat_sessions.id
  legacy_session_id UUID UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_conv_channel_ext
  ON conversations(channel, external_chat_id) WHERE status NOT IN ('closed');
CREATE INDEX IF NOT EXISTS idx_conv_status
  ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conv_contact
  ON conversations(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_assigned
  ON conversations(assigned_operator_id) WHERE assigned_operator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_last_msg
  ON conversations(last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_conv_created
  ON conversations(created_at DESC);

-- ============================================================================
-- 5. messages — unified messages (замена visitor_chat_messages)
-- ============================================================================

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- Sender
  sender_type VARCHAR(20) NOT NULL
    CHECK (sender_type IN ('visitor', 'operator', 'bot', 'system', 'internal_note')),
  sender_id VARCHAR(100),
  sender_name VARCHAR(200),

  -- Content
  message_type VARCHAR(20) DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'file', 'video', 'audio',
           'system', 'interactive', 'location', 'contact', 'sticker')),
  content TEXT NOT NULL,

  -- External tracking
  external_message_id VARCHAR(255),
  client_message_id VARCHAR(255),

  -- Threading
  reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  is_forwarded BOOLEAN DEFAULT false,
  forwarded_from_name VARCHAR(200),

  -- Delivery (denormalized latest status)
  delivery_status VARCHAR(20) DEFAULT 'accepted'
    CHECK (delivery_status IN ('accepted', 'sent', 'delivered', 'read', 'failed')),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  is_read BOOLEAN DEFAULT false,

  -- Bot metadata
  metadata JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Migration bridge
  legacy_message_id UUID UNIQUE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_external_id
  ON messages(external_message_id) WHERE external_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_client_id
  ON messages(client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msg_conversation_cursor
  ON messages(conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_msg_reply_to
  ON messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msg_content_trgm
  ON messages USING gin (content gin_trgm_ops);

-- ============================================================================
-- 6. message_statuses — delivery event log
-- ============================================================================

CREATE TABLE IF NOT EXISTS message_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('accepted', 'sent', 'delivered', 'read', 'failed')),
  error_code VARCHAR(50),
  error_message TEXT,
  external_status_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_status_message
  ON message_statuses(message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_status_failed
  ON message_statuses(status) WHERE status = 'failed';

-- ============================================================================
-- 7. media_attachments — отдельная таблица медиа (1:N)
-- ============================================================================

CREATE TABLE IF NOT EXISTS media_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  s3_key VARCHAR(500) NOT NULL,
  s3_url TEXT NOT NULL,
  media_type VARCHAR(20) NOT NULL
    CHECK (media_type IN ('image', 'video', 'audio', 'file', 'sticker')),
  mime_type VARCHAR(100) NOT NULL,
  file_size_bytes BIGINT,
  file_name VARCHAR(500),
  width INTEGER,
  height INTEGER,
  duration_seconds INTEGER,
  original_url TEXT,
  original_mime VARCHAR(100),
  processing_status VARCHAR(20) DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'downloading', 'processing', 'uploaded', 'failed')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_message
  ON media_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_media_processing
  ON media_attachments(processing_status) WHERE processing_status != 'uploaded';

-- ============================================================================
-- 8. outbound_queue — персистентная очередь отправки
-- ============================================================================

CREATE TABLE IF NOT EXISTS outbound_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel channel_type NOT NULL,
  account_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL,
  external_chat_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text',
  media_attachment_id UUID REFERENCES media_attachments(id) ON DELETE SET NULL,
  attachment_url TEXT,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'dead_letter', 'cancelled')),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  next_retry_at TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  external_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_pending
  ON outbound_queue(channel, next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbound_conversation
  ON outbound_queue(conversation_id);
CREATE INDEX IF NOT EXISTS idx_outbound_status
  ON outbound_queue(status) WHERE status IN ('failed', 'dead_letter');

-- ============================================================================
-- 9. Trigger: conversations.updated_at auto-update
-- ============================================================================

CREATE OR REPLACE FUNCTION update_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON conversations;
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_conversations_updated_at();

-- ============================================================================
-- 10. Trigger: conversations denormalized counters
-- ============================================================================

CREATE OR REPLACE FUNCTION update_conversation_counters()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE conversations SET
      message_count = message_count + 1,
      last_message_content = NEW.content,
      last_message_at = NEW.created_at,
      unread_count = CASE
        WHEN NEW.sender_type = 'visitor' THEN unread_count + 1
        ELSE unread_count
      END,
      updated_at = NOW()
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_message_counters ON messages;
CREATE TRIGGER trg_message_counters
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_counters();

-- ============================================================================
-- 11. Trigger: outbound_queue.updated_at auto-update
-- ============================================================================

CREATE OR REPLACE FUNCTION update_outbound_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_outbound_queue_updated_at ON outbound_queue;
CREATE TRIGGER trg_outbound_queue_updated_at
  BEFORE UPDATE ON outbound_queue
  FOR EACH ROW EXECUTE FUNCTION update_outbound_queue_updated_at();

-- ============================================================================
-- 12. Seed channel_accounts (credentials empty — populated from .env at runtime)
-- ============================================================================

INSERT INTO channel_accounts (channel, name, is_active, rate_limit_max, rate_limit_duration_ms, capabilities, webhook_url) VALUES
  ('telegram', '@FmagnusBot', true, 30, 1000,
   '{"markAsRead": false, "sendPhoto": true, "sendFile": true, "sendVideo": true, "sendAudio": true, "sendInlineButton": true, "replyWindow24h": false, "forwardDetection": true, "replyToDetection": true, "statusUpdates": false, "typingIndicator": false, "twoStepUpload": false, "challengeResponse": false, "confirmationHandshake": false, "maxMediaSizeBytes": 52428800, "maxTextLength": 4096}',
   'https://svoefoto.ru/api/webhooks/telegram'),
  ('vk', 'VK Своё Фото', true, 20, 1000,
   '{"markAsRead": true, "sendPhoto": true, "sendFile": true, "sendVideo": false, "sendAudio": false, "sendInlineButton": false, "replyWindow24h": false, "forwardDetection": true, "replyToDetection": true, "statusUpdates": false, "typingIndicator": false, "twoStepUpload": true, "challengeResponse": false, "confirmationHandshake": true, "maxMediaSizeBytes": 209715200, "maxTextLength": 4096}',
   'https://svoefoto.ru/api/webhooks/vk'),
  ('whatsapp', 'WA Business', true, 80, 1000,
   '{"markAsRead": true, "sendPhoto": true, "sendFile": true, "sendVideo": true, "sendAudio": true, "sendInlineButton": false, "replyWindow24h": true, "forwardDetection": false, "replyToDetection": false, "statusUpdates": true, "typingIndicator": false, "twoStepUpload": false, "challengeResponse": true, "confirmationHandshake": false, "maxMediaSizeBytes": 16777216, "maxTextLength": 4096}',
   'https://svoefoto.ru/api/webhooks/whatsapp'),
  ('instagram', 'IG DM', true, 25, 1000,
   '{"markAsRead": false, "sendPhoto": true, "sendFile": true, "sendVideo": false, "sendAudio": false, "sendInlineButton": false, "replyWindow24h": true, "forwardDetection": false, "replyToDetection": false, "statusUpdates": false, "typingIndicator": false, "twoStepUpload": false, "challengeResponse": true, "confirmationHandshake": false, "maxMediaSizeBytes": 8388608, "maxTextLength": 1000}',
   'https://svoefoto.ru/api/webhooks/instagram'),
  ('max', 'Max Bot', true, 25, 1000,
   '{"markAsRead": false, "sendPhoto": true, "sendFile": true, "sendVideo": true, "sendAudio": true, "sendInlineButton": false, "replyWindow24h": false, "forwardDetection": true, "replyToDetection": true, "statusUpdates": false, "typingIndicator": false, "twoStepUpload": false, "challengeResponse": false, "confirmationHandshake": false, "maxMediaSizeBytes": 52428800, "maxTextLength": 4000}',
   'https://svoefoto.ru/api/webhooks/max'),
  ('email', 'info@svoefoto.ru', true, 10, 1000,
   '{"markAsRead": false, "sendPhoto": false, "sendFile": true, "sendVideo": false, "sendAudio": false, "sendInlineButton": false, "replyWindow24h": false, "forwardDetection": false, "replyToDetection": false, "statusUpdates": false, "typingIndicator": false, "twoStepUpload": false, "challengeResponse": false, "confirmationHandshake": false, "maxMediaSizeBytes": 26214400, "maxTextLength": 0}',
   NULL),
  ('web', 'Web Chat', true, 60, 1000,
   '{"markAsRead": false, "sendPhoto": true, "sendFile": true, "sendVideo": false, "sendAudio": true, "sendInlineButton": true, "replyWindow24h": false, "forwardDetection": false, "replyToDetection": true, "statusUpdates": false, "typingIndicator": true, "twoStepUpload": false, "challengeResponse": false, "confirmationHandshake": false, "maxMediaSizeBytes": 10485760, "maxTextLength": 10000}',
   NULL)
ON CONFLICT (channel, name) DO NOTHING;

\echo '✅ Omnichannel v2 Phase 0: 7 tables + 3 triggers + seed data created'
