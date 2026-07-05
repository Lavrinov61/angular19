-- Fix VK doc messages that have attachment_url but wrong message_type = 'text'
-- Idempotent: only updates rows that match the condition
UPDATE visitor_chat_messages m
SET message_type = 'file'
FROM visitor_chat_sessions s
WHERE m.session_id = s.id
  AND s.channel = 'vk'
  AND m.message_type = 'text'
  AND m.content LIKE '%[Файл:%'
  AND m.attachment_url IS NOT NULL;
