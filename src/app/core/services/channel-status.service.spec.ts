import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ChannelStatusService } from './channel-status.service';

describe('ChannelStatusService', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('defaults to available (no notice) before the response arrives', () => {
    const svc = TestBed.inject(ChannelStatusService);
    httpMock.expectOne('/api/channel-status'); // fired from constructor
    expect(svc.whatsappAvailable()).toBe(true);
    expect(svc.whatsappNotice()).toBeUndefined();
  });

  it('surfaces a notice when WhatsApp is unavailable', () => {
    const svc = TestBed.inject(ChannelStatusService);
    httpMock.expectOne('/api/channel-status').flush({ whatsapp: { available: false } });
    expect(svc.whatsappAvailable()).toBe(false);
    expect(svc.whatsappNotice()).toBe('Временно не работает');
  });

  it('stays available (no notice) when WhatsApp is up', () => {
    const svc = TestBed.inject(ChannelStatusService);
    httpMock.expectOne('/api/channel-status').flush({ whatsapp: { available: true } });
    expect(svc.whatsappAvailable()).toBe(true);
    expect(svc.whatsappNotice()).toBeUndefined();
  });

  it('fails open on a network error (no false banner)', () => {
    const svc = TestBed.inject(ChannelStatusService);
    httpMock.expectOne('/api/channel-status').error(new ProgressEvent('error'));
    expect(svc.whatsappAvailable()).toBe(true);
    expect(svc.whatsappNotice()).toBeUndefined();
  });
});
