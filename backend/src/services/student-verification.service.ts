import type { PoolClient } from 'pg';
import db from '../database/db.js';
import { ErrorCode } from '../constants/error-codes.js';
import { AppError } from '../middleware/errorHandler.js';
import { storageService } from './storage.service.js';
import {
  STUDENT_ALLOWANCE_PERIOD_DAYS,
  STUDENT_DISCOUNT_PRINT_LIMIT,
  STUDENT_DISCOUNT_PRINT_PRICE,
  STUDENT_DISCOUNT_VERIFIED_PRINT_PRICE,
  currentStudentAllowancePeriodStartSql,
  ensureCurrentStudentAllowancePeriodWithClient,
  getStudentDiscountForUser,
  type StudentDiscountSummary,
} from './student-discount.service.js';
import { createLogger } from '../utils/logger.js';
import type {
  StudentAccountRow,
  StudentAllowancePeriodRow,
  EducationDocumentType,
  EducationRole,
  StudentReferralChannel,
  StudentVerificationRow,
  StudentVerificationStatus,
} from '../types/views/student-discount-views.js';
import type { IdOnly } from '../types/db-common.types.js';
import type { VerifiedFile } from '../routes/shared/presigned-upload.factory.js';

const log = createLogger('student-verification');

export const STUDENT_VERIFICATION_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

interface PendingVerificationLookupRow {
  id: string;
}

interface InPersonUserLookupRow {
  id: string;
  phone: string | null;
  display_name: string | null;
  email: string | null;
}

interface StudentVerificationUserPhoneRow {
  id: string;
  phone: string | null;
}

interface ReferrerCodeLookupRow {
  user_id: string | null;
}

interface StudentVerificationPrerequisiteRow {
  id: string;
  phone: string | null;
}

interface StudentVerificationAdminRow extends StudentVerificationRow {
  account_status: string | null;
  account_expires_at: string | null;
  user_email: string | null;
  user_phone: string | null;
  user_display_name: string | null;
  user_date_of_birth: string | null;
}

export interface StudentVerificationWithDocumentUrl extends StudentVerificationAdminRow {
  document_url: string | null;
}

export interface StudentVerificationStatusPayload {
  account: StudentAccountRow | null;
  latest_verification: StudentVerificationWithDocumentUrl | null;
  student_discount: StudentDiscountSummary | null;
}

export interface InPersonStudentVerificationPayload {
  verification: StudentVerificationWithDocumentUrl;
  matched_user: InPersonUserLookupRow | null;
  scheduled_send_at: string | null;
  scheduled_send_channel: string | null;
  /**
   * Канал, в который ссылка УЖЕ отправлена в личный чат прямо сейчас (web/telegram/…).
   * null — немедленной доставки не было (нет диалога/ошибка), сработает отложенный
   * scheduled_send_at. Взаимоисключим со scheduled_send_at в happy-path.
   */
  sent_to_chat_channel: string | null;
}

const CLEARED_EDUCATION_INSTITUTION = 'Образовательные данные удалены';

// Каналы, в которые имеет смысл слать ссылку подтверждения (deliverable messenger).
// Локальная копия, чтобы не тянуть delivery-сервис eager-импортом (см. ленивый
// import enqueueInPersonConfirmSend ниже). Должна совпадать с MESSENGER_CHANNELS
// в student-inperson-confirm-send.service.ts.
const IN_PERSON_TARGET_MESSENGER_CHANNELS = ['telegram', 'max', 'vk', 'whatsapp', 'instagram'];

const STUDENT_VERIFICATION_SELECT_COLUMNS = `
  v.id, v.account_id, v.user_id, v.status,
  COALESCE(v.source, 'online_upload')::text AS source,
  COALESCE(v.education_role, a.education_role, 'student')::text AS education_role,
  v.institution_name, v.document_type, v.document_expires_at,
  v.document_photo_key, v.document_photo_content_type, v.document_photo_size_bytes,
  v.phone_normalized, v.referral_channel, v.referred_by_user_id,
  v.verified_by_employee_id, v.confirmed_by_student_user_id,
  v.in_person_prepared_at, v.student_confirmed_at,
  v.consent_version, v.consented_at, v.consent_ip, v.consent_user_agent,
  v.employee_ip, v.employee_user_agent,
  v.education_fields_cleared_at, v.audit_retention_until,
  v.submitted_at, v.reviewed_at, v.reviewer_id, v.reject_reason, v.review_notes,
  v.retention_delete_after, v.photo_deleted_at, v.created_at, v.updated_at,
  a.status AS account_status, a.expires_at AS account_expires_at,
  u.email AS user_email, u.phone AS user_phone, u.display_name AS user_display_name,
  COALESCE(
    u.date_of_birth,
    CASE WHEN u.personal_data->>'dateOfBirth' ~ '^\\d{4}-\\d{2}-\\d{2}$'
         THEN (u.personal_data->>'dateOfBirth')::date END
  ) AS user_date_of_birth
`;

const STUDENT_VERIFICATION_LOCK_COLUMNS = `
  v.id, v.account_id, v.user_id, v.status,
  COALESCE(v.source, 'online_upload')::text AS source,
  COALESCE(v.education_role, 'student')::text AS education_role,
  v.institution_name, v.document_type, v.document_expires_at,
  v.document_photo_key, v.document_photo_content_type, v.document_photo_size_bytes,
  v.phone_normalized, v.referral_channel, v.referred_by_user_id,
  v.verified_by_employee_id, v.confirmed_by_student_user_id,
  v.in_person_prepared_at, v.student_confirmed_at,
  v.consent_version, v.consented_at, v.consent_ip, v.consent_user_agent,
  v.employee_ip, v.employee_user_agent,
  v.education_fields_cleared_at, v.audit_retention_until,
  v.submitted_at, v.reviewed_at, v.reviewer_id, v.reject_reason, v.review_notes,
  v.retention_delete_after, v.photo_deleted_at, v.created_at, v.updated_at
`;

