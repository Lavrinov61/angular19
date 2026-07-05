import type { ChannelType } from '../core/types.js';

export type CapturedPhoneSource = 'contact_shared' | 'text_extracted';

const TRUSTED_CONTACT_SHARE_CHANNELS: ReadonlySet<ChannelType> = new Set(['telegram', 'max']);

export function supportsTrustedContactShare(channel: ChannelType): boolean {
  return TRUSTED_CONTACT_SHARE_CHANNELS.has(channel);
}

export function shouldExtractPhoneFromPlainText(channel: ChannelType): boolean {
  return !supportsTrustedContactShare(channel);
}

export function isTrustedPhoneSource(source: CapturedPhoneSource): boolean {
  return source === 'contact_shared';
}
