import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    set: vi.fn(),
  },
}));

vi.mock('./config/index.js', () => ({
  config: {
    role: 'telephony',
    server: {
      nodeEnv: 'test',
    },
    cors: {
      origin: 'http://localhost:4200',
    },
    voximplant: {
      voiceCall: {
        enabled: true,
        callerIds: ['+79030000000'],
        ttlSeconds: 120,
      },
    },
  },
}));

vi.mock('./database/db.js', () => ({
  default: {
    query: vi.fn(),
    queryOne: vi.fn(),
  },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('./middleware/rate-limit-store.js', () => ({
  createRateLimitStore: vi.fn(() => undefined),
}));

vi.mock('./services/redis-factory.js', async () => {
  const actual = await vi.importActual<typeof import('./services/redis-factory.js')>('./services/redis-factory.js');
  return {
    ...actual,
    createResilientRedis: vi.fn(() => mockRedis),
  };
});

vi.mock('./services/sms.service.js', () => ({
  normalizePhone: vi.fn((value: string) => value),
}));

vi.mock('./services/code-delivery.service.js', () => ({
  checkDeliveryChannel: vi.fn().mockResolvedValue({ available: true, provider: 'voice_call' }),
}));

vi.mock('./services/voice-otp-dispatcher.service.js', () => ({
  requestVoiceOtpDispatch: vi.fn(),
}));

vi.mock('./services/approval-counters.service.js', () => ({
  linkApprovalSessionsByPhone: vi.fn().mockResolvedValue(0),
}));

vi.mock('./services/account-backfill.service.js', () => ({
  runPostLoginBackfill: vi.fn().mockResolvedValue({ subs: 0, contacts: 0 }),
}));

vi.mock('./services/auth.service.js', () => ({
  generateTokens: vi.fn().mockReturnValue({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
}));

vi.mock('./services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('./services/voximplant-management-sdk.service.js', () => ({
  getSdkPhoneNumbers: vi.fn().mockResolvedValue({ result: [] }),
  isVoximplantSdkConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock('./services/voximplant.service.js', () => ({
  isVoximplantVoiceCallConfigured: vi.fn().mockReturnValue(true),
}));

const { createTelephonyApp } = await import('./telephony-app.js');

describe('createTelephonyApp', () => {
  beforeEach(() => {
    vi.mocked(mockRedis.set).mockReset();
    vi.mocked(mockRedis.set).mockResolvedValue('OK');
  });

  it('mounts phone auth routes under /api/auth', async () => {
    const app = createTelephonyApp({
      checkDb: async () => 'ok',
      checkRedis: async () => 'ok',
      checkVoiceOtpDispatcher: async () => 'ok',
      checkPhoneAuthRoutes: async () => 'ok',
      checkVoximplantConfig: async () => 'ok',
      checkPhoneAuthProviderPreflight: async () => 'skipped',
    });

    const res = await request(app).get('/api/auth/phone-check');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('treats skipped provider preflight as ready when all checks pass', async () => {
    const app = createTelephonyApp({
      checkDb: async () => 'ok',
      checkRedis: async () => 'ok',
      checkVoiceOtpDispatcher: async () => 'ok',
      checkPhoneAuthRoutes: async () => 'ok',
      checkVoximplantConfig: async () => 'ok',
      checkPhoneAuthProviderPreflight: async () => 'skipped',
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.checks.providerPreflight).toMatchObject({
      ok: true,
      status: 'skipped',
    });
  });

  it('fails readiness when a hard dependency check fails', async () => {
    const app = createTelephonyApp({
      checkDb: async () => 'ok',
      checkRedis: async () => 'ok',
      checkVoiceOtpDispatcher: async () => 'ok',
      checkPhoneAuthRoutes: async () => 'ok',
      checkVoximplantConfig: async () => {
        throw new Error('missing rule id');
      },
      checkPhoneAuthProviderPreflight: async () => 'skipped',
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
    expect(res.body.checks.db).toMatchObject({ ok: true, status: 'ok' });
    expect(res.body.checks.redis).toMatchObject({ ok: true, status: 'ok' });
    expect(res.body.checks.voiceOtpDispatcher).toMatchObject({ ok: true, status: 'ok' });
    expect(res.body.checks.phoneAuthRoutes).toMatchObject({ ok: true, status: 'ok' });
    expect(res.body.checks.voximplantConfig).toMatchObject({ ok: false, error: 'missing rule id' });
    expect(res.body.checks.providerPreflight).toMatchObject({
      ok: true,
      status: 'skipped',
    });
  });

  it('fails readiness when provider preflight fails', async () => {
    const app = createTelephonyApp({
      checkDb: async () => 'ok',
      checkRedis: async () => 'ok',
      checkVoiceOtpDispatcher: async () => 'ok',
      checkPhoneAuthRoutes: async () => 'ok',
      checkVoximplantConfig: async () => 'ok',
      checkPhoneAuthProviderPreflight: async () => {
        throw new Error('caller id unavailable');
      },
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
    expect(res.body.checks.providerPreflight).toMatchObject({
      ok: false,
      error: 'caller id unavailable',
    });
  });
});
