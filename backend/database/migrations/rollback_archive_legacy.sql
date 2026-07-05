-- Rollback: restore visitor_chat_sessions and visitor_chat_messages tables
-- Reason: omnichannel_v2_archive_legacy.sql was applied prematurely —
-- 43+ backend files still reference the original table names.
-- Idempotent: IF EXISTS on every operation.

ALTER TABLE IF EXISTS visitor_chat_sessions_archived RENAME TO visitor_chat_sessions;
ALTER TABLE IF EXISTS visitor_chat_messages_archived RENAME TO visitor_chat_messages;

\echo '✅ Rollback: visitor_chat_sessions + visitor_chat_messages restored'
