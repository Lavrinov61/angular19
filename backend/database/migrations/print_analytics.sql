-- Print Analytics: columns + views
-- Idempotent: safe to re-run

-- Analytics columns on print_jobs
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS price_total NUMERIC(10,2);
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS pages_printed INTEGER DEFAULT 1;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS batch_sequence INTEGER;

-- Daily summary view
CREATE OR REPLACE VIEW print_daily_stats AS
SELECT
  date_trunc('day', created_at) AS day,
  studio_id,
  COUNT(*) AS total_jobs,
  COUNT(*) FILTER (WHERE status = 'completed') AS completed_jobs,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed_jobs,
  SUM(copies) AS total_copies,
  COALESCE(SUM(price_total), 0) AS total_revenue,
  AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000) FILTER (WHERE status = 'completed') AS avg_duration_ms
FROM print_jobs
GROUP BY date_trunc('day', created_at), studio_id;

-- Operator stats view
CREATE OR REPLACE VIEW print_operator_stats AS
SELECT
  created_by AS operator_id,
  COUNT(*) AS total_jobs,
  COUNT(*) FILTER (WHERE status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed,
  SUM(copies) AS total_copies,
  COALESCE(SUM(price_total), 0) AS revenue
FROM print_jobs
GROUP BY created_by;
