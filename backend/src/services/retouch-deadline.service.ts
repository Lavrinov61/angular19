import { pool } from '../database/db.js';
import type { RetouchAvailabilityRow } from '../types/views/retouch-views.js';
import { addBusinessMinutes } from './business-hours.service.js';

const MINUTE_MS = 60_000;

export const RETOUCH_DEADLINE_LOOKAHEAD_DAYS = 45;

export function normalizeRetouchDeadlineMinutes(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return Math.max(1, Math.floor(parsed));
}

function parseDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function computeRetouchDeadlineFromAvailability(
  minutes: number,
  availability: readonly RetouchAvailabilityRow[],
  now: Date = new Date(),
): Date | null {
  const normalizedMinutes = normalizeRetouchDeadlineMinutes(minutes);
  if (!normalizedMinutes) return null;

  let remainingMinutes = normalizedMinutes;
  const nowMs = now.getTime();

  for (const slot of availability) {
    const shiftStart = parseDate(slot.shift_start_at);
    const shiftEnd = parseDate(slot.shift_end_at);
    if (!shiftStart || !shiftEnd || shiftEnd.getTime() <= nowMs) continue;

    const startsAtMs = Math.max(shiftStart.getTime(), nowMs);
    const availableMinutes = Math.floor((shiftEnd.getTime() - startsAtMs) / MINUTE_MS);
    if (availableMinutes <= 0) continue;

    if (remainingMinutes <= availableMinutes) {
      return new Date(startsAtMs + remainingMinutes * MINUTE_MS);
    }

    remainingMinutes -= availableMinutes;
  }

  return null;
}

async function loadRetouchAvailability(now: Date, preferredStudioId: string | null): Promise<RetouchAvailabilityRow[]> {
  const result = await pool.query<RetouchAvailabilityRow>(
    `WITH retouchers AS (
       SELECT u.id
       FROM users u
       WHERE u.is_active = true
         AND (u.role = 'admin' OR 'retoucher' = ANY(u.skills))
     ),
     workload AS (
       SELECT assigned_to, COUNT(*) AS active_count
       FROM work_tasks
       WHERE task_type = 'retouch'
         AND status IN ('open', 'assigned', 'in_progress', 'waiting')
         AND assigned_to IS NOT NULL
       GROUP BY assigned_to
     )
     SELECT
       es.employee_id,
       es.studio_id,
       ((es.shift_date::date + es.start_time::time) AT TIME ZONE COALESCE(s.timezone, 'Europe/Moscow')) AS shift_start_at,
       ((es.shift_date::date + es.end_time::time) AT TIME ZONE COALESCE(s.timezone, 'Europe/Moscow')) AS shift_end_at,
       COALESCE(w.active_count, 0) AS active_count
     FROM employee_shifts es
     INNER JOIN retouchers r ON r.id = es.employee_id
     INNER JOIN studios s ON s.id = es.studio_id
     LEFT JOIN studio_schedule_exceptions ex
       ON ex.studio_id = es.studio_id
      AND ex.exception_date = es.shift_date
     LEFT JOIN workload w ON w.assigned_to = es.employee_id
     WHERE es.status IN ('scheduled', 'active')
       AND es.shift_date BETWEEN ($1::timestamptz AT TIME ZONE COALESCE(s.timezone, 'Europe/Moscow'))::date
         AND (($1::timestamptz AT TIME ZONE COALESCE(s.timezone, 'Europe/Moscow'))::date + $2::int)
       AND ((es.shift_date::date + es.end_time::time) AT TIME ZONE COALESCE(s.timezone, 'Europe/Moscow')) > $1::timestamptz
       AND (
         COALESCE(s.status, 'open') = 'open'
         OR (s.status_until IS NOT NULL AND s.status_until < es.shift_date)
       )
       AND COALESCE(ex.is_closed, false) = false
     ORDER BY
       GREATEST(
         ((es.shift_date::date + es.start_time::time) AT TIME ZONE COALESCE(s.timezone, 'Europe/Moscow')),
         $1::timestamptz
       ) ASC,
       CASE WHEN $3::text IS NOT NULL AND es.studio_id::text = $3::text THEN 0 ELSE 1 END,
       COALESCE(w.active_count, 0) ASC
     LIMIT 200`,
    [now, RETOUCH_DEADLINE_LOOKAHEAD_DAYS, preferredStudioId],
  );

  return result.rows;
}

export async function computeRetouchDeadline(
  minutes: number,
  options: { studioId?: string | null; now?: Date } = {},
): Promise<Date> {
  const normalizedMinutes = normalizeRetouchDeadlineMinutes(minutes);
  const now = options.now ?? new Date();
  if (!normalizedMinutes) return now;

  const availability = await loadRetouchAvailability(now, options.studioId ?? null);
  const deadline = computeRetouchDeadlineFromAvailability(normalizedMinutes, availability, now);

  if (deadline) return deadline;

  return addBusinessMinutes(now, normalizedMinutes, options.studioId ?? undefined);
}
