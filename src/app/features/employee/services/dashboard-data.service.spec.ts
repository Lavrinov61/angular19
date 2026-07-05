import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AuthService, type UserProfile } from '../../../core/services/auth.service';
import { WebSocketService } from '../../../core/services/websocket.service';
import { type ApiResponse } from '../../../core/services/api.service';
import { CrmReportsApiService } from './crm-reports-api.service';
import { DashboardDataService } from './dashboard-data.service';
import { InboxService } from './inbox.service';
import { OrdersApiService } from './orders-api.service';
import { PosApiService, type PosOpenShiftResponse, type PosShift } from './pos-api.service';
import { PosSalesApiService } from './pos-sales-api.service';
import { ShiftsApiService, type EmployeeShift } from './shifts-api.service';
import { TasksApiService, type WorkdayShift } from './tasks-api.service';

const makeEmployeeShift = (overrides: Partial<EmployeeShift> = {}): EmployeeShift => ({
  id: 'employee-shift-1',
  employee_id: 'emp-1',
  studio_id: 'studio-1',
  shift_date: '2026-05-23',
  start_time: '09:00',
  end_time: '19:30',
  status: 'active',
  cash_at_open: 250,
  cash_at_close: null,
  base_pay_rate: 2000,
  online_earnings: 0,
  online_count: 0,
  commission_total: 0,
  sales_total: 0,
  receipts_count: 0,
  created_at: '2026-05-23T06:00:00Z',
  updated_at: '2026-05-23T06:00:00Z',
  ...overrides,
});

const makePosShift = (overrides: Partial<PosShift> = {}): PosShift => ({
  id: 'pos-shift-1',
  employee_id: 'emp-1',
  studio_id: 'studio-1',
  shift_number: 1,
  opened_at: '2026-05-23T06:00:00Z',
  closed_at: null,
  cash_at_open: 250,
  cash_at_close: null,
  expected_cash: 250,
  fiscal_enabled: true,
  status: 'open',
  total_sales: 0,
  total_refunds: 0,
  receipt_count: 0,
  ...overrides,
});

