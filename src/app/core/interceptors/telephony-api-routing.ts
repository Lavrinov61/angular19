const TELEPHONY_OWNED_AUTH_PATHS = new Set([
  '/api/auth/phone-check',
  '/api/auth/phone-code',
  '/api/auth/phone-verify',
  '/api/auth/profile-phone-verify',
]);

export function isTelephonyApiPath(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];

  if (path === '/api/telephony' || path.startsWith('/api/telephony/')) {
    return true;
  }

  return TELEPHONY_OWNED_AUTH_PATHS.has(path);
}
