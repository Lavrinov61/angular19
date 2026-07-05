-- Migration 085: State transitions audit trail (trigger on print_jobs)
-- Idempotent: IF NOT EXISTS / OR REPLACE

-- Table already exists from earlier migration, ensure it's present
CREATE TABLE IF NOT EXISTS job_state_transitions (
    id          BIGSERIAL PRIMARY KEY,
    job_id      UUID NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
    from_status VARCHAR(50),
    to_status   VARCHAR(50) NOT NULL,
    actor_id    UUID,
    actor_type  VARCHAR(20) DEFAULT 'user',
    reason      TEXT,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jst_job_id ON job_state_transitions(job_id);
CREATE INDEX IF NOT EXISTS idx_jst_created_at ON job_state_transitions(created_at);

-- Trigger function: log every status change with actor inference
CREATE OR REPLACE FUNCTION log_job_state_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO job_state_transitions (job_id, from_status, to_status, actor_id, actor_type, reason)
    VALUES (
      NEW.id, OLD.status, NEW.status,
      COALESCE(NEW.held_by, NEW.released_by, NEW.reassigned_by, NEW.created_by),
      CASE
        WHEN NEW.status IN ('splitting','applying_icc','rendering_layout','converting') THEN 'agent'
        WHEN NEW.status = 'scheduled' AND NEW.scheduled_at IS NOT NULL THEN 'scheduler'
        ELSE 'user'
      END,
      CASE
        WHEN NEW.error_message IS NOT NULL AND OLD.error_message IS DISTINCT FROM NEW.error_message THEN NEW.error_message
        WHEN NEW.reassign_reason IS NOT NULL AND OLD.reassign_reason IS DISTINCT FROM NEW.reassign_reason THEN NEW.reassign_reason
        ELSE NULL
      END
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_state_transition_log ON print_jobs;
CREATE TRIGGER trg_job_state_transition_log
  AFTER UPDATE OF status ON print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION log_job_state_transition();
