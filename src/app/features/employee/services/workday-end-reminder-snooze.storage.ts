type ReminderSnoozeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const WORKDAY_END_REMINDER_SNOOZE_STORAGE_KEY = 'sf_workday_end_reminder_snooze_v1';

export function readWorkdayEndReminderSnooze(
  storage: ReminderSnoozeStorage,
  shiftId: string,
  now = Date.now(),
): number {
  try {
    const raw = storage.getItem(WORKDAY_END_REMINDER_SNOOZE_STORAGE_KEY);
    if (!raw) return 0;

    const params = new URLSearchParams(raw);
    const storedShiftId = params.get('shiftId');
    const snoozedUntil = Number(params.get('snoozedUntil'));

    if (storedShiftId !== shiftId || !Number.isFinite(snoozedUntil) || snoozedUntil <= now) {
      storage.removeItem(WORKDAY_END_REMINDER_SNOOZE_STORAGE_KEY);
      return 0;
    }

    return snoozedUntil;
  } catch {
    try {
      storage.removeItem(WORKDAY_END_REMINDER_SNOOZE_STORAGE_KEY);
    } catch {
      // Storage can be unavailable or blocked; in-memory snooze still works.
    }
    return 0;
  }
}

export function saveWorkdayEndReminderSnooze(
  storage: ReminderSnoozeStorage,
  shiftId: string,
  snoozedUntil: number,
): void {
  try {
    const params = new URLSearchParams({
      shiftId,
      snoozedUntil: String(snoozedUntil),
    });
    storage.setItem(WORKDAY_END_REMINDER_SNOOZE_STORAGE_KEY, params.toString());
  } catch {
    // Storage persistence is best effort; the current tab keeps the in-memory timer.
  }
}

export function clearWorkdayEndReminderSnooze(storage: ReminderSnoozeStorage): void {
  try {
    storage.removeItem(WORKDAY_END_REMINDER_SNOOZE_STORAGE_KEY);
  } catch {
    // Ignore blocked storage.
  }
}
