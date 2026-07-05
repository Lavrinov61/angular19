import type { NextFunction, Request, Response } from 'express';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { StudentVerificationStatusPayload } from '../services/student-verification.service.js';

const mockDb = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const studentVerificationMocks = vi.hoisted(() => ({
  approveStudentVerification: vi.fn(),
  confirmInPersonStudentVerification: vi.fn(),
  getPendingInPersonStudentVerification: vi.fn(),
  getMyStudentVerificationStatus: vi.fn(),
  listStudentVerifications: vi.fn(),
  prepareInPersonStudentVerification: vi.fn(),
  rejectStudentVerification: vi.fn(),
  revokeStudentAccount: vi.fn(),
  submitStudentVerification: vi.fn(),
  withdrawStudentProgramConsent: vi.fn(),
}));

vi.mock('../database/db.js', () => ({
  default: mockDb,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/auth-cache.service.js', () => ({
  getAuthCache: vi.fn().mockResolvedValue(null),
  setAuthCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/permission.service.js', () => ({
  permissionService: {
    getUserPermissions: vi.fn().mockResolvedValue([]),
    hasAllPermissions: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('../config/index.js', () => ({
  config: {
    jwt: {
      secret: 'test-jwt-secret-for-tests',
      secretPrevious: '',
      expiresIn: '15m',
    },
    redis: { host: '' },
  },
}));

vi.mock('ioredis', () => {
  class MockRedis {
    status = 'ready';

    on(): this {
      return this;
    }

    connect(): Promise<void> {
      this.status = 'ready';
      return Promise.resolve();
    }

    quit(): Promise<string> {
      this.status = 'end';
      return Promise.resolve('OK');
    }

    disconnect(): void {
      this.status = 'end';
    }

    get(): Promise<null> {
      return Promise.resolve(null);
    }

    set(): Promise<string> {
      return Promise.resolve('OK');
    }

    del(): Promise<number> {
      return Promise.resolve(0);
    }

    scan(): Promise<[string, string[]]> {
      return Promise.resolve(['0', []]);
    }

    call(): Promise<number> {
      return Promise.resolve(1);
    }
  }

  return { default: MockRedis };
});

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../middleware/rate-limit-store.js', () => ({
  createRateLimitStore: vi.fn(() => undefined),
}));

vi.mock('../middleware/upload-limiter.js', () => ({
  createUploadLimiter: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../services/storage.service.js', () => ({
  storageService: {
    generatePresignedGetUrl: vi.fn().mockResolvedValue('https://storage.example/document.jpg'),
    generatePresignedPutUrl: vi.fn().mockResolvedValue({ url: 'https://storage.example/upload' }),
    getPublicUrl: vi.fn().mockReturnValue('https://storage.example/document.jpg'),
    headObject: vi.fn().mockResolvedValue({ contentLength: 12345 }),
  },
}));

vi.mock('../services/av-scan-worker.js', () => ({
  enqueueAvScan: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock('../services/student-verification.service.js', () => ({
  STUDENT_VERIFICATION_IMAGE_MIMES: new Set(['image/jpeg', 'image/png', 'image/webp']),
  ...studentVerificationMocks,
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./student-verifications.routes.js');
  app = createTestApp(router);
});

import { authHeader, makeAdminUser, makeClientUser, makeEmployeeUser } from '../test-utils/mock-auth.js';

const DB_ADMIN = {
  id: 'admin-id',
  email: 'admin@example.com',
  role: 'admin',
  is_active: true,
  display_name: 'Admin',
  phone: null,
  force_password_change: false,
  last_password_change: null,
};

const DB_CLIENT = {
  id: 'client-id',
  email: 'client@example.com',
  role: 'client',
  is_active: true,
  display_name: 'Client',
  phone: '+79001234567',
  force_password_change: false,
  last_password_change: null,
};

const DB_EMPLOYEE = {
  id: 'employee-id',
  email: 'employee@example.com',
  role: 'employee',
  is_active: true,
  display_name: 'Employee',
  phone: null,
  force_password_change: false,
  last_password_change: null,
};

const emptyStatus: StudentVerificationStatusPayload = {
  account: null,
  latest_verification: null,
  student_discount: null,
};

function mockAdminAuth(): void {
  vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
}

function mockEmployeeAuth(): void {
  vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
}

function mockClientAuth(): void {
  vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT);
}

describe('student verification review routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
    studentVerificationMocks.approveStudentVerification.mockResolvedValue(emptyStatus);
    studentVerificationMocks.confirmInPersonStudentVerification.mockResolvedValue(emptyStatus);
    studentVerificationMocks.getPendingInPersonStudentVerification.mockResolvedValue(null);
    studentVerificationMocks.prepareInPersonStudentVerification.mockResolvedValue({
      verification: {
        id: 'verification-1',
        status: 'pending_in_person',
        source: 'in_person',
        phone_normalized: '79001234567',
        document_url: null,
      },
      matched_user: null,
    });
    studentVerificationMocks.rejectStudentVerification.mockResolvedValue(emptyStatus);
    studentVerificationMocks.withdrawStudentProgramConsent.mockResolvedValue(emptyStatus);
  });

  it('accepts a valid approve payload', async () => {
    mockAdminAuth();

    const res = await request(app)
      .post('/admin/verification-1/approve')
      .set(authHeader(makeAdminUser()))
      .send({ expires_at: '2027-04-01' });

    expect(res.status).toBe(200);
    expect(studentVerificationMocks.approveStudentVerification).toHaveBeenCalledWith({
      verificationId: 'verification-1',
      reviewerId: 'admin-id',
      expiresAt: '2027-04-01',
      reviewNotes: null,
    });
  });

  it('accepts a valid reject payload', async () => {
    mockAdminAuth();

    const res = await request(app)
      .post('/admin/verification-1/reject')
      .set(authHeader(makeAdminUser()))
      .send({ reason: 'Фото документа не читается' });

    expect(res.status).toBe(200);
    expect(studentVerificationMocks.rejectStudentVerification).toHaveBeenCalledWith({
      verificationId: 'verification-1',
      reviewerId: 'admin-id',
      reason: 'Фото документа не читается',
      reviewNotes: null,
    });
  });

  it('accepts the expanded admin list limit', async () => {
    mockAdminAuth();
    studentVerificationMocks.listStudentVerifications.mockResolvedValue([]);

    const res = await request(app)
      .get('/admin')
      .query({ status: 'all', limit: '250' })
      .set(authHeader(makeAdminUser()));

    expect(res.status).toBe(200);
    expect(studentVerificationMocks.listStudentVerifications).toHaveBeenCalledWith({
      status: 'all',
      limit: 250,
    });
  });

  it('returns a validation error for a short reject reason', async () => {
    mockAdminAuth();

    const res = await request(app)
      .post('/admin/verification-1/reject')
      .set(authHeader(makeAdminUser()))
      .send({ reason: 'no' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
    });
    expect(String(res.body.error)).toContain('reason:');
    expect(studentVerificationMocks.rejectStudentVerification).not.toHaveBeenCalled();
  });

  it('accepts upload completion without a document expiry date', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT);
    studentVerificationMocks.submitStudentVerification.mockResolvedValue(emptyStatus);

    const res = await request(app)
      .post('/uploads/complete')
      .set(authHeader(makeClientUser()))
      .send({
        files: [
          {
            s3Key: 'student-verifications/document.jpg',
            fileName: 'document.jpg',
            contentType: 'image/jpeg',
            fileSize: 12345,
          },
        ],
        education_role: 'student',
        institution_name: 'РИНХ',
        document_expires_at: null,
      });

    expect(res.status).toBe(200);
    expect(studentVerificationMocks.submitStudentVerification).toHaveBeenCalledWith({
      userId: 'client-id',
      institutionName: 'РИНХ',
      educationRole: 'student',
      documentExpiresAt: null,
      file: {
        s3Key: 'student-verifications/document.jpg',
        s3Url: 'https://storage.example/document.jpg',
        fileName: 'document.jpg',
        contentType: 'image/jpeg',
        fileSize: 12345,
      },
    });
  });

  it('lets an employee prepare an in-person student verification without activating status', async () => {
    mockEmployeeAuth();

    const res = await request(app)
      .post('/admin/in-person/prepare')
      .set(authHeader(makeEmployeeUser()))
      .set('User-Agent', 'employee-browser')
      .send({
        phone: '+7 (900) 123-45-67',
        institution_name: 'РИНХ',
        education_role: 'student',
        document_type: 'student_card',
        document_expires_at: '2027-06-30',
        referral_channel: 'classmate',
        referrer_phone: null,
      });

    expect(res.status).toBe(200);
    expect(studentVerificationMocks.prepareInPersonStudentVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+7 (900) 123-45-67',
        employeeId: 'employee-id',
        institutionName: 'РИНХ',
        educationRole: 'student',
        documentType: 'student_card',
        documentExpiresAt: '2027-06-30',
        referralChannel: 'classmate',
        referrerPhone: null,
        requestIp: expect.any(String),
        requestUserAgent: 'employee-browser',
      }),
    );
    expect(studentVerificationMocks.confirmInPersonStudentVerification).not.toHaveBeenCalled();
  });

  it('returns pending in-person verification for the authenticated client', async () => {
    mockClientAuth();
    studentVerificationMocks.getPendingInPersonStudentVerification.mockResolvedValue({
      id: 'verification-1',
      status: 'pending_in_person',
      source: 'in_person',
      institution_name: 'РИНХ',
      document_expires_at: '2027-06-30',
      document_url: null,
    });

    const res = await request(app)
      .get('/in-person/pending')
      .set(authHeader(makeClientUser()));

    expect(res.status).toBe(200);
    expect(studentVerificationMocks.getPendingInPersonStudentVerification).toHaveBeenCalledWith('client-id');
  });

  it('confirms an in-person verification in the authenticated client session', async () => {
    mockClientAuth();

    const res = await request(app)
      .post('/in-person/verification-1/confirm')
      .set(authHeader(makeClientUser()))
      .set('User-Agent', 'student-browser')
      .send({
        consent_version: 'student-program-v1',
        marketing_consent: false,
      });

    expect(res.status).toBe(200);
    expect(studentVerificationMocks.confirmInPersonStudentVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationId: 'verification-1',
        userId: 'client-id',
        consentVersion: 'student-program-v1',
        marketingConsent: false,
        requestIp: expect.any(String),
        requestUserAgent: 'student-browser',
      }),
    );
  });

  it('withdraws student program consent from the authenticated client session', async () => {
    mockClientAuth();

    const res = await request(app)
      .post('/in-person/withdraw')
      .set(authHeader(makeClientUser()))
      .send({ reason: 'consent_withdrawn' });

    expect(res.status).toBe(200);
    expect(studentVerificationMocks.withdrawStudentProgramConsent).toHaveBeenCalledWith({
      userId: 'client-id',
      reason: 'consent_withdrawn',
    });
  });
});
