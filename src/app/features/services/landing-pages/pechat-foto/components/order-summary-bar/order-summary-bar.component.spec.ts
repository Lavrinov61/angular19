import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';

import { SubscriptionService } from '../../../../../../core/services/subscription.service';
import { PhotoPrintStoreService, type PrintOrderResult, type PrintContactInfo } from '../../services/photo-print-store.service';
import { OrderSummaryBarComponent } from './order-summary-bar.component';

const CONTACT_DRAFT_STORAGE_KEY = 'sf_photo_print_contact_draft';

class PhotoPrintStoreStub {
  readonly updateContact = vi.fn<(updates: Partial<PrintContactInfo>) => void>();
  readonly ensurePickupLocationsLoaded = vi.fn<() => Promise<void>>().mockResolvedValue();
  readonly allUploaded = vi.fn<() => boolean>().mockReturnValue(true);
  readonly selectedPickupLocation = vi.fn<() => { id: string } | null>().mockReturnValue({ id: 'soborny' });
  readonly submitOrder = vi.fn<() => Observable<PrintOrderResult>>().mockReturnValue(of({ success: true }));
  readonly clearOrder = vi.fn<() => void>();
}

class SubscriptionServiceStub {
  readonly currentSubscription = signal(null);
  readonly ensureLoaded = vi.fn<() => void>();
  readonly totalRemainingCredits = vi.fn<() => number>().mockReturnValue(0);
  readonly loadMySubscription = vi.fn<() => void>();
}

describe('OrderSummaryBarComponent', () => {
  let fixture: ComponentFixture<OrderSummaryBarComponent>;
  let component: OrderSummaryBarComponent;
  let store: PhotoPrintStoreStub;

  beforeEach(async () => {
    window.localStorage.removeItem(CONTACT_DRAFT_STORAGE_KEY);
    store = new PhotoPrintStoreStub();

    await TestBed.configureTestingModule({
      imports: [OrderSummaryBarComponent],
      providers: [
        provideRouter([]),
        { provide: PhotoPrintStoreService, useValue: store },
        { provide: SubscriptionService, useClass: SubscriptionServiceStub },
      ],
    })
      .overrideComponent(OrderSummaryBarComponent, {
        set: { template: '' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(OrderSummaryBarComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    window.localStorage.removeItem(CONTACT_DRAFT_STORAGE_KEY);
  });

  it('restores public contact draft without requiring authorization state', () => {
    window.localStorage.setItem(CONTACT_DRAFT_STORAGE_KEY, JSON.stringify({
      name: 'Анна',
      phone: '+7 900 111-22-33',
    }));

    fixture.detectChanges();

    expect(component.contactForm.getRawValue().name).toBe('Анна');
    expect(component.contactForm.getRawValue().phone).toBe('+7 900 111-22-33');
    expect(store.updateContact).toHaveBeenCalledWith({
      name: 'Анна',
      phone: '+7 900 111-22-33',
    });
  });

  it('saves contact draft when guest order is submitted', () => {
    fixture.detectChanges();
    component.contactForm.setValue({
      name: 'Иван',
      phone: '+7 900 000-00-00',
      email: '',
      comments: '',
    });

    component.submitOrder();

    expect(store.submitOrder).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(CONTACT_DRAFT_STORAGE_KEY)).toBe(JSON.stringify({
      name: 'Иван',
      phone: '+7 900 000-00-00',
      email: '',
      comments: '',
    }));
  });
});
