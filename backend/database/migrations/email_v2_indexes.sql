-- Email → Omnichannel v2: индексы для CRM email queries
-- Миграция: email_v2_indexes.sql
-- Дата: 2026-03-12

-- 1. Быстрый фильтр email-конверсаций по статусу + сортировка по дате
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_channel_email
  ON conversations (channel, status, last_message_at DESC)
  WHERE channel = 'email';

-- 2. Lookup сообщений по RFC 2822 Message-ID (thread resolution, dedup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_msg_metadata_message_id
  ON messages ((metadata->>'messageId'))
  WHERE metadata->>'messageId' IS NOT NULL;

-- 3. Lookup конверсаций по threadId (thread resolution)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_metadata_thread_id
  ON conversations ((metadata->>'threadId'))
  WHERE channel = 'email' AND metadata->>'threadId' IS NOT NULL;

-- 4. GIN для произвольных metadata-запросов (search, from/to)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_email_metadata_gin
  ON conversations USING gin (metadata)
  WHERE channel = 'email';
