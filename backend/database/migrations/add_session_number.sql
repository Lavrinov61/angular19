-- Migration: add session_number to visitor_chat_sessions
-- Readable sequential number for chat sessions (replaces fingerprint hash)

ALTER TABLE visitor_chat_sessions ADD COLUMN IF NOT EXISTS session_number INT;
CREATE SEQUENCE IF NOT EXISTS chat_session_number_seq START WITH 1000;
