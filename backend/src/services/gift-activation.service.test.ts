import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── In-memory Redis shim (covers the get/set/del/EX subset we use) ──────────
const store = new Map<string, string>();

const h = vi.hoisted(() => ({
  mockRedis: {
    status: 'ready' as const,
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
  },
  mockRequestVoiceOtpDispatch: vi.fn(),
  mockSendGiftActivationCodeEmail: vi.fn(),
  mockGetGiftSubscriptionPromoInfo: vi.fn(),
  mockFinalizeGiftActivation: vi.fn(),
  mockDbQuery: vi.fn(),
  mockDbQueryOne: vi.fn(),
}));

const {
  mockRedis,
  mockRequestVoiceOtpDispatch,
  mockSendGiftActivationCodeEmail,
  mockGetGiftSubscriptionPromoInfo,
  mockFinalizeGiftActivation,
  mockDbQuery,
  mockDbQueryOne,
} = h;

// Wire the redis shim to the shared `store`.
mockRedis.get.mockImplementation(async (key: string) => (store.has(key) ? store.get(key)! : null));
mockRedis.set.mockImplementation(async (key: string, value: string) => {
  store.set(key, value);
  return 'OK';
});
mockRedis.del.mockImplementation(async (key: string) => (store.delete(key) ? 1 : 0));
mockRedis.incr.mockImplementation(async (key: string) => {
  const next = parseInt(store.get(key) || '0', 10) + 1;
  store.set(key, String(next));
  return next;
});
mockRedis.expire.mockImplementation(async () => 1);

vi.mock('./redis-factory.js', () => ({
  createLazyRedis: () => () => h.mockRedis,
  isRedisReady: (c: unknown) => c !== null,
}));

vi.mock('./voice-otp-dispatcher.service.js', () => ({
  requestVoiceOtpDispatch: h.mockRequestVoiceOtpDispatch,
}));

vi.mock('./email.service.js', () => ({
  sendGiftActivationCodeEmail: h.mockSendGiftActivationCodeEmail,
}));

vi.mock('./subscription.service.js', () => ({
  getGiftSubscriptionPromoInfo: h.mockGetGiftSubscriptionPromoInfo,
  finalizeGiftActivation: h.mockFinalizeGiftActivation,
  normalizePhone: (raw: string) => {
    let d = raw.replace(/\D/g, '');
    if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1);
    if (d.length === 10) d = '7' + d;
    return d;
  },
}));

vi.mock('./privacy-consent.service.js', () => ({
  recordPrivacyConsentTx: vi.fn().mockResolvedValue({ id: 'consent-1' }),
}));

vi.mock('./phone-otp-event.service.js', () => ({
  recordPhoneOtpEventSafely: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../database/db.js', () => ({
  default: {
    query: (...args: unknown[]) => h.mockDbQuery(...args),
    queryOne: (...args: unknown[]) => h.mockDbQueryOne(...args),
    transaction: (cb: (client: unknown) => Promise<unknown>) => cb({ query: h.mockDbQuery }),
  },
}));

vi.mock('../config/index.js', () => ({
  config: {
    voximplant: { voiceCall: { enabled: true, ttlSeconds: 120 } },
  },
}));

// metrics is imported by the service; stub the counters we touch.
vi.mock('./metrics.service.js', () => ({
  giftActivationStartedTotal: { inc: vi.fn() },
  giftActivationFinalizedTotal: { inc: vi.fn() },
  giftActivationCodeRejectedTotal: { inc: vi.fn() },
  giftActivationCodeLockedTotal: { inc: vi.fn() },
}));

import {
  startGiftActivation,
  getSession,
  verifyEmailCode,
  verifyPhoneCode,
  resendCode,
  finalizeActivation,
  type GiftActivationSession,
} from './gift-activation.service.js';

const PROMO = {
  promo_code: 'SVF-GIFT-ABCD',
  plan_id: 'plan-1',
  plan_name: 'Базовый',
  trial_days: 31,
  expires_at: null,
};

function baseStartInput() {
  return {
    promoCode: 'SVF-GIFT-ABCD',
    fullName: 'Иванов Иван Иванович',
    phone: '+7 (900) 123-45-67',
    email: 'Client@Example.com',
    policyVersion: '2026-01-01',
  };
}

