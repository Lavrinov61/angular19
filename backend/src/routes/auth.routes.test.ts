/**
 * Integration tests for /auth routes.
 *
 * Tests describe the CONTRACT of the auth API.
 * Failing tests = code to fix, NOT tests to adjust.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  createTestApp,
  mockDb,
  resetMockDb,
  TEST_JWT_SECRET,
  makeUser,
  makeEmployeeUser,
  authHeader,
  makeToken,
} from '../test-utils/index.js';

// ─── Module mocks (must appear before any SUT import) ─────────────────────────

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    set: vi.fn(),
  },
}));

const { mockFetchWithTimeout } = vi.hoisted(() => ({
  mockFetchWithTimeout: vi.fn(),
}));

const { mockGetStudentDiscountForUser } = vi.hoisted(() => ({
  mockGetStudentDiscountForUser: vi.fn(),
}));

vi.mock('../database/db.js', () => ({
  default: mockDb,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../config/index.js', () => ({
  config: {
    role: 'monolith',
    jwt: { secret: TEST_JWT_SECRET, secretPrevious: '', expiresIn: '15m', refreshExpiresIn: '30d' },
    cors: { origin: 'http://localhost:4200' },
    yandex: { clientId: '', clientSecret: '' },
    google: { clientId: '', clientSecret: '' },
    vk: { clientId: '', clientSecret: '' },
    sber: { clientId: '', clientSecret: '' },
    mts: { clientId: '', clientSecret: '' },
    apple: { clientId: '', clientSecret: '' },
    telegram: { gatewayToken: '' },
    voximplant: {
      voiceCall: {
        enabled: true,
        ttlSeconds: 120,
      },
    },
    mobileGrpc: {
      internalSecret: 'test-mobile-grpc-secret',
    },
  },
}));

vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
  blacklistToken: vi.fn().mockResolvedValue(undefined),
  blacklistAllUserTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/permission.service.js', () => ({
  permissionService: {
    getUserPermissions: vi.fn().mockResolvedValue([]),
    hasAllPermissions: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('../services/email.service.js', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendEmailVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendLoginAlertEmail: vi.fn().mockResolvedValue(undefined),
  sendRegistrationAttemptEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/sms.service.js', () => ({
  sendSms: vi.fn().mockResolvedValue(undefined),
  normalizePhone: vi.fn((p: string) => p),
}));

vi.mock('../services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../services/code-delivery.service.js', () => ({
  checkDeliveryChannel: vi.fn().mockResolvedValue({ available: true, provider: 'voice_call' }),
  getCachedVoiceCallProviderPreflight: vi.fn().mockResolvedValue('skipped'),
  isVoiceCallProviderAvailable: vi.fn().mockResolvedValue(true),
}));

vi.mock('../services/voice-otp-dispatcher.service.js', () => ({
  requestVoiceOtpDispatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../middleware/rate-limit-store.js', () => ({
  createRateLimitStore: vi.fn(() => undefined),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/redis-factory.js', async () => {
  const actual = await vi.importActual<typeof import('../services/redis-factory.js')>('../services/redis-factory.js');
  return {
    ...actual,
    createResilientRedis: vi.fn(() => mockRedis),
  };
});

vi.mock('../services/login-guard.service.js', () => ({
  checkAccountLockout: vi.fn().mockResolvedValue({ locked: false }),
  recordLoginAttempt: vi.fn(),
}));

vi.mock('../utils/password-validator.js', () => ({
  validatePasswordStrength: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

vi.mock('../services/oauth-link.service.js', () => ({
  createPendingLink: vi.fn().mockResolvedValue({ maskedEmail: 'u***@example.com' }),
  confirmPendingLink: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/approval-counters.service.js', () => ({
  linkApprovalSessionsByPhone: vi.fn().mockResolvedValue(0),
}));

vi.mock('../services/account-backfill.service.js', () => ({
  runPostLoginBackfill: vi.fn().mockResolvedValue({ subs: 0, contacts: 0 }),
}));

vi.mock('../services/student-discount.service.js', () => ({
  getStudentDiscountForUser: mockGetStudentDiscountForUser,
}));

vi.mock('../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}));

// ─── SUT import ───────────────────────────────────────────────────────────────

const { default: authRouter } = await import('./auth.routes.js');
const { checkAccountLockout, recordLoginAttempt } = await import('../services/login-guard.service.js');
const { validatePasswordStrength } = await import('../utils/password-validator.js');
const { linkApprovalSessionsByPhone } = await import('../services/approval-counters.service.js');
const { runPostLoginBackfill } = await import('../services/account-backfill.service.js');
const { isVoiceCallProviderAvailable } = await import('../services/code-delivery.service.js');
const { requestVoiceOtpDispatch } = await import('../services/voice-otp-dispatcher.service.js');
const { resetTelephonySplitReadinessCacheForTests } = await import('../services/telephony-split-readiness.service.js');
const { config } = await import('../config/index.js');

const app = createTestApp(authRouter, '/');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a bcrypt hash for a known password */
async function passwordHash(plain: string): Promise<string> {
  return bcrypt.hash(plain, 4); // low rounds = fast in tests
}

