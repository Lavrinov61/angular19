-- Migration: Add OAuth provider fields to users table
-- Date: 2024

-- Add OAuth provider ID columns
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS apple_id VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS vk_id VARCHAR(255) UNIQUE;

-- Add indexes for OAuth provider IDs
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_apple_id ON users(apple_id);
CREATE INDEX IF NOT EXISTS idx_users_vk_id ON users(vk_id);

