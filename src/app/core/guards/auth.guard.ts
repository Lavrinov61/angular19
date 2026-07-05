import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, CanActivateFn } from '@angular/router';

import { AuthService } from '../services/auth.service';

/**
 * Auth state гарантированно готов к моменту вызова guard —
 * APP_INITIALIZER дожидается initializeAuth() перед bootstrap.
 * Поэтому guard — простая синхронная проверка, без таймеров.
 */

function requireCompletedProfile(authService: AuthService, router: Router, returnUrl: string): boolean {
  if (!authService.requiresProfileCompletion()) {
    return true;
  }

  router.navigateByUrl(authService.getProfileCompletionRedirectUrl(returnUrl));
  return false;
}

export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  if (authService.isAuthenticated()) {
    return requireCompletedProfile(authService, router, state.url);
  }

  if (authService.pinUnlockRequired()) {
    router.navigate(['/auth/pin'], { queryParams: { returnUrl: state.url } });
    return false;
  }

  router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url } });
  return false;
};

export const guestGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  if (authService.pinUnlockRequired()) {
    const returnUrl = route.queryParams['returnUrl'];
    const target = typeof returnUrl === 'string' ? returnUrl : '/';
    router.navigate(['/auth/pin'], { queryParams: { returnUrl: target } });
    return false;
  }

  if (!authService.isAuthenticated()) return true;

  const returnUrl = route.queryParams['returnUrl'];
  const target = typeof returnUrl === 'string' ? returnUrl : '/dashboard';
  router.navigateByUrl(authService.getPostAuthRedirectUrl(target));
  return false;
};

export const adminGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  if (authService.isAuthenticated()) {
    if (!requireCompletedProfile(authService, router, state.url)) return false;
    return authService.isAdmin() ? true : (router.navigate(['/dashboard']), false);
  }

  if (authService.pinUnlockRequired()) {
    router.navigate(['/auth/pin'], { queryParams: { returnUrl: state.url } });
    return false;
  }

  router.navigate(['/auth/employee-login'], { queryParams: { returnUrl: state.url } });
  return false;
};

export const phoneVerifiedGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  if (authService.isAuthenticated()) {
    if (!requireCompletedProfile(authService, router, state.url)) return false;
    if (authService.isPhoneVerified() || authService.hasSkippedPhoneRequirement()) {
      return true;
    }

    router.navigateByUrl(authService.getProfileCompletionRedirectUrl(state.url));
    return false;
  }

  if (authService.pinUnlockRequired()) {
    router.navigate(['/auth/pin'], { queryParams: { returnUrl: state.url } });
    return false;
  }

  router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url } });
  return false;
};

export const roleGuard = (allowedRoles: string[]): CanActivateFn => {
  return (_route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

    if (authService.isAuthenticated()) {
      if (!requireCompletedProfile(authService, router, state.url)) return false;
      const role = authService.userRole();
      if (role && allowedRoles.includes(role)) return true;
      router.navigate(['/dashboard']);
      return false;
    }

    if (authService.pinUnlockRequired()) {
      router.navigate(['/auth/pin'], { queryParams: { returnUrl: state.url } });
      return false;
    }

    // Employee roles → employee login, clients → client login
    const isEmployeeRoute = allowedRoles.some(r => ['admin', 'manager', 'employee', 'photographer'].includes(r));
    const loginPath = isEmployeeRoute ? '/auth/employee-login' : '/auth/login';
    router.navigate([loginPath], { queryParams: { returnUrl: state.url } });
    return false;
  };
};

export const permissionGuard = (requiredPermission: string): CanActivateFn => {
  return (_route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

    if (authService.isAuthenticated()) {
      if (!requireCompletedProfile(authService, router, state.url)) return false;
      return authService.hasPermission(requiredPermission) ? true : (router.navigate(['/employee']), false);
    }

    if (authService.pinUnlockRequired()) {
      router.navigate(['/auth/pin'], { queryParams: { returnUrl: state.url } });
      return false;
    }

    router.navigate(['/auth/employee-login'], { queryParams: { returnUrl: state.url } });
    return false;
  };
};

export const photographerGuard: CanActivateFn = roleGuard(['photographer']);
export const employeeGuard: CanActivateFn = roleGuard(['admin', 'manager', 'employee', 'photographer']);
