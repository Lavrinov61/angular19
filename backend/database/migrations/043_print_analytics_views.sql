-- Migration: 043_print_analytics_views
-- Print analytics: daily summary, operator, printer views + utilization + waste log
-- Idempotent: CREATE OR REPLACE VIEW, CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS

-- ============================================================
-- 1. VIEW print_daily_summary — ежедневная сводка печати
-- ============================================================

CREATE OR REPLACE VIEW print_daily_summary AS
SELECT
    (pj.created_at AT TIME ZONE 'Europe/Moscow')::date AS day,
    pj.studio_id,
    COUNT(*)::int AS total_jobs,
    COUNT(*) FILTER (WHERE pj.status = 'completed')::int AS completed_jobs,
    COUNT(*) FILTER (WHERE pj.status = 'failed')::int AS failed_jobs,
    COUNT(*) FILTER (WHERE pj.status = 'cancelled')::int AS cancelled_jobs,
    COALESCE(SUM(pj.copies), 0)::int AS total_copies,
    COALESCE(SUM(pj.copies) FILTER (WHERE pj.status = 'completed'), 0)::int AS completed_copies,
    COALESCE(SUM(pj.pages_printed) FILTER (WHERE pj.status = 'completed'), 0)::int AS pages_printed,
    COALESCE(SUM(pj.price_total) FILTER (WHERE pj.status = 'completed'), 0)::numeric(12,2) AS revenue,
    ROUND(AVG(pj.duration_ms) FILTER (WHERE pj.status = 'completed'))::int AS avg_duration_ms,
    COUNT(DISTINCT pj.created_by) FILTER (WHERE pj.status = 'completed')::int AS active_operators,
    COUNT(DISTINCT pj.printer_id) FILTER (WHERE pj.status = 'completed')::int AS active_printers,
    COUNT(DISTINCT pj.batch_id)::int AS batches
FROM print_jobs pj
GROUP BY 1, 2;

-- ============================================================
-- 2. VIEW print_operator_daily — по операторам
-- ============================================================

CREATE OR REPLACE VIEW print_operator_daily AS
SELECT
    (pj.created_at AT TIME ZONE 'Europe/Moscow')::date AS day,
    pj.created_by AS operator_id,
    u.display_name AS operator_name,
    pj.studio_id,
    COUNT(*)::int AS total_jobs,
    COUNT(*) FILTER (WHERE pj.status = 'completed')::int AS completed,
    COUNT(*) FILTER (WHERE pj.status = 'failed')::int AS failed,
    COALESCE(SUM(pj.copies), 0)::int AS total_copies,
    COALESCE(SUM(pj.price_total) FILTER (WHERE pj.status = 'completed'), 0)::numeric(12,2) AS revenue,
    ROUND(AVG(pj.duration_ms) FILTER (WHERE pj.status = 'completed'))::int AS avg_speed_ms
FROM print_jobs pj
LEFT JOIN users u ON u.id = pj.created_by
GROUP BY 1, 2, 3, 4;

-- ============================================================
-- 3. VIEW print_printer_daily — по принтерам
-- ============================================================

CREATE OR REPLACE VIEW print_printer_daily AS
SELECT
    (pj.created_at AT TIME ZONE 'Europe/Moscow')::date AS day,
    pj.printer_id,
    p.name AS printer_name,
    p.printer_type,
    pj.studio_id,
    COUNT(*)::int AS total_jobs,
    COUNT(*) FILTER (WHERE pj.status = 'completed')::int AS completed,
    COUNT(*) FILTER (WHERE pj.status = 'failed')::int AS failed,
    COALESCE(SUM(pj.copies), 0)::int AS total_copies,
    COALESCE(SUM(pj.price_total) FILTER (WHERE pj.status = 'completed'), 0)::numeric(12,2) AS revenue,
    ROUND(AVG(pj.duration_ms) FILTER (WHERE pj.status = 'completed'))::int AS avg_duration_ms
FROM print_jobs pj
LEFT JOIN printers p ON p.id = pj.printer_id
GROUP BY 1, 2, 3, 4, 5;

-- ============================================================
-- 4. VIEW printer_utilization_hourly — утилизация принтеров
-- ============================================================

CREATE OR REPLACE VIEW printer_utilization_hourly AS
SELECT
    date_trunc('hour', pt.collected_at AT TIME ZONE 'Europe/Moscow') AS hour,
    pt.printer_id,
    p.name AS printer_name,
    pt.studio_id,
    COUNT(*)::int AS samples,
    COUNT(*) FILTER (WHERE pt.state = 'idle')::int AS idle_samples,
    COUNT(*) FILTER (WHERE pt.state IN ('processing', 'printing'))::int AS busy_samples,
    COUNT(*) FILTER (WHERE pt.state IN ('error', 'warning'))::int AS error_samples,
    COUNT(*) FILTER (WHERE NOT pt.is_online)::int AS offline_samples,
    CASE
        WHEN COUNT(*) > 0
        THEN ROUND(
            COUNT(*) FILTER (WHERE pt.state IN ('processing', 'printing'))::numeric
            / COUNT(*)::numeric * 100, 1
        )
        ELSE 0
    END AS utilization_pct
FROM printer_telemetry pt
LEFT JOIN printers p ON p.id = pt.printer_id
GROUP BY 1, 2, 3, 4;

-- ============================================================
-- 5. TABLE print_waste_log — регистрация брака
-- ============================================================

CREATE TABLE IF NOT EXISTS print_waste_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    print_job_id UUID REFERENCES print_jobs(id) ON DELETE SET NULL,
    printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
    studio_id UUID REFERENCES studios(id) ON DELETE SET NULL,
    waste_type VARCHAR(20) NOT NULL CHECK (waste_type IN (
        'jam', 'color_defect', 'alignment', 'media_defect', 'operator_error', 'other'
    )),
    sheets_wasted INT NOT NULL CHECK (sheets_wasted > 0),
    paper_size VARCHAR(30),
    media_type VARCHAR(50),
    cost_estimate NUMERIC(10,2),
    notes TEXT,
    reported_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для print_waste_log
CREATE INDEX IF NOT EXISTS idx_print_waste_log_studio_created
    ON print_waste_log(studio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_waste_log_printer_created
    ON print_waste_log(printer_id, created_at DESC);

-- ============================================================
-- 6. Индексы для print_jobs (ускорение views)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_print_jobs_created_at_status
    ON print_jobs(created_at, status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_created_by
    ON print_jobs(created_by);
