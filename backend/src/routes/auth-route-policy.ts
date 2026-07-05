const AUTH_SAFE_GET_PATHS = new Set([
  '/providers',
  '/me',
  '/phone-check',
]);

const PHONE_AUTH_DEDICATED_LIMITER_PATHS = new Set([
  '/phone-code',
  '/phone-verify',
  '/profile-phone-verify',
]);

const SESSION_MAINTENANCE_PATHS = new Set([
  '/refresh',
  '/logout',
]);

/**
 * Phone auth owns its limiter policy at the route layer, so these endpoints
 * must not also inherit the generic /auth brute-force limiter in monolith mode.
 */
export function shouldSkipAuthLimiter(method: string, path: string): boolean {
  if (method === 'GET' && AUTH_SAFE_GET_PATHS.has(path)) {
    return true;
  }

  if (method === 'GET' && path.startsWith('/callback')) {
    return true;
  }

  if (method === 'POST' && SESSION_MAINTENANCE_PATHS.has(path)) {
    return true;
  }

  return PHONE_AUTH_DEDICATED_LIMITER_PATHS.has(path);
}
