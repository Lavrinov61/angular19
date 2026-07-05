import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS,
  HttpClient,
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ServerHttpInterceptor } from './server-http.interceptor';

describe('ServerHttpInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let originalApiPort: string | undefined;
  let originalTelephonyPort: string | undefined;

  function configure(platformId: 'server' | 'browser'): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: HTTP_INTERCEPTORS, useClass: ServerHttpInterceptor, multi: true },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => {
    originalApiPort = process.env['API_PORT'];
    originalTelephonyPort = process.env['TELEPHONY_PORT'];
    process.env['API_PORT'] = '3901';
    process.env['TELEPHONY_PORT'] = '3909';
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();

    if (originalApiPort === undefined) {
      delete process.env['API_PORT'];
    } else {
      process.env['API_PORT'] = originalApiPort;
    }

    if (originalTelephonyPort === undefined) {
      delete process.env['TELEPHONY_PORT'];
    } else {
      process.env['TELEPHONY_PORT'] = originalTelephonyPort;
    }
  });

  it('rewrites generic relative API requests to the API process during SSR', () => {
    configure('server');

    http.get('/api/auth/providers').subscribe();

    const req = httpMock.expectOne('http://localhost:3901/api/auth/providers');
    expect(req.request.url).toBe('http://localhost:3901/api/auth/providers');
    req.flush({ success: true, data: [] });
  });

  it('routes telephony-owned phone auth requests with params to the telephony process during SSR', () => {
    configure('server');

    http.get('/api/auth/phone-check', { params: { phone: '79001234567' } }).subscribe();

    const req = httpMock.expectOne('http://localhost:3909/api/auth/phone-check?phone=79001234567');
    expect(req.request.url).toBe('http://localhost:3909/api/auth/phone-check');
    req.flush({ success: true, data: { available: true, provider: 'voice_call' } });
  });

  it('routes literal query phone auth URLs to the telephony process during SSR', () => {
    configure('server');

    http.get('/api/auth/phone-check?phone=79001234567').subscribe();

    const req = httpMock.expectOne('http://localhost:3909/api/auth/phone-check?phone=79001234567');
    expect(req.request.url).toBe('http://localhost:3909/api/auth/phone-check?phone=79001234567');
    req.flush({ success: true, data: { available: true, provider: 'voice_call' } });
  });

  it('does not rewrite relative API requests in the browser', () => {
    configure('browser');

    http.get('/api/auth/phone-check', { params: { phone: '79001234567' } }).subscribe();

    const req = httpMock.expectOne('/api/auth/phone-check?phone=79001234567');
    expect(req.request.url).toBe('/api/auth/phone-check');
    req.flush({ success: true, data: { available: true, provider: 'voice_call' } });
  });
});
