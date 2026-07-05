-- Phase 3C.2: Unified channel users table
-- Stores user profiles from all messenger channels, enabling cross-channel identity resolution.

CREATE TABLE IF NOT EXISTS channel_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel VARCHAR(20) NOT NULL,
    external_user_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    username VARCHAR(255),
    phone VARCHAR(20),
    customer_id UUID,
    opted_in BOOLEAN DEFAULT true,
    opted_in_at TIMESTAMPTZ,
    opted_out_at TIMESTAMPTZ,
    raw_profile JSONB DEFAULT '{}',
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (channel, external_user_id)
);

-- Fast lookup by channel + external_user_id (covered by UNIQUE constraint)
-- Index for customer linking
CREATE INDEX IF NOT EXISTS idx_channel_users_customer
  ON channel_users(customer_id) WHERE customer_id IS NOT NULL;
