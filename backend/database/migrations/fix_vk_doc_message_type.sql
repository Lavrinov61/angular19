-- Fix VK documents saved as message_type='text' instead of 'file'
-- These were incorrectly classified because messageType was only set inside
-- the "no text content" branch, missing messages with both text and attachment.

UPDATE visitor_chat_messages m
SET message_type = 'file'
FROM visitor_chat_sessions s
WHERE m.session_id = s.id
  AND s.channel = 'vk'
  AND m.message_type = 'text'
  AND m.content LIKE '%[Файл:%'
  AND m.attachment_url IS NOT NULL;
