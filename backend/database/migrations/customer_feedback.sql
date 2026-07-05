-- customer_feedback: unified satisfaction signals from multiple sources
-- Sources: approval outcomes, review clicks, order completion, manual operator entry

CREATE TABLE IF NOT EXISTS customer_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT,
  client_phone TEXT,
  client_id UUID,
  employee_id UUID,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  service TEXT,
  source TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_created
  ON customer_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_employee
  ON customer_feedback (employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_source
  ON customer_feedback (source);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_entity
  ON customer_feedback (entity_type, entity_id);

-- One feedback per entity (idempotent NPS + approval hooks)
DO $$ BEGIN
  ALTER TABLE customer_feedback ADD CONSTRAINT customer_feedback_entity_unique UNIQUE (entity_type, entity_id);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Backfill from existing photo_approvals (approved/rejected/changes_requested)
INSERT INTO customer_feedback (client_name, client_id, employee_id, rating, service, source, entity_type, entity_id, created_at)
SELECT
  COALESCE(c.display_name, pas.client_name, 'Клиент'),
  pa.client_id,
  pa.photographer_id,
  CASE pa.status
    WHEN 'approved' THEN 5
    WHEN 'changes_requested' THEN 3
    WHEN 'rejected' THEN 2
    ELSE 4
  END,
  COALESCE(pa.retouch_type, 'Ретушь'),
  CASE pa.status
    WHEN 'approved' THEN 'approval_approved'
    WHEN 'changes_requested' THEN 'approval_changes'
    WHEN 'rejected' THEN 'approval_rejected'
    ELSE 'approval_approved'
  END,
  'approval_session',
  pa.approval_session_id,
  COALESCE(pa.approved_at, pa.rejected_at, pa.updated_at, pa.created_at)
FROM photo_approvals pa
LEFT JOIN photo_approval_sessions pas ON pas.id = pa.approval_session_id
LEFT JOIN contacts c ON c.id = pa.client_id
WHERE pa.status IN ('approved', 'rejected', 'changes_requested')
  AND NOT EXISTS (
    SELECT 1 FROM customer_feedback cf
    WHERE cf.entity_type = 'approval_session'
      AND cf.entity_id = pa.approval_session_id
      AND cf.source = CASE pa.status
        WHEN 'approved' THEN 'approval_approved'
        WHEN 'changes_requested' THEN 'approval_changes'
        WHEN 'rejected' THEN 'approval_rejected'
        ELSE 'approval_approved'
      END
  );