function normalizeReviewExpiresAt(value: string): string {
  return `${value} 23:59:59+03`;
}

function retentionDeleteAfter(expiresAt: string | null): string {
  const base = expiresAt ? new Date(expiresAt) : new Date();
  const safeBase = Number.isFinite(base.getTime()) ? base : new Date();
  safeBase.setDate(safeBase.getDate() + 180);
  return safeBase.toISOString();
}

function normalizeFullRussianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return `7${digits.slice(1)}`;
  }
  throw new AppError(400, 'Введите полный российский номер телефона', ErrorCode.VALIDATION_ERROR);
}

function normalizeRequestText(value: string | readonly string[] | null | undefined): string | null {
  if (typeof value !== 'string') return value ? value.join(', ').slice(0, 500) : null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

function assertFutureDate(value: string): void {
  const expiresAt = new Date(`${value}T23:59:59+03:00`);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new AppError(400, 'Некорректная дата окончания документа', ErrorCode.VALIDATION_ERROR);
  }
  if (expiresAt <= new Date()) {
    throw new AppError(400, 'Дата окончания документа должна быть в будущем', ErrorCode.VALIDATION_ERROR);
  }
}

function requireVerificationUserId(verification: StudentVerificationRow): string {
  if (!verification.user_id) {
    throw new AppError(409, 'Заявка не привязана к клиенту', ErrorCode.VALIDATION_ERROR);
  }
  return verification.user_id;
}

function requireVerificationAccountId(verification: StudentVerificationRow): string {
  if (!verification.account_id) {
    throw new AppError(409, 'Заявка не привязана к образовательному аккаунту', ErrorCode.VALIDATION_ERROR);
  }
  return verification.account_id;
}

