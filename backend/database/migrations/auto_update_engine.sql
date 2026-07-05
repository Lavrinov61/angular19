-- Auto-Update Engine (Phase 3)
-- Staged rollout plans, update progress tracking, scheduled updates

-- ── rollout_plans: staged rollout tracking ──
CREATE TABLE IF NOT EXISTS rollout_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES agent_releases(id),
  strategy VARCHAR(20) NOT NULL CHECK (strategy IN ('canary','batch','fleet')),
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','paused','completed','failed','cancelled')),
  target_agent_type VARCHAR(20) NOT NULL,
  target_platform VARCHAR(20),
  total_agents INT DEFAULT 0,
  completed_agents INT DEFAULT 0,
  failed_agents INT DEFAULT 0,
  -- Canary phase: update canary_count agents, wait canary_wait_minutes
  canary_count INT DEFAULT 1,
  canary_wait_minutes INT DEFAULT 15,
  -- Batch phase: update batch_percent% of remaining, wait batch_wait_minutes
  batch_percent INT DEFAULT 10,
  batch_wait_minutes INT DEFAULT 30,
  -- Current execution state
  current_phase VARCHAR(20) DEFAULT 'canary'
    CHECK (current_phase IN ('canary','batch','fleet','done')),
  phase_started_at TIMESTAMPTZ,
  next_phase_at TIMESTAMPTZ,
  initiated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rollout_plans_status ON rollout_plans(status) WHERE status IN ('pending','in_progress');
CREATE INDEX IF NOT EXISTS idx_rollout_plans_release ON rollout_plans(release_id);

-- ── Extend agent_update_commands ──
ALTER TABLE agent_update_commands
  ADD COLUMN IF NOT EXISTS progress_percent INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rollout_id UUID REFERENCES rollout_plans(id),
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_auc_rollout ON agent_update_commands(rollout_id) WHERE rollout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auc_scheduled ON agent_update_commands(scheduled_at) WHERE status = 'pending' AND scheduled_at IS NOT NULL;

-- ── Extend agent_releases: mark as stable with promote_at ──
ALTER TABLE agent_releases
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS download_count INT DEFAULT 0;
