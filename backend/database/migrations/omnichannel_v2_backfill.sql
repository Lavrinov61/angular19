-- Omnichannel v2 — Phase 4: Data Backfill
-- Migrates existing data from legacy tables to v2 schema.
-- Idempotent: safe to run multiple times (uses NOT EXISTS / ON CONFLICT).
--
-- Source tables: visitor_chat_sessions, visitor_chat_messages, email_messages, email_attachments
-- Target tables: conversations, messages, media_attachments

-- ============================================================================
-- 1. Backfill conversations from visitor_chat_sessions
-- ============================================================================

INSERT INTO conversations (
  id, channel, external_chat_id, contact_id, user_id,
  visitor_id, visitor_name, visitor_phone, visitor_email,
  status, assigned_operator_id, source, entry_context,
  page_url, selected_service, selected_price,
  message_count, unread_count, last_message_content, last_message_at,
  first_response_at, resolved_at, csat_score, csat_comment,
  context, metadata, booking_id,
  created_at, updated_at, closed_at, user_agent, ip_address,
  account_id, legacy_session_id
)
SELECT
  gen_random_uuid(),
  (CASE
    WHEN s.channel IN ('online', 'studio') THEN 'web'
    WHEN s.channel IS NULL THEN 'web'
    ELSE s.channel
  END)::channel_type,
  s.metadata->>'externalChatId',
  s.contact_id,
  s.user_id,
  s.visitor_id,
  s.visitor_name,
  s.visitor_phone,
  s.visitor_email,
  s.status,
  s.assigned_operator_id,
  COALESCE(s.source, 'web'),
  COALESCE(s.entry_context, '{}'::jsonb),
  s.page_url,
  s.selected_service,
  s.selected_price,
  COALESCE(s.message_count, 0),
  COALESCE(s.unread_count, 0),
  s.last_message_content,
  s.last_message_at,
  s.first_response_at,
  s.resolved_at,
  s.csat_score,
  s.csat_comment,
  COALESCE(s.context, '{}'::jsonb),
  COALESCE(s.metadata, '{}'::jsonb),
  s.booking_id,
  s.created_at,
  s.updated_at,
  s.closed_at,
  s.user_agent,
  s.ip_address,
  (SELECT ca.id FROM channel_accounts ca WHERE ca.channel = (CASE
    WHEN s.channel IN ('online', 'studio') THEN 'web'
    WHEN s.channel IS NULL THEN 'web'
    ELSE s.channel
  END)::channel_type LIMIT 1),
  s.id
FROM visitor_chat_sessions s
WHERE NOT EXISTS (SELECT 1 FROM conversations c WHERE c.legacy_session_id = s.id);

-- ============================================================================
-- 2. Backfill messages from visitor_chat_messages
-- ============================================================================

INSERT INTO messages (
  id, conversation_id, sender_type, sender_id, sender_name,
  message_type, content, external_message_id, client_message_id,
  reply_to_message_id, is_forwarded, forwarded_from_name,
  delivered_at, is_read, read_at, metadata, created_at,
  delivery_status, legacy_message_id
)
SELECT
  gen_random_uuid(),
  c.id,
  m.sender_type,
  m.sender_id,
  m.sender_name,
  COALESCE(m.message_type, 'text'),
  COALESCE(m.content, ''),
  m.external_message_id,
  m.client_message_id,
  NULL, -- reply_to resolved in step 3
  COALESCE(m.is_forwarded, false),
  m.forwarded_from_name,
  m.delivered_at,
  COALESCE(m.is_read, false),
  m.read_at,
  m.metadata,
  m.created_at,
  CASE
    WHEN COALESCE(m.is_read, false) THEN 'read'
    WHEN m.delivered_at IS NOT NULL THEN 'delivered'
    WHEN m.sender_type IN ('operator', 'bot') THEN 'sent'
    ELSE 'accepted'
  END::varchar(20),
  m.id
FROM visitor_chat_messages m
JOIN conversations c ON c.legacy_session_id = m.session_id
WHERE NOT EXISTS (SELECT 1 FROM messages msg WHERE msg.legacy_message_id = m.id);

-- ============================================================================
-- 3. Resolve reply_to_message_id references in new messages table
-- ============================================================================

UPDATE messages new_msg
SET reply_to_message_id = ref.id
FROM visitor_chat_messages old_msg
JOIN messages ref ON ref.legacy_message_id = old_msg.reply_to_message_id
WHERE new_msg.legacy_message_id = old_msg.id
  AND old_msg.reply_to_message_id IS NOT NULL
  AND new_msg.reply_to_message_id IS NULL;

-- ============================================================================
-- 4. Backfill media_attachments from visitor_chat_messages with attachments
-- ============================================================================

