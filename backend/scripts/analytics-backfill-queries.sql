-- =====================================================================
-- 14-day analytics backfill queries (2026-04-02 .. 2026-04-16)
-- Восстанавливает ~80% потерянной статистики из-за ad_clicks regression
-- (фиксенo в 01dc84c5). Источник данных: visitor_sessions.total_clicks,
-- инкрементируется в UPSERT tracking.routes.ts → tracking-jobs.service.ts.
-- =====================================================================

-- Q1: Ежедневная оценка кликов (источник: visitor_sessions.total_clicks)
-- Выполнять в multiplatform_publication или через mp_fdw.visitor_sessions
SELECT DATE(last_clicked_at) AS day,
       SUM(total_clicks) AS est_clicks,
       COUNT(DISTINCT COALESCE(visitor_id::text, fingerprint_visitor_id)) AS unique_visitors,
       COUNT(*) FILTER (WHERE fingerprint_visitor_id IS NOT NULL) AS sessions_with_fp
FROM visitor_sessions
WHERE last_clicked_at >= '2026-04-02' AND last_clicked_at < '2026-04-16'
GROUP BY 1 ORDER BY 1;

-- Q2: UTM attribution reconstruction
SELECT DATE(last_clicked_at) AS day,
       first_utm_source  AS utm_source,
       first_utm_campaign AS utm_campaign,
       SUM(total_clicks) AS clicks,
       COUNT(*)          AS sessions
FROM visitor_sessions
WHERE last_clicked_at >= '2026-04-02' AND last_clicked_at < '2026-04-16'
  AND first_utm_source IS NOT NULL
GROUP BY 1,2,3 ORDER BY 1,4 DESC;

-- Q3: Conversion funnel (после фикса, для baseline)
SELECT DATE(created_at) AS day,
       conversion_type,
       COUNT(*) AS conversions
FROM conversions
WHERE created_at >= '2026-04-16'
GROUP BY 1, 2 ORDER BY 1, 2;

-- Q4: После FDW (migration 106) — cross-DB query из magnus_photo_db
-- SELECT DATE(clicked_at), COUNT(*) FROM mp_fdw.ad_clicks
--   WHERE clicked_at > NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 1;
