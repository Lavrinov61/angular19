import { describe, expect, it } from 'vitest';

import { profilePhoneVerifySchema } from './auth.schema.js';

describe('profilePhoneVerifySchema', () => {
  it('preserves fingerprintVisitorId for device rate limiting', () => {
    const result = profilePhoneVerifySchema.parse({
      phone: '79001234567',
      code: '1234',
      fingerprintVisitorId: 'sf_device_profile_1',
    });

    expect(result).toEqual({
      phone: '79001234567',
      code: '1234',
      fingerprintVisitorId: 'sf_device_profile_1',
    });
  });
});