INSERT INTO media_attachments (
  message_id, s3_key, s3_url, media_type, mime_type,
  file_name, processing_status, metadata
)
SELECT
  msg.id,
  CASE
    WHEN old.attachment_url LIKE '%chat/%'
      THEN regexp_replace(old.attachment_url, '^.*/chat/', 'chat/')
    ELSE 'legacy/' || old.id
  END,
  old.attachment_url,
  CASE old.message_type
    WHEN 'image' THEN 'image'
    WHEN 'video' THEN 'video'
    WHEN 'audio' THEN 'audio'
    ELSE 'file'
  END::varchar(20),
  CASE old.message_type
    WHEN 'image' THEN 'image/jpeg'
    WHEN 'video' THEN 'video/mp4'
    WHEN 'audio' THEN 'audio/ogg'
    ELSE 'application/octet-stream'
  END,
  old.attachment_name,
  'uploaded',
  '{}'::jsonb
FROM visitor_chat_messages old
JOIN messages msg ON msg.legacy_message_id = old.id
WHERE old.attachment_url IS NOT NULL
  AND old.attachment_url != ''
  AND NOT EXISTS (SELECT 1 FROM media_attachments ma WHERE ma.message_id = msg.id);

-- ============================================================================
-- 5. Backfill conversations from email_messages (one conversation per thread)
-- ============================================================================

INSERT INTO conversations (
  id, channel, account_id, visitor_name, visitor_phone, visitor_email,
  status, source, metadata, last_message_at, message_count,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'email'::channel_type,
  (SELECT ca.id FROM channel_accounts ca WHERE ca.channel = 'email' LIMIT 1),
  e.from_address,
  e.customer_phone,
  e.from_address,
  CASE e.status WHEN 'archived' THEN 'closed' ELSE 'open' END,
  'email',
  jsonb_build_object(
    'threadId', e.thread_id,
    'subject', e.subject,
    'fromAddress', e.from_address,
    'toAddress', e.to_address,
    'ccAddresses', e.cc_addresses
  ),
  e.created_at,
  (SELECT COUNT(*) FROM email_messages e2 WHERE e2.thread_id = e.thread_id),
  e.created_at,
  e.updated_at
FROM email_messages e
WHERE e.id = (
  SELECT MIN(e3.id) FROM email_messages e3 WHERE e3.thread_id = e.thread_id
)
AND NOT EXISTS (
  SELECT 1 FROM conversations c
  WHERE c.channel = 'email' AND c.metadata->>'threadId' = e.thread_id
);

-- ============================================================================
-- 6. Backfill messages from email_messages
-- ============================================================================

INSERT INTO messages (
  id, conversation_id, sender_type, sender_name,
  message_type, content, metadata, created_at,
  delivery_status
)
SELECT
  gen_random_uuid(),
  c.id,
  CASE e.direction WHEN 'inbound' THEN 'visitor' ELSE 'operator' END,
  CASE e.direction WHEN 'inbound' THEN e.from_address ELSE 'operator' END,
  'text',
  COALESCE(e.body_text, e.subject, ''),
  jsonb_build_object(
    'messageId', e.message_id,
    'inReplyTo', e.in_reply_to,
    'subject', e.subject,
    'bodyHtml', e.body_html,
    'rawSourceKey', e.raw_source_key,
    'imapUid', e.imap_uid,
    'imapFolder', e.imap_folder,
    'isBounce', COALESCE(e.is_bounce, false)
  ),
  e.created_at,
  CASE e.status
    WHEN 'sent' THEN 'sent'
    WHEN 'failed' THEN 'failed'
    ELSE 'accepted'
  END::varchar(20)
FROM email_messages e
JOIN conversations c ON c.channel = 'email' AND c.metadata->>'threadId' = e.thread_id
WHERE NOT EXISTS (
  SELECT 1 FROM messages m
  WHERE m.conversation_id = c.id AND m.metadata->>'messageId' = e.message_id
);

-- ============================================================================
-- 7. Backfill email_attachments → media_attachments
-- ============================================================================

INSERT INTO media_attachments (
  message_id, s3_key, s3_url, media_type, mime_type, file_name,
  file_size_bytes, processing_status, metadata
)
SELECT
  m.id,
  ea.s3_key,
  ea.storage_url,
  'file',
  COALESCE(ea.mime_type, 'application/octet-stream'),
  ea.filename,
  ea.size_bytes,
  'uploaded',
  jsonb_build_object(
    'contentId', ea.content_id,
    'contentDisposition', ea.content_disposition
  )
FROM email_attachments ea
JOIN email_messages e ON e.id = ea.email_id
JOIN conversations c ON c.channel = 'email' AND c.metadata->>'threadId' = e.thread_id
JOIN messages m ON m.conversation_id = c.id AND m.metadata->>'messageId' = e.message_id
WHERE NOT EXISTS (
  SELECT 1 FROM media_attachments ma
  WHERE ma.message_id = m.id AND ma.s3_key = ea.s3_key
);

-- ============================================================================
-- Summary
-- ============================================================================
-- After running, verify:
--   SELECT 'conversations' t, count(*) FROM conversations
--   UNION ALL SELECT 'messages', count(*) FROM messages
--   UNION ALL SELECT 'media_attachments', count(*) FROM media_attachments;