beforeEach(() => {
  config.role = 'monolith';
  config.mobileGrpc.internalSecret = 'test-mobile-grpc-secret';
  vi.mocked(isVoiceCallProviderAvailable).mockResolvedValue(true);
  mockGetStudentDiscountForUser.mockReset();
  mockGetStudentDiscountForUser.mockResolvedValue(null);
  resetTelephonySplitReadinessCacheForTests();
  vi.mocked(mockFetchWithTimeout).mockReset();
  vi.mocked(mockFetchWithTimeout).mockResolvedValue(
    new Response(JSON.stringify({ ready: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }) as never,
  );
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /auth/providers', () => {
  it('returns 200 with empty providers array when no OAuth is configured', async () => {
    const res = await request(app).get('/providers');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('includes phoneAuth availability info', async () => {
    const res = await request(app).get('/providers');

    expect(res.body).toHaveProperty('phoneAuth');
    expect(typeof res.body.phoneAuth.available).toBe('boolean');
    expect(res.body.phoneAuth.providers).toEqual(['voice_call']);
    expect(res.body.phoneAuth.captcha).toEqual({
      required: false,
      provider: null,
      challengeUrl: null,
    });
  });
  it('reports phone auth as unavailable when voice call config is degraded', async () => {
    vi.mocked(isVoiceCallProviderAvailable).mockResolvedValue(false);

    const res = await request(app).get('/providers');

    expect(res.status).toBe(200);
    expect(res.body.phoneAuth.available).toBe(false);
    expect(res.body.phoneAuth.providers).toEqual(['voice_call']);
  });
});

describe('Split mode phone auth routing', () => {
  it('does not expose phone auth routes from the main auth router in api role', async () => {
    config.role = 'api';

    const res = await request(app)
      .post('/phone-code')
      .send({ phone: '79001234567' });

    expect(res.status).toBe(404);
  });

  it('reports phone auth as unavailable when telephony process readiness is down', async () => {
    config.role = 'api';
    vi.mocked(mockFetchWithTimeout).mockResolvedValue(
      new Response(JSON.stringify({ ready: false }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }) as never,
    );

    const res = await request(app).get('/providers');

    expect(res.status).toBe(200);
    expect(res.body.phoneAuth.available).toBe(false);
    expect(res.body.phoneAuth.providers).toEqual(['voice_call']);
    expect(vi.mocked(mockFetchWithTimeout)).toHaveBeenCalledWith(
      'http://127.0.0.1:3009/health',
      expect.objectContaining({ method: 'GET', timeout: 1500 }),
    );
  });
});

describe('POST /auth/phone-code', () => {
  beforeEach(() => {
    resetMockDb();
    vi.mocked(requestVoiceOtpDispatch).mockReset();
    vi.mocked(requestVoiceOtpDispatch).mockResolvedValue({
      success: true,
      data: {
        provider: 'voice_call',
        requestId: 'req-voice-1',
        callSessionHistoryId: 'hist-voice-1',
        verificationCode: '1234',
        callerId: '+79030000000',
        acceptedAt: '2026-04-23T20:00:00.000Z',
      },
    });
  });

  it('starts voice OTP delivery, invalidates old codes, and stores the new code', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ count: '0' } as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/phone-code')
      .send({ phone: '79001234567', fingerprintVisitorId: 'sf_device_12345678' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { expiresIn: 120, provider: 'voice_call' },
    });
    expect(vi.mocked(requestVoiceOtpDispatch)).toHaveBeenCalledWith('79001234567', expect.stringMatching(/^\d{4}$/));
    expect(vi.mocked(mockDb.query)).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE verification_codes'),
      ['79001234567'],
    );
    expect(vi.mocked(mockDb.query)).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO verification_codes'),
      ['79001234567', '1234', 'voice_call', expect.any(Date)],
    );
  });

  it('returns PHONE_SEND_LIMIT when the phone-level rate limit is hit', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ count: '3' } as never);

    const res = await request(app)
      .post('/phone-code')
      .send({ phone: '79001234567' });

    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PHONE_SEND_LIMIT');
    expect(vi.mocked(requestVoiceOtpDispatch)).not.toHaveBeenCalled();
  });

  it('returns PHONE_SEND_FAILED when voice delivery cannot be started', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ count: '0' } as never);
    vi.mocked(requestVoiceOtpDispatch).mockResolvedValueOnce({
      success: false,
      reason: 'provider',
      error: 'provider rejected request',
    });

    const res = await request(app)
      .post('/phone-code')
      .send({ phone: '79001234567' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PHONE_SEND_FAILED');
    expect(vi.mocked(mockDb.query)).not.toHaveBeenCalled();
  });

  it('returns PHONE_SEND_BUSY when the local dispatcher is saturated', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ count: '0' } as never);
    vi.mocked(requestVoiceOtpDispatch).mockResolvedValueOnce({
      success: false,
      reason: 'busy',
      error: 'dispatcher busy',
    });

    const res = await request(app)
      .post('/phone-code')
      .send({ phone: '79001234567', fingerprintVisitorId: 'sf_device_busy_1' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PHONE_SEND_BUSY');
    expect(vi.mocked(mockDb.query)).not.toHaveBeenCalled();
  });

  it('starts voice OTP without CAPTCHA token', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ count: '0' } as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/phone-code')
      .send({ phone: '79001234567' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { expiresIn: 120, provider: 'voice_call' },
    });
    expect(vi.mocked(mockRedis.set)).not.toHaveBeenCalled();
    expect(vi.mocked(requestVoiceOtpDispatch)).toHaveBeenCalledWith('79001234567', expect.stringMatching(/^\d{4}$/));
  });

  it('lets trusted mobile gRPC request voice OTP', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ count: '0' } as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/phone-code')
      .set('X-SVF-Mobile-GRPC-Secret', 'test-mobile-grpc-secret')
      .send({
        phone: '79001234567',
        fingerprintVisitorId: 'grpc-device-123',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { expiresIn: 120, provider: 'voice_call' },
    });
    expect(vi.mocked(mockRedis.set)).not.toHaveBeenCalled();
    expect(vi.mocked(requestVoiceOtpDispatch)).toHaveBeenCalledWith(
      '79001234567',
      expect.stringMatching(/^\d{4}$/),
    );
  });

  it('requires a device id for trusted mobile gRPC phone OTP', async () => {
    const res = await request(app)
      .post('/phone-code')
      .set('X-SVF-Mobile-GRPC-Secret', 'test-mobile-grpc-secret')
      .send({ phone: '79001234567' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(vi.mocked(mockDb.queryOne)).not.toHaveBeenCalled();
    expect(vi.mocked(requestVoiceOtpDispatch)).not.toHaveBeenCalled();
  });

});