beforeEach(() => {
  store.clear();
  // Clear call history but keep the redis impls wired to `store`.
  mockRequestVoiceOtpDispatch.mockReset();
  mockSendGiftActivationCodeEmail.mockReset();
  mockGetGiftSubscriptionPromoInfo.mockReset();
  mockFinalizeGiftActivation.mockReset();
  mockDbQuery.mockReset();
  mockDbQueryOne.mockReset();
  mockRedis.get.mockClear();
  mockRedis.set.mockClear();
  mockRedis.del.mockClear();
  mockRedis.incr.mockClear();
  mockRedis.expire.mockClear();

  mockGetGiftSubscriptionPromoInfo.mockResolvedValue(PROMO);
  // voice dispatch succeeds with a known code
  mockRequestVoiceOtpDispatch.mockResolvedValue({
    success: true,
    data: {
      provider: 'voice_call',
      callerId: '79000000000',
      verificationCode: '1111',
      acceptedAt: new Date().toISOString(),
    },
  });
  mockSendGiftActivationCodeEmail.mockResolvedValue(true);
  // recent-codes count query returns 0
  mockDbQueryOne.mockResolvedValue({ count: '0' });
  mockDbQuery.mockResolvedValue([]);
});

describe('startGiftActivation', () => {
  it('opens a session, lowercases email, normalizes phone, sends both codes', async () => {
    const { session, voiceSent } = await startGiftActivation(baseStartInput());

    expect(voiceSent).toBe(true);
    expect(session.phone).toBe('79001234567');
    expect(session.email).toBe('client@example.com');
    expect(session.voice.code).toBe('1111');
    expect(session.emailCode.code).toMatch(/^\d{4}$/);
    expect(mockSendGiftActivationCodeEmail).toHaveBeenCalledOnce();

    // persisted in redis
    const persisted = await getSession(session.id);
    expect(persisted?.id).toBe(session.id);
  });

  it('returns voiceSent=false (not 503) when only voice fails', async () => {
    mockRequestVoiceOtpDispatch.mockResolvedValue({ success: false, reason: 'busy', error: 'x' });
    const { voiceSent, session } = await startGiftActivation(baseStartInput());
    expect(voiceSent).toBe(false);
    expect(session.voice.code).toBe('');
    expect(session.emailCode.code).toMatch(/^\d{4}$/);
  });

  it('throws 503 when BOTH channels fail', async () => {
    mockRequestVoiceOtpDispatch.mockResolvedValue({ success: false, reason: 'busy', error: 'x' });
    mockSendGiftActivationCodeEmail.mockResolvedValue(false);
    await expect(startGiftActivation(baseStartInput())).rejects.toMatchObject({ statusCode: 503 });
  });

  it('throws 404 GIFT_PROMO_INVALID for an unknown promo', async () => {
    mockGetGiftSubscriptionPromoInfo.mockResolvedValue(null);
    await expect(startGiftActivation(baseStartInput())).rejects.toMatchObject({
      statusCode: 404,
      code: 'GIFT_PROMO_INVALID',
    });
  });
});

describe('verifyEmailCode — anti-brute lockout', () => {
  async function freshSession(): Promise<GiftActivationSession> {
    const { session } = await startGiftActivation(baseStartInput());
    return session;
  }

  it('accepts the correct code', async () => {
    const session = await freshSession();
    await verifyEmailCode(session, session.emailCode.code);
    expect(session.emailCode.verified).toBe(true);
    const persisted = await getSession(session.id);
    expect(persisted?.emailCode.verified).toBe(true);
  });

  it('rejects a wrong code and persists the incremented attempt counter', async () => {
    const session = await freshSession();
    await expect(verifyEmailCode(session, '0000')).rejects.toMatchObject({ code: 'EMAIL_CODE_INVALID' });
    const persisted = await getSession(session.id);
    expect(persisted?.emailCode.attempts).toBe(1);
  });

  it('burns the code after 5 wrong attempts → ACTIVATION_CODE_LOCKED', async () => {
    const session = await freshSession();
    const wrong = session.emailCode.code === '0000' ? '0001' : '0000';
    // 4 invalid tries
    for (let i = 0; i < 4; i++) {
      await expect(verifyEmailCode(session, wrong)).rejects.toMatchObject({ code: 'EMAIL_CODE_INVALID' });
    }
    // 5th wrong → locked
    await expect(verifyEmailCode(session, wrong)).rejects.toMatchObject({
      statusCode: 423,
      code: 'ACTIVATION_CODE_LOCKED',
    });
    // even the correct code is now rejected (burned)
    await expect(verifyEmailCode(session, session.emailCode.code)).rejects.toMatchObject({
      statusCode: 423,
      code: 'ACTIVATION_CODE_LOCKED',
    });
  });
});

