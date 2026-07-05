import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../database/db.js';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { auditLog } from '../middleware/audit.js';
import { logAudit } from '../services/audit.service.js';
import { validatePasswordStrength } from '../utils/password-validator.js';
import { blacklistAllUserTokens } from '../services/token-blacklist.service.js';
import { invalidateAuthCache } from '../services/auth-cache.service.js';
import { normalizeCustomerAccountType } from '../services/account-discounts.service.js';
import { clearAuthCookies } from './auth-cookies.js';
import { recordPhoneOtpEventSafely } from '../services/phone-otp-event.service.js';
import type {
  CreatedStaffUserRow,
  DeletedSelfUserRow,
  EducationEligibilityRow,
  PhoneRequirementSkipUserRow,
  StaffListUserRow,
  StaffUserIdRow,
} from '../types/views/users-views.js';

import { createLogger } from '../utils/logger.js';
const router = express.Router();

const logger = createLogger('users.routes');

const ALLOWED_DEPARTMENTS = ['photography', 'retouching', 'printing', 'reception', 'management'] as const;
type Department = typeof ALLOWED_DEPARTMENTS[number];

function isValidDepartment(value: unknown): value is Department {
  return typeof value === 'string' && ALLOWED_DEPARTMENTS.some(department => department === value);
}

function readObjectBody(value: unknown): object {
  return typeof value === 'object' && value !== null ? value : {};
}

function readStringField(source: object, key: string): string | undefined {
  const value = Reflect.get(source, key);
  return typeof value === 'string' ? value : undefined;
}

function readNullableStringField(source: object, key: string): string | null | undefined {
  const value = Reflect.get(source, key);
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function readBooleanField(source: object, key: string): boolean | undefined {
  const value = Reflect.get(source, key);
  return typeof value === 'boolean' ? value : undefined;
}

function readQueryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function addStaffChatMemberships(userId: string): Promise<void> {
  const GENERAL_CHAT_ID = '00000000-0000-0000-0000-000000000001';
  await db.query(
    `INSERT INTO staff_conversation_participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [GENERAL_CHAT_ID, userId],
  );

  const otherStaff = await db.query<StaffUserIdRow>(
    `SELECT id FROM users
     WHERE role IN ('admin', 'manager', 'employee', 'photographer')
       AND is_active = true AND id != $1`,
    [userId],
  );

  for (const other of otherStaff) {
    const convId = crypto.randomUUID();
    await db.query(
      `INSERT INTO staff_conversations (id, type, created_by, last_message_preview)
       VALUES ($1, 'direct', $2, '')`,
      [convId, userId],
    );
    await db.query(
      `INSERT INTO staff_conversation_participants (conversation_id, user_id, role)
       VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
      [convId, userId, other.id],
    );
  }
}

