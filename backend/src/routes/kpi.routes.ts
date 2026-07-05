/**
 * kpi.routes.ts — Enterprise Employee KPI API
 *
 * Endpoints:
 *   /my/dashboard, /my/trends, /my/history     — Employee self-view
 *   /team/overview, /team/compare, /team/leaderboard, /employee/:id/detail — Manager view
 *   /alerts, /alerts/:id/acknowledge            — Alert management
 *   /admin/metrics, /admin/targets, /admin/weight-profiles — Admin configuration
 */

import { Router } from 'express';
import { authenticateToken, requirePermission, requireUser } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../types/index.js';
import db from '../database/db.js';
import {
  computeAllMetrics,
  computeCompositeScore,
  getMetricDefinitions,
  getApplicableMetrics,
  getStaffUsers,
  getSnapshots,
  getCompositeHistory,
  resolveTarget,
  normalizeValue,
} from '../services/kpi-computation.service.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════
// EMPLOYEE SELF-VIEW
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /my/dashboard?period=today|week|month
 */
router.get('/my/dashboard', authenticateToken, async (req: AuthRequest, res) => {
  requireUser(req);
  const period = (req.query['period'] as string) || 'today';
  const { start, end } = getPeriodDates(period);
  const employeeId = req.user.id;
  const role = req.user.role;

  const applicableCodes = await getApplicableMetrics(role);
  const definitions = await getMetricDefinitions();
  const metrics = await computeAllMetrics(employeeId, start, end, applicableCodes);
  const composite = await computeCompositeScore(employeeId, role, metrics, definitions, start);

  // Enrich metrics with targets and trends
  const defMap = new Map(definitions.map(d => [d.code, d]));
  const enriched = await Promise.all(
    metrics.map(async (m) => {
      const def = defMap.get(m.code);
      if (!def) return null;
      const target = await resolveTarget(m.code, employeeId, role, start);
      const normalized = target ? normalizeValue(m.value, def.direction, target.targetValue) : 0;

      // Trend: compare with previous period
      const prevSnaps = await getSnapshots(employeeId, period === 'today' ? 'daily' : period === 'week' ? 'weekly' : 'monthly', 2, m.code);
      let trend: 'up' | 'down' | 'flat' = 'flat';
      if (prevSnaps.length >= 2) {
        const diff = prevSnaps[0].value - prevSnaps[1].value;
        const direction = def.direction === 'higher_better' ? 1 : -1;
        if (Math.abs(diff) > 0.01) trend = (diff * direction) > 0 ? 'up' : 'down';
      }

      return {
        code: m.code,
        name: def.name,
        nameRu: def.nameRu,
        category: def.category,
        unit: def.unit,
        direction: def.direction,
        value: m.value,
        sampleSize: m.sampleSize,
        target: target?.targetValue ?? null,
        targetPct: Math.round(normalized * 100) / 100,
        trend,
      };
    }),
  );

  res.json({
    metrics: enriched.filter(Boolean),
    compositeScore: composite,
    period: { type: period, start, end },
  });
});

/**
 * GET /my/trends?metric=prod_tasks_completed&period=daily&count=30
 */
router.get('/my/trends', authenticateToken, async (req: AuthRequest, res) => {
  requireUser(req);
  const metric = req.query['metric'] as string;
  const periodType = (req.query['period'] as string) || 'daily';
  const count = Math.min(parseInt(req.query['count'] as string) || 30, 90);

  if (!metric) throw new AppError(400, 'metric parameter required');

  const snapshots = await getSnapshots(req.user.id, periodType, count, metric);
  const definitions = await getMetricDefinitions();
  const def = definitions.find(d => d.code === metric);

  // Add target to each point
  const points = await Promise.all(
    snapshots.map(async s => {
      const target = await resolveTarget(s.metricCode, req.user!.id, req.user!.role, s.periodStart);
      return { date: s.periodStart, value: s.value, target: target?.targetValue ?? null };
    }),
  );

  // Comparison: current vs previous period value
  let comparison = null;
  if (points.length >= 2) {
    const current = points[0].value;
    const previous = points[1].value;
    const changePct = previous !== 0 ? Math.round(((current - previous) / previous) * 100) : 0;
    comparison = { current, previous, changePct };
  }

  res.json({ metric: def || null, points: points.reverse(), comparison });
});

