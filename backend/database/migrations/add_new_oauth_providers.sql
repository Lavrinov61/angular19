-- Migration: Add OAuth provider columns
-- Adds google_id, apple_id, vk_id (previously missing from prod DB),
-- plus new sber_id and mts_id columns.
-- Date: 2026-02-27
-- Run: PGPASSWORD=magnus_password psql -U magnus_user -d magnus_photo_db -h 127.0.0.1 -f this_file.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vk_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sber_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mts_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_apple_id ON users(apple_id) WHERE apple_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_vk_id ON users(vk_id) WHERE vk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_sber_id ON users(sber_id) WHERE sber_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_mts_id ON users(mts_id) WHERE mts_id IS NOT NULL;
