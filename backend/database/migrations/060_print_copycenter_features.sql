-- Migration 060: Print Copy-Center Features
-- 19 features: pause/resume queue, job splitting/balancing, scheduling,
-- hold/release, finishing ops, job groups, billing views, downtime tracking,
-- template usage stats, tracking codes, triggers/notify
-- Idempotent: uses IF NOT EXISTS, DO $$ blocks, OR REPLACE

BEGIN;

-- ============================================================
-- 1. Extend print_jobs.status CHECK
-- ============================================================
DO $$ BEGIN
  -- Drop existing check constraint
  ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_status_check;
  -- Recreate with extended set
  ALTER TABLE print_jobs
    ADD CONSTRAINT print_jobs_status_check
    CHECK (status::text = ANY (ARRAY[
      'queued'::text,
      'sending'::text,
      'applying_icc'::text,
      'rendering_layout'::text,
      'converting'::text,
      'printing'::text,
      'completed'::text,
      'failed'::text,
      'cancelled'::text,
      'paused'::text,
      'held'::text,
      'scheduled'::text,
      'splitting'::text,
      'finishing'::text
    ]));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'status CHECK constraint update failed: %', SQLERRM;
END $$;

-- ============================================================
-- 2. New columns in print_jobs
-- ============================================================

-- P0-3: Progress tracking
ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS current_copy INTEGER DEFAULT 0;

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS total_copies_needed INTEGER;

-- P0-4: Split strategy
ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS split_strategy VARCHAR(20);

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS child_count INTEGER DEFAULT 0;

