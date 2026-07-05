-- Migration: Backfill orphaned v1 sessions into v2 conversations + messages
-- Problem: 28 visitor_chat_sessions from 2026-03-14 were never migrated to conversations
-- during the v1→v2 omnichannel migration. crm_inbox references them by v1 ID,
-- but the API queries conversations (v2) → 404 "Session not found".
--
-- Idempotent: ON CONFLICT DO NOTHING

BEGIN;

-- 1. Migrate orphaned sessions from visitor_chat_sessions → conversations
INSERT INTO conversations (
  id, channel, visitor_id, visitor_name, visitor_phone, visitor_email,
  selected_service, selected_price, page_url, status, assigned_operator_id,
  user_agent, ip_address, created_at, updated_at, last_message_at, closed_at,
  metadata, user_id, first_response_at, resolved_at, csat_score, csat_comment,
  csat_submitted_at, context, source, entry_context, session_number,
  message_count, unread_count, last_message_content, booking_id, contact_id,
  legacy_session_id
)
SELECT
  vcs.id,
  -- Map channel: 'studio' → 'web' (studio not in channel_type enum)
  (CASE WHEN vcs.channel = 'studio' THEN 'web' ELSE vcs.channel END)::channel_type,
  vcs.visitor_id, vcs.visitor_name, vcs.visitor_phone, vcs.visitor_email,
  vcs.selected_service, vcs.selected_price, vcs.page_url, vcs.status,
  vcs.assigned_operator_id, vcs.user_agent, vcs.ip_address,
  vcs.created_at, vcs.updated_at, vcs.last_message_at, vcs.closed_at,
  vcs.metadata, vcs.user_id, vcs.first_response_at, vcs.resolved_at,
  vcs.csat_score, vcs.csat_comment, vcs.csat_submitted_at, vcs.context,
  vcs.source, vcs.entry_context, vcs.session_number,
  vcs.message_count, vcs.unread_count, vcs.last_message_content,
  vcs.booking_id, vcs.contact_id,
  vcs.id  -- legacy_session_id = original v1 id
FROM visitor_chat_sessions vcs
WHERE vcs.id IN (
  SELECT ci.id::uuid
  FROM crm_inbox ci
  LEFT JOIN conversations c ON ci.id::uuid = c.id
  WHERE ci.type = 'chat' AND c.id IS NULL
)
ON CONFLICT (id) DO NOTHING;

-- 2. Migrate messages from visitor_chat_messages → messages
INSERT INTO messages (
  id, conversation_id, sender_type, sender_id, sender_name,
  message_type, content, attachment_url, is_read, read_at,
  created_at, metadata, external_message_id, delivered_at,
  reply_to_message_id, is_forwarded, forwarded_from_name,
  client_message_id, event_type, legacy_message_id
)
SELECT
  vcm.id,
  vcm.session_id,  -- same UUID, now exists in conversations
  vcm.sender_type, vcm.sender_id, vcm.sender_name,
  vcm.message_type, vcm.content, vcm.attachment_url, vcm.is_read, vcm.read_at,
  vcm.created_at, vcm.metadata, vcm.external_message_id, vcm.delivered_at,
  vcm.reply_to_message_id, vcm.is_forwarded, vcm.forwarded_from_name,
  vcm.client_message_id, vcm.event_type,
  vcm.id  -- legacy_message_id = original v1 id
FROM visitor_chat_messages vcm
WHERE vcm.session_id IN (
  SELECT ci.id::uuid
  FROM crm_inbox ci
  LEFT JOIN conversations c ON ci.id::uuid = c.id
  WHERE ci.type = 'chat' AND c.id IS NULL
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
