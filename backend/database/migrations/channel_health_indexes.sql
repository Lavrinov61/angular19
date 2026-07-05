-- Channel Health Monitoring — indexes for webhook freshness queries
-- Idempotent: IF NOT EXISTS

CREATE INDEX IF NOT EXISTS idx_webhook_events_channel_received
  ON webhook_events (channel, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_channel_status_received
  ON webhook_events (channel, status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_queue_status_channel
  ON outbound_queue (status, channel)
  WHERE status IN ('pending', 'failed', 'dead_letter');