describe('DashboardDataService', () => {
  const user: UserProfile = {
    id: 'emp-1',
    email: 'employee@example.test',
    role: 'employee',
  };

  let service: DashboardDataService;
  let shiftsApi: {
    startWorkday: ReturnType<typeof vi.fn>;
    checkOut: ReturnType<typeof vi.fn>;
  };
  let posApi: {
    getCurrentShift: ReturnType<typeof vi.fn>;
    openShiftWithFiscalCommand: ReturnType<typeof vi.fn>;
    closeShiftFiscalWithCommand: ReturnType<typeof vi.fn>;
  };
  let dialog: {
    open: ReturnType<typeof vi.fn>;
  };
  let snackBar: {
    open: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    const shiftResponse: ApiResponse<EmployeeShift> = {
      success: true,
      data: makeEmployeeShift(),
    };
    const posResponse: PosOpenShiftResponse = {
      shift: makePosShift(),
      employeeShiftId: 'employee-shift-1',
      fiscalTransactionId: 'fiscal-tx-1',
    };

    shiftsApi = {
      startWorkday: vi.fn(() => of(shiftResponse)),
      checkOut: vi.fn(() => of(shiftResponse)),
    };
    posApi = {
      getCurrentShift: vi.fn(() => of(null)),
      openShiftWithFiscalCommand: vi.fn(() => of(posResponse)),
      closeShiftFiscalWithCommand: vi.fn(() => of({ shift: makePosShift(), fiscalCommandEnqueued: false, fiscalTransactionId: null })),
    };
    dialog = {
      open: vi.fn(),
    };
    snackBar = {
      open: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        DashboardDataService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AuthService, useValue: { currentUser: () => user, hasPermission: () => false } },
        { provide: InboxService, useValue: { counts: () => ({}) } },
        { provide: CrmReportsApiService, useValue: {} },
        { provide: TasksApiService, useValue: {} },
        { provide: OrdersApiService, useValue: {} },
        { provide: ShiftsApiService, useValue: shiftsApi },
        { provide: PosApiService, useValue: posApi },
        { provide: PosSalesApiService, useValue: {} },
        {
          provide: WebSocketService,
          useValue: {
            orderEvent: () => null,
            taskEvent: () => null,
            paymentLinkEvent: () => null,
            retouchQueueEvent: () => null,
            approvalEvent: () => null,
          },
        },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MatDialog, useValue: dialog },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });

    service = TestBed.inject(DashboardDataService);
    vi.spyOn(service, 'loadWorkday').mockImplementation(() => undefined);
    vi.spyOn(service, 'loadCommission').mockImplementation(() => undefined);
  });

  it('opens the POS shift from the first workday start flow with the same cash and fiscal flag', async () => {
    const result = await firstValueFrom(service.startWorkday('studio-1', false, 250));

    expect(result.success).toBe(true);
    expect(shiftsApi.startWorkday).toHaveBeenCalledWith('studio-1', false, 250);
    expect(posApi.getCurrentShift).toHaveBeenCalledWith('emp-1');
    expect(posApi.openShiftWithFiscalCommand).toHaveBeenCalledWith({
      employee_id: 'emp-1',
      studio_id: 'studio-1',
      cash_at_open: 250,
      fiscal_enabled: true,
    });
  });

  it('passes the disabled fiscal flag when the first flow checkbox is off', async () => {
    await firstValueFrom(service.startWorkday('studio-1', false, 250, false));

    expect(posApi.openShiftWithFiscalCommand).toHaveBeenCalledWith({
      employee_id: 'emp-1',
      studio_id: 'studio-1',
      cash_at_open: 250,
      fiscal_enabled: false,
    });
  });

  it('skips POS shift creation for virtual workday starts', async () => {
    const result = await firstValueFrom(service.startWorkday('online-studio', false, 0, false, false));

    expect(result.success).toBe(true);
    expect(shiftsApi.startWorkday).toHaveBeenCalledWith('online-studio', false, 0);
    expect(posApi.getCurrentShift).not.toHaveBeenCalled();
    expect(posApi.openShiftWithFiscalCommand).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith('Рабочий день начат.', 'OK', { duration: 3000 });
  });

  it('does not create a duplicate POS shift when one is already open', async () => {
    posApi.getCurrentShift.mockReturnValue(of(makePosShift()));

    await firstValueFrom(service.startWorkday('studio-1', false, 250));

    expect(posApi.getCurrentShift).toHaveBeenCalledWith('emp-1');
    expect(posApi.openShiftWithFiscalCommand).not.toHaveBeenCalled();
  });

  it('keeps the workday start result and reports an error when POS shift opening fails', async () => {
    posApi.openShiftWithFiscalCommand.mockReturnValue(throwError(() => new Error('POS unavailable')));

    const result = await firstValueFrom(service.startWorkday('studio-1', false, 250));

    expect(result.success).toBe(true);
    expect(snackBar.open).toHaveBeenCalledWith(
      'Рабочий день начат, но кассовую смену открыть не удалось',
      'OK',
      { duration: 5000, panelClass: ['snack-error'] },
    );
  });

  it('closes a virtual workday with zero cash without asking for cash count', () => {
    const shift: WorkdayShift = {
      id: 'workday-online',
      studio_id: 'online-studio',
      status: 'active',
      shift_kind: 'virtual',
      is_virtual: true,
      studio_name: 'Онлайн смена',
      studio_address: null,
      location_code: 'online',
      cash_at_open: 0,
      cash_at_close: null,
      online_earnings: 0,
      online_count: 0,
    };

    service.requestCheckOut(shift);

    expect(dialog.open).not.toHaveBeenCalled();
    expect(shiftsApi.checkOut).toHaveBeenCalledWith('workday-online', 0);
  });
});
