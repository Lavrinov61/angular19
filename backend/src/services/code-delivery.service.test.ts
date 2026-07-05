import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: {
    voximplant: {
      voiceCall: {
        enabled: true,
        callerIds: ['+79030000000'],
      },
    },
  },
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./voximplant.service.js', () => ({
  isVoximplantVoiceCallConfigured: vi.fn().mockReturnValue(true),
  startVoximplantVoiceCall: vi.fn(),
}));

vi.mock('./voximplant-management-sdk.service.js', () => ({
  getSdkPhoneNumbers: vi.fn(),
  isVoximplantSdkConfigured: vi.fn().mockReturnValue(false),
}));

const {
  checkDeliveryChannel,
  getCachedVoiceCallProviderPreflight,
  isVoiceCallProviderAvailable,
  resetVoiceCallProviderProbeCacheForTests,
} = await import('./code-delivery.service.js');
const { getSdkPhoneNumbers, isVoximplantSdkConfigured } = await import('./voximplant-management-sdk.service.js');
const { isVoximplantVoiceCallConfigured } = await import('./voximplant.service.js');

describe('code-delivery voice call provider probe', () => {
  beforeEach(() => {
    resetVoiceCallProviderProbeCacheForTests();
    vi.clearAllMocks();
    vi.mocked(isVoximplantVoiceCallConfigured).mockReturnValue(true);
    vi.mocked(isVoximplantSdkConfigured).mockReturnValue(false);
  });

  it('treats provider as available when SDK probe is skipped but voice call is configured', async () => {
    await expect(getCachedVoiceCallProviderPreflight()).resolves.toBe('skipped');
    await expect(isVoiceCallProviderAvailable()).resolves.toBe(true);
    await expect(checkDeliveryChannel('79001234567')).resolves.toEqual({
      available: true,
      provider: 'voice_call',
    });
    expect(vi.mocked(getSdkPhoneNumbers)).not.toHaveBeenCalled();
  });

  it('caches successful SDK-backed preflight results', async () => {
    vi.mocked(isVoximplantSdkConfigured).mockReturnValue(true);
    vi.mocked(getSdkPhoneNumbers)
      .mockResolvedValueOnce({ result: [] })
      .mockResolvedValueOnce({
        result: [{ phoneNumber: '79030000000', canBeUsed: true }],
      });

    await expect(getCachedVoiceCallProviderPreflight()).resolves.toBe('ok');
    await expect(isVoiceCallProviderAvailable()).resolves.toBe(true);
    expect(vi.mocked(getSdkPhoneNumbers)).toHaveBeenCalledTimes(2);
  });

  it('caches failed SDK-backed preflight results and reports channel unavailable', async () => {
    vi.mocked(isVoximplantSdkConfigured).mockReturnValue(true);
    vi.mocked(getSdkPhoneNumbers)
      .mockResolvedValueOnce({ result: [] })
      .mockResolvedValueOnce({
        result: [{ phoneNumber: '+79030000000', canBeUsed: false }],
      });

    await expect(getCachedVoiceCallProviderPreflight()).rejects.toThrow(
      'Configured caller ID is attached but unavailable in Voximplant',
    );
    await expect(isVoiceCallProviderAvailable()).resolves.toBe(false);
    await expect(checkDeliveryChannel('79001234567')).resolves.toEqual({
      available: false,
      provider: 'none',
    });
    expect(vi.mocked(getSdkPhoneNumbers)).toHaveBeenCalledTimes(2);
  });
});
