/**
 * Error Tracking Abstraction — ready for Sentry integration
 *
 * Provides a unified error-capture API that currently logs via pino.
 * When Sentry is installed and SENTRY_DSN is set, switch the internals
 * to forward to @sentry/node without changing any callsite.
 *
 * Install: npm install @sentry/node
 * Then set SENTRY_DSN in .env and uncomment the Sentry blocks below.
 */

import { createLogger } from './logger.js';

const log = createLogger('error-tracker');

// ── Options ───────────────────────────────────────────────────────────────────

export interface ErrorTrackerOptions {
  /** Indexed tags for filtering (e.g. { module: 'payments', channel: 'vk' }) */
  tags?: Record<string, string>;
  /** Arbitrary context attached to the event */
  extra?: Record<string, unknown>;
  /** User context for the error */
  user?: { id: string; email?: string };
  /** Severity level */
  level?: 'fatal' | 'error' | 'warning' | 'info';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorToStack(error: unknown): string | undefined {
  if (error instanceof Error) return error.stack;
  return undefined;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Capture an exception and forward to the error tracking backend.
 * Currently logs via pino; replace internals when Sentry is configured.
 */
export function captureException(error: unknown, options?: ErrorTrackerOptions): void {
  // When @sentry/node is installed and SENTRY_DSN is set:
  // Sentry.withScope((scope) => {
  //   if (options?.tags) scope.setTags(options.tags);
  //   if (options?.extra) scope.setExtras(options.extra);
  //   if (options?.user) scope.setUser(options.user);
  //   if (options?.level) scope.setLevel(options.level);
  //   Sentry.captureException(error);
  // });

  log.error('Captured exception', {
    error: errorToMessage(error),
    stack: errorToStack(error),
    ...(options?.tags && { tags: options.tags }),
    ...(options?.extra && { extra: options.extra }),
    ...(options?.user && { userId: options.user.id }),
    ...(options?.level && { level: options.level }),
  });
}

/**
 * Capture a message-level event (no exception object).
 */
export function captureMessage(message: string, options?: ErrorTrackerOptions): void {
  // When @sentry/node is installed and SENTRY_DSN is set:
  // Sentry.withScope((scope) => {
  //   if (options?.tags) scope.setTags(options.tags);
  //   if (options?.extra) scope.setExtras(options.extra);
  //   if (options?.user) scope.setUser(options.user);
  //   if (options?.level) scope.setLevel(options.level);
  //   Sentry.captureMessage(message, options?.level || 'warning');
  // });

  const logLevel = options?.level || 'warning';
  const meta: Record<string, unknown> = {
    ...(options?.tags && { tags: options.tags }),
    ...(options?.extra && { extra: options.extra }),
    ...(options?.user && { userId: options.user.id }),
  };

  if (logLevel === 'fatal' || logLevel === 'error') {
    log.error(message, meta);
  } else if (logLevel === 'warning') {
    log.warn(message, meta);
  } else {
    log.info(message, meta);
  }
}
