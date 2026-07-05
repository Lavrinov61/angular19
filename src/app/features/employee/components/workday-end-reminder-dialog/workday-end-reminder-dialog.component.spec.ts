import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkdayEndReminderDialogComponent,
  type WorkdayEndReminderDialogData,
  type WorkdayEndReminderDialogResult,
} from './workday-end-reminder-dialog.component';

describe('WorkdayEndReminderDialogComponent', () => {
  let close: ReturnType<typeof vi.fn>;

  function createComponent(data: WorkdayEndReminderDialogData): ComponentFixture<WorkdayEndReminderDialogComponent> {
    TestBed.configureTestingModule({
      imports: [WorkdayEndReminderDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });

    const fixture = TestBed.createComponent(WorkdayEndReminderDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    close = vi.fn();
    TestBed.resetTestingModule();
  });

  it('does not ask for cash and closes a cashless online shift with zero cash', () => {
    const fixture = createComponent({
      shiftId: 'shift-online',
      studioName: 'Пульт',
      endTime: '19:45 МСК',
      cashAtClose: null,
      cashlessAtClose: true,
    });
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('input')).toBeNull();
    expect(root.textContent).not.toContain('Фактически наличных в кассе');

    const checkoutButton = Array.from(root.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Закрыть рабочий день'));
    checkoutButton?.click();

    expect(close).toHaveBeenCalledWith({
      action: 'close_workday',
      cashAtClose: 0,
    } satisfies WorkdayEndReminderDialogResult);
  });
});
