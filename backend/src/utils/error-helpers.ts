/**
 * Error narrowing helpers — safe extraction of message/statusCode from unknown errors.
 * Use instead of `catch(err: any)` → `catch(err: unknown)` + these helpers.
 */

/** Extract a human-readable message from an unknown thrown value. */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

/** Extract HTTP-like statusCode from unknown error (web-push, axios, etc.). */
export function toStatusCode(err: unknown): number | undefined {
  if (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as Record<string, unknown>)['statusCode'] === 'number'
  ) {
    return (err as Record<string, unknown>)['statusCode'] as number;
  }
  return undefined;
}
