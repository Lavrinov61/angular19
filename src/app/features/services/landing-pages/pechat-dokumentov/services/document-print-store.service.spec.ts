import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  DocumentPrintStoreService,
  type DocumentPrintFileItem,
  type PickupLocation,
} from './document-print-store.service';

describe('DocumentPrintStoreService', () => {
  let service: DocumentPrintStoreService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        DocumentPrintStoreService,
      ],
    });

    service = TestBed.inject(DocumentPrintStoreService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('creates an anonymous website order from uploaded files and print settings', () => {
    const pickup: PickupLocation = {
      id: 'soborny',
      name: 'Соборный 21',
      address: 'пер. Соборный, 21',
      status: 'open',
      statusMessage: null,
      statusUntil: null,
      workHours: 'ежедневно 9:00-19:30',
      hours: [],
    };
    const file = new File(['pdf'], 'dogovor.pdf', { type: 'application/pdf' });
    const uploadedItem: DocumentPrintFileItem = {
      id: 'doc-1',
      file,
      fileName: 'dogovor.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
      sizeLabel: '1 КБ',
      pageCount: 3,
      s3Key: 'document-print/dogovor.pdf',
      uploadedUrl: 'https://storage.example/document-print/dogovor.pdf',
      status: 'uploaded',
      uploadProgress: 100,
    };

    Reflect.get(service, '_pickupLocations').set([pickup]);
    Reflect.get(service, '_selectedPickupLocationId').set(pickup.id);
    Reflect.get(service, '_items').set([uploadedItem]);

    service.updateContact({ name: 'Иван Иванов', phone: '+7 900 123-45-67' });
    service.updatePrintSettings({
      paperSize: 'a4',
      colorMode: 'bw',
      sides: 'single',
      copies: 2,
      finishing: 'none',
    });

    let result: unknown;
    service.submitOrder().subscribe(value => {
      result = value;
    });

    const req = httpMock.expectOne('/api/orders/document-print');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.body).toEqual({
      contact: {
        name: 'Иван Иванов',
        phone: '+7 900 123-45-67',
      },
      pickupLocationId: 'soborny',
      print: {
        paperSize: 'a4',
        colorMode: 'bw',
        sides: 'single',
        copies: 2,
        finishing: 'none',
      },
      files: [
        {
          fileName: 'dogovor.pdf',
          contentType: 'application/pdf',
          fileSize: 1024,
          s3Key: 'document-print/dogovor.pdf',
          uploadedUrl: 'https://storage.example/document-print/dogovor.pdf',
          pageCount: 3,
        },
      ],
      source: 'website',
    });

    req.flush({
      success: true,
      data: {
        orderId: 'DP-TEST-001',
        totalPrice: 60,
        paymentUrl: '/pay/DP-TEST-001',
      },
    });

    expect(result).toEqual({
      success: true,
      orderId: 'DP-TEST-001',
      paymentUrl: '/pay/DP-TEST-001',
      totalPrice: 60,
      message: 'Заказ создан. Оплатите онлайн, и мы начнём печать.',
    });
    expect(service.orderId()).toBe('DP-TEST-001');
    expect(service.paymentUrl()).toBe('/pay/DP-TEST-001');
  });

  it('does not show online shifts as pickup locations', async () => {
    const pickup: PickupLocation = {
      id: 'soborny',
      name: 'Своё Фото — Соборный',
      address: 'пер. Соборный, 21',
      status: 'open',
      statusMessage: null,
      statusUntil: null,
      workHours: 'ежедневно 9:00-19:30',
      hours: [],
    };
    const onlinePickup: PickupLocation = {
      id: 'online-shift',
      name: 'Онлайн смена',
      address: '',
      status: 'open',
      statusMessage: null,
      statusUntil: null,
      workHours: 'часы работы уточните в чате',
      hours: [],
    };

    const locationsPromise = service.ensurePickupLocationsLoaded();
    const req = httpMock.expectOne('/api/studios/pickup-locations');
    req.flush({
      success: true,
      data: [pickup, onlinePickup],
    });
    await locationsPromise;

    expect(service.pickupLocations()).toEqual([pickup]);
    expect(service.selectedPickupLocationId()).toBe(pickup.id);
  });
});