describe('resendCode', () => {
  it('enforces the 60s cooldown', async () => {
    const { session } = await startGiftActivation(baseStartInput());
    // a send just happened at /start (lastSentAt = now)
    await expect(resendCode(session, 'email', undefined, {})).rejects.toMatchObject({
      statusCode: 429,
      code: 'ACTIVATION_RATE_LIMITED',
    });
  });

  it('allows email correction on resend (after cooldown)', async () => {
    const { session } = await startGiftActivation(baseStartInput());
    session.emailCode.lastSentAt = 0; // bypass cooldown
    const res = await resendCode(session, 'email', 'new@example.com', {});
    expect(session.email).toBe('new@example.com');
    expect(res.maskedEmail).toContain('@example.com');
  });
});

describe('verifyPhoneCode', () => {
  it('accepts the voice code and burns the phone_login verification_codes row', async () => {
    const { session } = await startGiftActivation(baseStartInput());
    await verifyPhoneCode(session, session.voice.code);
    expect(session.voice.verified).toBe(true);

    // immediate side-channel close: an UPDATE verification_codes ... used_at ran
    const burnCall = mockDbQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE verification_codes') && sql.includes('used_at'),
    );
    expect(burnCall).toBeTruthy();
  });

  it('rejects a wrong voice code WITHOUT burning the verification_codes row', async () => {
    const { session } = await startGiftActivation(baseStartInput());
    mockDbQuery.mockClear();
    const wrong = session.voice.code === '0000' ? '0001' : '0000';
    await expect(verifyPhoneCode(session, wrong)).rejects.toMatchObject({ code: 'PHONE_CODE_INVALID' });
    const burnCall = mockDbQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE verification_codes') && sql.includes('used_at'),
    );
    expect(burnCall).toBeFalsy();
  });
});

describe('finalizeActivation', () => {
  it('requires email verification first (409 ACTIVATION_NOT_VERIFIED)', async () => {
    const { session } = await startGiftActivation(baseStartInput());
    await expect(finalizeActivation(session, true, {})).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACTIVATION_NOT_VERIFIED',
    });
  });

  it('finalizes, burns the side-channel code, deletes the session', async () => {
    const { session } = await startGiftActivation(baseStartInput());
    await verifyEmailCode(session, session.emailCode.code);

    mockFinalizeGiftActivation.mockResolvedValue({
      user: { id: 'u-1', displayName: 'Иванов Иван', phone: '79001234567', email: 'client@example.com', role: 'client' },
      account: { already_existed: false },
      subscription: { id: 's-1', plan_name: 'Базовый', current_period_end: '2026-07-01T00:00:00Z', status: 'active', mode: 'created' },
      emailLinkedElsewhere: false,
    });

    const result = await finalizeActivation(session, true, { ip: '1.2.3.4', userAgent: 'jest' });

    expect(result.user.id).toBe('u-1');
    expect(result.phone_verified).toBe(true);
    expect(result.isNewUser).toBe(true);
    expect(result.subscription.mode).toBe('created');
    expect(mockFinalizeGiftActivation).toHaveBeenCalledOnce();
    // side-channel burn: an UPDATE verification_codes ... used_at runs inside the tx
    const burnCall = mockDbQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE verification_codes') && sql.includes('used_at'),
    );
    expect(burnCall).toBeTruthy();
    // session removed
    expect(await getSession(session.id)).toBeNull();
  });
});
