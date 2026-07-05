-- Migration 134: Fleet Management — printer_alerts, supplies_replacements, print_jobs.print_source, aggregation views
-- Date: 2026-04-21
-- Context: Fleet Management module для мониторинга принтеров (SNMP polling, CUPS page_log, Canon Remote UI scraper, alerts engine).
-- Strictly idempotent: CREATE IF NOT EXISTS, DO $$ ... $$ blocks, OR REPLACE.
-- Bridge-agent мёртв с 2026-04-04 — printer_telemetry теперь кормится из нового SNMP-polling сервиса.

BEGIN;

-- ============================================================================
-- 1. printer_alerts: state-machine для активных алертов принтеров
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.printer_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    printer_id UUID NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
    studio_id UUID REFERENCES public.studios(id) ON DELETE SET NULL,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(10) NOT NULL CHECK (severity IN ('info','warn','critical')),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    resolve_reason VARCHAR(20) CHECK (resolve_reason IN ('auto','manual','supply_replaced','stale')),
    last_value JSONB,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.printer_alerts IS 'State-machine активных и исторических алертов принтеров. Open alert = resolved_at IS NULL.';
COMMENT ON COLUMN public.printer_alerts.alert_type IS 'toner_low|toner_empty|paper_low|paper_empty|offline|paper_jam|cover_open|service_required|snmp_unreachable';