async function invalidateAuthCacheLogged(userId: string, reason: string): Promise<void> {
  try {
    await invalidateAuthCache(userId);
  } catch (error: unknown) {
    logger.warn('Failed to invalidate auth cache', {
      userId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function computeDisplayName(first: string | null | undefined, last: string | null | undefined, fallback?: string | null): string | null {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (l && f) return `${l} ${f}`;
  if (l) return l;
  if (f) return f;
  return fallback ?? null;
}

// All routes require authentication
router.use(authenticateToken);

// Get current user profile
router.get('/me', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const user = await db.queryOne(
    `SELECT id, email, username, display_name, first_name, last_name, department, phone, photo_url,
            role, email_verified, phone_verified, is_active, account_type, personal_data, preferences,
            linked_accounts, created_at, updated_at
     FROM users WHERE id = $1`,
    [req.user.id]
  );

  if (!user) {
    throw new AppError(404, 'User not found');
  }

  res.json({ success: true, data: user });
});

// Update current user profile
router.put('/me', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const {
    display_name,
    first_name,
    last_name,
    phone,
    photo_url,
    account_type,
    personal_data,
    preferences,
  } = req.body;

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  const firstProvided = first_name !== undefined;
  const lastProvided = last_name !== undefined;
  const nameProvided = display_name !== undefined;

  if (firstProvided) {
    updates.push(`first_name = $${paramIndex++}`);
    values.push(first_name);
  }
  if (lastProvided) {
    updates.push(`last_name = $${paramIndex++}`);
    values.push(last_name);
  }

  if (nameProvided) {
    updates.push(`display_name = $${paramIndex++}`);
    values.push(display_name);
  } else if (firstProvided || lastProvided) {
    const fIdx = firstProvided ? `$${paramIndex - (lastProvided ? 2 : 1)}` : 'first_name';
    const lIdx = lastProvided ? `$${paramIndex - 1}` : 'last_name';
    updates.push(`display_name = NULLIF(TRIM(CONCAT_WS(' ', ${lIdx}, ${fIdx})), '')`);
  }
  if (phone !== undefined) {
    updates.push(`phone = $${paramIndex++}`);
    values.push(phone);
  }
  if (photo_url !== undefined) {
    updates.push(`photo_url = $${paramIndex++}`);
    values.push(photo_url);
  }
  if (account_type !== undefined) {
    const normalizedAccountType = normalizeCustomerAccountType(account_type);
    if (!normalizedAccountType) {
      throw new AppError(400, 'account_type must be personal, education, or business');
    }
    if (normalizedAccountType === 'education') {
      const verifiedAccount = await db.queryOne<EducationEligibilityRow>(
        `SELECT id
         FROM student_accounts
         WHERE user_id = $1
           AND status = 'verified'
           AND (expires_at IS NULL OR expires_at >= NOW())
         LIMIT 1`,
        [req.user.id],
      );
      if (!verifiedAccount) {
        throw new AppError(403, 'Образовательный аккаунт доступен после подтверждения статуса');
      }
    }
    updates.push(`account_type = $${paramIndex++}`);
    values.push(normalizedAccountType);
  }
  if (personal_data !== undefined) {
    updates.push(`personal_data = $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(personal_data));
  }
  if (preferences !== undefined) {
    updates.push(`preferences = $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(preferences));
  }

  if (updates.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  values.push(req.user.id);

  const query = `
    UPDATE users
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = $${paramIndex}
    RETURNING id, email, username, display_name, first_name, last_name, department, phone, photo_url,
              role, email_verified, phone_verified, is_active, account_type, personal_data, preferences,
              linked_accounts, created_at, updated_at
  `;

  const updatedUser = await db.queryOne(query, values);

  if (!updatedUser) {
    throw new AppError(404, 'User not found');
  }

  res.json({ success: true, data: updatedUser });
});

// Let an already-authenticated OAuth/email user continue if the OTP call does not arrive.
router.post('/me/phone-requirement-skip', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const userId = req.user.id;
  const body = readObjectBody(req.body);
  const attemptedPhone = readStringField(body, 'attemptedPhone');
  const currentUser = await db.queryOne<PhoneRequirementSkipUserRow>(
    `SELECT id, email, username, display_name, first_name, last_name, department, phone, photo_url,
            role, email_verified, phone_verified, is_active, account_type, personal_data, preferences,
            linked_accounts, created_at, updated_at
       FROM users
      WHERE id = $1`,
    [userId],
  );

  if (!currentUser) {
    throw new AppError(404, 'Пользователь не найден');
  }

  if ((currentUser.phone ?? '').trim()) {
    throw new AppError(409, 'Телефон уже привязан к аккаунту');
  }

  const updatedUser = await db.queryOne<PhoneRequirementSkipUserRow>(
    `UPDATE users
        SET preferences = COALESCE(preferences, '{}'::jsonb) || jsonb_build_object(
              'phoneRequirementSkippedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'phoneRequirementSkipReason', 'voice_call_not_received',
              'phoneRequirementSkipSource', 'complete_profile'
            ),
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, username, display_name, first_name, last_name, department, phone, photo_url,
                role, email_verified, phone_verified, is_active, account_type, personal_data, preferences,
                linked_accounts, created_at, updated_at`,
    [userId],
  );

  if (!updatedUser) {
    throw new AppError(404, 'Пользователь не найден');
  }

  await invalidateAuthCacheLogged(userId, 'phone_requirement_skip');

  logAudit({
    userId,
    userName: req.user.display_name || req.user.email,
    action: 'phone_requirement_skipped',
    entityType: 'user',
    entityId: userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    details: { reason: 'voice_call_not_received' },
  });

  const attemptedPhoneDigits = attemptedPhone?.replace(/\D/g, '') ?? '';
  if (attemptedPhone && attemptedPhoneDigits.length >= 4) {
    await recordPhoneOtpEventSafely({
      userId,
      phone: attemptedPhone,
      eventType: 'phone_requirement_skipped',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: { reason: 'voice_call_not_received', hasPhone: false },
    });
  }

  res.json({ success: true, data: updatedUser });
});

// DELETE /api/users/me — self-service account deletion via anonymization.
router.delete('/me', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const userId = req.user.id;
  const anonymizedEmail = `deleted+${userId}@svoefoto.local`;

  const deletedUser = await db.transaction(async (client) => {
    const updateParams: unknown[] = [userId, anonymizedEmail];
    const updateResult = await client.query<DeletedSelfUserRow>(
      `UPDATE users
       SET email = CASE WHEN email IS NULL THEN NULL ELSE $2 END,
           username = NULL,
           display_name = 'Удалённый пользователь',
           first_name = NULL,
           last_name = NULL,
           phone = NULL,
           photo_url = NULL,
           email_verified = false,
           phone_verified = false,
           yandex_id = NULL,
           yandex_email = NULL,
           telegram_id = NULL,
           telegram_username = NULL,
           google_id = NULL,
           apple_id = NULL,
           vk_id = NULL,
           sber_id = NULL,
           mts_id = NULL,
           password_hash = NULL,
           personal_data = '{}'::jsonb,
           preferences = '{}'::jsonb,
           linked_accounts = '{}'::jsonb,
           accept_calls = false,
           two_factor_enabled = false,
           two_factor_method = NULL,
           force_password_change = true,
           is_active = false,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, display_name, is_active`,
      updateParams,
    );

    const row = updateResult.rows[0] ?? null;
    if (!row) return null;

    const userParams: unknown[] = [userId];
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', userParams);
    await client.query('DELETE FROM pending_oauth_links WHERE user_id = $1', userParams);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', userParams);

    return row;
  });

  if (!deletedUser) {
    throw new AppError(404, 'Пользователь не найден');
  }

  await blacklistAllUserTokens(userId);
  await invalidateAuthCacheLogged(userId, 'self_account_delete');
  clearAuthCookies(res);

  logAudit({
    userId,
    userName: req.user.display_name || req.user.email,
    action: 'account_deleted_self',
    entityType: 'user',
    entityId: userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    details: { anonymized: true },
  });

  res.json({ success: true, data: { ...deletedUser, deleted: true } });
});

// ─── Admin: управление пользователями ────────────────────────────────────────

// GET /api/users — список пользователей
router.get('/', requirePermission('users:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  const role = readQueryString(req.query['role']);
  const isActive = readQueryString(req.query['is_active']);
  const search = readQueryString(req.query['search']);

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (role) {
    conditions.push(`role = $${idx++}`);
    values.push(role);
  }
  if (isActive !== undefined) {
    conditions.push(`is_active = $${idx++}`);
    values.push(isActive === 'true');
  }
  if (search) {
    conditions.push(`(display_name ILIKE $${idx} OR first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx} OR phone ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const users = await db.query(
    `SELECT id, email, username, display_name, first_name, last_name, department, phone,
            photo_url, role, email_verified, phone_verified, is_active, account_type, created_at, updated_at
     FROM users ${where}
     ORDER BY last_name ASC NULLS LAST, first_name ASC NULLS LAST, display_name ASC`,
    values
  );

  res.json({ success: true, data: users });
});

// POST /api/users — создать сотрудника
router.post('/', requirePermission('users:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  const body = readObjectBody(req.body);
  const email = readStringField(body, 'email');
  const displayName = readStringField(body, 'display_name');
  const firstName = readStringField(body, 'first_name');
  const lastName = readStringField(body, 'last_name');
  const department = readStringField(body, 'department');
  const phone = readStringField(body, 'phone');
  const role = readStringField(body, 'role');
  const password = readStringField(body, 'password');

  const computedName = computeDisplayName(firstName, lastName, displayName);
  if (!email || !computedName || !password) {
    throw new AppError(400, 'email, password и (display_name или first_name/last_name) обязательны');
  }

  const ALLOWED_ROLES = ['employee', 'photographer', 'manager'];
  if (!role || !ALLOWED_ROLES.includes(role)) {
    throw new AppError(400, `role должен быть одним из: ${ALLOWED_ROLES.join(', ')}`);
  }

  if (department !== undefined && !isValidDepartment(department)) {
    throw new AppError(400, `department должен быть одним из: ${ALLOWED_DEPARTMENTS.join(', ')}`);
  }

  const pwCheck = validatePasswordStrength(password, email);
  if (!pwCheck.valid) {
    throw new AppError(400, `Слабый пароль: ${pwCheck.errors.join(', ')}`);
  }

  const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    throw new AppError(409, 'Пользователь с таким email уже существует');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await db.queryOne<CreatedStaffUserRow>(
    `INSERT INTO users (email, display_name, first_name, last_name, department, phone, role, password_hash, is_active, email_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, true)
     RETURNING id, email, display_name, first_name, last_name, department, phone, role, is_active, created_at`,
    [email, computedName, firstName || null, lastName || null, department || null, phone || null, role, passwordHash]
  );

  // Auto-join general staff chat + create direct chats with all existing staff
  if (user) {
    try {
      await addStaffChatMemberships(user.id);
    } catch (error: unknown) {
      logger.warn('Failed to add staff chat memberships for new user', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  res.status(201).json({ success: true, data: user });
});

// PUT /api/users/:id — обновить сотрудника
router.put('/:id', requirePermission('users:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'];
  const body = readObjectBody(req.body);
  const displayName = readNullableStringField(body, 'display_name');
  const firstName = readNullableStringField(body, 'first_name');
  const lastName = readNullableStringField(body, 'last_name');
  const department = readNullableStringField(body, 'department');
  const phone = readNullableStringField(body, 'phone');
  const role = readStringField(body, 'role');
  const isActive = readBooleanField(body, 'is_active');
  const password = readStringField(body, 'password');

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  const firstProvided = Reflect.has(body, 'first_name');
  const lastProvided = Reflect.has(body, 'last_name');
  const nameProvided = Reflect.has(body, 'display_name');

  if (firstProvided) {
    updates.push(`first_name = $${paramIdx++}`);
    values.push(firstName || null);
  }
  if (lastProvided) {
    updates.push(`last_name = $${paramIdx++}`);
    values.push(lastName || null);
  }

  if (nameProvided) {
    updates.push(`display_name = $${paramIdx++}`);
    values.push(displayName);
  } else if (firstProvided || lastProvided) {
    const fIdx = firstProvided ? `$${paramIdx - (lastProvided ? 2 : 1)}` : 'first_name';
    const lIdx = lastProvided ? `$${paramIdx - 1}` : 'last_name';
    updates.push(`display_name = NULLIF(TRIM(CONCAT_WS(' ', ${lIdx}, ${fIdx})), '')`);
  }

  if (Reflect.has(body, 'department')) {
    if (department !== null && !isValidDepartment(department)) {
      throw new AppError(400, `department должен быть одним из: ${ALLOWED_DEPARTMENTS.join(', ')}`);
    }
    updates.push(`department = $${paramIdx++}`);
    values.push(department || null);
  }

  if (Reflect.has(body, 'phone')) { updates.push(`phone = $${paramIdx++}`); values.push(phone); }
  if (role !== undefined) {
    const ALLOWED_ROLES = ['employee', 'photographer', 'manager', 'admin'];
    if (!ALLOWED_ROLES.includes(role)) {
      throw new AppError(400, `Недопустимая роль: ${role}`);
    }
    updates.push(`role = $${paramIdx++}`);
    values.push(role);
  }
  if (Reflect.has(body, 'is_active')) {
    if (isActive === undefined) {
      throw new AppError(400, 'is_active должен быть boolean');
    }
    updates.push(`is_active = $${paramIdx++}`);
    values.push(isActive);
  }
  const passwordChanged = !!password;
  if (password) {
    const pwCheck = validatePasswordStrength(password);
    if (!pwCheck.valid) {
      throw new AppError(400, `Слабый пароль: ${pwCheck.errors.join(', ')}`);
    }
    const hash = await bcrypt.hash(password, 12);
    updates.push(`password_hash = $${paramIdx++}`);
    values.push(hash);
    updates.push(`last_password_change = NOW()`);
  }

  if (updates.length === 0) {
    throw new AppError(400, 'Нет полей для обновления');
  }

  values.push(id);
  const user = await db.queryOne(
    `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIdx}
     RETURNING id, email, display_name, first_name, last_name, department, phone, role, is_active, updated_at`,
    values
  );

  if (!user) {
    throw new AppError(404, 'Пользователь не найден');
  }

  // Invalidate auth cache — role, password, or is_active may have changed
  await invalidateAuthCacheLogged(id, 'admin_user_update');

  if (passwordChanged) {
    // Отзываем все активные сессии пользователя — принудительный re-login
    await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [id]);
    // Blacklist all access tokens immediately via Redis
    await blacklistAllUserTokens(id);
    logAudit({
      userId: req.user?.id,
      userName: req.user?.display_name || req.user?.email,
      action: 'admin_password_reset',
      entityType: 'user',
      entityId: id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  res.json({ success: true, data: user });
});

// DELETE /api/users/:id — деактивировать (не удалять)
router.delete('/:id', requirePermission('users:manage'), auditLog('user_deactivate', 'user', 'id'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'];

  if (req.user?.id === id) {
    throw new AppError(403, 'Нельзя деактивировать собственный аккаунт');
  }

  const user = await db.queryOne(
    `UPDATE users SET is_active = false, updated_at = NOW()
     WHERE id = $1
     RETURNING id, email, display_name, is_active`,
    [id]
  );

  if (!user) {
    throw new AppError(404, 'Пользователь не найден');
  }

  // Invalidate auth cache — user deactivated
  await invalidateAuthCacheLogged(id, 'admin_user_deactivate');

  res.json({ success: true, data: user });
});

// ─── Staff list (для CRM — выбор сотрудника) ──────────────────────────────────

// GET /api/users/staff-list — список сотрудников (id, display_name, photo_url, role)
router.get('/staff-list', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const department = readQueryString(req.query['department']);
  const conditions: string[] = [`is_active = true`, `role IN ('employee', 'admin', 'manager', 'photographer')`];
  const values: unknown[] = [];

  if (department !== undefined && department !== '') {
    if (!isValidDepartment(department)) {
      throw new AppError(400, `department должен быть одним из: ${ALLOWED_DEPARTMENTS.join(', ')}`);
    }
    conditions.push(`department = $1`);
    values.push(department);
  }

  const staff = await db.query<StaffListUserRow>(
    `SELECT id, display_name, first_name, last_name, department, photo_url, role
     FROM users
     WHERE ${conditions.join(' AND ')}
     ORDER BY last_name ASC NULLS LAST, first_name ASC NULLS LAST, display_name ASC`,
    values,
  );

  res.json({ success: true, data: staff });
});

// ─── Public: профили по ID ────────────────────────────────────────────────────

// Get user by ID
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'];

  // Users can only see their own profile or admins can see anyone
  if (!req.user || (req.user.id !== id && req.user.role !== 'admin')) {
    throw new AppError(403, 'Forbidden');
  }

  const user = await db.queryOne(
    `SELECT id, email, username, display_name, first_name, last_name, department, phone, photo_url,
            role, email_verified, phone_verified, is_active, account_type, created_at, updated_at
     FROM users WHERE id = $1`,
    [id]
  );

  if (!user) {
    throw new AppError(404, 'User not found');
  }

  res.json({ success: true, data: user });
});

export default router;
