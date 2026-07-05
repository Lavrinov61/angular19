import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';
import { CloudPaymentsService } from './cloud-payments.service';
import { PricingApiService } from './pricing-api.service';

type CloudPaymentsStartParams = Record<string, unknown>;
type FetchInitWithBody = RequestInit & { body?: string };

function readFetchBody(call: unknown[]): unknown {
  const init = call[1] as FetchInitWithBody | undefined;
  return init?.body ? JSON.parse(init.body) as unknown : null;
}

describe('CloudPaymentsService', () => {
  let service: CloudPaymentsService;
  let startParams: CloudPaymentsStartParams | null;

  beforeEach(() => {
    startParams = null;

    class FakeCloudPaymentsWidget {
      start(params: CloudPaymentsStartParams): Promise<{
        data: { transactionId: number };
      }> {
        startParams = params;
        return Promise.resolve({ data: { transactionId: 12345 } });
      }
    }

    Reflect.set(globalThis, 'cp', {
      CloudPayments: FakeCloudPaymentsWidget,
    });

    TestBed.configureTestingModule({
      providers: [
        CloudPaymentsService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: PricingApiService, useValue: {} },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => true,
            getAuthToken: () => Promise.resolve('test-jwt'),
          },
        },
      ],
    });

    service = TestBed.inject(CloudPaymentsService);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'cp');
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('opens monthly education access as monthly recurrent auto-renewal', async () => {
    const result = await service.subscribe({
      subscriptionId: 'education-subscription-1',
      planName: 'Образовательный доступ',
      amount: 199,
      billingPeriod: 'monthly',
      email: 'student@example.com',
      phone: '79001234567',
    });

    expect(result).toEqual({ success: true, transactionId: 12345 });
    expect(startParams).not.toBeNull();
    expect(startParams?.['amount']).toBe(199);
    expect(startParams?.['description']).toContain('автопродлением');
    expect(startParams?.['retryPayment']).toBe(true);
    expect(startParams?.['tokenize']).toBe(true);
    expect(startParams?.['metadata']).toMatchObject({
      subscriptionId: 'education-subscription-1',
      planName: 'Образовательный доступ',
      type: 'subscription',
    });
    expect(startParams?.['recurrent']).toMatchObject({
      interval: 'Month',
      period: 1,
      amount: 199,
    });
  });

  it('asks the backend to confirm a subscription widget payment', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        status: 'confirmed',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.confirmSubscriptionPayment(
      'education-subscription-1',
      12345,
      1,
      0,
    );

    expect(result).toEqual({ success: true, status: 'confirmed' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/payments/confirm-subscription-from-widget',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-jwt',
        },
      }),
    );
    expect(readFetchBody(fetchMock.mock.calls[0] ?? [])).toEqual({
      subscriptionId: 'education-subscription-1',
      transactionId: 12345,
    });
  });
});