async function signedDocumentUrl(row: StudentVerificationRow): Promise<string | null> {
  if (row.photo_deleted_at || !row.document_photo_key) return null;
  try {
    return await storageService.generatePresignedGetUrl(row.document_photo_key, 15 * 60);
  } catch (err) {
    log.warn('Failed to sign student verification document URL', {
      verificationId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function withDocumentUrl(row: StudentVerificationAdminRow): Promise<StudentVerificationWithDocumentUrl> {
  return {
    ...row,
    document_url: await signedDocumentUrl(row),
  };
}

async function loadAccountByUser(userId: string): Promise<StudentAccountRow | null> {
  return db.queryOne<StudentAccountRow>(
    `SELECT id, user_id, status,
            COALESCE(education_role, 'student')::text AS education_role,
            institution_name, document_number, verified_at, expires_at,
            reviewer_id, reject_reason, revoke_reason, created_at, updated_at
     FROM student_accounts
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
}

async function loadLatestVerificationByUser(userId: string): Promise<StudentVerificationAdminRow | null> {
  return db.queryOne<StudentVerificationAdminRow>(
    `SELECT ${STUDENT_VERIFICATION_SELECT_COLUMNS}
     FROM student_verifications v
     LEFT JOIN student_accounts a ON a.id = v.account_id
     LEFT JOIN users u ON u.id = v.user_id
     WHERE v.user_id = $1
     ORDER BY v.submitted_at DESC
     LIMIT 1`,
    [userId],
  );
}

async function assertNoPendingVerification(client: PoolClient, userId: string): Promise<void> {
  const pending = await client.query<PendingVerificationLookupRow>(
    `SELECT id
     FROM student_verifications
     WHERE user_id = $1 AND status IN ('pending', 'pending_in_person')
     LIMIT 1`,
    [userId],
  );
  if (pending.rows[0]) {
    throw new AppError(409, 'Заявка на проверку уже ожидает решения', ErrorCode.VALIDATION_ERROR);
  }
}

async function assertStudentVerificationPrerequisites(client: PoolClient, userId: string): Promise<void> {
  const values: unknown[] = [userId];
  const result = await client.query<StudentVerificationPrerequisiteRow>(
    `SELECT id, phone
     FROM users
     WHERE id = $1
     LIMIT 1`,
    values,
  );

  const user = result.rows[0];
  if (!user) {
    throw new AppError(404, 'Пользователь не найден', ErrorCode.NOT_FOUND);
  }

  // Student verification only needs a phone bound to the account. Phone login
  // already proves ownership, and legacy users may still have phone_verified=false.
  if (!user.phone?.trim()) {
    throw new AppError(
      409,
      'Укажите телефон в личном кабинете перед отправкой заявки',
      ErrorCode.VALIDATION_ERROR,
    );
  }
}

async function upsertSubmissionAccount(
  client: PoolClient,
  params: {
    userId: string;
    educationRole: EducationRole;
    institutionName: string;
    documentExpiresAt: string | null;
  },
): Promise<StudentAccountRow> {
  const existing = await client.query<StudentAccountRow>(
    `SELECT id, user_id, status,
            COALESCE(education_role, 'student')::text AS education_role,
            institution_name, document_number, verified_at, expires_at,
            reviewer_id, reject_reason, revoke_reason, created_at, updated_at
     FROM student_accounts
     WHERE user_id = $1
     FOR UPDATE`,
    [params.userId],
  );
  if (existing.rows[0]?.status === 'revoked') {
    throw new AppError(403, 'Образовательный статус отозван. Обратитесь к сотруднику', ErrorCode.FORBIDDEN);
  }

  const result = await client.query<StudentAccountRow>(
    `INSERT INTO student_accounts (user_id, status, education_role, institution_name, expires_at)
     VALUES ($1, 'pending', $2, $3, $4::timestamptz)
     ON CONFLICT (user_id) DO UPDATE SET
       status = CASE
         WHEN student_accounts.status = 'verified' THEN student_accounts.status
         ELSE 'pending'
       END,
       education_role = EXCLUDED.education_role,
       institution_name = EXCLUDED.institution_name,
       expires_at = CASE
         WHEN student_accounts.status = 'verified' THEN student_accounts.expires_at
         ELSE EXCLUDED.expires_at
       END,
       reject_reason = NULL,
       revoke_reason = NULL,
       updated_at = NOW()
     RETURNING id, user_id, status, education_role, institution_name, document_number, verified_at, expires_at,
               reviewer_id, reject_reason, revoke_reason, created_at, updated_at`,
    [params.userId, params.educationRole, params.institutionName, params.documentExpiresAt],
  );
  const account = result.rows[0];
  if (!account) {
    throw new AppError(500, 'Не удалось создать образовательный аккаунт', ErrorCode.INTERNAL_ERROR);
  }
  return account;
}

async function upsertVerifiedStudentAccount(
  client: PoolClient,
  params: {
    userId: string;
    educationRole: EducationRole;
    institutionName: string;
    expiresAt: string;
    reviewerId: string | null;
  },
): Promise<StudentAccountRow> {
  const result = await client.query<StudentAccountRow>(
    `INSERT INTO student_accounts (user_id, status, education_role, institution_name, verified_at, expires_at, reviewer_id)
     VALUES ($1, 'verified', $2, $3, NOW(), $4::timestamptz, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       status = 'verified',
       education_role = EXCLUDED.education_role,
       institution_name = EXCLUDED.institution_name,
       verified_at = COALESCE(student_accounts.verified_at, NOW()),
       expires_at = EXCLUDED.expires_at,
       reviewer_id = EXCLUDED.reviewer_id,
       reject_reason = NULL,
       revoke_reason = NULL,
       updated_at = NOW()
     RETURNING id, user_id, status, education_role, institution_name, document_number, verified_at, expires_at,
               reviewer_id, reject_reason, revoke_reason, created_at, updated_at`,
    [params.userId, params.educationRole, params.institutionName, params.expiresAt, params.reviewerId],
  );
  const account = result.rows[0];
  if (!account) {
    throw new AppError(500, 'Не удалось подтвердить образовательный аккаунт', ErrorCode.INTERNAL_ERROR);
  }
  return account;
}

async function upsertVerifiedEducationEntitlement(
  client: PoolClient,
  params: {
    userId: string;
    accountId: string;
    expiresAt: string;
  },
): Promise<void> {
  // Подтверждение статуса само по себе даёт тариф «без подписки» (документы −50%,
  // фото −30%). Не понижаем уже оплаченную подписку: если запись
  // 'education_subscription', сохраняем её.
  const entitlementResult = await client.query<IdOnly>(
    `INSERT INTO student_discount_entitlements
       (user_id, status, source_token, source_url, student_account_id, activated_at, expires_at)
     VALUES ($1, 'active', 'education_verified', NULL, $2, NOW(), $3::timestamptz)
     ON CONFLICT (user_id) DO UPDATE SET
       status = 'active',
       student_account_id = EXCLUDED.student_account_id,
       source_token = CASE
         WHEN student_discount_entitlements.source_token = 'education_subscription'
              AND student_discount_entitlements.status = 'active'
           THEN 'education_subscription'
         ELSE 'education_verified'
       END,
       expires_at = GREATEST(
         COALESCE(student_discount_entitlements.expires_at, EXCLUDED.expires_at),
         EXCLUDED.expires_at
       ),
       updated_at = NOW()
     RETURNING id`,
    [params.userId, params.accountId, params.expiresAt],
  );
  const entitlement = entitlementResult.rows[0];
  if (entitlement) {
    await ensureCurrentStudentAllowancePeriodWithClient(client, {
      entitlementId: entitlement.id,
      userId: params.userId,
      lock: false,
    });
  }
}

export async function getMyStudentVerificationStatus(userId: string): Promise<StudentVerificationStatusPayload> {
  const [account, latest, studentDiscount] = await Promise.all([
    loadAccountByUser(userId),
    loadLatestVerificationByUser(userId),
    getStudentDiscountForUser(userId),
  ]);

  return {
    account,
    latest_verification: latest ? await withDocumentUrl(latest) : null,
    student_discount: studentDiscount,
  };
}

export async function submitStudentVerification(params: {
  userId: string;
  educationRole?: EducationRole;
  institutionName: string;
  documentExpiresAt: string | null;
  file: VerifiedFile;
}): Promise<StudentVerificationStatusPayload> {
  if (!STUDENT_VERIFICATION_IMAGE_MIMES.has(params.file.contentType)) {
    throw new AppError(400, 'Загрузите фото документа в формате JPEG, PNG, WEBP или HEIC', ErrorCode.VALIDATION_ERROR);
  }

  const educationRole = params.educationRole ?? 'student';

  await db.transaction(async client => {
    await assertStudentVerificationPrerequisites(client, params.userId);
    await assertNoPendingVerification(client, params.userId);
    const account = await upsertSubmissionAccount(client, {
      userId: params.userId,
      educationRole,
      institutionName: params.institutionName,
      documentExpiresAt: params.documentExpiresAt,
    });

    await client.query<StudentVerificationRow>(
      `INSERT INTO student_verifications (
         account_id, user_id, status, source, education_role, institution_name, document_expires_at,
         document_photo_key, document_photo_content_type, document_photo_size_bytes,
         retention_delete_after
       )
       VALUES ($1, $2, 'pending', 'online_upload', $3, $4, $5::date, $6, $7, $8, NOW() + INTERVAL '18 months')`,
      [
        account.id,
        params.userId,
        educationRole,
        params.institutionName,
        params.documentExpiresAt,
        params.file.s3Key,
        params.file.contentType,
        params.file.fileSize,
      ],
    );
  });

  return getMyStudentVerificationStatus(params.userId);
}

export async function listStudentVerifications(params: {
  status: StudentVerificationStatus | 'all';
  limit: number;
}): Promise<StudentVerificationWithDocumentUrl[]> {
  const values: unknown[] = [params.limit];
  const statusWhere = params.status === 'all' ? '' : 'WHERE v.status = $2';
  if (params.status !== 'all') {
    values.push(params.status);
  }

  const rows = await db.query<StudentVerificationAdminRow>(
    `SELECT ${STUDENT_VERIFICATION_SELECT_COLUMNS}
     FROM student_verifications v
     LEFT JOIN student_accounts a ON a.id = v.account_id
     LEFT JOIN users u ON u.id = v.user_id
     ${statusWhere}
     ORDER BY CASE WHEN v.status IN ('pending', 'pending_in_person') THEN 0 ELSE 1 END, v.submitted_at DESC
     LIMIT $1`,
    values,
  );

  const result: StudentVerificationWithDocumentUrl[] = [];
  for (const row of rows) {
    result.push(await withDocumentUrl(row));
  }
  return result;
}

async function findUserByFullPhone(client: PoolClient, normalizedPhone: string): Promise<InPersonUserLookupRow | null> {
  const result = await client.query<InPersonUserLookupRow>(
    `SELECT id, phone, display_name, email
     FROM users
     WHERE phone IS NOT NULL
       AND ('7' || RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10)) = $1
     LIMIT 1`,
    [normalizedPhone],
  );
  return result.rows[0] ?? null;
}

async function createInPersonStudentClientByPhone(
  client: PoolClient,
  normalizedPhone: string,
): Promise<InPersonUserLookupRow> {
  const result = await client.query<InPersonUserLookupRow>(
    `INSERT INTO users (phone, phone_verified, role, is_active, created_at, updated_at)
     VALUES ($1, false, 'client', true, NOW(), NOW())
     RETURNING id, phone, display_name, email`,
    [normalizedPhone],
  );
  const user = result.rows[0];
  if (!user) {
    throw new AppError(500, 'Не удалось создать клиентский аккаунт для образовательного статуса', ErrorCode.INTERNAL_ERROR);
  }
  return user;
}

/**
 * Read-only поиск клиента по полному телефону — для живого превью в форме очной заявки.
 * Использует ровно ту же логику матчинга, что и prepare, чтобы превью совпадало с реальной привязкой.
 */
export async function lookupInPersonStudentClientByPhone(phone: string): Promise<InPersonUserLookupRow | null> {
  const phoneNormalized = normalizeFullRussianPhone(phone);
  const rows = await db.query<InPersonUserLookupRow>(
    `SELECT id, phone, display_name, email
     FROM users
     WHERE phone IS NOT NULL
       AND ('7' || RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10)) = $1
     LIMIT 1`,
    [phoneNormalized],
  );
  return rows[0] ?? null;
}

async function resolveReferrerUserId(
  client: PoolClient,
  referrerCode: string | null | undefined,
  referrerPhone: string | null | undefined,
): Promise<string | null> {
  const code = referrerCode?.trim();
  if (code) {
    const result = await client.query<ReferrerCodeLookupRow>(
      `SELECT user_id
       FROM loyalty_profiles
       WHERE referral_code = $1
         AND user_id IS NOT NULL
       LIMIT 1`,
      [code],
    );
    const userId = result.rows[0]?.user_id;
    if (userId) return userId;
  }

  if (!referrerPhone?.trim()) return null;
  let normalizedPhone: string;
  try {
    normalizedPhone = normalizeFullRussianPhone(referrerPhone);
  } catch {
    return null;
  }
  const referrer = await findUserByFullPhone(client, normalizedPhone);
  return referrer?.id ?? null;
}

async function loadUserPhoneForConfirmation(client: PoolClient, userId: string): Promise<StudentVerificationUserPhoneRow> {
  const result = await client.query<StudentVerificationUserPhoneRow>(
    `SELECT id, phone
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user) {
    throw new AppError(404, 'Пользователь не найден', ErrorCode.NOT_FOUND);
  }
  if (!user.phone?.trim()) {
    throw new AppError(409, 'Войдите по телефону перед подтверждением студенческой программы', ErrorCode.VALIDATION_ERROR);
  }
  return user;
}

async function lockInPersonVerification(
  client: PoolClient,
  verificationId: string,
): Promise<StudentVerificationRow> {
  const result = await client.query<StudentVerificationRow>(
    `SELECT ${STUDENT_VERIFICATION_LOCK_COLUMNS}
     FROM student_verifications v
     WHERE v.id = $1
     FOR UPDATE`,
    [verificationId],
  );
  const verification = result.rows[0];
  if (!verification) {
    throw new AppError(404, 'Очная заявка не найдена', ErrorCode.NOT_FOUND);
  }
  if (verification.status !== 'pending_in_person' || verification.source !== 'in_person') {
    throw new AppError(409, 'Очная заявка уже обработана', ErrorCode.VALIDATION_ERROR);
  }
  return verification;
}

export async function prepareInPersonStudentVerification(params: {
  phone: string;
  employeeId: string;
  institutionName: string;
  educationRole: EducationRole;
  documentType: EducationDocumentType;
  documentExpiresAt: string;
  referralChannel: StudentReferralChannel;
  referrerPhone?: string | null;
  referrerCode?: string | null;
  conversationId?: string | null;
  requestIp?: string | null;
  requestUserAgent?: string | readonly string[] | null;
}): Promise<InPersonStudentVerificationPayload> {
  const phoneNormalized = normalizeFullRussianPhone(params.phone);
  assertFutureDate(params.documentExpiresAt);

  const tx = await db.transaction(async client => {
    const matchedUser = await findUserByFullPhone(client, phoneNormalized)
      ?? await createInPersonStudentClientByPhone(client, phoneNormalized);
    const referredByUserId = await resolveReferrerUserId(client, params.referrerCode, params.referrerPhone);
    const expiresAt = normalizeReviewExpiresAt(params.documentExpiresAt);

    // Диалог регистрации: сохраняем target для аудита/старых ссылок и привязываем
    // conversations.user_id, но больше не шлём клиенту отдельную ссылку подтверждения.
    let immediateConversationId: string | null = null;
    let messengerTargetId: string | null = null;
    if (params.conversationId) {
      const conv = await client.query<{ channel: string; ext: string | null }>(
        `SELECT channel::text AS channel,
                COALESCE(external_chat_id, metadata->>'externalChatId') AS ext
           FROM conversations
          WHERE id = $1`,
        [params.conversationId],
      );
      const row = conv.rows[0];
      if (row) {
        immediateConversationId = params.conversationId;
        if (row.ext && IN_PERSON_TARGET_MESSENGER_CHANNELS.includes(row.channel)) {
          messengerTargetId = params.conversationId;
        }
      }
    }

    const account = await upsertVerifiedStudentAccount(client, {
      userId: matchedUser.id,
      educationRole: params.educationRole,
      institutionName: params.institutionName,
      expiresAt,
      reviewerId: params.employeeId,
    });

    const preparedResult = await client.query<StudentVerificationRow>(
      `INSERT INTO student_verifications (
         account_id, user_id, status, source, education_role, institution_name,
         document_type, document_expires_at,
         document_photo_key, document_photo_content_type, document_photo_size_bytes,
         phone_normalized, referral_channel, referred_by_user_id,
         verified_by_employee_id, reviewer_id, in_person_prepared_at,
         employee_ip, employee_user_agent, retention_delete_after,
         target_conversation_id
       )
       VALUES (
         NULL, $1, 'pending_in_person', 'in_person', $2, $3,
         $4, $5::date,
         NULL, NULL, NULL,
         $6, $7, $8,
         $9, $9, NOW(),
         $10, $11, $12::timestamptz,
         $13
       )
       ON CONFLICT (phone_normalized)
         WHERE phone_normalized IS NOT NULL AND status = 'pending_in_person'
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         education_role = EXCLUDED.education_role,
         institution_name = EXCLUDED.institution_name,
         document_type = EXCLUDED.document_type,
         document_expires_at = EXCLUDED.document_expires_at,
         referral_channel = EXCLUDED.referral_channel,
         referred_by_user_id = EXCLUDED.referred_by_user_id,
         verified_by_employee_id = EXCLUDED.verified_by_employee_id,
         reviewer_id = EXCLUDED.reviewer_id,
         in_person_prepared_at = NOW(),
         employee_ip = EXCLUDED.employee_ip,
         employee_user_agent = EXCLUDED.employee_user_agent,
         retention_delete_after = EXCLUDED.retention_delete_after,
         target_conversation_id = EXCLUDED.target_conversation_id,
         updated_at = NOW()
       RETURNING id`,
      [
        matchedUser.id,
        params.educationRole,
        params.institutionName,
        params.documentType,
        params.documentExpiresAt,
        phoneNormalized,
        params.referralChannel,
        referredByUserId,
        params.employeeId,
        normalizeRequestText(params.requestIp),
        normalizeRequestText(params.requestUserAgent),
        retentionDeleteAfter(normalizeReviewExpiresAt(params.documentExpiresAt)),
        messengerTargetId,
      ],
    );
    const prepared = preparedResult.rows[0];
    if (!prepared) {
      throw new AppError(500, 'Не удалось подготовить очную проверку', ErrorCode.INTERNAL_ERROR);
    }

    await client.query(
      `UPDATE student_verifications
          SET account_id = $2,
              user_id = $3,
              status = 'approved',
              reviewed_at = NOW(),
              reviewer_id = COALESCE(reviewer_id, verified_by_employee_id, $4),
              retention_delete_after = $5::timestamptz,
              audit_retention_until = NOW() + INTERVAL '3 years',
              updated_at = NOW()
        WHERE id = $1`,
      [
        prepared.id,
        account.id,
        matchedUser.id,
        params.employeeId,
        retentionDeleteAfter(expiresAt),
      ],
    );

    await upsertVerifiedEducationEntitlement(client, {
      userId: matchedUser.id,
      accountId: account.id,
      expiresAt,
    });

    await client.query(
      `UPDATE student_inperson_confirm_sends
          SET status = 'canceled',
              last_error = 'in_person_auto_approved',
              updated_at = NOW()
        WHERE verification_id = $1
          AND status IN ('pending', 'sending', 'failed', 'skipped')`,
      [prepared.id],
    );

    const verificationResult = await client.query<StudentVerificationAdminRow>(
      `SELECT ${STUDENT_VERIFICATION_SELECT_COLUMNS}
       FROM student_verifications v
       LEFT JOIN student_accounts a ON a.id = v.account_id
       LEFT JOIN users u ON u.id = v.user_id
       WHERE v.id = $1
       LIMIT 1`,
      [prepared.id],
    );
    const verification = verificationResult.rows[0];
    if (!verification) {
      throw new AppError(500, 'Не удалось подтвердить очную проверку', ErrorCode.INTERNAL_ERROR);
    }

    // Link-client (семантика «привязан»): если по телефону нашли user и регистрируем
    // из конкретного диалога — точечно проставляем conversations.user_id (любой канал),
    // чтобы оператор видел привязку. БЕЗ mergeContactRecords и БЕЗ contacts.user_id
    // (иначе риск нарушить unique ux_contacts_user_id_active). Не перехватываем диалог,
    // уже привязанный к другому.
    if (matchedUser && immediateConversationId) {
      await client.query(
        `UPDATE conversations
            SET user_id = $1, updated_at = NOW()
          WHERE id = $2
            AND (user_id IS NULL OR user_id = $1)`,
        [matchedUser.id, immediateConversationId],
      );
      log.info('In-person prepare linked conversation to user', {
        conversationId: immediateConversationId,
        userId: matchedUser.id,
      });
    }

    return { verification, matchedUser };
  });

  const { verification, matchedUser } = tx;

  return {
    verification: await withDocumentUrl({
      ...verification,
      user_email: matchedUser?.email ?? null,
      user_phone: matchedUser?.phone ?? null,
      user_display_name: matchedUser?.display_name ?? null,
    }),
    matched_user: matchedUser,
    scheduled_send_at: null,
    scheduled_send_channel: null,
    sent_to_chat_channel: null,
  };
}

export async function getPendingInPersonStudentVerification(userId: string): Promise<StudentVerificationWithDocumentUrl | null> {
  return db.transaction(async client => {
    const user = await loadUserPhoneForConfirmation(client, userId);
    const phoneNormalized = normalizeFullRussianPhone(user.phone ?? '');
    const result = await client.query<StudentVerificationAdminRow>(
      `SELECT ${STUDENT_VERIFICATION_SELECT_COLUMNS}
       FROM student_verifications v
       LEFT JOIN student_accounts a ON a.id = v.account_id
       LEFT JOIN users u ON u.id = COALESCE(v.user_id, $1::uuid)
       WHERE v.status = 'pending_in_person'
         AND v.source = 'in_person'
         AND v.phone_normalized = $2
         AND (v.user_id IS NULL OR v.user_id = $1)
       ORDER BY v.submitted_at DESC
       LIMIT 1`,
      [userId, phoneNormalized],
    );
    const verification = result.rows[0];
    return verification ? withDocumentUrl(verification) : null;
  });
}

export async function confirmInPersonStudentVerification(params: {
  verificationId: string;
  userId: string;
  consentVersion: string;
  marketingConsent?: boolean;
  requestIp?: string | null;
  requestUserAgent?: string | readonly string[] | null;
}): Promise<StudentVerificationStatusPayload> {
  await db.transaction(async client => {
    const verification = await lockInPersonVerification(client, params.verificationId);
    if (verification.user_id && verification.user_id !== params.userId) {
      throw new AppError(403, 'Эта очная заявка привязана к другому клиенту', ErrorCode.FORBIDDEN);
    }

    const user = await loadUserPhoneForConfirmation(client, params.userId);
    const userPhoneNormalized = normalizeFullRussianPhone(user.phone ?? '');
    if (!verification.phone_normalized || verification.phone_normalized !== userPhoneNormalized) {
      throw new AppError(403, 'Телефон сессии не совпадает с телефоном очной заявки', ErrorCode.FORBIDDEN);
    }

    const documentExpiresAt = verification.document_expires_at;
    if (!documentExpiresAt) {
      throw new AppError(409, 'У очной заявки не указана дата окончания документа', ErrorCode.VALIDATION_ERROR);
    }
    const expiresAt = normalizeReviewExpiresAt(documentExpiresAt);
    const account = await upsertVerifiedStudentAccount(client, {
      userId: params.userId,
      educationRole: verification.education_role,
      institutionName: verification.institution_name,
      expiresAt,
      reviewerId: verification.verified_by_employee_id,
    });

    await client.query(
      `UPDATE student_verifications
          SET account_id = $2,
              user_id = $3,
              status = 'approved',
              reviewed_at = NOW(),
              reviewer_id = COALESCE(reviewer_id, verified_by_employee_id),
              confirmed_by_student_user_id = $3,
              student_confirmed_at = NOW(),
              consent_version = $4,
              consented_at = NOW(),
              consent_ip = $5,
              consent_user_agent = $6,
              retention_delete_after = $7::timestamptz,
              audit_retention_until = NOW() + INTERVAL '3 years',
              updated_at = NOW()
        WHERE id = $1`,
      [
        verification.id,
        account.id,
        params.userId,
        params.consentVersion,
        normalizeRequestText(params.requestIp),
        normalizeRequestText(params.requestUserAgent),
        retentionDeleteAfter(expiresAt),
      ],
    );

    await upsertVerifiedEducationEntitlement(client, {
      userId: params.userId,
      accountId: account.id,
      expiresAt,
    });
  });

  return getMyStudentVerificationStatus(params.userId);
}

export async function withdrawStudentProgramConsent(params: {
  userId: string;
  reason?: string | null;
}): Promise<StudentVerificationStatusPayload> {
  const reason = params.reason?.trim() || 'student_program_consent_withdrawn';
  await db.transaction(async client => {
    const accountResult = await client.query<StudentAccountRow>(
      `UPDATE student_accounts
          SET status = 'revoked',
              revoke_reason = $2,
              updated_at = NOW()
        WHERE user_id = $1
          AND status IN ('pending', 'verified')
        RETURNING id, user_id, status, education_role, institution_name, document_number, verified_at, expires_at,
                  reviewer_id, reject_reason, revoke_reason, created_at, updated_at`,
      [params.userId, reason],
    );
    const account = accountResult.rows[0];
    if (!account) {
      throw new AppError(404, 'Активная студенческая программа не найдена', ErrorCode.NOT_FOUND);
    }

    await client.query(
      `UPDATE student_discount_entitlements
          SET status = 'revoked',
              updated_at = NOW()
        WHERE user_id = $1
          AND status = 'active'
          AND source_token IN ('education_verified', 'education_subscription')`,
      [params.userId],
    );

    await client.query(
      `UPDATE student_verifications
          SET status = CASE WHEN status = 'pending_in_person' THEN 'cancelled' ELSE status END,
              institution_name = $2,
              document_type = NULL,
              document_expires_at = NULL,
              phone_normalized = NULL,
              referral_channel = NULL,
              referred_by_user_id = NULL,
              education_fields_cleared_at = NOW(),
              updated_at = NOW()
        WHERE source = 'in_person'
          AND user_id = $1
          AND education_fields_cleared_at IS NULL`,
      [params.userId, CLEARED_EDUCATION_INSTITUTION],
    );
  });

  return getMyStudentVerificationStatus(params.userId);
}

async function lockVerification(
  client: PoolClient,
  verificationId: string,
): Promise<StudentVerificationRow> {
  const result = await client.query<StudentVerificationRow>(
    `SELECT ${STUDENT_VERIFICATION_LOCK_COLUMNS}
     FROM student_verifications v
     WHERE v.id = $1
     FOR UPDATE`,
    [verificationId],
  );
  const verification = result.rows[0];
  if (!verification) {
    throw new AppError(404, 'Заявка не найдена', ErrorCode.NOT_FOUND);
  }
  if (verification.status !== 'pending') {
    throw new AppError(409, 'Заявка уже обработана', ErrorCode.VALIDATION_ERROR);
  }
  return verification;
}

export async function approveStudentVerification(params: {
  verificationId: string;
  reviewerId: string;
  expiresAt: string;
  reviewNotes?: string | null;
}): Promise<StudentVerificationStatusPayload> {
  let userId = '';
  await db.transaction(async client => {
    const verification = await lockVerification(client, params.verificationId);
    userId = requireVerificationUserId(verification);
    const accountId = requireVerificationAccountId(verification);
    const expiresAt = normalizeReviewExpiresAt(params.expiresAt);

    await client.query(
      `UPDATE student_verifications
          SET status = 'approved',
              reviewed_at = NOW(),
              reviewer_id = $2,
              review_notes = $3,
              retention_delete_after = $4::timestamptz,
              updated_at = NOW()
        WHERE id = $1`,
      [verification.id, params.reviewerId, params.reviewNotes ?? null, retentionDeleteAfter(expiresAt)],
    );

    await client.query<StudentAccountRow>(
      `UPDATE student_accounts
          SET status = 'verified',
              institution_name = $2,
              education_role = $3,
              verified_at = NOW(),
              expires_at = $4::timestamptz,
              reviewer_id = $5,
              reject_reason = NULL,
              revoke_reason = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [accountId, verification.institution_name, verification.education_role, expiresAt, params.reviewerId],
    );

    await upsertVerifiedEducationEntitlement(client, { userId, accountId, expiresAt });
  });

  return getMyStudentVerificationStatus(userId);
}

export async function rejectStudentVerification(params: {
  verificationId: string;
  reviewerId: string;
  reason: string;
  reviewNotes?: string | null;
}): Promise<StudentVerificationStatusPayload> {
  let userId = '';
  await db.transaction(async client => {
    const verification = await lockVerification(client, params.verificationId);
    userId = requireVerificationUserId(verification);
    const accountId = requireVerificationAccountId(verification);

    await client.query(
      `UPDATE student_verifications
          SET status = 'rejected',
              reviewed_at = NOW(),
              reviewer_id = $2,
              reject_reason = $3,
              review_notes = $4,
              retention_delete_after = NOW() + INTERVAL '180 days',
              updated_at = NOW()
        WHERE id = $1`,
      [verification.id, params.reviewerId, params.reason, params.reviewNotes ?? null],
    );

    await client.query(
      `UPDATE student_accounts
          SET status = CASE WHEN status = 'verified' THEN status ELSE 'rejected' END,
              reject_reason = $2,
              reviewer_id = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [accountId, params.reason, params.reviewerId],
    );
  });

  return getMyStudentVerificationStatus(userId);
}

export async function revokeStudentAccount(params: {
  accountId: string;
  reviewerId: string;
  reason: string;
}): Promise<StudentVerificationStatusPayload> {
  const account = await db.transaction(async client => {
    const result = await client.query<StudentAccountRow>(
      `UPDATE student_accounts
          SET status = 'revoked',
              revoke_reason = $2,
              reviewer_id = $3,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, user_id, status, education_role, institution_name, document_number, verified_at, expires_at,
                  reviewer_id, reject_reason, revoke_reason, created_at, updated_at`,
      [params.accountId, params.reason, params.reviewerId],
    );
    const updated = result.rows[0];
    if (!updated) {
      throw new AppError(404, 'Образовательный аккаунт не найден', ErrorCode.NOT_FOUND);
    }
    await client.query(
      `UPDATE student_discount_entitlements
          SET status = 'revoked',
              updated_at = NOW()
        WHERE user_id = $1 AND status = 'active'`,
      [updated.user_id],
    );
    return updated;
  });

  return getMyStudentVerificationStatus(account.user_id);
}

export async function expireStudentAccounts(): Promise<number> {
  const expired = await db.query<StudentAccountRow>(
    `UPDATE student_accounts
        SET status = 'expired',
            updated_at = NOW()
      WHERE status = 'verified'
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
      RETURNING id, user_id, status, education_role, institution_name, document_number, verified_at, expires_at,
                reviewer_id, reject_reason, revoke_reason, created_at, updated_at`,
  );

  const userIds = expired.map(account => account.user_id);
  if (userIds.length > 0) {
    await db.query(
      `UPDATE student_discount_entitlements
          SET status = 'expired',
              updated_at = NOW()
        WHERE user_id = ANY($1::uuid[])
          AND status = 'active'`,
      [userIds],
    );
  }

  return expired.length;
}

export async function provisionStudentAllowancePeriods(): Promise<number> {
  const periodStartSql = currentStudentAllowancePeriodStartSql('s');
  const rows = await db.query<StudentAllowancePeriodRow>(
    `WITH current_period AS (
       SELECT
         s.id AS entitlement_id,
         s.user_id,
         s.source_token,
         ${periodStartSql} AS period_start
       FROM student_discount_entitlements s
       WHERE s.status = 'active'
         AND s.source_token IN ('education_subscription', 'education_verified')
         AND s.expires_at >= NOW()
         AND EXISTS (
           SELECT 1
           FROM student_accounts a
           WHERE a.id = s.student_account_id
             AND a.user_id = s.user_id
             AND a.status = 'verified'
             AND (a.expires_at IS NULL OR a.expires_at >= NOW())
         )
     )
     INSERT INTO student_allowance_periods (
       entitlement_id, user_id, period_start, period_end, sheet_limit, sheet_price
     )
     SELECT
       entitlement_id,
       user_id,
       period_start,
       period_start + INTERVAL '${STUDENT_ALLOWANCE_PERIOD_DAYS} days',
       $1,
       CASE WHEN source_token = 'education_subscription' THEN $2::numeric ELSE $3::numeric END
     FROM current_period
     ON CONFLICT (entitlement_id, period_start) DO UPDATE SET
       sheet_price = EXCLUDED.sheet_price
     RETURNING id, entitlement_id, user_id, period_start, period_end,
               sheet_limit, sheet_price, sheets_used, created_at, updated_at`,
    [STUDENT_DISCOUNT_PRINT_LIMIT, STUDENT_DISCOUNT_PRINT_PRICE, STUDENT_DISCOUNT_VERIFIED_PRINT_PRICE],
  );
  return rows.length;
}

export async function cleanupExpiredStudentVerificationPhotos(limit = 100): Promise<number> {
  const rows = await db.query<StudentVerificationRow>(
    `SELECT ${STUDENT_VERIFICATION_LOCK_COLUMNS}
     FROM student_verifications v
     WHERE photo_deleted_at IS NULL
       AND document_photo_key IS NOT NULL
       AND retention_delete_after IS NOT NULL
       AND retention_delete_after < NOW()
     ORDER BY retention_delete_after ASC
     LIMIT $1`,
    [limit],
  );

  let cleaned = 0;
  for (const row of rows) {
    if (!row.document_photo_key) continue;
    try {
      await storageService.delete(row.document_photo_key);
      await db.query(
        `UPDATE student_verifications
            SET photo_deleted_at = NOW(),
                updated_at = NOW()
          WHERE id = $1`,
        [row.id],
      );
      cleaned++;
    } catch (err) {
      log.warn('Failed to cleanup student verification photo', {
        verificationId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return cleaned;
}

export async function cleanupExpiredStudentEducationFields(limit = 100): Promise<number> {
  const rows = await db.query<IdOnly>(
    `SELECT id
     FROM student_verifications
     WHERE source = 'in_person'
       AND education_fields_cleared_at IS NULL
       AND retention_delete_after IS NOT NULL
       AND retention_delete_after < NOW()
     ORDER BY retention_delete_after ASC
     LIMIT $1`,
    [limit],
  );
  if (rows.length === 0) return 0;

  const ids = rows.map(row => row.id);
  await db.query(
    `UPDATE student_verifications
        SET institution_name = $2,
            document_type = NULL,
            document_expires_at = NULL,
            phone_normalized = NULL,
            referral_channel = NULL,
            referred_by_user_id = NULL,
            education_fields_cleared_at = NOW(),
            updated_at = NOW()
      WHERE id = ANY($1::uuid[])`,
    [ids, CLEARED_EDUCATION_INSTITUTION],
  );
  return rows.length;
}

export async function runStudentMaintenanceCycle(): Promise<{
  expired: number;
  provisioned: number;
  photosCleaned: number;
  educationFieldsCleaned: number;
}> {
  const expired = await expireStudentAccounts();
  const provisioned = await provisionStudentAllowancePeriods();
  const photosCleaned = await cleanupExpiredStudentVerificationPhotos();
  const educationFieldsCleaned = await cleanupExpiredStudentEducationFields();
  return { expired, provisioned, photosCleaned, educationFieldsCleaned };
}
