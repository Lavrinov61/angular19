-- Phase 3A.3: Outbound Delivery Log (audit trail, not queue)
-- BullMQ handles queuing in Redis; this table is the persistent audit trail.

CREATE TABLE IF NOT EXISTS outbound_delivery_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel VARCHAR(20) NOT NULL,
    external_chat_id VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',
    attachment_url TEXT,
    source_message_id UUID,
    session_id UUID,
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'delivered', 'failed', 'dead_letter')),
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);

-- Partial index for monitoring failed/dead-letter deliveries
CREATE INDEX IF NOT EXISTS idx_odl_status
  ON outbound_delivery_log(status)
  WHERE status IN ('failed', 'dead_letter');

-- Session lookup for delivery history
CREATE INDEX IF NOT EXISTS idx_odl_session
  ON outbound_delivery_log(session_id);
