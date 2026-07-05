import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  StudentVerificationService,
  type InPersonStudentVerificationPayload,
  type StudentVerification,
} from '../../../../core/services/student-verification.service';
import { InPersonStudentVerificationComponent } from './in-person-student-verification.component';

const verification: StudentVerification = {
  id: 'verification-1',
  account_id: 'student-account-1',
  user_id: 'user-1',
  status: 'approved',
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
  referral_channel: 'classmate',
  submitted_at: '2026-06-04T12:00:00.000Z',
  reviewed_at: '2026-06-04T12:01:00.000Z',
  reviewer_id: 'employee-1',
  review_notes: null,
  rejection_reason: null,
  photo_deleted_at: null,
  retention_delete_after: null,
};

const preparePayload: InPersonStudentVerificationPayload = {
  verification,
  matched_user: {
    id: 'user-1',
    phone: '+79001234567',
    display_name: 'Student',
    email: null,
  },
  scheduled_send_at: null,
  scheduled_send_channel: null,
  sent_to_chat_channel: null,
};

describe('InPersonStudentVerificationComponent', () => {
  let fixture: ComponentFixture<InPersonStudentVerificationComponent>;
  let service: Pick<StudentVerificationService, 'lookupInPerson' | 'prepareInPerson'>;

  beforeEach(async () => {
    service = {
      lookupInPerson: vi.fn(() => of(null)),
      prepareInPerson: vi.fn(() => of(preparePayload)),
    };

    await TestBed.configureTestingModule({
      imports: [InPersonStudentVerificationComponent],
      providers: [
        provideNoopAnimations(),
        { provide: StudentVerificationService, useValue: service },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InPersonStudentVerificationComponent);
    fixture.detectChanges();
  });

  it('activates an in-person verification without asking for a confirmation link', async () => {
    setValue('phone', '+7 (900) 123-45-67');
    setValue('institutionName', 'РИНХ');
    setValue('documentExpiresAt', '2027-06-30');

    button('submit')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.prepareInPerson).toHaveBeenCalledWith({
      phone: '+7 (900) 123-45-67',
      institutionName: 'РИНХ',
      educationRole: 'student',
      documentType: 'student_card',
      documentExpiresAt: '2027-06-30',
      referralChannel: 'walk_in',
      referrerPhone: null,
      conversationId: null,
    });
    expect(fixture.nativeElement.textContent).toContain('Статус активирован');
    expect(fixture.nativeElement.textContent).toContain('Образовательные цены доступны клиенту сразу');
    expect(fixture.nativeElement.textContent).not.toContain('/education/in-person');
    expect(fixture.nativeElement.textContent).not.toContain('автоматически');
  });

  it('does not render legacy delivery fields when backend still returns them', async () => {
    service.prepareInPerson = vi.fn(() =>
      of<InPersonStudentVerificationPayload>({
        ...preparePayload,
        scheduled_send_at: '2026-06-06T06:00:00.000Z',
        scheduled_send_channel: 'telegram',
        sent_to_chat_channel: 'web',
      }),
    );

    await submitForm();

    expect(fixture.nativeElement.textContent).toContain('Дополнительная ссылка подтверждения не требуется');
    expect(fixture.nativeElement.textContent).not.toContain('Ссылка');
    expect(fixture.nativeElement.textContent).not.toContain('автоматически');
    expect(fixture.nativeElement.textContent).not.toContain('в 09:00');
  });

  it('prefills the phone from the chat and forwards conversationId to prepare', async () => {
    const dialogFixture = TestBed.createComponent(InPersonStudentVerificationComponent);
    Object.defineProperty(dialogFixture.componentInstance, 'prefillPhone', {
      configurable: true,
      value: () => '79001234567',
    });
    Object.defineProperty(dialogFixture.componentInstance, 'conversationId', {
      configurable: true,
      value: () => 'conv-42',
    });
    dialogFixture.detectChanges();
    await dialogFixture.whenStable();
    dialogFixture.detectChanges();

    const phoneInput = dialogFixture.nativeElement.querySelector('[name="phone"]') as HTMLInputElement;
    expect(phoneInput.value).toBe('+7 (900) 123-45-67');

    const setInput = (name: string, value: string): void => {
      const input = dialogFixture.nativeElement.querySelector(`[name="${name}"]`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setInput('institutionName', 'РИНХ');
    setInput('documentExpiresAt', '2027-06-30');

    (dialogFixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    dialogFixture.detectChanges();
    await dialogFixture.whenStable();

    expect(service.prepareInPerson).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-42', phone: '+7 (900) 123-45-67' }),
    );
  });

  async function submitForm(): Promise<void> {
    setValue('phone', '+7 (900) 123-45-67');
    setValue('institutionName', 'РИНХ');
    setValue('documentExpiresAt', '2027-06-30');

    button('submit')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function setValue(name: string, value: string): void {
    const input = fixture.nativeElement.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    input!.value = value;
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function button(type: string): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(`button[type="${type}"]`);
  }
});
