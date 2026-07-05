import { describe, expect, it } from 'vitest';

import { isTelephonyApiPath } from './telephony-api-routing';

describe('isTelephonyApiPath', () => {
  it('matches telephony route tree', () => {
    expect(isTelephonyApiPath('/api/telephony')).toBe(true);
    expect(isTelephonyApiPath('/api/telephony/calls')).toBe(true);
    expect(isTelephonyApiPath('/api/telephony/calls?limit=10')).toBe(true);
  });

  it('matches telephony-owned phone auth endpoints', () => {
    expect(isTelephonyApiPath('/api/auth/phone-check')).toBe(true);
    expect(isTelephonyApiPath('/api/auth/phone-check?phone=79001234567')).toBe(true);
    expect(isTelephonyApiPath('/api/auth/phone-code')).toBe(true);
    expect(isTelephonyApiPath('/api/auth/phone-verify')).toBe(true);
    expect(isTelephonyApiPath('/api/auth/phone-verify#retry')).toBe(true);
    expect(isTelephonyApiPath('/api/auth/profile-phone-verify')).toBe(true);
  });

  it('leaves generic api endpoints on the main api process', () => {
    expect(isTelephonyApiPath('/api/auth/providers')).toBe(false);
    expect(isTelephonyApiPath('/api/auth/login')).toBe(false);
    expect(isTelephonyApiPath('/api/orders')).toBe(false);
  });
});
