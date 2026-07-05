import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { OfflineQueueService } from '../services/offline-queue.service';
import { authTokenInterceptor } from './auth-token.interceptor';

describe('authTokenInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  const authServiceStub = {
    getAuthToken: () => Promise.resolve('access-token-1'),
    refreshAccessToken: () => of({ accessToken: 'access-token-2', refreshToken: 'refresh-token-2' }),
  } satisfies Pick<AuthService, 'getAuthToken' | 'refreshAccessToken'>;

  const offlineQueueStub = {
    enqueue: vi.fn(),
  } satisfies Pick<OfflineQueueService, 'enqueue'>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authTokenInterceptor])),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AuthService, useValue: authServiceStub },
        { provide: OfflineQueueService, useValue: offlineQueueStub },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it('keeps Authorization on PIN setup requests so clients are not dependent on cookies', async () => {
    http.post('/api/auth/pin/setup', { pin: '1234', refreshToken: 'refresh-token-1' }).subscribe();

    await Promise.resolve();

    const req = httpMock.expectOne('/api/auth/pin/setup');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-token-1');
    req.flush({ success: true, data: { enabled: true } });
  });
});