describe('POST /auth/phone-verify', () => {
  beforeEach(() => {
    resetMockDb();
    vi.mocked(linkApprovalSessionsByPhone).mockReset();
    vi.mocked(linkApprovalSessionsByPhone).mockResolvedValue(0);
    vi.mocked(runPostLoginBackfill).mockReset();
    vi.mocked(runPostLoginBackfill).mockResolvedValue({ subs: 0, contacts: 0 });
  });

  it('returns PHONE_INVALID before DB lookup for an invalid phone number', async () => {
    const res = await request(app)
      .post('/phone-verify')
      .send({ phone: '123', code: '1234' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PHONE_INVALID');
    expect(vi.mocked(mockDb.queryOne)).not.toHaveBeenCalled();
  });

  it('returns PHONE_CODE_EXPIRED when no active code exists', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/phone-verify')
      .send({ phone: '79001234567', code: '1234', fingerprintVisitorId: 'sf_device_expired_1' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PHONE_CODE_EXPIRED');
    expect(vi.mocked(mockDb.query)).not.toHaveBeenCalled();
    expect(vi.mocked(linkApprovalSessionsByPhone)).not.toHaveBeenCalled();
    expect(vi.mocked(runPostLoginBackfill)).not.toHaveBeenCalled();
  });

  it('returns PHONE_CODE_MAX_ATTEMPTS without consuming the code again', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'code-max-attempts',
      code: '1234',
      attempts: 5,
      method: 'voice_call',
    } as never);

    const res = await request(app)
      .post('/phone-verify')
      .send({ phone: '79001234567', code: '1234', fingerprintVisitorId: 'sf_device_max_1' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PHONE_CODE_MAX_ATTEMPTS');
    expect(vi.mocked(mockDb.query)).not.toHaveBeenCalled();
    expect(vi.mocked(linkApprovalSessionsByPhone)).not.toHaveBeenCalled();
    expect(vi.mocked(runPostLoginBackfill)).not.toHaveBeenCalled();
  });

  it('logs in an existing user and triggers post-login linking', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ id: 'code-1', code: '1234', attempts: 0, method: 'voice_call' } as never)
      .mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        role: 'client',
        display_name: 'Existing User',
        is_active: true,
      } as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/phone-verify')
      .send({ phone: '79001234567', code: '1234', fingerprintVisitorId: 'sf_device_12345678' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'Existing User',
      phone_verified: true,
      role: 'client',
    });
    expect(res.body.data.isNewUser).toBe(false);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(vi.mocked(mockDb.query)).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE verification_codes SET used_at = NOW()'),
      ['code-1'],
    );
    expect(vi.mocked(mockDb.query)).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE users SET phone = $1, phone_verified = true'),
      ['79001234567', 'user-1'],
    );
    expect(vi.mocked(mockDb.query)).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO refresh_tokens'),
      ['user-1', expect.any(String)],
    );
    expect(vi.mocked(linkApprovalSessionsByPhone)).toHaveBeenCalledWith('user-1', '79001234567');
    expect(vi.mocked(runPostLoginBackfill)).toHaveBeenCalledWith('user-1', '79001234567', 'user@example.com');
  });

  it('requires profile details before logging in an existing phone user without a name', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ id: 'code-existing-profile', code: '1234', attempts: 0, method: 'voice_call' } as never)
      .mockResolvedValueOnce({
        id: 'user-no-name',
        email: 'noname@example.com',
        role: 'client',
        display_name: null,
        is_active: true,
      } as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/phone-verify')
      .send({ phone: '79001234567', code: '1234' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      requiresProfile: true,
      isNewUser: false,
      phone: '79001234567',
    });
    expect(res.body.data.accessToken).toBeUndefined();
    expect(vi.mocked(mockDb.query)).not.toHaveBeenCalled();
    expect(vi.mocked(linkApprovalSessionsByPhone)).not.toHaveBeenCalled();
    expect(vi.mocked(runPostLoginBackfill)).not.toHaveBeenCalled();
  });

  it('updates the missing name and logs in an existing phone user after profile details are provided', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ id: 'code-existing-profile-2', code: '1234', attempts: 0, method: 'voice_call' } as never)
      .mockResolvedValueOnce({
        id: 'user-no-name',
        email: 'noname@example.com',
        role: 'client',
        display_name: '',
        is_active: true,
      } as never)
      .mockResolvedValueOnce({
        id: 'user-no-name',
        email: 'noname@example.com',
        role: 'client',
        display_name: 'Заполненный Клиент',
        is_active: true,
      } as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/phone-verify')
      .send({
        phone: '79001234567',
        code: '1234',
        profile: { displayName: 'Заполненный Клиент' },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      id: 'user-no-name',
      email: 'noname@example.com',
      displayName: 'Заполненный Клиент',
      role: 'client',
    });
    expect(res.body.data.isNewUser).toBe(false);
    expect(vi.mocked(mockDb.queryOne)).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE users'),
      [
        'user-no-name',
        'Заполненный Клиент',
        'Заполненный Клиент',
        null,
        JSON.stringify({ firstName: 'Заполненный Клиент' }),
      ],
    );
    expect(vi.mocked(mockDb.query)).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE verification_codes SET used_at = NOW()'),
      ['code-existing-profile-2'],
    );
    expect(vi.mocked(mockDb.query)).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE users SET phone = $1, phone_verified = true'),
      ['79001234567', 'user-no-name'],
    );
    expect(vi.mocked(mockDb.query)).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO refresh_tokens'),
      ['user-no-name', expect.any(String)],
    );
    expect(vi.mocked(linkApprovalSessionsByPhone)).toHaveBeenCalledWith('user-no-name', '79001234567');
    expect(vi.mocked(runPostLoginBackfill)).toHaveBeenCalledWith('user-no-name', '79001234567', 'noname@example.com');
  });

  it('requires profile details before registering a new phone client', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ id: 'code-2', code: '4321', attempts: 0, method: 'voice_call' } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/phone-verify')
      .send({ phone: '79001234567', code: '4321' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      requiresProfile: true,
      isNewUser: true,
      phone: '79001234567',
    });
    expect(res.body.data.accessToken).toBeUndefined();
    expect(vi.mocked(mockDb.query)).not.toHaveBeenCalled();
    expect(vi.mocked(linkApprovalSessionsByPhone)).not.toHaveBeenCalled();
    expect(vi.mocked(runPostLoginBackfill)).not.toHaveBeenCalled();
  });

  it('registers a new phone client after profile details are provided', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ id: 'code-2-profile', code: '4321', attempts: 0, method: 'voice_call' } as never)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'new-user-1',
        role: 'client',
        display_name: 'Новый Клиент',
      } as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/phone-verify')
      .send({
        phone: '79001234567',
        code: '4321',
        profile: {
          displayName: 'Новый Клиент',
          firstName: 'Клиент',
          lastName: 'Новый',
          dateOfBirth: '1990-05-20',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      id: 'new-user-1',
      email: null,
      displayName: 'Новый Клиент',
      role: 'client',
    });
    expect(res.body.data.isNewUser).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(vi.mocked(mockDb.queryOne)).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO users'),
      [
        '79001234567',
        'Новый Клиент',
        'Клиент',
        'Новый',
        JSON.stringify({ firstName: 'Клиент', lastName: 'Новый', dateOfBirth: '1990-05-20' }),
      ],
    );
    expect(vi.mocked(mockDb.query)).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE verification_codes SET used_at = NOW()'),
      ['code-2-profile'],
    );
    expect(vi.mocked(linkApprovalSessionsByPhone)).toHaveBeenCalledWith('new-user-1', '79001234567');
    expect(vi.mocked(runPostLoginBackfill)).toHaveBeenCalledWith('new-user-1', '79001234567', null);
  });

  it('increments attempts and returns PHONE_CODE_INVALID for a wrong code', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'code-3',
      code: '1234',
      attempts: 1,
      method: 'voice_call',
    } as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/phone-verify')
      .send({ phone: '79001234567', code: '9999', fingerprintVisitorId: 'sf_device_wrong_1' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PHONE_CODE_INVALID');
    expect(vi.mocked(mockDb.query)).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE verification_codes SET attempts = attempts + 1'),
      ['code-3'],
    );
    expect(vi.mocked(linkApprovalSessionsByPhone)).not.toHaveBeenCalled();
    expect(vi.mocked(runPostLoginBackfill)).not.toHaveBeenCalled();
  });

  it('rejects staff-only login for a non-staff account', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ id: 'code-4', code: '1234', attempts: 0, method: 'voice_call' } as never)
      .mockResolvedValueOnce({
        id: 'user-client-1',
        email: 'client@example.com',
        role: 'client',
        display_name: 'Client User',
        is_active: true,
      } as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/phone-verify')
      .send({ phone: '79001234567', code: '1234', staffOnly: true, fingerprintVisitorId: 'sf_device_staff_1' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/сотрудников/i);
    expect(vi.mocked(mockDb.query)).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE verification_codes SET used_at = NOW()'),
      ['code-4'],
    );
    expect(
      vi.mocked(mockDb.query).mock.calls.some(call =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO refresh_tokens'),
      ),
    ).toBe(false);
    expect(vi.mocked(linkApprovalSessionsByPhone)).not.toHaveBeenCalled();
    expect(vi.mocked(runPostLoginBackfill)).not.toHaveBeenCalled();
  });
});

