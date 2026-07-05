import { describe, expect, it } from 'vitest';

import { shouldSkipAuthLimiter } from './auth-route-policy.js';

describe('shouldSkipAuthLimiter', () => {
  it('skips public read-only auth endpoints', () => {
    expect(shouldSkipAuthLimiter('GET', '/providers')).toBe(true);
    expect(shouldSkipAuthLimiter('GET', '/me')).toBe(true);
    expect(shouldSkipAuthLimiter('GET', '/phone-check')).toBe(true);
  });

  it('skips oauth callbacks', () => {
    expect(shouldSkipAuthLimiter('GET', '/callback')).toBe(true);
    expect(shouldSkipAuthLimiter('GET', '/callback/google')).toBe(true);
  });

  it('skips phone auth endpoints with dedicated route-level limiters', () => {
    expect(shouldSkipAuthLimiter('POST', '/phone-code')).toBe(true);
    expect(shouldSkipAuthLimiter('POST', '/phone-verify')).toBe(true);
    expect(shouldSkipAuthLimiter('POST', '/profile-phone-verify')).toBe(true);
  });

  it('skips session maintenance endpoints that do not submit credentials', () => {
    expect(shouldSkipAuthLimiter('POST', '/refresh')).toBe(true);
    expect(shouldSkipAuthLimiter('POST', '/logout')).toBe(true);
  });

  it('keeps generic auth endpoints behind the shared limiter', () => {
    expect(shouldSkipAuthLimiter('POST', '/login')).toBe(false);
    expect(shouldSkipAuthLimiter('POST', '/register')).toBe(false);
    expect(shouldSkipAuthLimiter('GET', '/yandex')).toBe(false);
  });
});
