import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { FingerprintService } from './fingerprint.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;
  let fingerprintVisitorId: string | null;

  beforeEach(() => {
    localStorage.clear();
    fingerprintVisitorId = null;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: FingerprintService, useValue: { visitorId: () => fingerprintVisitorId } },
      ],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('isAuthenticated is false initially', () => {
      expect(service.isAuthenticated()).toBe(false);
    });

    it('currentUser is null initially', () => {
      expect(service.currentUser()).toBeNull();
    });

    it('permissions is empty initially', () => {
      expect(service.permissions()).toEqual([]);
    });
  });

  describe('hasPermission', () => {
    it('returns false when permissions are empty', () => {
      expect(service.hasPermission('inbox:view')).toBe(false);
    });

    it('returns true after permissions are loaded from API', () => {
      localStorage.setItem('access_token', 'test-jwt');
      service.initializeAuth();

      const req = httpMock.expectOne('/api/auth/me');
      req.flush({
        success: true,
        data: {
          id: 'u1',
          email: 'employee@test.com',
          role: 'employee',
          display_name: 'Employee',
          permissions: ['inbox:view', 'inbox:manage', 'settings:manage'],
        },
      });

      // Background provider loading
      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));

      expect(service.hasPermission('inbox:view')).toBe(true);
      expect(service.hasPermission('settings:manage')).toBe(true);
      expect(service.hasPermission('nonexistent:perm')).toBe(false);
    });

    it('lets employee roles open student verification even when the permission list is stale', () => {
      localStorage.setItem('access_token', 'test-jwt');
      service.initializeAuth();

      const req = httpMock.expectOne('/api/auth/me');
      req.flush({
        success: true,
        data: {
          id: 'u1',
          email: 'employee@test.com',
          role: 'employee',
          display_name: 'Employee',
          permissions: ['inbox:view'],
        },
      });

      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));

      expect(service.hasPermission('students:verify')).toBe(true);
      expect(service.hasPermission('settings:manage')).toBe(false);
    });
  });

  describe('initializeAuth', () => {
    it('sets isLoading to false when no token exists', async () => {
      await service.initializeAuth();
      expect(service.isLoading()).toBe(false);
      expect(service.isAuthenticated()).toBe(false);
      httpMock.expectNone('/api/auth/refresh');
      httpMock.expectNone('/api/auth/me');
    });

    it('loads user profile when token exists', async () => {
      localStorage.setItem('access_token', 'valid-jwt');
      const promise = service.initializeAuth();

      const req = httpMock.expectOne('/api/auth/me');
      req.flush({
        success: true,
        data: {
          id: 'u1',
          email: 'test@test.com',
          role: 'employee',
          display_name: 'Test User',
          permissions: ['inbox:view', 'chat:reply'],
        },
      });

      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));

      await promise;

      expect(service.isAuthenticated()).toBe(true);
      expect(service.currentUser()?.email).toBe('test@test.com');
      expect(service.userRole()).toBe('employee');
      expect(service.permissions()).toEqual(['inbox:view', 'chat:reply']);
      expect(service.isLoading()).toBe(false);
    });

    it('refreshes and loads user profile when only refresh session exists', async () => {
      localStorage.setItem('refresh_token', 'saved-refresh');
      const promise = service.initializeAuth();

      const refreshReq = httpMock.expectOne('/api/auth/refresh');
      expect(refreshReq.request.method).toBe('POST');
      expect(refreshReq.request.withCredentials).toBe(true);
      expect(refreshReq.request.body).toEqual({ refreshToken: 'saved-refresh' });
      refreshReq.flush({
        success: true,
        data: {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
        },
      });

      const profileReq = httpMock.expectOne('/api/auth/me');
      profileReq.flush({
        success: true,
        data: {
          id: 'u5',
          email: 'returning@test.com',
          role: 'client',
          display_name: 'Returning Client',
          permissions: ['orders:view'],
        },
      });

      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));

      await promise;

      expect(service.isAuthenticated()).toBe(true);
      expect(service.currentUser()?.email).toBe('returning@test.com');
      expect(service.permissions()).toEqual(['orders:view']);
      expect(localStorage.getItem('access_token')).toBe('new-access');
      expect(localStorage.getItem('refresh_token')).toBe('new-refresh');
      expect(service.isLoading()).toBe(false);
    });

    it('clears stale refresh session without redirecting during initial restore', async () => {
      localStorage.setItem('refresh_token', 'stale-refresh');
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const promise = service.initializeAuth();

      const refreshReq = httpMock.expectOne('/api/auth/refresh');
      refreshReq.flush(
        { success: false, error: 'Invalid or expired refresh token' },
        { status: 401, statusText: 'Unauthorized' },
      );

      await promise;

      expect(service.isAuthenticated()).toBe(false);
      expect(service.currentUser()).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
      expect(service.isLoading()).toBe(false);
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('clears tokens and sets null user when profile load fails', async () => {
      localStorage.setItem('access_token', 'expired-jwt');
      const promise = service.initializeAuth();

      const req = httpMock.expectOne('/api/auth/me');
      req.flush({ success: false, error: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));

      await promise;

      expect(service.isAuthenticated()).toBe(false);
      expect(service.currentUser()).toBeNull();
      expect(localStorage.getItem('access_token')).toBeNull();
    });
  });

  describe('logout', () => {
    it('clears user, permissions, and tokens', () => {
      localStorage.setItem('access_token', 'test-jwt');
      localStorage.setItem('refresh_token', 'test-refresh');

      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      service.logout().subscribe();

      const req = httpMock.expectOne('/api/auth/logout');
      req.flush({ success: true });

      expect(service.isAuthenticated()).toBe(false);
      expect(service.currentUser()).toBeNull();
      expect(service.permissions()).toEqual([]);
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
      expect(navigateSpy).toHaveBeenCalledWith(['/auth/login']);
    });

    it('clears state even when logout API fails', () => {
      localStorage.setItem('access_token', 'test-jwt');
      localStorage.setItem('refresh_token', 'test-refresh');
      vi.spyOn(router, 'navigate').mockResolvedValue(true);

      service.logout().subscribe();

      const req = httpMock.expectOne('/api/auth/logout');
      req.flush({ error: 'Server error' }, { status: 500, statusText: 'Internal Server Error' });

      expect(service.isAuthenticated()).toBe(false);
      expect(localStorage.getItem('access_token')).toBeNull();
    });
  });

  describe('computed signals', () => {
    it('isAdmin is true only for admin role', async () => {
      localStorage.setItem('access_token', 'jwt');
      const promise = service.initializeAuth();

      httpMock.expectOne('/api/auth/me').flush({
        success: true,
        data: { id: 'u1', email: 'a@b.c', role: 'admin', permissions: [] },
      });
      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));
      await promise;

      expect(service.isAdmin()).toBe(true);
    });

    it('isAdmin is false for non-admin', async () => {
      localStorage.setItem('access_token', 'jwt');
      const promise = service.initializeAuth();

      httpMock.expectOne('/api/auth/me').flush({
        success: true,
        data: { id: 'u2', email: 'e@f.g', role: 'employee', permissions: [] },
      });
      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));
      await promise;

      expect(service.isAdmin()).toBe(false);
    });

    it('treats a saved phone as verified even when the legacy flag is false', async () => {
      localStorage.setItem('access_token', 'jwt');
      const promise = service.initializeAuth();

      httpMock.expectOne('/api/auth/me').flush({
        success: true,
        data: {
          id: 'u3',
          email: 'client@test.com',
          role: 'client',
          display_name: 'Client',
          phone: '79890000000',
          phone_verified: false,
          email_verified: false,
          permissions: [],
        },
      });
      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));
      await promise;

      expect(service.isPhoneVerified()).toBe(true);
      expect(service.currentUser()?.phoneVerified).toBe(true);
      expect(service.currentUser()?.phone_verified).toBe(true);
      expect(service.canAccessPrivateContent()).toBe(true);
    });

    it('does not treat the legacy phone flag as enough when no phone is saved', async () => {
      localStorage.setItem('access_token', 'jwt');
      const promise = service.initializeAuth();

      httpMock.expectOne('/api/auth/me').flush({
        success: true,
        data: {
          id: 'u4',
          email: 'client2@test.com',
          role: 'client',
          display_name: 'Client',
          phone_verified: true,
          email_verified: false,
          permissions: [],
        },
      });
      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));
      await promise;

      expect(service.isPhoneVerified()).toBe(false);
      expect(service.currentUser()?.phoneVerified).toBe(false);
      expect(service.requiredProfileFields().phone).toBe(true);
      expect(service.canAccessPrivateContent()).toBe(false);
    });
  });

  describe('complete profile requirements', () => {
    it('requires display name and saved phone for profile completion', () => {
      expect(service.getRequiredProfileFields({
        id: 'u1',
        email: 'client@test.com',
        role: 'client',
      })).toEqual({ displayName: true, phone: true });

      expect(service.getRequiredProfileFields({
        id: 'u1',
        email: 'client@test.com',
        role: 'client',
        display_name: 'Client',
        phone: '79990000000',
      })).toEqual({ displayName: false, phone: false });
    });

    it('lets authenticated non-phone users continue when the verification call does not arrive', async () => {
      localStorage.setItem('access_token', 'jwt');
      const promise = service.initializeAuth();

      httpMock.expectOne('/api/auth/me').flush({
        success: true,
        data: {
          id: 'u5',
          email: 'client5@test.com',
          role: 'client',
          display_name: 'Client',
          email_verified: true,
          permissions: [],
        },
      });
      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));
      await promise;

      expect(service.isPhoneVerified()).toBe(false);
      expect(service.requiredProfileFields().phone).toBe(true);
      expect(service.canSkipPhoneRequirement()).toBe(true);

      const skipPromise = firstValueFrom(service.skipPhoneRequirement('79990000000'));
      const skipReq = httpMock.expectOne('/api/users/me/phone-requirement-skip');
      expect(skipReq.request.method).toBe('POST');
      expect(skipReq.request.body).toEqual({ attemptedPhone: '79990000000' });
      skipReq.flush({
        success: true,
        data: {
          id: 'u5',
          email: 'client5@test.com',
          role: 'client',
          display_name: 'Client',
          email_verified: true,
          preferences: { phoneRequirementSkippedAt: '2026-05-16T10:00:00.000Z' },
        },
      });

      await expect(skipPromise).resolves.toBe(true);

      expect(service.isPhoneVerified()).toBe(false);
      expect(service.hasSkippedPhoneRequirement()).toBe(true);
      expect(service.requiredProfileFields().phone).toBe(false);
      expect(service.requiresProfileCompletion()).toBe(false);
    });

    it('can force the phone step even after the phone requirement was skipped', async () => {
      localStorage.setItem('access_token', 'jwt');
      const promise = service.initializeAuth();

      httpMock.expectOne('/api/auth/me').flush({
        success: true,
        data: {
          id: 'u6',
          email: 'client6@test.com',
          role: 'client',
          display_name: 'Client',
          permissions: [],
        },
      });
      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));
      await promise;

      const skipPromise = firstValueFrom(service.skipPhoneRequirement());
      const skipReq = httpMock.expectOne('/api/users/me/phone-requirement-skip');
      expect(skipReq.request.method).toBe('POST');
      expect(skipReq.request.body).toEqual({});
      skipReq.flush({
        success: true,
        data: {
          id: 'u6',
          email: 'client6@test.com',
          role: 'client',
          display_name: 'Client',
          preferences: { phoneRequirementSkippedAt: '2026-05-16T10:00:00.000Z' },
        },
      });

      await expect(skipPromise).resolves.toBe(true);

      expect(service.getRequiredProfileFields().phone).toBe(false);
      expect(service.getRequiredProfileFields(undefined, { forcePhone: true }).phone).toBe(true);
    });

    it('uses server-persisted phone requirement skip from the loaded profile', async () => {
      localStorage.setItem('access_token', 'jwt');
      const promise = service.initializeAuth();

      httpMock.expectOne('/api/auth/me').flush({
        success: true,
        data: {
          id: 'u7',
          email: 'client7@test.com',
          role: 'client',
          display_name: 'Client',
          permissions: [],
          preferences: { phoneRequirementSkippedAt: '2026-05-16T10:00:00.000Z' },
        },
      });
      httpMock.match('/api/auth/providers').forEach(r => r.flush({ success: true, data: [] }));
      await promise;

      expect(service.isPhoneVerified()).toBe(false);
      expect(service.hasSkippedPhoneRequirement()).toBe(true);
      expect(service.requiredProfileFields().phone).toBe(false);
    });

    it('keeps complete-profile return URLs internal and non-recursive', () => {
      expect(service.getProfileCompletionRedirectUrl('/user-profile/orders'))
        .toBe('/auth/complete-profile?returnUrl=%2Fuser-profile%2Forders');
      expect(service.getProfileCompletionRedirectUrl('https://example.com/profile'))
        .toBe('/auth/complete-profile?returnUrl=%2F');
      expect(service.getProfileCompletionRedirectUrl('/auth/complete-profile?returnUrl=/user-profile'))
        .toBe('/auth/complete-profile?returnUrl=%2F');
      expect(service.getProfileCompletionRedirectUrl('/auth/phone-verification?returnUrl=/user-profile'))
        .toBe('/auth/complete-profile?returnUrl=%2F');
    });

    it('passes fingerprint visitor id when verifying profile phone', () => {
      fingerprintVisitorId = 'sf_test_visitor';

      service.verifyProfilePhoneCode('79990000000', '1234').subscribe();

      const req = httpMock.expectOne('/api/auth/profile-phone-verify');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        phone: '79990000000',
        code: '1234',
        fingerprintVisitorId: 'sf_test_visitor',
      });

      req.flush({ success: true });
    });

    it('shows phone code API errors to callers', async () => {
      const promise = firstValueFrom(service.requestPhoneCode('79990000000'));

      const req = httpMock.expectOne('/api/auth/phone-code');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.phone).toBe('79990000000');

      req.flush({ success: false, error: 'Телефон временно недоступен' });

      await expect(promise).rejects.toThrow('Телефон временно недоступен');
    });
  });

  describe('loadAvailableProviders', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('deduplicates concurrent provider requests', async () => {
      const first = firstValueFrom(service.loadAvailableProviders());
      const second = firstValueFrom(service.loadAvailableProviders());

      const requests = httpMock.match('/api/auth/providers');
      expect(requests.length).toBe(1);

      requests[0].flush({
        success: true,
        data: [{ id: 'google', name: 'Google', url: '/api/auth/google' }],
        phoneAuth: {
          available: true,
          providers: ['voice_call'],
          captcha: {
            required: false,
            provider: null,
            challengeUrl: null,
          },
        },
      });

      await expect(first).resolves.toEqual([{ id: 'google', name: 'Google', url: '/api/auth/google' }]);
      await expect(second).resolves.toEqual([{ id: 'google', name: 'Google', url: '/api/auth/google' }]);
      expect(service.availableProviders()).toEqual([{ id: 'google', name: 'Google', url: '/api/auth/google' }]);
      expect(service.phoneAuthAvailable()).toBe(true);
    });

    it('refreshes cached providers after ttl expiry', async () => {
      vi.useFakeTimers();

      const first = firstValueFrom(service.loadAvailableProviders());
      httpMock.expectOne('/api/auth/providers').flush({
        success: true,
        data: [],
        phoneAuth: {
          available: true,
          providers: ['voice_call'],
          captcha: {
            required: false,
            provider: null,
            challengeUrl: null,
          },
        },
      });
      await first;

      const cached = firstValueFrom(service.loadAvailableProviders());
      httpMock.expectNone('/api/auth/providers');
      await expect(cached).resolves.toEqual([]);
      expect(service.phoneAuthAvailable()).toBe(true);

      vi.advanceTimersByTime(30_001);

      const refreshed = firstValueFrom(service.loadAvailableProviders());
      httpMock.expectOne('/api/auth/providers').flush({
        success: true,
        data: [],
        phoneAuth: {
          available: false,
          providers: ['voice_call'],
          captcha: {
            required: false,
            provider: null,
            challengeUrl: null,
          },
        },
      });
      await refreshed;

      expect(service.phoneAuthAvailable()).toBe(false);
      expect(service.phoneAuthProviders()).toEqual(['voice_call']);
    });
  });
});
