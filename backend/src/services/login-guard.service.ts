import db from '../database/db.js';

import { createLogger } from '../utils/logger.js';
const MAX_FAILED_ATTEMPTS = 15;
const LOCKOUT_WINDOW_MINUTES = 15;

const logger = createLogger('login-guard.service');
export interface LoginAttemptResult {
  locked: boolean;
  remainingMinutes?: number;
  /** Сколько неудачных попыток осталось до блокировки (на момент проверки). */
  remainingAttempts?: number;
}

/** Результат COUNT(*) по неудачным попыткам входа. */
interface FailedAttemptCountRow {
  count: string;
}

/** Результат MIN(created_at) — самая ранняя неудача в активном окне. */
interface OldestFailRow {
  first_fail: string | null;
}

/**
 * Check if email is locked out due to too many failed attempts.
 * Must be called BEFORE password verification to prevent timing-based attacks.
 */
export async function checkAccountLockout(email: string): Promise<LoginAttemptResult> {
  const normalizedEmail = email.trim().toLowerCase();

  // Неудачи считаем ТОЛЬКО после последнего успешного входа в окне:
  // успешный вход сбрасывает счётчик (иначе прежние промахи висят весь LOCKOUT_WINDOW
  // и блокируют даже того, кто уже успешно залогинился). Аудит-записи не удаляются.
  const lastSuccessBoundary = `COALESCE(
        (SELECT MAX(created_at) FROM login_attempts
          WHERE email = $1 AND success = true
            AND created_at > NOW() - INTERVAL '${LOCKOUT_WINDOW_MINUTES} minutes'),
        '-infinity'::timestamptz)`;

  const result = await db.queryOne<FailedAttemptCountRow>(
    `SELECT COUNT(*) as count FROM login_attempts
     WHERE email = $1 AND success = false
       AND created_at > NOW() - INTERVAL '${LOCKOUT_WINDOW_MINUTES} minutes'
       AND created_at > ${lastSuccessBoundary}`,
    [normalizedEmail]
  );

  const failedCount = parseInt(result?.count || '0', 10);
  const remainingAttempts = Math.max(0, MAX_FAILED_ATTEMPTS - failedCount);

  if (failedCount >= MAX_FAILED_ATTEMPTS) {
    const oldest = await db.queryOne<OldestFailRow>(
      `SELECT MIN(created_at) as first_fail FROM login_attempts
       WHERE email = $1 AND success = false
         AND created_at > NOW() - INTERVAL '${LOCKOUT_WINDOW_MINUTES} minutes'
         AND created_at > ${lastSuccessBoundary}`,
      [normalizedEmail]
    );

    const firstFailTime = oldest?.first_fail ? new Date(oldest.first_fail).getTime() : Date.now();
    const lockoutEnds = firstFailTime + LOCKOUT_WINDOW_MINUTES * 60 * 1000;
    const remainingMs = lockoutEnds - Date.now();
    const remainingMinutes = Math.ceil(remainingMs / 60000);

    return { locked: true, remainingMinutes: Math.max(1, remainingMinutes), remainingAttempts: 0 };
  }

  return { locked: false, remainingAttempts };
}

/**
 * Record a login attempt (success or failure).
 * Fire-and-forget — does not block the login response.
 */
export function recordLoginAttempt(
  email: string,
  ip: string | undefined,
  userAgent: string | undefined,
  success: boolean
): void {
  const normalizedEmail = email.trim().toLowerCase();
  db.query(
    `INSERT INTO login_attempts (email, ip, user_agent, success)
     VALUES ($1, $2, $3, $4)`,
    [normalizedEmail, ip || null, userAgent || null, success]
  ).catch(err => logger.error('[LoginGuard] Failed to record attempt:', err.message));
}
