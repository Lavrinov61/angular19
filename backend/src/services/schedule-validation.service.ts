/**
 * Валидация и генерация графиков по паттернам.
 * Поддерживаемые паттерны: '2/2', '1/1', '3/3', '5/2', 'custom'
 *
 * ВАЖНО: итерация по дням через setDate() — корректна при DST-переходах,
 * в отличие от cursor += 86400000 (может пропускать/дублировать дни).
 */

export interface ShiftDay {
  date: string;       // YYYY-MM-DD
  start_time: string; // HH:MM
  end_time: string;   // HH:MM
  studio_id?: string;
}

const MAX_RANGE_DAYS = 365;

/**
 * Форматирует Date в строку YYYY-MM-DD в локальном часовом поясе сервера.
 * НЕ использует toISOString() — тот возвращает UTC-дату.
 */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Парсит строку YYYY-MM-DD в Date как локальную дату (00:00 по локальному времени).
 * new Date('YYYY-MM-DD') парсит как UTC midnight — неверно для MSK (UTC+3).
 */
function parseLocalDate(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) throw new RangeError(`Неверный формат даты: ${dateStr}`);
  return d;
}

/**
 * Проверить, что набор смен соответствует указанному паттерну.
 * Для 'custom' — всегда valid.
 */
export function validateShiftPattern(
  shifts: ShiftDay[],
  pattern: '2/2' | '1/1' | '3/3' | '5/2' | 'custom',
  patternStartDate: string,
): { valid: boolean; errors: string[] } {
  if (pattern === 'custom') {
    return { valid: true, errors: [] };
  }

  // 5/2: calendar-aware validation — проверяем что все даты пн-пт
  if (pattern === '5/2') {
    const errors: string[] = [];
    for (const shift of shifts) {
      let shiftDate: Date;
      try {
        shiftDate = parseLocalDate(shift.date);
      } catch {
        errors.push(`Неверный формат даты: ${shift.date}`);
        continue;
      }
      const dow = shiftDate.getDay();
      if (dow === 0 || dow === 6) {
        errors.push(`Дата ${shift.date} — выходной день (сб/вс), не подходит для графика 5/2`);
      }
    }
    const shiftDates = shifts.map(s => s.date);
    const uniqueDates = new Set(shiftDates);
    if (uniqueDates.size !== shiftDates.length) {
      errors.push('Обнаружены дублирующиеся даты в запросе');
    }
    return { valid: errors.length === 0, errors };
  }

  // Валидация входной даты
  let startDate: Date;
  try {
    startDate = parseLocalDate(patternStartDate);
  } catch {
    return { valid: false, errors: ['Неверный формат patternStartDate (ожидается YYYY-MM-DD)'] };
  }

  if (shifts.length === 0) {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];

  const [workStr, restStr] = pattern.split('/');
  const workDays = parseInt(workStr, 10);
  const restDays = parseInt(restStr, 10);
  const cycleDays = workDays + restDays;

  // Найти максимальную дату в сменах
  const sortedDates = [...shifts.map(s => s.date)].sort();
  const maxDateStr = sortedDates.at(-1)!;

  // Проверка ограничения диапазона
  let maxDate: Date;
  try {
    maxDate = parseLocalDate(maxDateStr);
  } catch {
    return { valid: false, errors: [`Неверный формат даты в сменах: ${maxDateStr}`] };
  }

  const maxAllowed = new Date(startDate);
  maxAllowed.setDate(maxAllowed.getDate() + MAX_RANGE_DAYS);
  if (maxDate > maxAllowed) {
    return { valid: false, errors: [`Запрос на график слишком далеко в будущем (максимум ${MAX_RANGE_DAYS} дней)`] };
  }

  // Генерируем ожидаемые рабочие дни используя setDate() для DST-совместимости
  const expectedWorkDays = new Set<string>();
  const cursor = new Date(startDate);
  let dayOffset = 0;

  // Идём до maxDate + один цикл (чтобы точно перекрыть все переданные смены)
  const deadline = new Date(maxDate);
  deadline.setDate(deadline.getDate() + cycleDays);

  while (cursor <= deadline) {
    const posInCycle = dayOffset % cycleDays;
    if (posInCycle < workDays) {
      expectedWorkDays.add(toLocalDateStr(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
    dayOffset++;
  }

  // Каждая переданная смена должна попадать в рабочий день
  for (const shift of shifts) {
    if (!expectedWorkDays.has(shift.date)) {
      errors.push(`Дата ${shift.date} не является рабочим днём по паттерну ${pattern}`);
    }
  }

  // Не должно быть дублей
  const shiftDates = shifts.map(s => s.date);
  const uniqueDates = new Set(shiftDates);
  if (uniqueDates.size !== shiftDates.length) {
    errors.push('Обнаружены дублирующиеся даты в запросе');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Автоматически сгенерировать рабочие дни по паттерну.
 * @param pattern    — '2/2' | '1/1' | '3/3'
 * @param startDate  — первый день паттерна (YYYY-MM-DD)
 * @param endDate    — последний день включительно (YYYY-MM-DD)
 * @param defaultStartTime — '09:00'
 * @param defaultEndTime   — '19:30'
 */
export function generateShiftsFromPattern(
  pattern: '2/2' | '1/1' | '3/3' | '5/2',
  startDate: string,
  endDate: string,
  defaultStartTime = '09:00',
  defaultEndTime = '19:30',
): ShiftDay[] {
  let start: Date;
  let end: Date;
  try {
    start = parseLocalDate(startDate);
    end = parseLocalDate(endDate);
  } catch {
    return [];
  }

  // Ограничение диапазона
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + MAX_RANGE_DAYS);
  const effectiveEnd = end < maxEnd ? end : maxEnd;

  // 5/2: calendar-aware — рабочие дни пн-пт, выходные сб-вс
  if (pattern === '5/2') {
    const result: ShiftDay[] = [];
    const cursor = new Date(start);
    while (cursor <= effectiveEnd) {
      const dow = cursor.getDay();
      if (dow >= 1 && dow <= 5) {
        result.push({
          date: toLocalDateStr(cursor),
          start_time: defaultStartTime,
          end_time: defaultEndTime,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }

  const [workStr, restStr] = pattern.split('/');
  const workDays = parseInt(workStr, 10);
  const restDays = parseInt(restStr, 10);
  const cycleDays = workDays + restDays;

  const result: ShiftDay[] = [];
  const cursor = new Date(start);
  let dayOffset = 0;

  while (cursor <= effectiveEnd) {
    const posInCycle = dayOffset % cycleDays;
    if (posInCycle < workDays) {
      result.push({
        date: toLocalDateStr(cursor),
        start_time: defaultStartTime,
        end_time: defaultEndTime,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
    dayOffset++;
  }

  return result;
}
