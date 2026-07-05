import { HttpErrorResponse } from '@angular/common/http';

interface ApiErrorBody {
  readonly code?: unknown;
  readonly error?: unknown;
  readonly message?: unknown;
}

const WORKDAY_NOT_STARTED_MESSAGE = 'Сначала начните рабочий день, потом выставьте ссылку на оплату.';

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function employeeApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error;
    if (isApiErrorBody(body)) {
      if (body.code === 'WORKDAY_NOT_STARTED') return WORKDAY_NOT_STARTED_MESSAGE;
      if (typeof body.error === 'string' && body.error.trim()) {
        return readableApiMessage(body.error, fallback);
      }
      if (typeof body.message === 'string' && body.message.trim()) {
        return readableApiMessage(body.message, fallback);
      }
    }
    if (typeof body === 'string' && body.trim()) return readableApiMessage(body, fallback);
  }

  if (error instanceof Error && error.message.trim()) return readableApiMessage(error.message, fallback);
  return fallback;
}

function readableApiMessage(message: string, fallback: string): string {
  const trimmed = message.trim();
  if (!trimmed) return fallback;
  return isUnreadableMojibake(trimmed) ? fallback : trimmed;
}

function isUnreadableMojibake(message: string): boolean {
  const compact = Array.from(message.replace(/\s+/g, ''));
  if (compact.length === 0) return false;

  const replacementCount = compact.filter(char => char === '\uFFFD').length;
  if (replacementCount >= 3 && replacementCount / compact.length >= 0.2) return true;

  return /\uFFFD{3,}/u.test(message);
}
