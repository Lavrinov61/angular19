import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { StudentVerificationService } from './student-verification.service';

describe('StudentVerificationService', () => {
  let service: StudentVerificationService;
  let httpMock: HttpTestingController;

  const discount = {
    status: 'active',
    source_token: 'education_subscription',
    activated_at: '2026-04-01T09:00:00.000Z',
    expires_at: '2027-04-01T20:59:59.000Z',
    print_sheets_limit: 500,
    print_sheets_used: 7,
    print_sheets_remaining: 93,
    print_sheet_price: 3,
    max_print_fill_percent: 100,
    allowance_period_id: 'allowance-1',
    allowance_period_start: '2026-04-01T09:00:00.000Z',
    allowance_period_end: '2026-05-01T09:00:00.000Z',
    binding_limit: 1,
    binding_uses: 0,
    binding_remaining: 1,
  };

  const backendVerification = {
    id: 'verification-1',
    account_id: 'account-1',
    user_id: 'user-1',
    status: 'pending',
    education_role: 'teacher',
    institution_name: 'МГУ',
    document_expires_at: '2027-04-01',
    document_photo_key: 'student-verifications/user-1/card.jpg',
    document_url: 'https://storage.example/card.jpg',
    document_photo_content_type: 'image/jpeg',
    document_photo_size_bytes: '12345',
    submitted_at: '2026-04-02T09:00:00.000Z',
    reviewed_at: null,
    reviewer_id: null,
    review_notes: null,
    reject_reason: null,
    photo_deleted_at: null,
    retention_delete_after: '2027-10-01T00:00:00.000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(StudentVerificationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('maps my verification status from the backend contract', async () => {
    const resultPromise = firstValueFrom(service.loadMine());
    const req = httpMock.expectOne('/api/student-verifications/me');

    req.flush({
      success: true,
      data: {
        account: {
          id: 'account-1',
          user_id: 'user-1',
          status: 'verified',
          education_role: 'teacher',
          institution_name: 'МГУ',
          document_number: null,
          verified_at: '2026-04-03T09:00:00.000Z',
          expires_at: '2027-04-01T20:59:59.000Z',
          reviewer_id: 'reviewer-1',
          reject_reason: null,
          revoke_reason: null,
          created_at: '2026-04-02T09:00:00.000Z',
          updated_at: '2026-04-03T09:00:00.000Z',
        },
        latest_verification: backendVerification,
        student_discount: discount,
      },
    });

    const result = await resultPromise;

    expect(result.account?.status).toBe('verified');
    expect(result.account?.education_role).toBe('teacher');
    expect(result.latest_verification?.education_role).toBe('teacher');
    expect(result.latest_verification?.document_s3_key).toBe('student-verifications/user-1/card.jpg');
    expect(result.latest_verification?.document_mime_type).toBe('image/jpeg');
    expect(result.latest_verification?.document_file_size).toBe(12345);
    expect(result.student_discount?.print_sheets_remaining).toBe(93);
    expect(result.discount?.print_sheets_remaining).toBe(93);
  });

  it('maps the admin queue items from data.items', async () => {
    const resultPromise = firstValueFrom(service.listAdmin('pending', 25));
    const req = httpMock.expectOne(request =>
      request.url === '/api/student-verifications/admin'
      && request.params.get('status') === 'pending'
      && request.params.get('limit') === '25',
    );

    req.flush({
      success: true,
      data: {
        items: [
          {
            ...backendVerification,
            account_status: 'pending',
            account_expires_at: '2027-04-01T20:59:59.000Z',
            user_email: 'student@example.com',
            user_phone: '+79990000000',
            user_display_name: 'Student',
          },
        ],
      },
    });

    const result = await resultPromise;

    expect(result.length).toBe(1);
    expect(result[0]?.education_role).toBe('teacher');
    expect(result[0]?.document_s3_key).toBe('student-verifications/user-1/card.jpg');
    expect(result[0]?.expires_at).toBe('2027-04-01T20:59:59.000Z');
    expect(result[0]?.user_phone).toBe('+79990000000');
  });

  it('posts the approve payload expected by the backend contract', async () => {
    const resultPromise = firstValueFrom(service.approve('verification-1', { expiresAt: '2027-04-01' }));
    const req = httpMock.expectOne('/api/student-verifications/admin/verification-1/approve');

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      expires_at: '2027-04-01',
      review_notes: null,
    });

    req.flush({
      success: true,
      data: {
        account: null,
        latest_verification: {
          ...backendVerification,
          status: 'approved',
        },
        student_discount: discount,
      },
    });

    const result = await resultPromise;

    expect(result.latest_verification?.status).toBe('approved');
  });

  it('posts the education role when completing an upload', async () => {
    const file = new File(['document'], 'card.jpg', { type: 'image/jpeg' });
    const resultPromise = firstValueFrom(service.completeUpload({
      upload: {
        s3Key: 'student-verifications/user-1/card.jpg',
        uploadUrl: 'https://storage.example/upload',
        contentType: 'image/jpeg',
      },
      file,
      educationRole: 'teacher',
      institutionName: 'МГУ',
      documentExpiresAt: '2027-04-01',
    }));
    const req = httpMock.expectOne('/api/student-verifications/uploads/complete');

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      files: [
        {
          s3Key: 'student-verifications/user-1/card.jpg',
          fileName: 'card.jpg',
          contentType: 'image/jpeg',
          fileSize: 8,
        },
      ],
      education_role: 'teacher',
      institution_name: 'МГУ',
      document_expires_at: '2027-04-01',
    });

    req.flush({
      success: true,
      data: {
        account: null,
        latest_verification: backendVerification,
        student_discount: null,
      },
    });

    const result = await resultPromise;
    expect(result.latest_verification?.education_role).toBe('teacher');
  });

  it('posts the reject payload expected by the backend contract', async () => {
    const resultPromise = firstValueFrom(service.reject('verification-1', { reason: 'Фото не читается' }));
    const req = httpMock.expectOne('/api/student-verifications/admin/verification-1/reject');

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      reason: 'Фото не читается',
      review_notes: null,
    });

    req.flush({
      success: true,
      data: {
        account: null,
        latest_verification: {
          ...backendVerification,
          status: 'rejected',
          reject_reason: 'Фото не читается',
        },
        student_discount: null,
      },
    });

    const result = await resultPromise;

    expect(result.latest_verification?.status).toBe('rejected');
    expect(result.latest_verification?.rejection_reason).toBe('Фото не читается');
  });

  it('posts the in-person prepare payload expected by the backend contract', async () => {
    const resultPromise = firstValueFrom(service.prepareInPerson({
      phone: '+7 (900) 123-45-67',
      institutionName: 'РИНХ',
      educationRole: 'student',
      documentType: 'student_card',
      documentExpiresAt: '2027-06-30',
      referralChannel: 'classmate',
      referrerPhone: null,
    }));
    const req = httpMock.expectOne('/api/student-verifications/admin/in-person/prepare');

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      phone: '+7 (900) 123-45-67',
      institution_name: 'РИНХ',
      education_role: 'student',
      document_type: 'student_card',
      document_expires_at: '2027-06-30',
      referral_channel: 'classmate',
      referrer_phone: null,
      conversation_id: null,
    });

    req.flush({
      success: true,
      data: {
        verification: {
          ...backendVerification,
          account_id: null,
          user_id: 'user-1',
          status: 'pending_in_person',
          source: 'in_person',
          document_type: 'student_card',
          document_photo_key: null,
          document_photo_content_type: null,
          document_photo_size_bytes: null,
          phone_normalized: '79001234567',
        },
        matched_user: {
          id: 'user-1',
          phone: '+79001234567',
          display_name: 'Student',
          email: null,
        },
      },
    });

    const result = await resultPromise;

    expect(result.verification.status).toBe('pending_in_person');
    expect(result.verification.document_s3_key).toBeNull();
    expect(result.matched_user?.id).toBe('user-1');
    expect(result.scheduled_send_at).toBeNull();
    expect(result.scheduled_send_channel).toBeNull();
  });

  it('maps the scheduled send hint from the in-person prepare response', async () => {
    const resultPromise = firstValueFrom(service.prepareInPerson({
      phone: '+7 (900) 123-45-67',
      institutionName: 'РИНХ',
      educationRole: 'student',
      documentType: 'student_card',
      documentExpiresAt: '2027-06-30',
      referralChannel: 'classmate',
      referrerPhone: null,
    }));
    const req = httpMock.expectOne('/api/student-verifications/admin/in-person/prepare');

    req.flush({
      success: true,
      data: {
        verification: {
          ...backendVerification,
          account_id: null,
          user_id: 'user-1',
          status: 'pending_in_person',
          source: 'in_person',
          document_type: 'student_card',
          document_photo_key: null,
          document_photo_content_type: null,
          document_photo_size_bytes: null,
          phone_normalized: '79001234567',
        },
        matched_user: null,
        scheduled_send_at: '2026-06-06T06:00:00.000Z',
        scheduled_send_channel: 'telegram',
      },
    });

    const result = await resultPromise;

    expect(result.scheduled_send_at).toBe('2026-06-06T06:00:00.000Z');
    expect(result.scheduled_send_channel).toBe('telegram');
  });

  it('loads the pending in-person verification for student confirmation', async () => {
    const resultPromise = firstValueFrom(service.loadPendingInPerson());
    const req = httpMock.expectOne('/api/student-verifications/in-person/pending');

    expect(req.request.method).toBe('GET');
    req.flush({
      success: true,
      data: {
        verification: {
          ...backendVerification,
          account_id: null,
          user_id: 'user-1',
          status: 'pending_in_person',
          source: 'in_person',
          document_type: 'student_card',
          document_photo_key: null,
          document_photo_content_type: null,
          document_photo_size_bytes: null,
          phone_normalized: '79001234567',
        },
      },
    });

    const result = await resultPromise;

    expect(result?.status).toBe('pending_in_person');
    expect(result?.document_type).toBe('student_card');
  });

  it('posts the in-person confirmation consent payload', async () => {
    const resultPromise = firstValueFrom(service.confirmInPerson('verification-1', {
      consentVersion: 'student-program-v1',
      marketingConsent: false,
    }));
    const req = httpMock.expectOne('/api/student-verifications/in-person/verification-1/confirm');

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      consent_version: 'student-program-v1',
      marketing_consent: false,
    });

    req.flush({
      success: true,
      data: {
        account: null,
        latest_verification: {
          ...backendVerification,
          status: 'approved',
        },
        student_discount: discount,
      },
    });

    const result = await resultPromise;

    expect(result.latest_verification?.status).toBe('approved');
    expect(result.student_discount?.source_token).toBe('education_subscription');
  });

  it('posts the in-person consent withdrawal payload', async () => {
    const resultPromise = firstValueFrom(service.withdrawInPersonConsent('consent_withdrawn'));
    const req = httpMock.expectOne('/api/student-verifications/in-person/withdraw');

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'consent_withdrawn' });

    req.flush({
      success: true,
      data: {
        account: {
          id: 'account-1',
          user_id: 'user-1',
          status: 'revoked',
          education_role: 'student',
          institution_name: null,
          document_number: null,
          verified_at: null,
          expires_at: null,
          reviewer_id: null,
          reject_reason: null,
          revoke_reason: 'consent_withdrawn',
          created_at: '2026-04-02T09:00:00.000Z',
          updated_at: '2026-04-03T09:00:00.000Z',
        },
        latest_verification: null,
        student_discount: null,
      },
    });

    const result = await resultPromise;

    expect(result.account?.status).toBe('revoked');
    expect(result.account?.revoke_reason).toBe('consent_withdrawn');
  });
});