describe('POST /auth/profile-phone-verify', () => {
  beforeEach(() => {
    resetMockDb();
    vi.mocked(linkApprovalSessionsByPhone).mockReset();
    vi.mocked(linkApprovalSessionsByPhone).mockResolvedValue(0);
    vi.mocked(runPostLoginBackfill).mockReset();
    vi.mocked(runPostLoginBackfill).mockResolvedValue({ subs: 0, contacts: 0 });
  });

  it('verifies a voice OTP and attaches the phone to the current user', async () => {
    const user = makeUser({ id: 'user-voice-1', email: 'voice@example.com', role: 'client' });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: 'user-voice-1',
        email: 'voice@example.com',
        role: 'client',
        is_active: true,
        display_name: 'Voice User',
        phone: null,
        force_password_change: false,
        last_password_change: null,
      } as never)
      .mockResolvedValueOnce({ id: 'voice-code-1', code: '1234', attempts: 0, method: 'voice_call' } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/profile-phone-verify')
      .set(authHeader(user))
      .send({ phone: '79001234567', code: '1234' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(vi.mocked(mockDb.query)).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE verification_codes SET used_at = NOW()'),
      ['voice-code-1'],
    );
    expect(vi.mocked(mockDb.query)).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE users SET phone = $1, phone_verified = true'),
      ['79001234567', 'user-voice-1'],
    );
    expect(vi.mocked(linkApprovalSessionsByPhone)).toHaveBeenCalledWith('user-voice-1', '79001234567');
    expect(vi.mocked(runPostLoginBackfill)).toHaveBeenCalledWith('user-voice-1', '79001234567', 'voice@example.com');
  });

  it('does not attach a phone that belongs to another user', async () => {
    const user = makeUser({ id: 'user-voice-2', email: 'voice2@example.com', role: 'client' });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: 'user-voice-2',
        email: 'voice2@example.com',
        role: 'client',
        is_active: true,
        display_name: 'Voice User 2',
        phone: null,
        force_password_change: false,
        last_password_change: null,
      } as never)
      .mockResolvedValueOnce({ id: 'voice-code-2', code: '1234', attempts: 0, method: 'voice_call' } as never)
      .mockResolvedValueOnce({ id: 'other-user' } as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/profile-phone-verify')
      .set(authHeader(user))
      .send({ phone: '79001234567', code: '1234' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(vi.mocked(mockDb.query)).not.toHaveBeenCalled();
    expect(vi.mocked(linkApprovalSessionsByPhone)).not.toHaveBeenCalled();
    expect(vi.mocked(runPostLoginBackfill)).not.toHaveBeenCalled();
  });
});

