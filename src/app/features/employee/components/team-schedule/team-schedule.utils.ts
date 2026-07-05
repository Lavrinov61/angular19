import type { EmployeeShift, ScheduleRequestedShift, ShiftStudio } from '../../services/shifts-api.service';

export type ScheduleLayout = 'employees' | 'studios';
export type ScheduleRequestAction = NonNullable<ScheduleRequestedShift['action']>;

export function filterShiftsByStudio(
  shifts: readonly EmployeeShift[],
  studioFilter: string,
): EmployeeShift[] {
  if (studioFilter === 'all') return [...shifts];
  return shifts.filter(shift => shift.studio_id === studioFilter);
}

export function groupShiftsByStudioDate(
  shifts: readonly EmployeeShift[],
): Map<string, Map<string, EmployeeShift[]>> {
  const grouped = new Map<string, Map<string, EmployeeShift[]>>();
  for (const shift of shifts) {
    const byDate = grouped.get(shift.studio_id) ?? new Map<string, EmployeeShift[]>();
    byDate.set(shift.shift_date, [...(byDate.get(shift.shift_date) ?? []), shift]);
    grouped.set(shift.studio_id, byDate);
  }
  return grouped;
}

export function visibleStudioRows(
  studios: readonly ShiftStudio[],
  studioFilter: string,
): ShiftStudio[] {
  if (studioFilter === 'all') return [...studios];
  return studios.filter(studio => studio.id === studioFilter);
}

export function scheduleRequestShiftAction(shift: Pick<ScheduleRequestedShift, 'action'>): ScheduleRequestAction {
  return shift.action ?? 'work';
}

export function isRequestedWorkShiftCovered(
  shifts: readonly EmployeeShift[],
  employeeId: string,
  requestShift: ScheduleRequestedShift,
): boolean {
  if (scheduleRequestShiftAction(requestShift) !== 'work') return false;
  return shifts.some(shift =>
    shift.employee_id === employeeId
    && shift.shift_date.slice(0, 10) === requestShift.date
    && shift.status !== 'cancelled',
  );
}
