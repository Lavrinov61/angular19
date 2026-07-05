import {
  clearWorkdayEndReminderSnooze,
  readWorkdayEndReminderSnooze,
  saveWorkdayEndReminderSnooze,
} from './workday-end-reminder-snooze.storage';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('workday end reminder snooze storage', () => {
  it('restores a future snooze for the same shift', () => {
    const storage = new MemoryStorage();

    saveWorkdayEndReminderSnooze(storage, 'shift-1', 1_700_000_060_000);

    expect(readWorkdayEndReminderSnooze(storage, 'shift-1', 1_700_000_000_000))
      .toBe(1_700_000_060_000);
  });

  it('clears expired snoozes', () => {
    const storage = new MemoryStorage();

    saveWorkdayEndReminderSnooze(storage, 'shift-1', 1_700_000_000_000);

    expect(readWorkdayEndReminderSnooze(storage, 'shift-1', 1_700_000_000_001)).toBe(0);
    expect(readWorkdayEndReminderSnooze(storage, 'shift-1', 1_700_000_000_002)).toBe(0);
  });

  it('ignores snoozes from another shift', () => {
    const storage = new MemoryStorage();

    saveWorkdayEndReminderSnooze(storage, 'shift-1', 1_700_000_060_000);

    expect(readWorkdayEndReminderSnooze(storage, 'shift-2', 1_700_000_000_000)).toBe(0);
  });

  it('clears the saved snooze explicitly', () => {
    const storage = new MemoryStorage();

    saveWorkdayEndReminderSnooze(storage, 'shift-1', 1_700_000_060_000);
    clearWorkdayEndReminderSnooze(storage);

    expect(readWorkdayEndReminderSnooze(storage, 'shift-1', 1_700_000_000_000)).toBe(0);
  });
});