describe('POST /auth/register', () => {
  beforeEach(() => {
    resetMockDb();
    vi.mocked(validatePasswordStrength).mockReturnValue({ valid: true, errors: [] });
    // No existing user by default
    vi.mocked(mockDb.queryOne).mockResolvedValue(null);
    // Insert returns new user
    vi.mocked(mockDb.query).mockResolvedValue([]);
  });

  it('returns 201 and requiresVerification when registration succeeds', async () => {
    const res = await request(app)
      .post('/register')
      .send({ email: 'new@example.com', password: 'Str0ngPass!', displayName: 'New User' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.requiresVerification).toBe(true);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/register')
      .send({ password: 'Str0ngPass!' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/register')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when password fails strength validation', async () => {
    vi.mocked(validatePasswordStrength).mockReturnValue({
      valid: false,
      errors: ['минимум 8 символов', 'нужна цифра'],
    });

    const res = await request(app)
      .post('/register')
      .send({ email: 'test@example.com', password: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Слабый пароль/);
  });

  it('returns 201 (not 409) when email already exists — anti-enumeration protection', async () => {
    // Existing user found → anti-enumeration: still returns 201 + requiresVerification
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ id: 'existing-id', display_name: 'Existing' } as never);

    const res = await request(app)
      .post('/register')
      .send({ email: 'existing@example.com', password: 'Str0ngPass!', displayName: 'User' });

    expect(res.status).toBe(201);
    expect(res.body.requiresVerification).toBe(true);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/register').send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /auth/login', () => {
  let validHash: string;

  const activeUser = {
    id: 'user-123',
    email: 'user@example.com',
    role: 'client',
    display_name: 'User',
    get password_hash() { return validHash; },
    is_active: true,
    email_verified: true,
    two_factor_enabled: false,
    phone: null,
    two_factor_method: null,
  };

  beforeEach(async () => {
    validHash = await passwordHash('Str0ngPass!');
    resetMockDb();
    vi.mocked(checkAccountLockout).mockResolvedValue({ locked: false });
    vi.mocked(recordLoginAttempt).mockReset();
  });

  it('returns 200 with user and tokens on successful login', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(activeUser as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never); // refresh token insert

    const res = await request(app)
      .post('/login')
      .send({ email: 'user@example.com', password: 'Str0ngPass!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');
    expect(res.body.data.user.email).toBe('user@example.com');
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/login')
      .send({ password: 'Str0ngPass!' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/login').send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when user does not exist', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/login')
      .send({ email: 'ghost@example.com', password: 'AnyPass123!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    // Should NOT reveal "user not found" — same message as wrong password
    expect(res.body.error).toMatch(/email или пароль/i);
  });

  it('returns 401 for wrong password — same message as not found (anti-enumeration)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      ...activeUser,
      password_hash: await passwordHash('CorrectPass!'),
    } as never);

    const res = await request(app)
      .post('/login')
      .send({ email: 'user@example.com', password: 'WrongPass!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/email или пароль/i);
  });

  it('returns 401 for deactivated user', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      ...activeUser,
      is_active: false,
    } as never);

    const res = await request(app)
      .post('/login')
      .send({ email: 'user@example.com', password: 'Str0ngPass!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 EMAIL_NOT_VERIFIED when email is not confirmed', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      ...activeUser,
      email_verified: false,
    } as never);

    const res = await request(app)
      .post('/login')
      .send({ email: 'user@example.com', password: 'Str0ngPass!' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('EMAIL_NOT_VERIFIED');
  });

  it('returns 429 when account is locked after too many attempts', async () => {
    vi.mocked(checkAccountLockout).mockResolvedValue({
      locked: true,
      remainingMinutes: 10,
    });

    const res = await request(app)
      .post('/login')
      .send({ email: 'user@example.com', password: 'AnyPass!' });

    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
  });

  it('records failed login attempt when password is wrong', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      ...activeUser,
      password_hash: await passwordHash('CorrectPass!'),
    } as never);

    await request(app)
      .post('/login')
      .send({ email: 'user@example.com', password: 'WrongPass!' });

    expect(vi.mocked(recordLoginAttempt)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordLoginAttempt)).toHaveBeenCalledWith(
      'user@example.com',
      expect.any(String),
      undefined,
      false,
    );
  });
});

describe('POST /auth/employee-login', () => {
  let validHash: string;

  const employeeUser = {
    id: 'emp-123',
    email: 'emp@example.com',
    role: 'employee',
    display_name: 'Employee',
    get password_hash() { return validHash; },
    is_active: true,
    two_factor_enabled: false,
    phone: null,
    two_factor_method: null,
  };

  beforeEach(async () => {
    validHash = await passwordHash('Str0ngPass!');
    resetMockDb();
    vi.mocked(checkAccountLockout).mockResolvedValue({ locked: false });
  });

  it('returns 200 with tokens for a valid employee', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(employeeUser as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/employee-login')
      .send({ email: 'emp@example.com', password: 'Str0ngPass!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data.user.role).toBe('employee');
  });

  it('returns 401 when client user tries employee login', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      ...employeeUser,
      role: 'client',
    } as never);

    const res = await request(app)
      .post('/employee-login')
      .send({ email: 'emp@example.com', password: 'Str0ngPass!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when credentials are missing', async () => {
    const res = await request(app)
      .post('/employee-login')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 429 when account is locked', async () => {
    vi.mocked(checkAccountLockout).mockResolvedValue({ locked: true, remainingMinutes: 5 });

    const res = await request(app)
      .post('/employee-login')
      .send({ email: 'emp@example.com', password: 'any' });

    expect(res.status).toBe(429);
  });
});

describe('GET /auth/me', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(app).get('/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 with malformed Bearer token', async () => {
    const res = await request(app)
      .get('/me')
      .set('Authorization', 'Bearer not-a-valid-jwt');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 with token signed by wrong secret', async () => {
    const token = jwt.sign({ userId: 'u1', email: 'a@b.com', role: 'client' }, 'wrong-secret');
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when token is expired', async () => {
    const expired = jwt.sign(
      { userId: 'u1', email: 'a@b.com', role: 'client' },
      TEST_JWT_SECRET,
      { expiresIn: 1 }, // 1ms
    );
    // Small delay to ensure token is expired
    await new Promise(r => setTimeout(r, 10));

    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 with user profile and permissions when token is valid', async () => {
    const user = makeUser({ id: 'u1', email: 'user@example.com', role: 'admin' });

    // authenticateToken calls queryOne for user validation
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'user@example.com',
        role: 'admin',
        is_active: true,
        display_name: 'Admin',
        force_password_change: false,
        last_password_change: null,
      } as never)
      // /me handler calls queryOne again for full profile
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'user@example.com',
        role: 'admin',
        display_name: 'Admin',
        is_active: true,
        email_verified: true,
        created_at: new Date().toISOString(),
      } as never);

    const res = await request(app)
      .get('/me')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('user@example.com');
    expect(Array.isArray(res.body.data.permissions)).toBe(true);
    expect(mockGetStudentDiscountForUser).not.toHaveBeenCalled();
    expect(vi.mocked(mockDb.queryOne).mock.calls[1]?.[0]).toContain("to_jsonb(u)->>'account_type'");
  });

  it('does not fail auth profile when student discount lookup fails', async () => {
    const user = makeUser({ id: 'u1', email: 'user@example.com', role: 'client' });
    mockGetStudentDiscountForUser.mockRejectedValueOnce(new Error('student_discount_entitlements unavailable'));

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'user@example.com',
        role: 'client',
        is_active: true,
        display_name: 'Client',
        force_password_change: false,
        last_password_change: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'user@example.com',
        role: 'client',
        display_name: 'Client',
        is_active: true,
        email_verified: true,
        created_at: new Date().toISOString(),
      } as never);

    const res = await request(app)
      .get('/me')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('user@example.com');
    expect(res.body.data.student_discount).toBeNull();
    expect(mockGetStudentDiscountForUser).toHaveBeenCalledWith('u1');
  });

  it('does not load student discount for employee profile', async () => {
    const user = makeEmployeeUser({ id: 'emp-1', email: 'emp@example.com', role: 'employee' });

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: 'emp-1',
        email: 'emp@example.com',
        role: 'employee',
        is_active: true,
        display_name: 'Employee',
        force_password_change: false,
        last_password_change: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'emp-1',
        email: 'emp@example.com',
        role: 'employee',
        display_name: 'Employee',
        is_active: true,
        email_verified: true,
        created_at: new Date().toISOString(),
      } as never);

    const res = await request(app)
      .get('/me')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.student_discount).toBeNull();
    expect(mockGetStudentDiscountForUser).not.toHaveBeenCalled();
  });

  it('returns 401 when user no longer exists in DB', async () => {
    // authenticateToken: user not found
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);

    const user = makeUser({ id: 'deleted-user' });
    const res = await request(app)
      .get('/me')
      .set(authHeader(user));

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 for deactivated user', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'u1',
      email: 'x@example.com',
      role: 'client',
      is_active: false,
    } as never);

    const user = makeUser({ id: 'u1' });
    const res = await request(app)
      .get('/me')
      .set(authHeader(user));

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 PASSWORD_CHANGE_REQUIRED when employee must change password', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'emp-1',
      email: 'emp@example.com',
      role: 'employee',
      is_active: true,
      display_name: 'Emp',
      force_password_change: true,
      last_password_change: null,
    } as never);

    const emp = makeEmployeeUser({ id: 'emp-1' });
    const res = await request(app)
      .get('/me')
      .set(authHeader(emp));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