/**
 * GET /my/history?periodType=weekly&from=2026-01-01&to=2026-03-09
 */
router.get('/my/history', authenticateToken, async (req: AuthRequest, res) => {
  requireUser(req);
  const periodType = (req.query['periodType'] as string) || 'weekly';
  const from = (req.query['from'] as string) || new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
  const to = (req.query['to'] as string) || new Date().toISOString().split('T')[0];

  const compositeScores = await getCompositeHistory(req.user.id, periodType, from, to);

  const alerts = await db.query<{
    id: string; metric_code: string; alert_type: string; severity: string;
    current_value: string; message: string; created_at: string;
  }>(
    `SELECT id, metric_code, alert_type, severity, current_value, message, created_at
     FROM kpi_alerts
     WHERE employee_id = $1 AND period_start >= $2::date AND period_start <= $3::date
     ORDER BY created_at DESC LIMIT 50`,
    [req.user.id, from, to],
  );

  res.json({
    compositeScores,
    alerts: alerts.map(a => ({
      id: a.id,
      metricCode: a.metric_code,
      alertType: a.alert_type,
      severity: a.severity,
      currentValue: parseFloat(a.current_value),
      message: a.message,
      createdAt: a.created_at,
    })),
  });
});

// ═══════════════════════════════════════════════════════════════════════
// MANAGER / TEAM VIEW
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /team/overview?period=week|month
 */
