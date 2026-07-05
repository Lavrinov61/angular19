import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  StudentVerificationService,
  type StudentVerification,
  type StudentVerificationStatusPayload,
} from '../../core/services/student-verification.service';
import { InPersonStudentConfirmComponent } from './in-person-student-confirm.component';

const verification: StudentVerification = {
  id: 'verification-1',
  account_id: null,
  user_id: 'user-1',
  status: 'pending_in_person',
  source: 'in_person',
  education_role: 'student',
  institution_name: 'РИНХ',
  document_type: 'student_card',
  document_s3_key: null,
  document_url: null,
  document_mime_type: null,
  document_file_size: 0,
  document_expires_at: '2027-06-30',
  phone_normalized: '79001234567',
  referral_channel: 'walk_in',
  submitted_at: '2026-06-04T12:00:00.000Z',
  reviewed_at: null,
  reviewer_id: null,
  review_notes: null,
  rejection_reason: null,
  photo_deleted_at: null,
  retention_delete_after: null,
};

const confirmedStatus: StudentVerificationStatusPayload = {
  account: {
    id: 'account-1',
    user_id: 'user-1',
    status: 'verified',
    education_role: 'student',
    institution_name: 'РИНХ',
    document_number: null,
    verified_at: '2026-06-04T12:10:00.000Z',
    expires_at: '2027-06-30T20:59:59.000Z',
    reviewer_id: 'employee-1',
    reject_reason: null,
    revoke_reason: null,
    revoked_reason: null,
    created_at: '2026-06-04T12:10:00.000Z',
    updated_at: '2026-06-04T12:10:00.000Z',
  },
  latest_verification: {
    ...verification,
    account_id: 'account-1',
    status: 'approved',
  },
  student_discount: null,
  discount: null,
};

const emptyStatus: StudentVerificationStatusPayload = {
  account: null,
  latest_verification: null,
  student_discount: null,
  discount: null,
};

describe('InPersonStudentConfirmComponent', () => {
  let fixture: ComponentFixture<InPersonStudentConfirmComponent>;
  let service: Pick<StudentVerificationService, 'confirmInPerson' | 'loadMine' | 'loadPendingInPerson'>;

  beforeEach(async () => {
    service = {
      loadMine: vi.fn(() => of(emptyStatus)),
      loadPendingInPerson: vi.fn(() => of(verification)),
      confirmInPerson: vi.fn(() => of(confirmedStatus)),
    };

    await TestBed.configureTestingModule({
      imports: [InPersonStudentConfirmComponent],
      providers: [
        provideRouter([]),
        { provide: StudentVerificationService, useValue: service },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InPersonStudentConfirmComponent);
    fixture.detectChanges();
    await settle(fixture);
  });

  it('shows prepared data and confirms it with explicit consent', async () => {
    expect(fixture.nativeElement.textContent).toContain('РИНХ');
    expect(fixture.nativeElement.textContent).toContain('30.06.2027');

    const consent = fixture.nativeElement.querySelector('input[name="consent"]') as HTMLInputElement | null;
    expect(consent).not.toBeNull();
    consent!.click();
    fixture.detectChanges();

    const confirmButton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    expect(confirmButton).not.toBeNull();
    confirmButton!.click();
    fixture.detectChanges();
    await settle(fixture);

    expect(service.confirmInPerson).toHaveBeenCalledWith('verification-1', {
      consentVersion: 'student-program-v1',
      marketingConsent: false,
    });
  });

  it('shows active status from the cabinet without loading a legacy pending link', async () => {
    service.loadMine = vi.fn(() => of(confirmedStatus));
    service.loadPendingInPerson = vi.fn(() => of(verification));

    const verifiedFixture = TestBed.createComponent(InPersonStudentConfirmComponent);
    verifiedFixture.detectChanges();
    await settle(verifiedFixture);

    expect(verifiedFixture.nativeElement.textContent).toContain('Статус активирован');
    expect(service.loadPendingInPerson).not.toHaveBeenCalled();
  });

  it('shows a friendly message when the legacy link lookup fails with a server error', async () => {
    service.loadMine = vi.fn(() => of(emptyStatus));
    service.loadPendingInPerson = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Internal server error' })),
    );

    const errorFixture = TestBed.createComponent(InPersonStudentConfirmComponent);
    errorFixture.detectChanges();
    await settle(errorFixture);

    const text = errorFixture.nativeElement.textContent ?? '';
    expect(text).toContain('Статус теперь включает сотрудник на точке');
    expect(text).not.toContain('Internal server error');
  });

  async function settle(componentFixture: ComponentFixture<InPersonStudentConfirmComponent>): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    componentFixture.detectChanges();
  }
});
