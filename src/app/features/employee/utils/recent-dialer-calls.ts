import { isCompleteRussianPhone, normalizeRussianPhoneForDial } from './phone-mask';

export const RECENT_DIALER_LIMIT = 8;
export const RECENT_DIALER_STORAGE_KEY = 'recent_dialer_calls';

export function parseRecentDialerCalls(value: string | null): string[] {
  if (!value) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const normalized = parsed
    .filter((item): item is string => typeof item === 'string')
    .map(item => normalizeRussianPhoneForDial(item))
    .filter(item => isCompleteRussianPhone(item));

  return Array.from(new Set(normalized)).slice(0, RECENT_DIALER_LIMIT);
}

export function rememberRecentDialerCall(calls: string[], phone: string): string[] {
  const normalized = normalizeRussianPhoneForDial(phone);
  if (!isCompleteRussianPhone(normalized)) return calls;

  const next = calls.filter(item => item !== normalized);
  next.unshift(normalized);
  return next.slice(0, RECENT_DIALER_LIMIT);
}