router.get('/team/overview', authenticateToken, requirePermission('analytics:view'), async (req: AuthRequest, res) => {
  const period = (req.query['period'] as string) || 'month';
  const { start, end } = getPeriodDates(period);
  const staff = await getStaffUsers();
  const definitions = await getMetricDefinitions();

  const employees = await Promise.all(
    staff.map(async (user) => {
      const applicableCodes = await getApplicableMetrics(user.role);
      const metrics = await computeAllMetrics(user.id, start, end, applicableCodes);
      const composite = await computeCompositeScore(user.id, user.role, metrics, definitions, start);

      // Find top and weakest metric
      const defMap = new Map(definitions.map(d => [d.code, d]));
      let topMetric = null;
      let weakestMetric = null;
      let topScore = -1;
      let weakScore = 101;

      for (const m of metrics) {
        const def = defMap.get(m.code);
        if (!def) continue;
        const target = await resolveTarget(m.code, user.id, user.role, start);
        if (!target) continue;
        const norm = normalizeValue(m.value, def.direction, target.targetValue);
        if (norm > topScore) { topScore = norm; topMetric = { code: m.code, value: m.value }; }
        if (norm < weakScore) { weakScore = norm; weakestMetric = { code: m.code, value: m.value }; }
      }

      // Alert count
      const alertRow = await db.queryOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM kpi_alerts
         WHERE employee_id = $1 AND NOT acknowledged
           AND period_start >= $2::date`,
        [user.id, start],
      );

      return {
        id: user.id,
        displayName: user.displayName,
        photoUrl: user.photoUrl,
        role: user.role,
        compositeScore: composite.compositeScore,
        rating: composite.rating,
        topMetric,
        weakestMetric,
        alertCount: parseInt(alertRow?.cnt || '0', 10),
      };
    }),
  );

  // Team average
  const scores = employees.map(e => e.compositeScore).filter(s => s > 0);
  const teamAverage = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0;

  res.json({
    employees: employees.sort((a, b) => b.compositeScore - a.compositeScore),
    teamAverage,
    period: { type: period, start, end },
  });
});

/**
 * GET /team/compare?employeeIds=id1,id2&metric=speed_chat_first_response&periodType=daily&count=14
 */
router.get('/team/compare', authenticateToken, requirePermission('analytics:view'), async (req: AuthRequest, res) => {
  const employeeIds = ((req.query['employeeIds'] as string) || '').split(',').filter(Boolean);
  const metric = req.query['metric'] as string;
  const periodType = (req.query['periodType'] as string) || 'daily';
  const count = Math.min(parseInt(req.query['count'] as string) || 14, 60);

  if (!metric || employeeIds.length === 0) throw new AppError(400, 'employeeIds and metric required');

  const staff = await getStaffUsers();
  const staffMap = new Map(staff.map(s => [s.id, s]));
  const definitions = await getMetricDefinitions();
  const def = definitions.find(d => d.code === metric);

  const series = await Promise.all(
    employeeIds.map(async (id) => {
      const user = staffMap.get(id);
      const points = await getSnapshots(id, periodType, count, metric);
      return {
        employeeId: id,
        displayName: user?.displayName || 'Unknown',
        points: points.map(p => ({ date: p.periodStart, value: p.value })).reverse(),
      };
    }),
  );

  res.json({ metric: def || null, series });
});

/**
 * GET /team/leaderboard?metric=composite|prod_tasks_completed&period=week|month
 */
router.get('/team/leaderboard', authenticateToken, requirePermission('analytics:view'), async (req: AuthRequest, res) => {
  const metric = (req.query['metric'] as string) || 'composite';
  const period = (req.query['period'] as string) || 'month';
  const { start, end } = getPeriodDates(period);

  const staff = await getStaffUsers();
  const definitions = await getMetricDefinitions();

  if (metric === 'composite') {
    const entries = await Promise.all(
      staff.map(async (user) => {
        const applicableCodes = await getApplicableMetrics(user.role);
        const metrics = await computeAllMetrics(user.id, start, end, applicableCodes);
        const composite = await computeCompositeScore(user.id, user.role, metrics, definitions, start);
        return {
          employeeId: user.id,
          displayName: user.displayName,
          photoUrl: user.photoUrl,
          value: composite.compositeScore,
          rating: composite.rating,
        };
      }),
    );
    entries.sort((a, b) => b.value - a.value);
    res.json({ metric: 'composite', entries: entries.map((e, i) => ({ ...e, rank: i + 1 })) });
  } else {
    const entries = await Promise.all(
      staff.map(async (user) => {
        const { computeMetric } = await import('../services/kpi-computation.service.js');
        try {
          const result = await computeMetric(user.id, metric, start, end);
          const target = await resolveTarget(metric, user.id, user.role, start);
          return {
            employeeId: user.id,
            displayName: user.displayName,
            photoUrl: user.photoUrl,
            value: result.value,
            target: target?.targetValue ?? null,
          };
        } catch {
          return { employeeId: user.id, displayName: user.displayName, photoUrl: user.photoUrl, value: 0, target: null };
        }
      }),
    );
    const def = definitions.find(d => d.code === metric);
    const ascending = def?.direction === 'lower_better';
    entries.sort((a, b) => ascending ? a.value - b.value : b.value - a.value);
    res.json({ metric, entries: entries.map((e, i) => ({ ...e, rank: i + 1 })) });
  }
});

/**
 * GET /employee/:id/detail?period=month
 */
router.get('/employee/:id/detail', authenticateToken, requirePermission('analytics:view'), async (req: AuthRequest, res) => {
  const employeeId = req.params['id'];
  const period = (req.query['period'] as string) || 'month';
  const { start, end } = getPeriodDates(period);

  const staff = await getStaffUsers();
  const user = staff.find(s => s.id === employeeId);
  if (!user) throw new AppError(404, 'Employee not found');

  const applicableCodes = await getApplicableMetrics(user.role);
  const definitions = await getMetricDefinitions();
  const metrics = await computeAllMetrics(employeeId, start, end, applicableCodes);
  const composite = await computeCompositeScore(employeeId, user.role, metrics, definitions, start);

  const defMap = new Map(definitions.map(d => [d.code, d]));
  const enriched = await Promise.all(
    metrics.map(async (m) => {
      const def = defMap.get(m.code);
      if (!def) return null;
      const target = await resolveTarget(m.code, employeeId, user.role, start);
      const normalized = target ? normalizeValue(m.value, def.direction, target.targetValue) : 0;
      return {
        code: m.code, nameRu: def.nameRu, category: def.category, unit: def.unit,
        direction: def.direction, value: m.value, sampleSize: m.sampleSize,
        target: target?.targetValue ?? null, targetPct: Math.round(normalized * 100) / 100,
      };
    }),
  );

  res.json({
    employee: user,
    metrics: enriched.filter(Boolean),
    compositeScore: composite,
    period: { type: period, start, end },
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /alerts?status=unacknowledged&severity=critical,warning&limit=50
 */
router.get('/alerts', authenticateToken, requirePermission('analytics:view'), async (req: AuthRequest, res) => {
  const status = req.query['status'] as string;
  const severities = ((req.query['severity'] as string) || '').split(',').filter(Boolean);
  const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 200);

  let whereClause = '1=1';
  const params: unknown[] = [limit];

  if (status === 'unacknowledged') whereClause += ' AND NOT acknowledged';
  if (status === 'acknowledged') whereClause += ' AND acknowledged';
  if (severities.length > 0) {
    whereClause += ` AND severity = ANY($${params.length + 1})`;
    params.push(severities);
  }

  const rows = await db.query<{
    id: string; employee_id: string; metric_code: string; alert_type: string;
    severity: string; period_type: string; period_start: string;
    current_value: string; target_value: string | null; message: string;
    acknowledged: boolean; created_at: string;
  }>(
    `SELECT a.*, u.display_name AS employee_name
     FROM kpi_alerts a
     LEFT JOIN users u ON u.id = a.employee_id
     WHERE ${whereClause}
     ORDER BY a.created_at DESC
     LIMIT $1`,
    params,
  );

  res.json({
    alerts: rows.map(r => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: (r as Record<string, unknown>)['employee_name'] || 'Unknown',
      metricCode: r.metric_code,
      alertType: r.alert_type,
      severity: r.severity,
      periodType: r.period_type,
      periodStart: r.period_start,
      currentValue: parseFloat(r.current_value),
      targetValue: r.target_value ? parseFloat(r.target_value) : null,
      message: r.message,
      acknowledged: r.acknowledged,
      createdAt: r.created_at,
    })),
  });
});

/**
 * PATCH /alerts/:id/acknowledge
 */
router.patch('/alerts/:id/acknowledge', authenticateToken, requirePermission('analytics:view'), async (req: AuthRequest, res) => {
  requireUser(req);
  const alertId = req.params['id'];
  await db.query(
    `UPDATE kpi_alerts SET acknowledged = true, acknowledged_by = $1, acknowledged_at = NOW()
     WHERE id = $2`,
    [req.user.id, alertId],
  );
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════
// ADMIN CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /admin/metrics
 */
router.get('/admin/metrics', authenticateToken, requirePermission('settings:manage'), async (_req, res) => {
  const definitions = await getMetricDefinitions(false);
  res.json({ metrics: definitions });
});

/**
 * PATCH /admin/metrics/:code
 */
router.patch('/admin/metrics/:code', authenticateToken, requirePermission('settings:manage'), async (req: AuthRequest, res) => {
  const code = req.params['code'];
  const { defaultWeight, isActive, applicableRoles } = req.body;

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (defaultWeight !== undefined) { sets.push(`default_weight = $${idx++}`); params.push(defaultWeight); }
  if (isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(isActive); }
  if (applicableRoles !== undefined) { sets.push(`applicable_roles = $${idx++}`); params.push(applicableRoles); }

  if (sets.length === 0) throw new AppError(400, 'No fields to update');

  params.push(code);
  await db.query(
    `UPDATE kpi_metric_definitions SET ${sets.join(', ')} WHERE code = $${idx}`,
    params,
  );
  res.json({ success: true });
});

/**
 * GET /admin/targets?metricCode=...&scope=...
 */
router.get('/admin/targets', authenticateToken, requirePermission('settings:manage'), async (req: AuthRequest, res) => {
  const metricCode = req.query['metricCode'] as string;
  const scope = req.query['scope'] as string;

  let where = '1=1';
  const params: unknown[] = [];
  if (metricCode) { params.push(metricCode); where += ` AND metric_code = $${params.length}`; }
  if (scope) { params.push(scope); where += ` AND scope = $${params.length}`; }

  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM kpi_targets WHERE ${where} ORDER BY metric_code, scope, effective_from DESC`,
    params,
  );
  res.json({ targets: rows });
});

/**
 * POST /admin/targets
 */
router.post('/admin/targets', authenticateToken, requirePermission('settings:manage'), async (req: AuthRequest, res) => {
  requireUser(req);
  const { metricCode, scope, scopeValue, targetValue, stretchValue, minimumValue, effectiveFrom, effectiveUntil } = req.body;
  if (!metricCode || !scope || targetValue === undefined || !effectiveFrom) {
    throw new AppError(400, 'metricCode, scope, targetValue, effectiveFrom required');
  }

  const row = await db.queryOne<{ id: string }>(
    `INSERT INTO kpi_targets
       (metric_code, scope, scope_value, target_value, stretch_value, minimum_value,
        effective_from, effective_until, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9)
     RETURNING id`,
    [metricCode, scope, scopeValue || null, targetValue, stretchValue || null,
     minimumValue || null, effectiveFrom, effectiveUntil || null, req.user.id],
  );
  res.status(201).json({ id: row!.id });
});

/**
 * PUT /admin/targets/:id
 */
router.put('/admin/targets/:id', authenticateToken, requirePermission('settings:manage'), async (req: AuthRequest, res) => {
  const { targetValue, stretchValue, minimumValue, effectiveFrom, effectiveUntil } = req.body;
  await db.query(
    `UPDATE kpi_targets SET
       target_value = COALESCE($1, target_value),
       stretch_value = $2,
       minimum_value = $3,
       effective_from = COALESCE($4::date, effective_from),
       effective_until = $5::date,
       updated_at = NOW()
     WHERE id = $6`,
    [targetValue, stretchValue ?? null, minimumValue ?? null,
     effectiveFrom || null, effectiveUntil || null, req.params['id']],
  );
  res.json({ success: true });
});

/**
 * DELETE /admin/targets/:id
 */
router.delete('/admin/targets/:id', authenticateToken, requirePermission('settings:manage'), async (req: AuthRequest, res) => {
  await db.query('DELETE FROM kpi_targets WHERE id = $1', [req.params['id']]);
  res.json({ success: true });
});

/**
 * GET /admin/weight-profiles
 */
router.get('/admin/weight-profiles', authenticateToken, requirePermission('settings:manage'), async (_req, res) => {
  const rows = await db.query<Record<string, unknown>>(
    'SELECT * FROM kpi_weight_profiles ORDER BY scope, scope_value',
  );
  res.json({ profiles: rows });
});

/**
 * PUT /admin/weight-profiles/:id
 */
router.put('/admin/weight-profiles/:id', authenticateToken, requirePermission('settings:manage'), async (req: AuthRequest, res) => {
  const { weights, name } = req.body;
  if (!weights) throw new AppError(400, 'weights required');

  await db.query(
    `UPDATE kpi_weight_profiles SET weights = $1, name = COALESCE($2, name), updated_at = NOW()
     WHERE id = $3`,
    [JSON.stringify(weights), name || null, req.params['id']],
  );
  res.json({ success: true });
});

// ─── Helpers ────────────────────────────────────────────────────────

function getPeriodDates(period: string): { start: string; end: string } {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  switch (period) {
    case 'today':
      return { start: today, end: today };
    case 'week': {
      const d = new Date(now);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      return { start: monday.toISOString().split('T')[0], end: today };
    }
    case 'month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: first.toISOString().split('T')[0], end: today };
    }
    default:
      return { start: today, end: today };
  }
}

export default router;