CREATE UNIQUE INDEX IF NOT EXISTS ux_printer_alerts_active
    ON public.printer_alerts(printer_id, alert_type) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_printer_alerts_printer_time
    ON public.printer_alerts(printer_id, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_printer_alerts_active_only
    ON public.printer_alerts(first_seen_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_printer_alerts_studio
    ON public.printer_alerts(studio_id, first_seen_at DESC) WHERE resolved_at IS NULL;

-- ============================================================================
-- 2. printer_supplies_replacements: ручные отметки замен расходников
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.printer_supplies_replacements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    printer_id UUID NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
    supply_type VARCHAR(40) NOT NULL,
    supply_index INTEGER,
    replaced_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    replaced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    counter_at_replacement BIGINT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.printer_supplies_replacements IS 'Отметки замены расходников для reset burn-rate и истории обслуживания.';
COMMENT ON COLUMN public.printer_supplies_replacements.supply_type IS 'toner_black|toner_cyan|toner_magenta|toner_yellow|ink_*|drum|fuser|paper_tray_N';
COMMENT ON COLUMN public.printer_supplies_replacements.counter_at_replacement IS 'prtMarkerLifeCount в момент замены — для расчёта pages-per-cartridge.';

CREATE INDEX IF NOT EXISTS idx_printer_supplies_replacements_printer_time
    ON public.printer_supplies_replacements(printer_id, replaced_at DESC);
CREATE INDEX IF NOT EXISTS idx_printer_supplies_replacements_type
    ON public.printer_supplies_replacements(printer_id, supply_type, replaced_at DESC);

-- ============================================================================
-- 3. print_jobs: origin source + external_job_id для dedup между источниками
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='print_jobs' AND column_name='print_source') THEN
        ALTER TABLE public.print_jobs ADD COLUMN print_source VARCHAR(20);
        COMMENT ON COLUMN public.print_jobs.print_source IS 'rust_api|cups|canon_remote_ui|windows_event|bridge_agent';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='print_jobs' AND column_name='external_job_id') THEN
        ALTER TABLE public.print_jobs ADD COLUMN external_job_id TEXT;
        COMMENT ON COLUMN public.print_jobs.external_job_id IS 'ID из внешнего источника (CUPS job-id, Canon job-id). Для upsert-дедупа.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='print_jobs' AND column_name='external_job_ids_merged') THEN
        ALTER TABLE public.print_jobs ADD COLUMN external_job_ids_merged JSONB;
        COMMENT ON COLUMN public.print_jobs.external_job_ids_merged IS 'При merge CUPS+Canon одной задачи — {"cups":"15","canon_remote_ui":"9735"}';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='print_jobs_print_source_check') THEN
        ALTER TABLE public.print_jobs
            ADD CONSTRAINT print_jobs_print_source_check
            CHECK (print_source IS NULL OR print_source IN
                   ('rust_api','cups','canon_remote_ui','windows_event','bridge_agent'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_print_jobs_external
    ON public.print_jobs(printer_id, external_job_id, print_source)
    WHERE external_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_print_jobs_source_created
    ON public.print_jobs(print_source, created_at DESC)
    WHERE print_source IS NOT NULL;

-- ============================================================================
-- 4. Aggregation views: hourly + daily rollup printer_telemetry
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS public.printer_telemetry_hourly AS
SELECT
    printer_id,
    date_trunc('hour', collected_at) AS hour,
    COUNT(*) AS samples,
    bool_or(is_online) AS any_online,
    AVG(CASE WHEN is_online THEN 1.0 ELSE 0.0 END)::numeric(5,2) AS online_ratio,
    MAX(CASE WHEN jsonb_typeof(counters) = 'object'
              AND counters ? 'lifetime'
              AND counters->>'lifetime' ~ '^[0-9]+$'
             THEN (counters->>'lifetime')::bigint END) AS max_lifetime_count,
    MIN(CASE WHEN jsonb_typeof(counters) = 'object'
              AND counters ? 'lifetime'
              AND counters->>'lifetime' ~ '^[0-9]+$'
             THEN (counters->>'lifetime')::bigint END) AS min_lifetime_count,
    (ARRAY_AGG(supplies ORDER BY collected_at DESC))[1] AS last_supplies,
    (ARRAY_AGG(trays ORDER BY collected_at DESC))[1] AS last_trays
FROM public.printer_telemetry
WHERE collected_at > now() - INTERVAL '45 days'
GROUP BY printer_id, date_trunc('hour', collected_at)
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS ux_printer_telemetry_hourly
    ON public.printer_telemetry_hourly(printer_id, hour);
CREATE INDEX IF NOT EXISTS idx_printer_telemetry_hourly_hour
    ON public.printer_telemetry_hourly(hour DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.printer_telemetry_daily AS
SELECT
    printer_id,
    date_trunc('day', collected_at) AS day,
    COUNT(*) AS samples,
    bool_or(is_online) AS any_online,
    AVG(CASE WHEN is_online THEN 1.0 ELSE 0.0 END)::numeric(5,2) AS online_ratio,
    MAX(CASE WHEN jsonb_typeof(counters) = 'object'
              AND counters ? 'lifetime'
              AND counters->>'lifetime' ~ '^[0-9]+$'
             THEN (counters->>'lifetime')::bigint END) AS max_lifetime_count,
    MIN(CASE WHEN jsonb_typeof(counters) = 'object'
              AND counters ? 'lifetime'
              AND counters->>'lifetime' ~ '^[0-9]+$'
             THEN (counters->>'lifetime')::bigint END) AS min_lifetime_count
FROM public.printer_telemetry
WHERE collected_at > now() - INTERVAL '365 days'
GROUP BY printer_id, date_trunc('day', collected_at)
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS ux_printer_telemetry_daily
    ON public.printer_telemetry_daily(printer_id, day);
CREATE INDEX IF NOT EXISTS idx_printer_telemetry_daily_day
    ON public.printer_telemetry_daily(day DESC);

-- Burn-rate view (non-materialized — on-demand compute)
CREATE OR REPLACE VIEW public.printer_burn_rate_7d AS
WITH daily AS (
    SELECT
        printer_id,
        SUM(COALESCE(max_lifetime_count - min_lifetime_count, 0)) AS pages_week
    FROM public.printer_telemetry_daily
    WHERE day > now() - INTERVAL '7 days'
    GROUP BY printer_id
)
SELECT
    d.printer_id,
    p.name AS printer_name,
    p.studio_id,
    d.pages_week AS pages_printed_7d,
    ROUND(d.pages_week::numeric / 7.0, 2) AS pages_per_day_avg
FROM daily d
JOIN public.printers p ON p.id = d.printer_id;

COMMENT ON VIEW public.printer_burn_rate_7d IS 'Средняя скорость печати pages/day за последние 7 дней (из daily rollup).';

-- ============================================================================
-- 5. Retention function — вызывается из Node.js scheduler (например, daily 03:00)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fleet_retention_cleanup(retention_days INTEGER DEFAULT 90)
RETURNS TABLE(deleted_snapshots BIGINT, refreshed_hourly BOOLEAN, refreshed_daily BOOLEAN) AS $$
DECLARE
    del_count BIGINT;
BEGIN
    -- 1. Refresh aggregates FIRST (чтобы не потерять данные при DELETE)
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.printer_telemetry_hourly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.printer_telemetry_daily;

    -- 2. Delete raw snapshots старше retention_days
    DELETE FROM public.printer_telemetry
    WHERE collected_at < now() - make_interval(days => retention_days);
    GET DIAGNOSTICS del_count = ROW_COUNT;

    -- 3. Cleanup resolved alerts старше 180 дней
    DELETE FROM public.printer_alerts
    WHERE resolved_at IS NOT NULL AND resolved_at < now() - INTERVAL '180 days';

    RETURN QUERY SELECT del_count, TRUE, TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.fleet_retention_cleanup(INTEGER) IS 'Daily retention: refresh aggregate views + delete raw snapshots старше retention_days + cleanup resolved alerts.';

-- ============================================================================
-- 6. Trigger: updated_at для printer_alerts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_printer_alerts_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_printer_alerts_updated_at ON public.printer_alerts;
CREATE TRIGGER trg_printer_alerts_updated_at
    BEFORE UPDATE ON public.printer_alerts
    FOR EACH ROW EXECUTE FUNCTION public.trg_printer_alerts_touch_updated_at();

COMMIT;

-- ============================================================================
-- Verification output
-- ============================================================================
\echo '=== printer_alerts ==='
SELECT COUNT(*) AS rows FROM public.printer_alerts;

\echo '=== printer_supplies_replacements ==='
SELECT COUNT(*) AS rows FROM public.printer_supplies_replacements;

\echo '=== print_jobs new columns ==='
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='print_jobs'
  AND column_name IN ('print_source','external_job_id','external_job_ids_merged')
ORDER BY column_name;

\echo '=== materialized views ==='
SELECT matviewname, ispopulated FROM pg_matviews
WHERE schemaname='public' AND matviewname LIKE 'printer_telemetry_%'
ORDER BY matviewname;

\echo '=== retention function ==='
SELECT proname, pronargs FROM pg_proc WHERE proname='fleet_retention_cleanup';
