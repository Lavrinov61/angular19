import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, type PoolClient } from 'pg';
import db from '../database/db.js';
import {
  approveStudentVerification,
  confirmInPersonStudentVerification,
  prepareInPersonStudentVerification,
  submitStudentVerification,
  withdrawStudentProgramConsent,
} from './student-verification.service.js';

const getStudentDiscountForUser = vi.hoisted(() => vi.fn());
const ensureCurrentStudentAllowancePeriodWithClient = vi.hoisted(() => vi.fn());
const enqueueInPersonConfirmSend = vi.hoisted(() => vi.fn());
const sendInPersonConfirmLinkToConversation = vi.hoisted(() => vi.fn());

vi.mock('../database/db.js', () => ({
  default: {
    query: vi.fn(),
    queryOne: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('./student-inperson-confirm-send.service.js', () => ({
  enqueueInPersonConfirmSend,
  sendInPersonConfirmLinkToConversation,
}));

vi.mock('./student-discount.service.js', () => ({
  STUDENT_DISCOUNT_PRINT_LIMIT: 500,
  STUDENT_DISCOUNT_PRINT_PRICE: 3,
  ensureCurrentStudentAllowancePeriodWithClient,
  getStudentDiscountForUser,
}));

vi.mock('./storage.service.js', () => ({
  storageService: {
    generatePresignedGetUrl: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

interface StudentAccountTestRow {
  readonly id: string;
  readonly user_id: string;
  readonly status: string;
  readonly education_role: string;
  readonly institution_name: string | null;
  readonly document_number: string | null;
  readonly verified_at: string | null;
  readonly expires_at: string | null;
  readonly reviewer_id: string | null;
  readonly reject_reason: string | null;
  readonly revoke_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ApprovedInPersonTestRow {
  readonly id: string;
  readonly account_id: string | null;
  readonly user_id: string | null;
  readonly status: string;
  readonly source: string;
  readonly education_role: string;
  readonly institution_name: string | null;
  readonly document_type: string | null;
  readonly document_expires_at: string | null;
  readonly document_photo_key: string | null;
  readonly document_photo_content_type: string | null;
  readonly document_photo_size_bytes: number | null;
  readonly phone_normalized: string | null;
  readonly submitted_at: string;
  readonly reviewed_at: string | null;
  readonly reviewer_id: string | null;
  readonly reject_reason: string | null;
  readonly review_notes: string | null;
  readonly retention_delete_after: string | null;
  readonly photo_deleted_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly account_status: string | null;
  readonly account_expires_at: string | null;
  readonly user_email: string | null;
  readonly user_phone: string | null;
  readonly user_display_name: string | null;
  readonly user_date_of_birth: string | null;
}

const accountRow: StudentAccountTestRow = {
  id: 'student-account-1',
  user_id: 'user-1',
  status: 'pending',
  education_role: 'teacher',
  institution_name: 'ДГТУ',
  document_number: null,
  verified_at: null,
  expires_at: '2029-10-10T00:00:00.000Z',
  reviewer_id: null,
  reject_reason: null,
  revoke_reason: null,
  created_at: '2026-05-03T10:00:00.000Z',
  updated_at: '2026-05-03T10:00:00.000Z',
};

function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/g, ' ').trim();
}

const approvedInPersonRow: ApprovedInPersonTestRow = {
  id: 'verification-1',
  account_id: 'student-account-1',
  user_id: 'user-1',
  status: 'approved',
  source: 'in_person',
  education_role: 'student',
  institution_name: 'РИНХ',
  document_type: 'student_card',
  document_expires_at: '2027-06-30',
  document_photo_key: null,
  document_photo_content_type: null,
  document_photo_size_bytes: null,
  phone_normalized: '79001234567',
  submitted_at: '2026-06-04T12:00:00.000Z',
  reviewed_at: '2026-06-04T12:01:00.000Z',
  reviewer_id: 'employee-1',
  reject_reason: null,
  review_notes: null,
  retention_delete_after: null,
  photo_deleted_at: null,
  created_at: '2026-06-04T12:00:00.000Z',
  updated_at: '2026-06-04T12:01:00.000Z',
  account_status: 'verified',
  account_expires_at: '2027-06-30T20:59:59.000Z',
  user_email: null,
  user_phone: '79001234567',
  user_display_name: 'Student',
  user_date_of_birth: null,
};

function buildVerifiedInPersonAccount(overrides: Partial<typeof accountRow> = {}): typeof accountRow {
  return {
    ...accountRow,
    id: 'student-account-1',
    user_id: 'user-1',
    status: 'verified',
    education_role: 'student',
    institution_name: 'РИНХ',
    expires_at: '2027-06-30T20:59:59.000Z',
    reviewer_id: 'employee-1',
    ...overrides,
  };
}

function buildApprovedInPersonRow(
  overrides: Partial<typeof approvedInPersonRow> = {},
): typeof approvedInPersonRow {
  return { ...approvedInPersonRow, ...overrides };
}

function handleImmediateInPersonActivationSql(normalized: string): { rows: unknown[] } | null {
  if (normalized.startsWith('INSERT INTO student_accounts')) {
    return { rows: [buildVerifiedInPersonAccount()] };
  }

  if (normalized.startsWith('UPDATE student_verifications')) {
    return { rows: [] };
  }

  if (normalized.startsWith('INSERT INTO student_discount_entitlements')) {
    return { rows: [{ id: 'entitlement-1' }] };
  }

  if (normalized.startsWith('UPDATE student_inperson_confirm_sends')) {
    return { rows: [] };
  }

  if (
    normalized.startsWith('SELECT')
    && normalized.includes('FROM student_verifications v')
    && normalized.includes('LEFT JOIN student_accounts')
    && normalized.includes('WHERE v.id = $1')
  ) {
    return { rows: [buildApprovedInPersonRow()] };
  }

  return null;
}

describe('submitStudentVerification prerequisites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStudentDiscountForUser.mockResolvedValue(null);
  });

  it('accepts an account with a bound phone even when phone_verified is false', async () => {
    const queryMock = vi.fn(async (sql: string, _params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes('FROM users')) {
        return {
          rows: [{
            id: 'user-1',
            phone: '+79001234567',
            phone_verified: false,
          }],
        };
      }

      if (normalized.includes('FROM student_verifications') && normalized.includes('status')) {
        return { rows: [] };
      }

      if (normalized.includes('FROM student_accounts') && normalized.includes('FOR UPDATE')) {
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO student_accounts')) {
        return { rows: [accountRow] };
      }

      if (normalized.startsWith('INSERT INTO student_verifications')) {
        return { rows: [] };
      }

      throw new Error(`Unhandled fake SQL: ${normalized}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback =>
      callback(client),
    );
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const normalized = normalizeSql(sql);
      if (normalized.includes('FROM student_accounts')) return accountRow;
      if (normalized.includes('FROM student_verifications')) return null;
      return null;
    });

    const result = await submitStudentVerification({
      userId: 'user-1',
      educationRole: 'teacher',
      institutionName: 'ДГТУ',
      documentExpiresAt: '2029-10-10',
      file: {
        s3Key: 'student-verifications/document.png',
        s3Url: 'https://storage.example/document.png',
        fileName: 'document.png',
        contentType: 'image/png',
        fileSize: 1024,
      },
    });

    expect(result.account?.id).toBe('student-account-1');
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, phone'),
      ['user-1'],
    );
    const userSql = normalizeSql(queryMock.mock.calls[0]?.[0]);
    expect(userSql).not.toContain('phone_verified');

    const accountInsertCall = queryMock.mock.calls.find(([sql]) =>
      normalizeSql(sql).startsWith('INSERT INTO student_accounts'),
    );
    expect(accountInsertCall?.[1]).toEqual([
      'user-1',
      'teacher',
      'ДГТУ',
      '2029-10-10',
    ]);

    const verificationInsertCall = queryMock.mock.calls.find(([sql]) =>
      normalizeSql(sql).startsWith('INSERT INTO student_verifications'),
    );
    expect(verificationInsertCall?.[1]).toEqual([
      'student-account-1',
      'user-1',
      'teacher',
      'ДГТУ',
      '2029-10-10',
      'student-verifications/document.png',
      'image/png',
      1024,
    ]);
  });
});

describe('approveStudentVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStudentDiscountForUser.mockResolvedValue(null);
  });

  it('approves the document and provisions a verified-only (no-subscription) entitlement', async () => {
    const verificationRow = {
      id: 'verification-1',
      account_id: 'student-account-1',
      user_id: 'user-1',
      status: 'pending',
      education_role: 'student',
      institution_name: 'РИНХ',
      document_expires_at: '2027-12-10',
      document_photo_key: 'student-verifications/document.png',
      document_photo_content_type: 'image/png',
      document_photo_size_bytes: 1024,
      submitted_at: '2026-05-03T10:00:00.000Z',
      reviewed_at: null,
      reviewer_id: null,
      reject_reason: null,
      review_notes: null,
      retention_delete_after: null,
      photo_deleted_at: null,
      created_at: '2026-05-03T10:00:00.000Z',
      updated_at: '2026-05-03T10:00:00.000Z',
    };
    const queryMock = vi.fn(async (sql: string, _params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes('FROM student_verifications') && normalized.includes('FOR UPDATE')) {
        return { rows: [verificationRow] };
      }

      if (normalized.startsWith('UPDATE student_verifications')) {
        return { rows: [] };
      }

      if (normalized.startsWith('UPDATE student_accounts')) {
        return {
          rows: [{
            ...accountRow,
            status: 'verified',
            education_role: 'student',
            institution_name: 'РИНХ',
            expires_at: '2027-12-10T20:59:59.000Z',
          }],
        };
      }

      if (normalized.startsWith('INSERT INTO student_discount_entitlements')) {
        return { rows: [{ id: 'entitlement-1' }] };
      }

      throw new Error(`Unhandled fake SQL: ${normalized}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback =>
      callback(client),
    );
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const normalized = normalizeSql(sql);
      if (normalized.includes('FROM student_accounts')) {
        return {
          ...accountRow,
          status: 'verified',
          education_role: 'student',
          institution_name: 'РИНХ',
          expires_at: '2027-12-10T20:59:59.000Z',
        };
      }
      if (normalized.includes('FROM student_verifications')) return null;
      return null;
    });

    const result = await approveStudentVerification({
      verificationId: 'verification-1',
      reviewerId: 'reviewer-1',
      expiresAt: '2027-12-10',
    });

    expect(result.account?.status).toBe('verified');
    expect(getStudentDiscountForUser).toHaveBeenCalledWith('user-1');

    // Подтверждение статуса заводит льготу 'education_verified' (тариф «без подписки»)
    // через upsert ON CONFLICT(user_id), не понижая возможную 'education_subscription'.
    const entitlementInsert = queryMock.mock.calls.find(([sql]) => {
      const n = normalizeSql(sql);
      return n.startsWith('INSERT INTO student_discount_entitlements')
        && n.includes("'education_verified'")
        && n.includes('ON CONFLICT (user_id)');
    });
    expect(entitlementInsert).toBeDefined();
    // student_account_id ($2) обязателен, иначе VERIFIED_STUDENT_ACCOUNT_SQL отфильтрует льготу.
    expect(entitlementInsert?.[1]?.[1]).toBe('student-account-1');

    // Начисляется текущий rolling-30 период (кап) для новой льготы.
    expect(ensureCurrentStudentAllowancePeriodWithClient).toHaveBeenCalledWith(
      client,
      { entitlementId: 'entitlement-1', userId: 'user-1', lock: false },
    );

    // Старый блок «expire photo_verification» удалён (upsert конвертирует запись).
    expect(queryMock.mock.calls.some(([sql]) =>
      normalizeSql(sql).includes("source_token = 'photo_verification'"),
    )).toBe(false);
  });
});

describe('in-person student verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStudentDiscountForUser.mockResolvedValue(null);
    enqueueInPersonConfirmSend.mockResolvedValue({
      enqueued: true,
      reason: 'enqueued',
      sendAt: '2026-06-06T06:00:00.000Z',
      channelHint: 'telegram',
    });
    // По умолчанию диалога для немедленной доставки нет → фолбэк на отложенную.
    // Chat-тесты переопределяют на { outcome: 'sent', ... }.
    sendInPersonConfirmLinkToConversation.mockResolvedValue({ outcome: 'no_conversation', channel: null });
  });

  it('activates an in-person verification immediately without sending a confirmation link', async () => {
    const verifiedAccount = {
      ...accountRow,
      id: 'student-account-1',
      user_id: 'user-1',
      status: 'verified',
      education_role: 'student',
      institution_name: 'РИНХ',
      expires_at: '2027-06-30T20:59:59.000Z',
      reviewer_id: 'employee-1',
    };
    const queryMock = vi.fn(async (sql: string, params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes('FROM users') && normalized.includes('RIGHT(REGEXP_REPLACE')) {
        return { rows: [{ id: 'user-1', phone: '79001234567', display_name: 'Student' }] };
      }

      if (normalized.startsWith('INSERT INTO student_accounts')) {
        return { rows: [verifiedAccount] };
      }

      if (normalized.startsWith('INSERT INTO student_verifications')) {
        return {
          rows: [{
            id: 'verification-1',
            account_id: null,
            user_id: 'user-1',
            status: 'pending_in_person',
            source: 'in_person',
            education_role: 'student',
            institution_name: 'РИНХ',
            document_type: 'student_card',
            document_expires_at: '2027-06-30',
            document_photo_key: null,
            document_photo_content_type: null,
            document_photo_size_bytes: null,
            phone_normalized: '79001234567',
            submitted_at: '2026-06-04T12:00:00.000Z',
            reviewed_at: null,
            reviewer_id: null,
            reject_reason: null,
            review_notes: null,
            retention_delete_after: null,
            photo_deleted_at: null,
            created_at: '2026-06-04T12:00:00.000Z',
            updated_at: '2026-06-04T12:00:00.000Z',
          }],
        };
      }

      if (normalized.startsWith('UPDATE student_verifications')) {
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO student_discount_entitlements')) {
        return { rows: [{ id: 'entitlement-1' }] };
      }

      const handled = handleImmediateInPersonActivationSql(normalized);
      if (handled) return handled;

      throw new Error(`Unhandled fake SQL: ${normalized} ${JSON.stringify(params)}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback =>
      callback(client),
    );
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const normalized = normalizeSql(sql);
      if (normalized.includes('FROM student_verifications')) {
        return {
          id: 'verification-1',
          account_id: 'student-account-1',
          user_id: 'user-1',
          status: 'approved',
          source: 'in_person',
          education_role: 'student',
          institution_name: 'РИНХ',
          document_type: 'student_card',
          document_expires_at: '2027-06-30',
          document_photo_key: null,
          document_photo_content_type: null,
          document_photo_size_bytes: null,
          phone_normalized: '79001234567',
          submitted_at: '2026-06-04T12:00:00.000Z',
          reviewed_at: '2026-06-04T12:01:00.000Z',
          reviewer_id: 'employee-1',
          reject_reason: null,
          review_notes: null,
          retention_delete_after: null,
          photo_deleted_at: null,
          created_at: '2026-06-04T12:00:00.000Z',
          updated_at: '2026-06-04T12:01:00.000Z',
          account_status: 'verified',
          account_expires_at: '2027-06-30T20:59:59.000Z',
          user_email: null,
          user_phone: '79001234567',
          user_display_name: 'Student',
          user_date_of_birth: null,
        };
      }
      return null;
    });

    const result = await prepareInPersonStudentVerification({
      phone: '+7 (900) 123-45-67',
      employeeId: 'employee-1',
      institutionName: 'РИНХ',
      educationRole: 'student',
      documentType: 'student_card',
      documentExpiresAt: '2027-06-30',
      referralChannel: 'classmate',
      referrerPhone: null,
      requestIp: '127.0.0.1',
      requestUserAgent: 'employee-browser',
    });

    expect(result.verification.status).toBe('approved');
    expect(result.verification.account_id).toBe('student-account-1');
    expect(result.verification.phone_normalized).toBe('79001234567');
    expect(queryMock.mock.calls.some(([sql]) =>
      normalizeSql(sql).startsWith('INSERT INTO student_discount_entitlements'),
    )).toBe(true);
    expect(ensureCurrentStudentAllowancePeriodWithClient).toHaveBeenCalledWith(
      client,
      { entitlementId: 'entitlement-1', userId: 'user-1', lock: false },
    );
    expect(enqueueInPersonConfirmSend).not.toHaveBeenCalled();
    expect(sendInPersonConfirmLinkToConversation).not.toHaveBeenCalled();
    expect(result.scheduled_send_at).toBeNull();
    expect(result.scheduled_send_channel).toBeNull();
    expect(result.sent_to_chat_channel).toBeNull();
  });

  it('creates a client account by phone when the number is not registered yet', async () => {
    const queryMock = vi.fn(async (sql: string, params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes('FROM users') && normalized.includes('RIGHT(REGEXP_REPLACE')) {
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO users')) {
        return {
          rows: [{
            id: 'new-user-1',
            phone: '79005554433',
            display_name: null,
            email: null,
          }],
        };
      }

      if (normalized.startsWith('INSERT INTO student_accounts')) {
        return { rows: [buildVerifiedInPersonAccount({ user_id: 'new-user-1' })] };
      }

      if (
        normalized.startsWith('SELECT')
        && normalized.includes('FROM student_verifications v')
        && normalized.includes('LEFT JOIN student_accounts')
        && normalized.includes('WHERE v.id = $1')
      ) {
        return {
          rows: [buildApprovedInPersonRow({
            user_id: 'new-user-1',
            user_phone: '79005554433',
            user_display_name: null,
          })],
        };
      }

      const handled = handleImmediateInPersonActivationSql(normalized);
      if (handled) return handled;

      if (normalized.startsWith('INSERT INTO student_verifications')) {
        return { rows: [{ id: 'verification-1' }] };
      }

      throw new Error(`Unhandled fake SQL: ${normalized} ${JSON.stringify(params)}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback =>
      callback(client),
    );

    const result = await prepareInPersonStudentVerification({
      phone: '+7 (900) 555-44-33',
      employeeId: 'employee-1',
      institutionName: 'РИНХ',
      educationRole: 'student',
      documentType: 'student_card',
      documentExpiresAt: '2027-06-30',
      referralChannel: 'walk_in',
      referrerPhone: null,
      requestIp: '127.0.0.1',
      requestUserAgent: 'employee-browser',
    });

    expect(result.matched_user?.id).toBe('new-user-1');
    expect(result.verification.status).toBe('approved');

    const userInsertCall = queryMock.mock.calls.find(([sql]) =>
      normalizeSql(sql).startsWith('INSERT INTO users'),
    );
    expect(userInsertCall?.[1]).toEqual(['79005554433']);
    expect(normalizeSql(userInsertCall?.[0])).toContain('phone_verified');
    expect(normalizeSql(userInsertCall?.[0])).toContain('false');

    const accountInsertCall = queryMock.mock.calls.find(([sql]) =>
      normalizeSql(sql).startsWith('INSERT INTO student_accounts'),
    );
    expect(accountInsertCall?.[1]?.[0]).toBe('new-user-1');
    expect(enqueueInPersonConfirmSend).not.toHaveBeenCalled();
    expect(sendInPersonConfirmLinkToConversation).not.toHaveBeenCalled();
  });

  it('resolves a referral code to an existing user id without storing the raw code', async () => {
    const queryMock = vi.fn(async (sql: string, params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes('FROM users') && normalized.includes('RIGHT(REGEXP_REPLACE')) {
        return { rows: [{ id: 'user-1', phone: '79001234567', display_name: 'Student' }] };
      }

      if (normalized.includes('FROM loyalty_profiles') && normalized.includes('referral_code')) {
        return { rows: [{ user_id: 'referrer-user-1' }] };
      }

      const handled = handleImmediateInPersonActivationSql(normalized);
      if (handled) return handled;

      if (normalized.startsWith('INSERT INTO student_verifications')) {
        return {
          rows: [{
            id: 'verification-1',
            account_id: null,
            user_id: 'user-1',
            status: 'pending_in_person',
            source: 'in_person',
            education_role: 'student',
            institution_name: 'РИНХ',
            document_type: 'student_card',
            document_expires_at: '2027-06-30',
            document_photo_key: null,
            document_photo_content_type: null,
            document_photo_size_bytes: null,
            phone_normalized: '79001234567',
            referral_channel: 'classmate',
            referred_by_user_id: 'referrer-user-1',
            submitted_at: '2026-06-04T12:00:00.000Z',
            reviewed_at: null,
            reviewer_id: null,
            reject_reason: null,
            review_notes: null,
            retention_delete_after: null,
            photo_deleted_at: null,
            created_at: '2026-06-04T12:00:00.000Z',
            updated_at: '2026-06-04T12:00:00.000Z',
          }],
        };
      }

      throw new Error(`Unhandled fake SQL: ${normalized} ${JSON.stringify(params)}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback =>
      callback(client),
    );

    await prepareInPersonStudentVerification({
      phone: '+7 (900) 123-45-67',
      employeeId: 'employee-1',
      institutionName: 'РИНХ',
      educationRole: 'student',
      documentType: 'student_card',
      documentExpiresAt: '2027-06-30',
      referralChannel: 'classmate',
      referrerCode: 'ABC123',
      referrerPhone: null,
      requestIp: '127.0.0.1',
      requestUserAgent: 'employee-browser',
    });

    const insertCall = queryMock.mock.calls.find(([sql]) =>
      normalizeSql(sql).startsWith('INSERT INTO student_verifications'),
    );
    expect(insertCall?.[1]).toContain('referrer-user-1');
    expect(JSON.stringify(insertCall?.[1])).not.toContain('ABC123');
  });

  it('saves target_conversation_id and links the conversation to the matched user when registered from a messenger chat', async () => {
    const updateConversationCalls: unknown[][] = [];
    const queryMock = vi.fn(async (sql: string, params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes('FROM users') && normalized.includes('RIGHT(REGEXP_REPLACE')) {
        return { rows: [{ id: 'user-1', phone: '79001234567', display_name: 'Student' }] };
      }

      // Валидация target-диалога одним SELECT (channel + ext по id).
      if (normalized.includes('FROM conversations') && normalized.includes('WHERE id = $1')
        && !normalized.startsWith('UPDATE')) {
        return { rows: [{ channel: 'telegram', ext: 'tg-chat-1' }] };
      }

      const handled = handleImmediateInPersonActivationSql(normalized);
      if (handled) return handled;

      // Точечный link-client (UPDATE conversations.user_id).
      if (normalized.startsWith('UPDATE conversations')) {
        updateConversationCalls.push(params ?? []);
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO student_verifications')) {
        return {
          rows: [{
            id: 'verification-1',
            account_id: null,
            user_id: 'user-1',
            status: 'pending_in_person',
            source: 'in_person',
            education_role: 'student',
            institution_name: 'РИНХ',
            document_type: 'student_card',
            document_expires_at: '2027-06-30',
            document_photo_key: null,
            document_photo_content_type: null,
            document_photo_size_bytes: null,
            phone_normalized: '79001234567',
            target_conversation_id: 'conv-1',
            submitted_at: '2026-06-04T12:00:00.000Z',
            reviewed_at: null,
            reviewer_id: null,
            reject_reason: null,
            review_notes: null,
            retention_delete_after: null,
            photo_deleted_at: null,
            created_at: '2026-06-04T12:00:00.000Z',
            updated_at: '2026-06-04T12:00:00.000Z',
          }],
        };
      }

      throw new Error(`Unhandled fake SQL: ${normalized} ${JSON.stringify(params)}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback => callback(client));
    sendInPersonConfirmLinkToConversation.mockResolvedValue({ outcome: 'sent', channel: 'telegram' });

    const result = await prepareInPersonStudentVerification({
      phone: '+7 (900) 123-45-67',
      employeeId: 'employee-1',
      institutionName: 'РИНХ',
      educationRole: 'student',
      documentType: 'student_card',
      documentExpiresAt: '2027-06-30',
      referralChannel: 'classmate',
      referrerPhone: null,
      conversationId: 'conv-1',
      requestIp: '127.0.0.1',
      requestUserAgent: 'employee-browser',
    });

    // target сохранён: INSERT получил conversation_id последним параметром ($13).
    const insertCall = queryMock.mock.calls.find(([sql]) =>
      normalizeSql(sql).startsWith('INSERT INTO student_verifications'),
    );
    expect(insertCall?.[1]?.[12]).toBe('conv-1');

    // conversations.user_id проставлен точечно (matched user + target).
    expect(updateConversationCalls).toHaveLength(1);
    expect(updateConversationCalls[0]).toEqual(['user-1', 'conv-1']);

    // Статус включился сразу; чат только привязан к клиенту, ссылка не отправляется.
    expect(result.verification.status).toBe('approved');
    expect(sendInPersonConfirmLinkToConversation).not.toHaveBeenCalled();
    expect(result.sent_to_chat_channel).toBeNull();
    expect(result.scheduled_send_at).toBeNull();
    expect(enqueueInPersonConfirmSend).not.toHaveBeenCalled();
  });

  it('links a web conversation and sends the link immediately into the web chat (target stays null)', async () => {
    const updateConversationCalls: unknown[][] = [];
    const queryMock = vi.fn(async (sql: string, params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes('FROM users') && normalized.includes('RIGHT(REGEXP_REPLACE')) {
        return { rows: [{ id: 'user-1', phone: '79001234567', display_name: 'Student' }] };
      }

      // web-диалог — не deliverable messenger → target_conversation_id (для отложенной
      // доставки) должен обнулиться, но НЕМЕДЛЕННАЯ доставка в чат всё равно идёт.
      if (normalized.includes('FROM conversations') && normalized.includes('WHERE id = $1')
        && !normalized.startsWith('UPDATE')) {
        return { rows: [{ channel: 'web', ext: null }] };
      }

      const handled = handleImmediateInPersonActivationSql(normalized);
      if (handled) return handled;

      // Link-client теперь идёт и для web (любой реальный диалог регистрации).
      if (normalized.startsWith('UPDATE conversations')) {
        updateConversationCalls.push(params ?? []);
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO student_verifications')) {
        return {
          rows: [{
            id: 'verification-1',
            account_id: null,
            user_id: 'user-1',
            status: 'pending_in_person',
            source: 'in_person',
            education_role: 'student',
            institution_name: 'РИНХ',
            document_type: 'student_card',
            document_expires_at: '2027-06-30',
            document_photo_key: null,
            document_photo_content_type: null,
            document_photo_size_bytes: null,
            phone_normalized: '79001234567',
            target_conversation_id: null,
            submitted_at: '2026-06-04T12:00:00.000Z',
            reviewed_at: null,
            reviewer_id: null,
            reject_reason: null,
            review_notes: null,
            retention_delete_after: null,
            photo_deleted_at: null,
            created_at: '2026-06-04T12:00:00.000Z',
            updated_at: '2026-06-04T12:00:00.000Z',
          }],
        };
      }

      throw new Error(`Unhandled fake SQL: ${normalized} ${JSON.stringify(params)}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback => callback(client));
    sendInPersonConfirmLinkToConversation.mockResolvedValue({ outcome: 'sent', channel: 'web' });

    const result = await prepareInPersonStudentVerification({
      phone: '+7 (900) 123-45-67',
      employeeId: 'employee-1',
      institutionName: 'РИНХ',
      educationRole: 'student',
      documentType: 'student_card',
      documentExpiresAt: '2027-06-30',
      referralChannel: 'walk_in',
      referrerPhone: null,
      conversationId: 'conv-web',
      requestIp: '127.0.0.1',
      requestUserAgent: 'employee-browser',
    });

    // INSERT получил NULL в target_conversation_id ($13) — web не messenger.
    const insertCall = queryMock.mock.calls.find(([sql]) =>
      normalizeSql(sql).startsWith('INSERT INTO student_verifications'),
    );
    expect(insertCall?.[1]?.[12]).toBeNull();

    // Диалог всё равно привязан к клиенту (любой канал), ссылка больше не нужна.
    expect(updateConversationCalls).toEqual([['user-1', 'conv-web']]);
    expect(result.verification.status).toBe('approved');
    expect(sendInPersonConfirmLinkToConversation).not.toHaveBeenCalled();
    expect(result.sent_to_chat_channel).toBeNull();
    expect(enqueueInPersonConfirmSend).not.toHaveBeenCalled();
  });

  it('does not send or enqueue a confirmation link after in-person activation', async () => {
    const queryMock = vi.fn(async (sql: string, params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes('FROM users') && normalized.includes('RIGHT(REGEXP_REPLACE')) {
        return { rows: [{ id: 'user-1', phone: '79001234567', display_name: 'Student' }] };
      }

      if (normalized.includes('FROM conversations') && normalized.includes('WHERE id = $1')
        && !normalized.startsWith('UPDATE')) {
        return { rows: [{ channel: 'telegram', ext: 'tg-chat-1' }] };
      }

      const handled = handleImmediateInPersonActivationSql(normalized);
      if (handled) return handled;

      if (normalized.startsWith('UPDATE conversations')) {
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO student_verifications')) {
        return {
          rows: [{
            id: 'verification-1',
            account_id: null,
            user_id: 'user-1',
            status: 'pending_in_person',
            source: 'in_person',
            education_role: 'student',
            institution_name: 'РИНХ',
            document_type: 'student_card',
            document_expires_at: '2027-06-30',
            document_photo_key: null,
            document_photo_content_type: null,
            document_photo_size_bytes: null,
            phone_normalized: '79001234567',
            target_conversation_id: 'conv-1',
            submitted_at: '2026-06-04T12:00:00.000Z',
            reviewed_at: null,
            reviewer_id: null,
            reject_reason: null,
            review_notes: null,
            retention_delete_after: null,
            photo_deleted_at: null,
            created_at: '2026-06-04T12:00:00.000Z',
            updated_at: '2026-06-04T12:00:00.000Z',
          }],
        };
      }

      throw new Error(`Unhandled fake SQL: ${normalized} ${JSON.stringify(params)}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback => callback(client));
    sendInPersonConfirmLinkToConversation.mockRejectedValue(new Error('socket down'));

    const result = await prepareInPersonStudentVerification({
      phone: '+7 (900) 123-45-67',
      employeeId: 'employee-1',
      institutionName: 'РИНХ',
      educationRole: 'student',
      documentType: 'student_card',
      documentExpiresAt: '2027-06-30',
      referralChannel: 'classmate',
      referrerPhone: null,
      conversationId: 'conv-1',
      requestIp: '127.0.0.1',
      requestUserAgent: 'employee-browser',
    });

    // Проверка включается в транзакции; старый путь доставки ссылки не вызывается.
    expect(result.verification.status).toBe('approved');
    expect(result.sent_to_chat_channel).toBeNull();
    expect(result.scheduled_send_at).toBeNull();
    expect(sendInPersonConfirmLinkToConversation).not.toHaveBeenCalled();
    expect(enqueueInPersonConfirmSend).not.toHaveBeenCalled();
  });

  it('clears the target on a walk-in re-prepare without conversation_id (intentional overwrite)', async () => {
    const queryMock = vi.fn(async (sql: string, params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes('FROM users') && normalized.includes('RIGHT(REGEXP_REPLACE')) {
        return { rows: [{ id: 'user-1', phone: '79001234567', display_name: 'Student' }] };
      }

      const handled = handleImmediateInPersonActivationSql(normalized);
      if (handled) return handled;

      // Без conversationId валидационный SELECT conversations не должен выполняться.
      if (normalized.includes('FROM conversations')) {
        throw new Error('walk-in без conversation_id не должен трогать conversations');
      }

      if (normalized.startsWith('INSERT INTO student_verifications')) {
        return {
          rows: [{
            id: 'verification-1',
            account_id: null,
            user_id: 'user-1',
            status: 'pending_in_person',
            source: 'in_person',
            education_role: 'student',
            institution_name: 'РИНХ',
            document_type: 'student_card',
            document_expires_at: '2027-06-30',
            document_photo_key: null,
            document_photo_content_type: null,
            document_photo_size_bytes: null,
            phone_normalized: '79001234567',
            target_conversation_id: null,
            submitted_at: '2026-06-04T12:00:00.000Z',
            reviewed_at: null,
            reviewer_id: null,
            reject_reason: null,
            review_notes: null,
            retention_delete_after: null,
            photo_deleted_at: null,
            created_at: '2026-06-04T12:00:00.000Z',
            updated_at: '2026-06-04T12:00:00.000Z',
          }],
        };
      }

      throw new Error(`Unhandled fake SQL: ${normalized} ${JSON.stringify(params)}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback => callback(client));

    await prepareInPersonStudentVerification({
      phone: '+7 (900) 123-45-67',
      employeeId: 'employee-1',
      institutionName: 'РИНХ',
      educationRole: 'student',
      documentType: 'student_card',
      documentExpiresAt: '2027-06-30',
      referralChannel: 'walk_in',
      referrerPhone: null,
      requestIp: '127.0.0.1',
      requestUserAgent: 'employee-browser',
    });

    // ON CONFLICT DO UPDATE перезаписывает target_conversation_id = EXCLUDED (=NULL):
    // повторная walk-in регистрация осознанно обнуляет ранее заданный target.
    const insertCall = queryMock.mock.calls.find(([sql]) =>
      normalizeSql(sql).startsWith('INSERT INTO student_verifications'),
    );
    expect(insertCall?.[1]?.[12]).toBeNull();
    expect(normalizeSql(insertCall?.[0] as string)).toContain('target_conversation_id = EXCLUDED.target_conversation_id');
  });

  it('rejects in-person confirmation from a different client user', async () => {
    const verificationRow = {
      id: 'verification-1',
      account_id: null,
      user_id: 'user-1',
      status: 'pending_in_person',
      source: 'in_person',
      education_role: 'student',
      institution_name: 'РИНХ',
      document_type: 'student_card',
      document_expires_at: '2027-06-30',
      document_photo_key: null,
      document_photo_content_type: null,
      document_photo_size_bytes: null,
      phone_normalized: '79001234567',
      submitted_at: '2026-06-04T12:00:00.000Z',
      reviewed_at: null,
      reviewer_id: null,
      reject_reason: null,
      review_notes: null,
      retention_delete_after: null,
      photo_deleted_at: null,
      created_at: '2026-06-04T12:00:00.000Z',
      updated_at: '2026-06-04T12:00:00.000Z',
    };
    const queryMock = vi.fn(async (sql: string) => {
      const normalized = normalizeSql(sql);
      if (normalized.includes('FROM student_verifications') && normalized.includes('FOR UPDATE')) {
        return { rows: [verificationRow] };
      }
      throw new Error(`Unhandled fake SQL: ${normalized}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback =>
      callback(client),
    );

    await expect(confirmInPersonStudentVerification({
      verificationId: 'verification-1',
      userId: 'other-user',
      consentVersion: 'student-program-v1',
      requestIp: '127.0.0.1',
      requestUserAgent: 'student-browser',
      marketingConsent: false,
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('activates verified-only entitlement only after matching student confirmation', async () => {
    const verificationRow = {
      id: 'verification-1',
      account_id: null,
      user_id: 'user-1',
      status: 'pending_in_person',
      source: 'in_person',
      education_role: 'student',
      institution_name: 'РИНХ',
      document_type: 'student_card',
      document_expires_at: '2027-06-30',
      document_photo_key: null,
      document_photo_content_type: null,
      document_photo_size_bytes: null,
      phone_normalized: '79001234567',
      submitted_at: '2026-06-04T12:00:00.000Z',
      reviewed_at: null,
      reviewer_id: null,
      reject_reason: null,
      review_notes: null,
      retention_delete_after: null,
      photo_deleted_at: null,
      created_at: '2026-06-04T12:00:00.000Z',
      updated_at: '2026-06-04T12:00:00.000Z',
    };
    const verifiedAccount = {
      ...accountRow,
      user_id: 'user-1',
      status: 'verified',
      education_role: 'student',
      institution_name: 'РИНХ',
      expires_at: '2027-06-30T20:59:59.000Z',
    };
    const queryMock = vi.fn(async (sql: string, _params: unknown[]) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes('FROM student_verifications') && normalized.includes('FOR UPDATE')) {
        return { rows: [verificationRow] };
      }

      if (normalized.includes('FROM users') && normalized.includes('phone')) {
        return { rows: [{ id: 'user-1', phone: '79001234567' }] };
      }

      if (normalized.startsWith('INSERT INTO student_accounts')) {
        return { rows: [verifiedAccount] };
      }

      if (normalized.startsWith('UPDATE student_verifications')) {
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO student_discount_entitlements')) {
        return { rows: [{ id: 'entitlement-1' }] };
      }

      throw new Error(`Unhandled fake SQL: ${normalized}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback =>
      callback(client),
    );
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const normalized = normalizeSql(sql);
      if (normalized.includes('FROM student_accounts')) return verifiedAccount;
      if (normalized.includes('FROM student_verifications')) return null;
      return null;
    });

    const result = await confirmInPersonStudentVerification({
      verificationId: 'verification-1',
      userId: 'user-1',
      consentVersion: 'student-program-v1',
      requestIp: '127.0.0.1',
      requestUserAgent: 'student-browser',
      marketingConsent: false,
    });

    expect(result.account?.status).toBe('verified');
    const entitlementInsert = queryMock.mock.calls.find(([sql]) =>
      normalizeSql(sql).startsWith('INSERT INTO student_discount_entitlements'),
    );
    expect(entitlementInsert).toBeDefined();
    expect(normalizeSql(entitlementInsert?.[0])).toContain("'education_verified'");
    expect(ensureCurrentStudentAllowancePeriodWithClient).toHaveBeenCalledWith(
      client,
      { entitlementId: 'entitlement-1', userId: 'user-1', lock: false },
    );
  });

  it('withdraws student program consent and revokes active education entitlement', async () => {
    const verifiedAccount = {
      ...accountRow,
      user_id: 'user-1',
      status: 'revoked',
      education_role: 'student',
      institution_name: 'РИНХ',
      expires_at: '2027-06-30T20:59:59.000Z',
    };
    const queryMock = vi.fn(async (sql: string) => {
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('UPDATE student_accounts')) {
        return { rows: [verifiedAccount] };
      }

      if (normalized.startsWith('UPDATE student_discount_entitlements')) {
        return { rows: [] };
      }

      if (normalized.startsWith('UPDATE student_verifications')) {
        return { rows: [] };
      }

      throw new Error(`Unhandled fake SQL: ${normalized}`);
    });
    const client: PoolClient = Object.assign(new Client(), {
      query: queryMock,
      release: vi.fn(),
    });

    vi.mocked(db.transaction).mockImplementation(async callback =>
      callback(client),
    );
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const normalized = normalizeSql(sql);
      if (normalized.includes('FROM student_accounts')) return verifiedAccount;
      if (normalized.includes('FROM student_verifications')) return null;
      return null;
    });

    const result = await withdrawStudentProgramConsent({
      userId: 'user-1',
      reason: 'consent_withdrawn',
    });

    expect(result.account?.status).toBe('revoked');
    expect(queryMock.mock.calls.some(([sql]) =>
      normalizeSql(sql).startsWith('UPDATE student_discount_entitlements'),
    )).toBe(true);
  });
});
