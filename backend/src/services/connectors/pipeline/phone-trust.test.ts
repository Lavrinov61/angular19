import { describe, expect, it } from 'vitest';
import { isTrustedPhoneSource, shouldExtractPhoneFromPlainText, supportsTrustedContactShare } from './phone-trust.js';

describe('phone trust policy', () => {
  it('requires native contact sharing for channels that support verified contact flow', () => {
    expect(supportsTrustedContactShare('telegram')).toBe(true);
    expect(supportsTrustedContactShare('max')).toBe(true);
    expect(shouldExtractPhoneFromPlainText('telegram')).toBe(false);
    expect(shouldExtractPhoneFromPlainText('max')).toBe(false);
  });

  it('keeps legacy text extraction untrusted for channels without contact sharing', () => {
    expect(shouldExtractPhoneFromPlainText('vk')).toBe(true);
    expect(shouldExtractPhoneFromPlainText('instagram')).toBe(true);
    expect(isTrustedPhoneSource('text_extracted')).toBe(false);
    expect(isTrustedPhoneSource('contact_shared')).toBe(true);
  });
});
