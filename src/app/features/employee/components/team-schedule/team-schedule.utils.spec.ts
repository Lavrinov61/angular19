import { describe, expect, it } from 'vitest';
import type { EmployeeShift, ScheduleRequestedShift, ShiftStudio } from '../../services/shifts-api.service';
import {
  filterShiftsByStudio,
  groupShiftsByStudioDate,
  isRequestedWorkShiftCovered,
  scheduleRequestShiftAction,
  visibleStudioRows,
} from './team-schedule.utils';

const baseShift: EmployeeShift = {
  id: 'shift-1',
  employee_id: 'employee-1',
  employee_name: 'Оля Бутенко',
  employee_phone: null,
  studio_id: 'soborny',
  studio_name: 'Соборный',
  studio_address: null,
  location_code: 'sob',
  shift_date: '2026-05-26',
  start_time: '08:45',
  end_time: '19:45',
  status: 'scheduled',
  cash_at_open: null,
  cash_at_close: null,
  base_pay_rate: 2000,
  online_earnings: 0,
  online_count: 0,
  commission_total: 0,
  sales_total: 0,
  receipts_count: 0,
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

const makeShift = (overrides: Partial<EmployeeShift>): EmployeeShift => ({
  ...baseShift,
  ...overrides,
});

const makeStudio = (overrides: Partial<ShiftStudio>): ShiftStudio => ({
  id: 'soborny',
  name: 'Соборный',
  address: 'Соборный 21',
  location_code: 'sob',
  status: 'active',
  shift_rate: 2000,
  ...overrides,
});

const makeRequestedShift = (overrides: Partial<ScheduleRequestedShift> = {}): ScheduleRequestedShift => ({
  date: '2026-05-26',
  start_time: '08:45',
  end_time: '19:45',
  studio_id: 'soborny',
  ...overrides,
});

describe('team schedule studio layout utils', () => {
  it('filters shifts by selected studio', () => {
    const shifts = [
      makeShift({ id: 'shift-1', studio_id: 'soborny' }),
      makeShift({ id: 'shift-2', studio_id: 'barrikadnaya' }),
    ];

    expect(filterShiftsByStudio(shifts, 'all').map(shift => shift.id)).toEqual(['shift-1', 'shift-2']);
    expect(filterShiftsByStudio(shifts, 'soborny').map(shift => shift.id)).toEqual(['shift-1']);
  });

  it('groups several employees into one studio-day cell', () => {
    const shifts = [
      makeShift({ id: 'shift-1', employee_id: 'employee-1', studio_id: 'soborny', shift_date: '2026-05-26' }),
      makeShift({ id: 'shift-2', employee_id: 'employee-2', studio_id: 'soborny', shift_date: '2026-05-26' }),
      makeShift({ id: 'shift-3', employee_id: 'employee-3', studio_id: 'soborny', shift_date: '2026-05-27' }),
    ];

    const grouped = groupShiftsByStudioDate(shifts);

    expect(grouped.get('soborny')?.get('2026-05-26')?.map(shift => shift.id)).toEqual(['shift-1', 'shift-2']);
    expect(grouped.get('soborny')?.get('2026-05-27')?.map(shift => shift.id)).toEqual(['shift-3']);
  });

  it('returns all studios or the selected studio row', () => {
    const studios = [
      makeStudio({ id: 'soborny', name: 'Соборный' }),
      makeStudio({ id: 'barrikadnaya', name: 'Баррикадная' }),
    ];

    expect(visibleStudioRows(studios, 'all').map(studio => studio.id)).toEqual(['soborny', 'barrikadnaya']);
    expect(visibleStudioRows(studios, 'barrikadnaya').map(studio => studio.id)).toEqual(['barrikadnaya']);
  });
});

describe('team schedule request utils', () => {
  it('defaults missing request shift action to work', () => {
    expect(scheduleRequestShiftAction(makeRequestedShift())).toBe('work');
  });

  it('treats a work request as covered when the employee already has a non-cancelled shift that day', () => {
    const shifts = [
      makeShift({
        employee_id: 'employee-1',
        shift_date: '2026-05-26T00:00:00Z',
        status: 'scheduled',
      }),
    ];

    expect(isRequestedWorkShiftCovered(shifts, 'employee-1', makeRequestedShift())).toBe(true);
    expect(isRequestedWorkShiftCovered(shifts, 'employee-2', makeRequestedShift())).toBe(false);
  });

  it('does not cover address-change or cancellation requests with an existing shift', () => {
    const shifts = [
      makeShift({
        employee_id: 'employee-1',
        shift_date: '2026-05-26',
        status: 'scheduled',
      }),
    ];

    expect(isRequestedWorkShiftCovered(shifts, 'employee-1', makeRequestedShift({ action: 'change_address' }))).toBe(false);
    expect(isRequestedWorkShiftCovered(shifts, 'employee-1', makeRequestedShift({ action: 'cancel_shift' }))).toBe(false);
  });

  it('does not cover work requests with cancelled shifts', () => {
    const shifts = [
      makeShift({
        employee_id: 'employee-1',
        shift_date: '2026-05-26',
        status: 'cancelled',
      }),
    ];

    expect(isRequestedWorkShiftCovered(shifts, 'employee-1', makeRequestedShift())).toBe(false);
  });
});
