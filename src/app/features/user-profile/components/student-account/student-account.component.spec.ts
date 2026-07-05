/// <reference types="node" />

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AuthService,
  type UserProfile,
} from '../../../../core/services/auth.service';
import { CloudPaymentsService } from '../../../../core/services/cloud-payments.service';
import {
  StudentVerificationService,
  type StudentVerificationStatusPayload,
} from '../../../../core/services/student-verification.service';
import {
  SubscriptionService,
  type MySubscription,
  type PurchaseResult,
  type SubscriptionPlan,
} from '../../../../core/services/subscription.service';
import { StudentAccountComponent } from './student-account.component';

describe('StudentAccountComponent', () => {
  let fixture: ComponentFixture<StudentAccountComponent>;

  const currentUser = signal<UserProfile | null>({
    id: 'user-1',
    email: 'student@example.com',
    display_name: 'Администратор',
    role: 'client',
    phone: '79891234567',
  });

  const approvedStatus: StudentVerificationStatusPayload = {
    account: {
      id: 'student-account-1',
      user_id: 'user-1',
      status: 'verified',
      education_role: 'student',
      institution_name: 'РИНХ',
      document_number: null,
      verified_at: '2026-05-18T11:28:00.000Z',
      expires_at: '2027-12-09',
      reviewer_id: 'admin-1',
      reject_reason: null,
      revoke_reason: null,
      revoked_reason: null,
      created_at: '2026-05-18T11:28:00.000Z',
      updated_at: '2026-05-18T11:28:00.000Z',
    },
    latest_verification: {
      id: 'student-verification-1',
      account_id: 'student-account-1',
      user_id: 'user-1',
      status: 'approved',
      education_role: 'student',
      institution_name: 'РИНХ',
      document_s3_key: 'student-verifications/document.jpg',
      document_url: null,
      document_mime_type: 'image/jpeg',
      document_file_size: 1024,
      document_expires_at: '2027-12-09',
      submitted_at: '2026-05-18T11:28:00.000Z',
      reviewed_at: '2026-05-18T11:40:00.000Z',
      reviewer_id: 'admin-1',
      review_notes: null,
      rejection_reason: null,
      photo_deleted_at: null,
      retention_delete_after: null,
    },
    student_discount: null,
    discount: null,
  };

  const activeStatus: StudentVerificationStatusPayload = {
    ...approvedStatus,
    student_discount: {
      status: 'active',
      source_token: 'education_subscription',
      activated_at: '2026-05-18T12:00:00.000Z',
      expires_at: '2027-05-18T12:00:00.000Z',
      print_sheets_limit: 150,
      print_sheets_used: 0,
      print_sheets_remaining: 150,
      print_sheet_price: 3,
      max_print_fill_percent: 20,
      binding_limit: 10,
      binding_uses: 0,
      binding_remaining: 10,
    },
    discount: {
      status: 'active',
      source_token: 'education_subscription',
      activated_at: '2026-05-18T12:00:00.000Z',
      expires_at: '2027-05-18T12:00:00.000Z',
      print_sheets_limit: 150,
      print_sheets_used: 0,
      print_sheets_remaining: 150,
      print_sheet_price: 3,
      max_print_fill_percent: 20,
      binding_limit: 10,
      binding_uses: 0,
      binding_remaining: 10,
    },
  };

  // Тариф «без подписки»: подтверждён статус, source_token='education_verified',
  // sheet_price 5. Должен показывать 50% / 5 ₽ / 14 ₽ вместо подписочных 70% / 3 ₽ / 10 ₽.
  const activeVerifiedStatus: StudentVerificationStatusPayload = {
    ...approvedStatus,
    student_discount: {
      ...activeStatus.student_discount!,
      source_token: 'education_verified',
      print_sheet_price: 5,
    },
    discount: {
      ...activeStatus.discount!,
      source_token: 'education_verified',
      print_sheet_price: 5,
    },
  };

  const educationPlan: SubscriptionPlan = {
    id: 'education-plan-1',
    name: 'Образовательный доступ',
    slug: 'education-monthly-199',
    base_price: 199,
    billing_period: 'monthly',
    description: 'Месячный образовательный доступ',
    features: [],
    is_popular: false,
    icon: 'school',
    savings_label: null,
    subscriber_discount_percent: 70,
    category: 'education',
    credits_rollover_months: 0,
    usage_policy: null,
    items: [],
  };

  const purchaseResult: PurchaseResult = {
    success: true,
    subscription_id: 'subscription-1',
    plan_name: 'Образовательный доступ',
    amount: 199,
    billing_period: 'monthly',
    phone: '79891234567',
    email: 'student@example.com',
  };

  const authServiceStub = {
    currentUser,
    isLoading: signal(false),
  } satisfies Pick<AuthService, 'currentUser' | 'isLoading'>;

  const studentVerificationServiceStub = {
    loadMine: vi.fn(() => of(approvedStatus)),
  } satisfies Pick<StudentVerificationService, 'loadMine'>;

  const subscriptionServiceStub = {
    ensureLoaded: vi.fn(() => undefined),
    loadPlans: vi.fn(() => of({ success: true, plans: [educationPlan] })),
    purchase: vi.fn(() => of(purchaseResult)),
    loadMySubscription: vi.fn(() => undefined),
    subscriptions: signal<MySubscription[]>([]),
  } satisfies Pick<
    SubscriptionService,
    'ensureLoaded' | 'loadPlans' | 'purchase' | 'loadMySubscription' | 'subscriptions'
  >;

  const cloudPaymentsServiceStub = {
    subscribe: vi.fn(() =>
      Promise.resolve({ success: true, transactionId: 123 }),
    ),
    confirmSubscriptionPayment: vi.fn(() =>
      Promise.resolve({ success: true, status: 'confirmed' }),
    ),
  } satisfies Pick<
    CloudPaymentsService,
    'subscribe' | 'confirmSubscriptionPayment'
  >;

  beforeEach(async () => {
    vi.clearAllMocks();
    studentVerificationServiceStub.loadMine.mockReturnValue(of(approvedStatus));
    subscriptionServiceStub.loadPlans.mockReturnValue(
      of({ success: true, plans: [educationPlan] }),
    );
    subscriptionServiceStub.purchase.mockReturnValue(of(purchaseResult));
    cloudPaymentsServiceStub.subscribe.mockResolvedValue({
      success: true,
      transactionId: 123,
    });
    cloudPaymentsServiceStub.confirmSubscriptionPayment.mockResolvedValue({
      success: true,
      status: 'confirmed',
    });

    await TestBed.configureTestingModule({
      imports: [StudentAccountComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceStub },
        {
          provide: StudentVerificationService,
          useValue: studentVerificationServiceStub,
        },
        { provide: SubscriptionService, useValue: subscriptionServiceStub },
        { provide: CloudPaymentsService, useValue: cloudPaymentsServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentAccountComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('surfaces the approved education status and payment action in the main column', () => {
    const element = fixture.nativeElement as HTMLElement;
    const callout = element.querySelector('.student-access-callout');
    const educationCardAction = element.querySelector(
      '.student-account-card--education .student-account-card__action--primary',
    );

    expect(callout).not.toBeNull();
    expect(callout?.textContent).toContain('Одобрен, ждёт оплаты');
    expect(callout?.textContent).toContain('Оплатить 199 ₽ / мес');
    expect(educationCardAction).toBeInstanceOf(HTMLButtonElement);
    expect(educationCardAction?.textContent).toContain('Оплатить 199 ₽ / мес');
    expect(
      element.querySelector('.student-account-card--education')?.textContent,
    ).not.toContain('Проверить статус');
  });

  it('does not create duplicate payment attempts while payment is opening', () => {
    const purchaseSubject = new Subject<PurchaseResult>();
    subscriptionServiceStub.purchase.mockReturnValue(
      purchaseSubject.asObservable(),
    );

    const element = fixture.nativeElement as HTMLElement;
    const payButton = element.querySelector(
      '.student-access-callout__button',
    ) as HTMLButtonElement | null;

    payButton?.click();
    payButton?.click();

    expect(subscriptionServiceStub.purchase).toHaveBeenCalledTimes(1);

    purchaseSubject.next(purchaseResult);
    purchaseSubject.complete();
  });

  it('shows payment errors directly under the payment callout', async () => {
    cloudPaymentsServiceStub.subscribe.mockResolvedValue({
      success: false,
      error: 'CloudPayments недоступен',
    });

    const element = fixture.nativeElement as HTMLElement;
    const payButton = element.querySelector(
      '.student-access-callout__button',
    ) as HTMLButtonElement | null;

    payButton?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const callout = element.querySelector('.student-access-callout');
    const message = callout?.nextElementSibling;

    expect(message?.classList.contains('student-message--error')).toBe(true);
    expect(message?.textContent).toContain('CloudPayments недоступен');
  });

  it('confirms the paid education subscription and refreshes the active status', async () => {
    studentVerificationServiceStub.loadMine.mockReturnValue(of(activeStatus));

    const element = fixture.nativeElement as HTMLElement;
    const payButton = element.querySelector(
      '.student-access-callout__button',
    ) as HTMLButtonElement | null;

    payButton?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      cloudPaymentsServiceStub.confirmSubscriptionPayment,
    ).toHaveBeenCalledWith('subscription-1', 123);
    expect(subscriptionServiceStub.loadMySubscription).toHaveBeenCalled();
    expect(element.querySelector('.student-access-callout')?.textContent).toContain(
      'Образовательные цены включены',
    );
    expect(element.textContent).toContain('Образовательный доступ подключен');
  });

  it('renders the verified-only (no-subscription) tier as 50% / 5 ₽ / 14 ₽', async () => {
    studentVerificationServiceStub.loadMine.mockReturnValue(of(activeVerifiedStatus));

    const verifiedFixture = TestBed.createComponent(StudentAccountComponent);
    verifiedFixture.detectChanges();
    await verifiedFixture.whenStable();
    verifiedFixture.detectChanges();

    const metrics = (verifiedFixture.nativeElement as HTMLElement).querySelector(
      '.student-metrics',
    );
    expect(metrics).not.toBeNull();
    expect(metrics?.textContent).toContain('50%');
    expect(metrics?.textContent).toContain('5 ₽');
    expect(metrics?.textContent).toContain('14 ₽');
    // Подписочные цифры НЕ должны протекать в тариф «без подписки».
    expect(metrics?.textContent).not.toContain('70%');
  });
});
