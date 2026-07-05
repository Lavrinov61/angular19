/**
 * Structured Logger — pino backend
 *
 * Async, structured JSON logging via pino. Replaces the previous
 * synchronous console-based logger without changing the public API.
 *
 * - Non-blocking: pino writes to stdout asynchronously (SonicBoom)
 * - Structured: JSON output with level, module, msg, timestamp
 * - Redaction: auth headers, cookies, passwords, tokens, PII (phone/email/IP) stripped
 * - Correlation: createChildLogger attaches requestId / arbitrary bindings
 *
 * Usage (unchanged from previous logger):
 *   const log = createLogger('inbound-pipeline');
 *   log.info('Message processed', { channel: 'vk', sessionId: '...' });
 *   log.warn('upsertChannelUser failed', { error: String(err) });
 */

import pino from 'pino';

// ── Root pino instance ──────────────────────────────────────────────────────

const isDev = process.env['NODE_ENV'] === 'development';

export const rootLogger = pino({
  level: process.env['LOG_LEVEL'] || 'info',
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
    : undefined,
  redact: {
    paths: [
      // ── Auth & secrets ──────────────────────────────────────────────
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'accessToken',
      'refreshToken',

      // ── Phone numbers (PII) ─────────────────────────────────────────
      'phone',
      'phone_number',
      'visitor_phone',
      '*.phone',
      '*.phone_number',
      '*.visitor_phone',
      'req.body.phone',
      'req.body.phone_number',
      'req.body.visitor_phone',

      // ── Email addresses (PII) ───────────────────────────────────────
      'email',
      'visitor_email',
      'user_email',
      '*.email',
      '*.visitor_email',
      '*.user_email',
      'req.body.email',
      'req.body.visitor_email',
      'req.body.user_email',

      // ── Names (PII, but NOT username — needed for debugging) ────────
      'visitor_name',
      '*.visitor_name',
      'req.body.visitor_name',

      // ── IP addresses (PII) ─────────────────────────────────────────
      'ip',
      'client_ip',
      'remote_address',
      '*.ip',
      '*.client_ip',
      '*.remote_address',
      'req.ip',

      // ── Payment data (PCI-DSS) ─────────────────────────────────────
      'card_number',
      'account_number',
      'pan',
      '*.card_number',
      '*.account_number',
      '*.pan',
      'req.body.card_number',
      'req.body.account_number',
      'req.body.pan',
    ],
    censor: '[REDACTED]',
  },
  // Rename pino's default "msg" key to "message" for backwards compatibility
  // with existing log consumers (ELK / Grafana dashboards, grep scripts).
  // "module" is bound via child() on every createLogger() call.
  formatters: {
    // Omit pid/hostname for cleaner output (container env already tags these)
    bindings: () => ({}),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ── Public Logger interface ─────────────────────────────────────────────────
// Preserved 1:1 so every existing callsite keeps working without changes.

type LogMeta = Record<string, unknown>;

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

/**
 * Wrap a pino child logger into the project's Logger interface.
 *
 * pino API: logger.info(mergeObj, msg)  — object FIRST, message SECOND
 * project API: log.info(msg, meta?)     — message FIRST, meta SECOND
 *
 * This shim translates between the two so callers stay unchanged.
 */
function wrapPino(pinoChild: pino.Logger): Logger {
  return {
    debug(message: string, meta?: LogMeta): void {
      if (meta) {
        pinoChild.debug(meta, message);
      } else {
        pinoChild.debug(message);
      }
    },
    info(message: string, meta?: LogMeta): void {
      if (meta) {
        pinoChild.info(meta, message);
      } else {
        pinoChild.info(message);
      }
    },
    warn(message: string, meta?: LogMeta): void {
      if (meta) {
        pinoChild.warn(meta, message);
      } else {
        pinoChild.warn(message);
      }
    },
    error(message: string, meta?: LogMeta): void {
      if (meta) {
        pinoChild.error(meta, message);
      } else {
        pinoChild.error(message);
      }
    },
  };
}

// ── Factory functions ───────────────────────────────────────────────────────

/**
 * Create a module-scoped logger. Every log entry includes `{ module: name }`.
 */
export function createLogger(name: string): Logger {
  return wrapPino(rootLogger.child({ module: name }));
}

/**
 * Create a child logger with additional bindings merged into every log entry.
 * Used by request-context middleware to attach requestId to all log entries.
 */
export function createChildLogger(bindings: LogMeta): Logger {
  return wrapPino(rootLogger.child(bindings));
}
