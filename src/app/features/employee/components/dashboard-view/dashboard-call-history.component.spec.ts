import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { DashboardCallHistoryComponent } from './dashboard-call-history.component';
import { TelephonyApiService, type CallLog } from '../../services/telephony-api.service';
import { TelephonyService } from '../../services/telephony.service';

const makeCallLog = (overrides: Partial<CallLog> = {}): CallLog => ({
  id: 'call-1',
  voximplant_session_id: 'crm-click-test',
  direction: 'outbound',
  caller_number: '+78633226575',
  called_number: '+79081234584',
  client_user_id: null,
  operator_user_id: 'operator-1',
  client_name: null,
  operator_name: 'Яковлева Ольга',
  status: 'failed',
  started_at: '2026-06-29T10:19:29.641Z',
  answered_at: null,
  ended_at: '2026-06-29T10:20:14.962Z',
  duration_seconds: null,
  recording_url: null,
  notes: '[2026-06-29T10:20:14.962Z] Voximplant call failed, reason=operator_answer_timeout, failure=operator_answer_timeout, scenario=studio-outbound, destination=soborny101',
  ...overrides,
});

describe('DashboardCallHistoryComponent', () => {
  let fixture: ComponentFixture<DashboardCallHistoryComponent>;

  const telephonyMock = {
    outboundRequesting: signal(false),
    callHistoryRefreshTick: signal(0),
    makeCall: vi.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardCallHistoryComponent],
      providers: [
        {
          provide: TelephonyApiService,
          useValue: {
            getCallHistory: () => of({ success: true, data: [makeCallLog()], total: 1 }),
          },
        },
        { provide: TelephonyService, useValue: telephonyMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardCallHistoryComponent);
    fixture.detectChanges();
  });

  it('shows a clear employee-facing reason when the studio phone did not answer', () => {
    const text = String(fixture.nativeElement.textContent ?? '');

    expect(text).toContain('нет ответа');
    expect(text).toContain('Телефон студии не ответил');
  });
});
