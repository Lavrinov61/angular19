import { isDevMode } from '@angular/core';

export function safeSubstring(s: unknown, start: number, end?: number): string {
  if (typeof s !== 'string') {
    if (isDevMode() && s !== null && s !== undefined) {
      console.warn('[safe-string] safeSubstring called with non-string:', s);
    }
    return '';
  }
  return end === undefined ? s.substring(start) : s.substring(start, end);
}

export function safeStartsWith(s: unknown, prefix: string): boolean {
  return typeof s === 'string' && s.startsWith(prefix);
}