describe('POST /auth/refresh', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('returns 401 when refreshToken is not provided', async () => {
    const res = await request(app).post('/refresh').send({});

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when refresh token is invalid JWT', async () => {
    const res = await request(app)
      .post('/refresh')
      .send({ refreshToken: 'not-a-valid-jwt' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when refresh token is not in database (revoked or unknown)', async () => {
    const user = makeUser();
    const refreshToken = makeToken(user, '30d');

    // Token not found in DB
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  it('returns 200 with new tokens when refresh is valid', async () => {
    const user = makeUser({ id: 'u1', role: 'client' });
    const refreshToken = makeToken(user, '30d');

    // First queryOne: token exists in DB
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ user_id: 'u1' } as never)
      // Second queryOne: user exists and is active
      .mockResolvedValueOnce({ id: 'u1', email: 'user@example.com', role: 'client', is_active: true } as never);

    vi.mocked(mockDb.query).mockResolvedValue([] as never); // UPDATE refresh_tokens

    const res = await request(app)
      .post('/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');
    // New refresh token should be different from old one
    expect(res.body.data.refreshToken).not.toBe(refreshToken);
  });

  it('returns 423 PIN_REQUIRED when a client PIN exists but the refresh session is locked', async () => {
    const user = makeUser({ id: 'u1', role: 'client' });
    const refreshToken = makeToken(user, '30d');

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ user_id: 'u1' } as never)
      .mockResolvedValueOnce({ id: 'u1', email: 'user@example.com', role: 'client', is_active: true } as never)
      .mockResolvedValueOnce({
        user_id: 'u1',
        pin_hash: 'hash',
        failed_attempts: 0,
        locked_until: null,
      } as never)
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(423);
    expect(res.body.code).toBe('PIN_REQUIRED');
  });

  it('returns 200 when a client PIN session is unlocked', async () => {
    const user = makeUser({ id: 'u1', role: 'client' });
    const refreshToken = makeToken(user, '30d');

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ user_id: 'u1' } as never)
      .mockResolvedValueOnce({ id: 'u1', email: 'user@example.com', role: 'client', is_active: true } as never)
      .mockResolvedValueOnce({
        user_id: 'u1',
        pin_hash: 'hash',
        failed_attempts: 0,
        locked_until: null,
      } as never)
      .mockResolvedValueOnce({
        user_id: 'u1',
        refresh_token_hash: 'token-hash',
        unlocked_until: new Date(Date.now() + 60_000).toISOString(),
        revoked_at: null,
      } as never);

    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(vi.mocked(mockDb.query).mock.calls.some(call =>
      typeof call[0] === 'string' && call[0].includes('UPDATE client_pin_sessions'),
    )).toBe(true);
  });

  it('returns 401 when user is inactive', async () => {
    const user = makeUser({ id: 'u1' });
    const refreshToken = makeToken(user, '30d');

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ user_id: 'u1' } as never)
      .mockResolvedValueOnce({ id: 'u1', email: 'x@example.com', role: 'client', is_active: false } as never);

    const res = await request(app)
      .post('/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('Client PIN auth', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('sets up a PIN for authenticated clients and unlocks the current refresh session', async () => {
    const user = makeUser({ id: 'u1', email: 'user@example.com', role: 'client' });
    const refreshToken = makeToken(user, '30d');

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'user@example.com',
        role: 'client',
        is_active: true,
        display_name: 'Client',
        force_password_change: false,
        last_password_change: null,
      } as never)
      .mockResolvedValueOnce({ user_id: 'u1' } as never)
      .mockResolvedValueOnce({ id: 'u1', email: 'user@example.com', role: 'client', is_active: true } as never);

    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/pin/setup')
      .set(authHeader(user))
      .send({ pin: '1234', refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(vi.mocked(mockDb.query).mock.calls.some(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO client_pin_credentials'),
    )).toBe(true);
    expect(vi.mocked(mockDb.query).mock.calls.some(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO client_pin_sessions'),
    )).toBe(true);
  });

  it('unlocks a client refresh session with a valid PIN and rotates tokens', async () => {
    const user = makeUser({ id: 'u1', email: 'user@example.com', role: 'client' });
    const refreshToken = makeToken(user, '30d');
    const pinHash = await bcrypt.hash('1234', 4);

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ user_id: 'u1' } as never)
      .mockResolvedValueOnce({ id: 'u1', email: 'user@example.com', role: 'client', is_active: true } as never)
      .mockResolvedValueOnce({
        user_id: 'u1',
        pin_hash: pinHash,
        failed_attempts: 0,
        locked_until: null,
      } as never);

    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/pin/unlock')
      .send({ pin: '1234', refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).not.toBe(refreshToken);
  });

  it('rejects an invalid PIN without issuing tokens', async () => {
    const user = makeUser({ id: 'u1', email: 'user@example.com', role: 'client' });
    const refreshToken = makeToken(user, '30d');
    const pinHash = await bcrypt.hash('1234', 4);

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ user_id: 'u1' } as never)
      .mockResolvedValueOnce({ id: 'u1', email: 'user@example.com', role: 'client', is_active: true } as never)
      .mockResolvedValueOnce({
        user_id: 'u1',
        pin_hash: pinHash,
        failed_attempts: 0,
        locked_until: null,
      } as never);

    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/pin/unlock')
      .send({ pin: '9999', refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('PIN_INVALID');
    expect(vi.mocked(mockDb.query).mock.calls.some(call =>
      typeof call[0] === 'string' && call[0].includes('UPDATE refresh_tokens'),
    )).toBe(false);
  });
});

