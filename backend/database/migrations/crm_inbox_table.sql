-- ============================================================
-- CRM 1M DAU: Real crm_inbox table (replaces MV for hot path)
--
-- Same schema as crm_inbox_view MV, but a real table updated
-- incrementally by crm-event-queue worker (O(1) per event).
-- MV remains as backstop reconciliation every 5 minutes.
--
-- Idempotent: IF NOT EXISTS
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_inbox (
  type             TEXT NOT NULL,
  id               TEXT NOT NULL,
  client_name      VARCHAR,
  client_phone     VARCHAR(20),
  preview          TEXT,
  status           VARCHAR,
  priority         INTEGER NOT NULL DEFAULT 2,
  sort_time        TIMESTAMPTZ,
  channel          TEXT,
  assigned_to      TEXT,
  assigned_to_name TEXT,
  unread           BOOLEAN DEFAULT FALSE,
  metadata         JSONB DEFAULT '{}',
  updated_at       TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (type, id)
);

-- Same indexes as MV for query compatibility
CREATE INDEX IF NOT EXISTS idx_crm_inbox_sort
  ON crm_inbox (priority ASC, sort_time DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_crm_inbox_type
  ON crm_inbox (type);

CREATE INDEX IF NOT EXISTS idx_crm_inbox_assigned
  ON crm_inbox (assigned_to) WHERE assigned_to IS NOT NULL;

-- Additional: search by client name/phone (ILIKE in crm-inbox.routes.ts:108-114)
CREATE INDEX IF NOT EXISTS idx_crm_inbox_client_phone
  ON crm_inbox (client_phone) WHERE client_phone IS NOT NULL;

-- Initial load from current MV (one-time seed)
INSERT INTO crm_inbox (type, id, client_name, client_phone, preview, status, priority, sort_time, channel, assigned_to, assigned_to_name, unread, metadata)
SELECT type, id, client_name, client_phone, preview, status, priority, sort_time, channel, assigned_to, assigned_to_name, unread, metadata
FROM crm_inbox_view
ON CONFLICT (type, id) DO UPDATE SET
  client_name      = EXCLUDED.client_name,
  client_phone     = EXCLUDED.client_phone,
  preview          = EXCLUDED.preview,
  status           = EXCLUDED.status,
  priority         = EXCLUDED.priority,
  sort_time        = EXCLUDED.sort_time,
  channel          = EXCLUDED.channel,
  assigned_to      = EXCLUDED.assigned_to,
  assigned_to_name = EXCLUDED.assigned_to_name,
  unread           = EXCLUDED.unread,
  metadata         = EXCLUDED.metadata,
  updated_at       = NOW();
