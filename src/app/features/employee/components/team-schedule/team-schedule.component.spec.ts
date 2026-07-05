import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffUser } from '../../services/users-api.service';
import { UsersApiService } from '../../services/users-api.service';
import type { ScheduleRequest, ScheduleRequestedShift, ShiftStudio } from '../../services/shifts-api.service';
import { ShiftsApiService } from '../../services/shifts-api.service';
import { TeamScheduleComponent } from './team-schedule.component';

const employee: StaffUser = {
  id: 'employee-1',
  email: 'olga@example.test',
  display_name: 'Яковлева Ольга',
  first_name: 'Ольга',
  last_name: 'Яковлева',
  department: 'reception',
  phone: '79081999839',
  role: 'employee',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const studio: ShiftStudio = {
  id: 'soborny',
  name: 'Соборный',
  address: 'Соборный 21',
  location_code: 'sob',
  status: 'active',
  shift_rate: 2000,
};

function makeRequestedShifts(count: number): ScheduleRequestedShift[] {
  return Array.from({ length: count }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return {
      date: `2026-06-${day}`,
      start_time: '08:45',
      end_time: '19:45',
      studio_id: 'soborny',
      action: 'work',
    };
  });
}

function makeRequest(overrides: Partial<ScheduleRequest> = {}): ScheduleRequest {
  return {
    id: 'request-1',
    employee_id: employee.id,
    employee_name: employee.display_name,
    employee_phone: employee.phone ?? undefined,
    shift_pattern: 'custom',
    pattern_start_date: '2026-06-01',
    end_date: '2026-06-14',
    requested_shifts: makeRequestedShifts(14),
    status: 'pending',
    admin_id: null,
    admin_name: undefined,
    admin_comment: undefined,
    created_at: '2026-05-31T19:48:00Z',
    updated_at: '2026-05-31T19:48:00Z',
    ...overrides,
  };
}

function apiResponse<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

describe('TeamScheduleComponent', () => {
  let request: ScheduleRequest;
  let shiftsApi: Pick<ShiftsApiService, 'getShifts' | 'getShiftStudios' | 'getScheduleRequests'>;
  let usersApi: Pick<UsersApiService, 'getUsers'>;

  function createComponent(): ComponentFixture<TeamScheduleComponent> {
    TestBed.configureTestingModule({
      imports: [TeamScheduleComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ShiftsApiService, useValue: shiftsApi },
        { provide: UsersApiService, useValue: usersApi },
      ],
    });

    const fixture = TestBed.createComponent(TeamScheduleComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    request = makeRequest();
    shiftsApi = {
      getShifts: vi.fn(() => of(apiResponse([]))),
      getShiftStudios: vi.fn(() => of(apiResponse([studio]))),
      getScheduleRequests: vi.fn(() => of(apiResponse([request]))),
    };
    usersApi = {
      getUsers: vi.fn(() => of([employee])),
    };
  });

  it('renders long request actions in the fixed panel footer instead of the scrollable details body', () => {
    const fixture = createComponent();

    fixture.componentInstance.openRequestPanel(request);
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const body = root.querySelector('.ts-request-panel .ts-panel-body');
    const actions = root.querySelector('.ts-request-panel .ts-request-actions');

    expect(actions).not.toBeNull();
    expect(body?.contains(actions)).toBe(false);
    expect(root.querySelector('.ts-request-panel .ts-request-footer .ts-request-actions')).not.toBeNull();
  });
});