describe('POST /auth/logout', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).post('/logout').send({});

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 on successful logout', async () => {
    // authenticateToken user lookup
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'u1',
      email: 'user@example.com',
      role: 'client',
      is_active: true,
      display_name: 'User',
      force_password_change: false,
      last_password_change: null,
    } as never);

    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const user = makeUser({ id: 'u1' });
    const res = await request(app)
      .post('/logout')
      .set(authHeader(user))
      .send({ refreshToken: makeToken(user, '30d') });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('deletes refresh token from DB on logout', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      id: 'u1',
      email: 'user@example.com',
      role: 'client',
      is_active: true,
      display_name: 'User',
      force_password_change: false,
      last_password_change: null,
    } as never);

    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const user = makeUser({ id: 'u1' });
    const refreshToken = makeToken(user, '30d');

    await request(app)
      .post('/logout')
      .set(authHeader(user))
      .send({ refreshToken });

    // Verify DELETE FROM refresh_tokens was called
    const deleteCalls = vi.mocked(mockDb.query).mock.calls;
    const deleteCall = deleteCalls.find(call =>
      typeof call[0] === 'string' && call[0].includes('DELETE FROM refresh_tokens'),
    );
    expect(deleteCall).toBeDefined();
  });
});

describe('POST /auth/enable-2fa', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('enables 2FA when the account has a bound phone', async () => {
    const user = makeUser({ id: 'u1', email: 'user@example.com', role: 'client' });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'user@example.com',
        role: 'client',
        is_active: true,
        display_name: 'User',
        force_password_change: false,
        last_password_change: null,
      } as never)
      .mockResolvedValueOnce({ phone: '79001234567' } as never);
    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const res = await request(app)
      .post('/enable-2fa')
      .set(authHeader(user))
      .send({ method: 'sms' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(vi.mocked(mockDb.queryOne)).toHaveBeenNthCalledWith(
      2,
      'SELECT phone FROM users WHERE id = $1',
      ['u1'],
    );
    expect(vi.mocked(mockDb.query)).toHaveBeenCalledWith(
      'UPDATE users SET two_factor_enabled = true, two_factor_method = $1, updated_at = NOW() WHERE id = $2',
      ['sms', 'u1'],
    );
  });

  it('rejects 2FA when the account has no phone', async () => {
    const user = makeUser({ id: 'u2', email: 'user2@example.com', role: 'client' });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: 'u2',
        email: 'user2@example.com',
        role: 'client',
        is_active: true,
        display_name: 'User 2',
        force_password_change: false,
        last_password_change: null,
      } as never)
      .mockResolvedValueOnce({ phone: null } as never);

    const res = await request(app)
      .post('/enable-2fa')
      .set(authHeader(user))
      .send({ method: 'sms' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Сначала привяжите телефон');
    expect(vi.mocked(mockDb.query)).not.toHaveBeenCalled();
  });
});