-- P0-5: Auto-balancing
ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS auto_balanced BOOLEAN DEFAULT FALSE;

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS original_printer_id UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'print_jobs_original_printer_id_fkey'
      AND table_name = 'print_jobs'
  ) THEN
    ALTER TABLE print_jobs
      ADD CONSTRAINT print_jobs_original_printer_id_fkey
      FOREIGN KEY (original_printer_id) REFERENCES printers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- P1-6: Scheduling
ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- P1-7: Hold/release
ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS held_by UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'print_jobs_held_by_fkey'
      AND table_name = 'print_jobs'
  ) THEN
    ALTER TABLE print_jobs
      ADD CONSTRAINT print_jobs_held_by_fkey
      FOREIGN KEY (held_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ;

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS released_by UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'print_jobs_released_by_fkey'
      AND table_name = 'print_jobs'
  ) THEN
    ALTER TABLE print_jobs
      ADD CONSTRAINT print_jobs_released_by_fkey
      FOREIGN KEY (released_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

-- P1-11: Finishing operations
ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS finishing_ops TEXT[] DEFAULT '{}';

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS finishing_status VARCHAR(20) DEFAULT 'none';

DO $$ BEGIN
  ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_finishing_status_check;
  ALTER TABLE print_jobs
    ADD CONSTRAINT print_jobs_finishing_status_check
    CHECK (finishing_status IN ('none','pending','in_progress','done'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'finishing_status check constraint update failed: %', SQLERRM;
END $$;

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS finishing_started_at TIMESTAMPTZ;

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS finishing_completed_at TIMESTAMPTZ;

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS finishing_notes TEXT;

-- P1-12: Job groups
ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS group_id UUID;

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS group_sequence INTEGER;

-- P2-14: Self-service tracking code
ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS tracking_code VARCHAR(20);

-- ============================================================
-- 3. New columns in printers
-- ============================================================

-- P0-2: Queue pause
ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS queue_paused BOOLEAN DEFAULT FALSE;

ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS queue_paused_at TIMESTAMPTZ;

ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS queue_paused_by UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'printers_queue_paused_by_fkey'
      AND table_name = 'printers'
  ) THEN
    ALTER TABLE printers
      ADD CONSTRAINT printers_queue_paused_by_fkey
      FOREIGN KEY (queue_paused_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS queue_paused_reason TEXT;

-- P1-8: Auto-pause supply threshold
ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS auto_pause_supply_threshold INTEGER DEFAULT 5;

-- P0-5: Queue depth counter
ALTER TABLE printers
  ADD COLUMN IF NOT EXISTS queue_depth INTEGER DEFAULT 0;

-- ============================================================
-- 4. New table: print_job_groups
-- ============================================================
CREATE TABLE IF NOT EXISTS print_job_groups (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           VARCHAR(200),
  customer_id    UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name  VARCHAR(255),
  total_price    NUMERIC(10,2) DEFAULT 0,
  receipt_id     UUID,
  status         VARCHAR(20) DEFAULT 'open'
                   CHECK (status IN ('open','printing','completed','cancelled')),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  studio_id      UUID REFERENCES studios(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

-- Add FK from print_jobs.group_id to print_job_groups only after table exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'print_jobs_group_id_fkey'
      AND table_name = 'print_jobs'
  ) THEN
    ALTER TABLE print_jobs
      ADD CONSTRAINT print_jobs_group_id_fkey
      FOREIGN KEY (group_id) REFERENCES print_job_groups(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 5. New table: printer_pause_log
-- ============================================================
CREATE TABLE IF NOT EXISTS printer_pause_log (
  id             BIGSERIAL PRIMARY KEY,
  printer_id     UUID NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  action         VARCHAR(10) NOT NULL CHECK (action IN ('pause','resume')),
  reason         TEXT,
  performed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  auto_triggered BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. New table: print_scheduled_jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS print_scheduled_jobs (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id       UUID NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  dispatched_at TIMESTAMPTZ,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. New table: print_template_usage
-- ============================================================
CREATE TABLE IF NOT EXISTS print_template_usage (
  id         BIGSERIAL PRIMARY KEY,
  preset_id  UUID NOT NULL REFERENCES print_presets(id) ON DELETE CASCADE,
  used_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  studio_id  UUID REFERENCES studios(id) ON DELETE SET NULL,
  used_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. New table: printer_downtime_log
-- ============================================================
CREATE TABLE IF NOT EXISTS printer_downtime_log (
  id                BIGSERIAL PRIMARY KEY,
  printer_id        UUID NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  -- duration_minutes is computed on read: EXTRACT(EPOCH FROM (ended_at - started_at)) / 60
  -- Cannot use GENERATED ALWAYS AS here because COALESCE(ended_at, NOW()) is non-immutable.
  -- Use the printer_downtime_summary view for aggregated minutes.
  reason            TEXT,
  auto_detected     BOOLEAN DEFAULT FALSE,
  resolved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  studio_id         UUID REFERENCES studios(id) ON DELETE SET NULL
);

-- ============================================================
-- 9. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_print_jobs_scheduled
  ON print_jobs (scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_print_jobs_group_id
  ON print_jobs (group_id)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_print_jobs_held
  ON print_jobs (held_at)
  WHERE status = 'held';

CREATE INDEX IF NOT EXISTS idx_print_jobs_finishing
  ON print_jobs (finishing_status)
  WHERE finishing_status != 'none';

CREATE INDEX IF NOT EXISTS idx_print_jobs_tracking
  ON print_jobs (tracking_code)
  WHERE tracking_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_print_jobs_split
  ON print_jobs (parent_job_id, batch_sequence)
  WHERE split_strategy IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_printers_queue_paused
  ON printers (queue_paused)
  WHERE queue_paused = TRUE;

CREATE INDEX IF NOT EXISTS idx_print_template_usage_preset
  ON print_template_usage (preset_id, used_at DESC);

CREATE INDEX IF NOT EXISTS idx_printer_pause_log_printer
  ON printer_pause_log (printer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_printer_downtime_printer
  ON printer_downtime_log (printer_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_print_job_groups_status
  ON print_job_groups (status, created_at DESC);

-- ============================================================
-- 10. Views
-- ============================================================

-- Client billing by month
CREATE OR REPLACE VIEW print_client_billing AS
SELECT
  pj.customer_id,
  u.display_name                               AS client_name,
  COUNT(*)                                     AS total_jobs,
  SUM(pj.copies)                               AS total_copies,
  SUM(COALESCE(pj.price_total, 0))             AS total_revenue,
  MAX(pj.created_at)                           AS last_print_at,
  DATE_TRUNC('month', pj.created_at)           AS billing_month
FROM print_jobs pj
LEFT JOIN users u ON u.id = pj.customer_id
WHERE pj.customer_id IS NOT NULL
GROUP BY pj.customer_id, u.display_name, DATE_TRUNC('month', pj.created_at);

-- Printer downtime summary
-- duration_minutes computed inline: (COALESCE(ended_at, NOW()) - started_at) / 60 seconds
CREATE OR REPLACE VIEW printer_downtime_summary AS
SELECT
  d.printer_id,
  p.name                                                                               AS printer_name,
  p.studio_id,
  COUNT(*)                                                                             AS total_incidents,
  SUM(EXTRACT(EPOCH FROM (COALESCE(d.ended_at, NOW()) - d.started_at))::INTEGER / 60) AS total_downtime_minutes,
  AVG(EXTRACT(EPOCH FROM (COALESCE(d.ended_at, NOW()) - d.started_at))::INTEGER / 60) AS avg_downtime_minutes,
  MAX(d.started_at)                                                                    AS last_downtime
FROM printer_downtime_log d
JOIN printers p ON p.id = d.printer_id
GROUP BY d.printer_id, p.name, p.studio_id;

-- ============================================================
-- 11. Trigger: auto-update queue_depth on printers
-- ============================================================
CREATE OR REPLACE FUNCTION update_printer_queue_depth()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status IN ('queued','sending') THEN
    UPDATE printers
       SET queue_depth = queue_depth + 1
     WHERE id = NEW.printer_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('queued','sending') AND NEW.status NOT IN ('queued','sending') THEN
      UPDATE printers
         SET queue_depth = GREATEST(queue_depth - 1, 0)
       WHERE id = OLD.printer_id;
    ELSIF OLD.status NOT IN ('queued','sending') AND NEW.status IN ('queued','sending') THEN
      UPDATE printers
         SET queue_depth = queue_depth + 1
       WHERE id = NEW.printer_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_print_jobs_queue_depth ON print_jobs;
CREATE TRIGGER trg_print_jobs_queue_depth
  AFTER INSERT OR UPDATE OF status ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION update_printer_queue_depth();

-- ============================================================
-- 12. Trigger: pg_notify when scheduled job moves to queued
-- ============================================================
CREATE OR REPLACE FUNCTION notify_scheduled_job_ready()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'scheduled' AND NEW.status = 'queued' THEN
    PERFORM pg_notify(
      'print_jobs_new',
      json_build_object('id', NEW.id, 'printer_id', NEW.printer_id)::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_print_jobs_scheduled_dispatch ON print_jobs;
CREATE TRIGGER trg_print_jobs_scheduled_dispatch
  AFTER UPDATE OF status ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION notify_scheduled_job_ready();

COMMIT;
