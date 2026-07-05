import { pool } from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import type { StudiosId } from '../types/generated/public/Studios.js';

const logger = createLogger('business-hours');

// ── Types ──────────────────────────────────────────────────────────────

interface DaySchedule {
  open: string; // "HH:MM"
  close: string;
}

interface OperatingHours {
  default: DaySchedule;
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
  sunday?: DaySchedule;
}

interface ScheduleException {
  exception_date: string; // "YYYY-MM-DD"
  is_closed: boolean;
  open_time: string | null; // "HH:MM:SS"
  close_time: string | null;
}

interface StudioScheduleCache {
  operatingHours: OperatingHours;
  timezone: string;
  exceptions: ScheduleException[];
  cachedAt: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ITERATIONS = 365; // safety limit — never loop more than a year
const MOSCOW_TZ = 'Europe/Moscow';

const DEFAULT_SCHEDULE: OperatingHours = {
  default: { open: '09:00', close: '19:30' },
  monday: { open: '09:00', close: '19:30' },
  tuesday: { open: '09:00', close: '19:30' },
  wednesday: { open: '09:00', close: '19:30' },
  thursday: { open: '09:00', close: '19:30' },
  friday: { open: '09:00', close: '19:30' },
  saturday: { open: '09:00', close: '19:30' },
  sunday: { open: '09:00', close: '19:30' },
};

const DAY_NAMES: readonly string[] = [
  'sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday',
] as const;

// ── Cache ──────────────────────────────────────────────────────────────

const scheduleCache = new Map<string, StudioScheduleCache>();

function isCacheValid(entry: StudioScheduleCache): boolean {
  return Date.now() - entry.cachedAt < CACHE_TTL_MS;
}

// ── DB loaders ─────────────────────────────────────────────────────────

async function loadStudioSchedule(studioId: StudiosId): Promise<StudioScheduleCache> {
  const cached = scheduleCache.get(studioId);
  if (cached && !isCacheValid(cached)) {
    scheduleCache.delete(studioId);
  }
  if (cached && isCacheValid(cached)) return cached;

  const studioRows = await pool.query<{
    operating_hours: OperatingHours | null;
    timezone: string | null;
  }>(
    'SELECT operating_hours, timezone FROM studios WHERE id = $1',
    [studioId],
  );

  const studio = studioRows.rows[0];
  const operatingHours: OperatingHours =
    studio?.operating_hours && Object.keys(studio.operating_hours).length > 0
      ? studio.operating_hours
      : DEFAULT_SCHEDULE;

  const timezone = studio?.timezone || MOSCOW_TZ;

  const exceptionRows = await pool.query<ScheduleException>(
    `SELECT exception_date::text, is_closed, open_time::text, close_time::text
     FROM studio_schedule_exceptions
     WHERE studio_id = $1
       AND exception_date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 14
     ORDER BY exception_date`,
    [studioId],
  );

  const entry: StudioScheduleCache = {
    operatingHours,
    timezone,
    exceptions: exceptionRows.rows,
    cachedAt: Date.now(),
  };

  scheduleCache.set(studioId, entry);
  return entry;
}

async function loadDefaultSchedule(): Promise<StudioScheduleCache> {
  const cached = scheduleCache.get('__default__');
  if (cached && isCacheValid(cached)) return cached;

  // Try to load first studio
  const rows = await pool.query<{
    id: StudiosId;
    operating_hours: OperatingHours | null;
    timezone: string | null;
  }>(
    'SELECT id, operating_hours, timezone FROM studios ORDER BY created_at LIMIT 1',
  );

  if (rows.rows[0]?.id) {
    const result = await loadStudioSchedule(rows.rows[0].id);
    scheduleCache.set('__default__', result);
    return result;
  }

  const entry: StudioScheduleCache = {
    operatingHours: DEFAULT_SCHEDULE,
    timezone: MOSCOW_TZ,
    exceptions: [],
    cachedAt: Date.now(),
  };
  scheduleCache.set('__default__', entry);
  return entry;
}

// ── Timezone helpers ───────────────────────────────────────────────────

/** Convert a UTC Date to local date parts in the given timezone */
function toLocalParts(date: Date, tz: string): {
  year: number; month: number; day: number;
  hours: number; minutes: number; dayOfWeek: number;
  dateStr: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(p => p.type === type)?.value ?? '0';

  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  let hours = parseInt(get('hour'), 10);
  if (hours === 24) hours = 0;
  const minutes = parseInt(get('minute'), 10);

  // Weekday from short name
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayOfWeek = weekdayMap[get('weekday')] ?? date.getUTCDay();

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { year, month, day, hours, minutes, dayOfWeek, dateStr };
}

/** Parse "HH:MM" or "HH:MM:SS" → total minutes from midnight */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Create a Date in a given timezone from local date string + minutes from midnight */
function localToUtcDate(dateStr: string, minutesFromMidnight: number, tz: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;

  // Build an ISO-like string and resolve via timezone
  const isoLocal = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

  // Use Intl to find the UTC offset for this local time
  const probe = new Date(isoLocal + 'Z');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  // Binary-search style: find the UTC instant whose local representation matches
  // For Europe/Moscow (fixed UTC+3), offset is always +180 min
  // But we handle it generically for future timezone support
  const targetMin = hours * 60 + minutes;

  // Start with a rough estimate: subtract likely offset
  const localParts = formatter.formatToParts(probe);
  const probeHour = parseInt(localParts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const probeMin = parseInt(localParts.find(p => p.type === 'minute')?.value ?? '0', 10);
  const probeLocalMin = (probeHour === 24 ? 0 : probeHour) * 60 + probeMin;
  const offsetMin = probeLocalMin - (probe.getUTCHours() * 60 + probe.getUTCMinutes());

  // The result: local time - offset = UTC
  const resultMs = new Date(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`
  ).getTime() - offsetMin * 60_000;

  return new Date(resultMs);
}

/** Advance dateStr by 1 day → "YYYY-MM-DD" */
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z'); // noon to avoid DST edge
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Get day-of-week (0=Sun) from "YYYY-MM-DD" */
function dayOfWeekFromDateStr(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}

// ── Core logic ─────────────────────────────────────────────────────────

function getDaySchedule(
  schedule: OperatingHours,
  dayOfWeek: number,
  dateStr: string,
  exceptions: ScheduleException[],
): DaySchedule | null {
  // Check exceptions first
  const exception = exceptions.find(e => e.exception_date === dateStr);
  if (exception) {
    if (exception.is_closed) return null; // closed day
    if (exception.open_time && exception.close_time) {
      return {
        open: exception.open_time.slice(0, 5),  // "HH:MM:SS" → "HH:MM"
        close: exception.close_time.slice(0, 5),
      };
    }
  }

  const dayName = DAY_NAMES[dayOfWeek] as keyof OperatingHours;
  const daySchedule = schedule[dayName] as DaySchedule | undefined;
  return daySchedule ?? schedule.default;
}

/**
 * Add business minutes to a start time, respecting studio operating hours.
 *
 * If startTime is outside business hours, fast-forwards to next opening.
 * Rolls over across days as needed, skipping closed days and respecting exceptions.
 */
export async function addBusinessMinutes(
  startTime: Date,
  minutes: number,
  studioId?: string,
): Promise<Date> {
  if (minutes <= 0) return startTime;

  const scheduleData = studioId
    ? await loadStudioSchedule(studioId as StudiosId)
    : await loadDefaultSchedule();

  const { operatingHours, timezone, exceptions } = scheduleData;
  let remaining = minutes;

  // Get local time parts
  let local = toLocalParts(startTime, timezone);
  let currentDateStr = local.dateStr;
  let currentMinutes = local.hours * 60 + local.minutes;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const dow = iteration === 0 ? local.dayOfWeek : dayOfWeekFromDateStr(currentDateStr);
    const daySchedule = getDaySchedule(operatingHours, dow, currentDateStr, exceptions);

    if (!daySchedule) {
      // Closed day — skip to next
      currentDateStr = nextDay(currentDateStr);
      currentMinutes = 0; // will be set to open time below
      continue;
    }

    const openMin = parseTimeToMinutes(daySchedule.open);
    const closeMin = parseTimeToMinutes(daySchedule.close);

    // If before opening — fast-forward to opening
    if (currentMinutes < openMin) {
      currentMinutes = openMin;
    }

    // If at or after closing — skip to next day
    if (currentMinutes >= closeMin) {
      currentDateStr = nextDay(currentDateStr);
      currentMinutes = 0;
      continue;
    }

    // We are within business hours
    const availableMinutes = closeMin - currentMinutes;

    if (remaining <= availableMinutes) {
      // Deadline falls within this day
      const deadlineMinutes = currentMinutes + remaining;
      return localToUtcDate(currentDateStr, deadlineMinutes, timezone);
    }

    // Not enough time today — consume what's available and move to next day
    remaining -= availableMinutes;
    currentDateStr = nextDay(currentDateStr);
    currentMinutes = 0;
  }

  // Safety fallback: should never reach here
  logger.warn('[BusinessHours] Exceeded max iterations, falling back to linear addition', {
    startTime: startTime.toISOString(),
    minutes,
    studioId,
  });
  return new Date(startTime.getTime() + minutes * 60_000);
}
