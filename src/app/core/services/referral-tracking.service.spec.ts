import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReferralTrackingService } from './referral-tracking.service';

describe('ReferralTrackingService', () => {
  let service: ReferralTrackingService;

  const setUrl = (url: string): void => {
    window.history.pushState({}, '', url);
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        ReferralTrackingService,
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    service = TestBed.inject(ReferralTrackingService);
  });

  afterEach(() => {
    localStorage.clear();
    setUrl('/');
    TestBed.resetTestingModule();
  });

  it('captures promo codes on non-subscription pages and removes the query param', () => {
    setUrl('/booking?promo=SVF-GIFT-1234&service=print');

    service.captureFromUrl();

    expect(service.getPromoCode()).toBe('SVF-GIFT-1234');
    expect(window.location.pathname).toBe('/booking');
    expect(window.location.search).toBe('?service=print');
  });

  it('keeps subscription promo codes in the URL for subscription-page validation', () => {
    setUrl('/subscriptions?promo=SVF-GIFT-1234');

    service.captureFromUrl();

    expect(service.getPromoCode()).toBeNull();
    expect(window.location.pathname).toBe('/subscriptions');
    expect(window.location.search).toBe('?promo=SVF-GIFT-1234');
  });

  it('can remove referral params on subscriptions without removing the promo param', () => {
    setUrl('/subscriptions?ref=PARTNER-1&promo=SVF-GIFT-1234');

    service.captureFromUrl();

    expect(service.getPartnerCode()).toBe('PARTNER-1');
    expect(service.getPromoCode()).toBeNull();
    expect(window.location.search).toBe('?promo=SVF-GIFT-1234');
  });
});
