import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';

const { mockDb, createTransportMock, sendMailMock, backfillEmailAttachmentsMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test-msg-id' });
  const createTransportMock = vi.fn().mockReturnValue({ sendMail: sendMailMock });
  const backfillEmailAttachmentsMock = vi.fn().mockResolvedValue({
    emailId: 1,
    attempted: true,
    saved: 0,
    available: 0,
  });
  const mockDb = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn().mockImplementation(async (fn: (c: unknown) => unknown) => fn({})),
  };
  return { mockDb, createTransportMock, sendMailMock, backfillEmailAttachmentsMock };
});

vi.mock('../database/db.js', () => ({ default: mockDb, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../services/auth-cache.service.js', () => ({
  getAuthCache: vi.fn().mockResolvedValue(null),
  setAuthCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '' },
    email: { host: '', port: 587, user: '', pass: '', from: 'test@example.com' },
    mail: { address: 'info@svoefoto.ru', aliases: ['info@svoefoto.ru', 'info@fmagnus.org'] },
    smtp: {
      host: 'smtp.example.test',
      port: 465,
      user: 'info@fmagnus.org',
      password: 'secret',
      from: '"Test" <info@fmagnus.org>',
    },
  },
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: createTransportMock,
  },
}));
vi.mock('../middleware/upload-limiter.js', () => ({
  createUploadLimiter: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock('../services/storage.service.js', () => ({
  storageService: {
    downloadToBuffer: vi.fn(),
    generatePresignedDownloadUrl: vi.fn(),
    generatePresignedPutUrl: vi.fn(),
    getPublicUrl: vi.fn(),
    headObject: vi.fn(),
    keyFromUrl: vi.fn(),
  },
}));
vi.mock('../services/imap.service.js', () => ({
  backfillEmailAttachments: backfillEmailAttachmentsMock,
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./crm-email.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';
import { storageService } from '../services/storage.service.js';
import { config } from '../config/index.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

const EMAIL_ROW = { id: 1, subject: 'Test', from_address: 'sender@example.com', to_address: 'test@example.com', body_text: 'Hello', status: 'unread', created_at: new Date().toISOString() };

const SMTP_ENV_KEYS = [
  'SMTP_INFO_SVOEFOTO_RU_HOST',
  'SMTP_INFO_SVOEFOTO_RU_PORT',
  'SMTP_INFO_SVOEFOTO_RU_USER',
  'SMTP_INFO_SVOEFOTO_RU_PASSWORD',
  'SMTP_INFO_SVOEFOTO_RU_PASS',
  'SMTP_INFO_SVOEFOTO_RU_FROM',
  'SMTP_INFO_FMAGNUS_ORG_HOST',
  'SMTP_INFO_FMAGNUS_ORG_PORT',
  'SMTP_INFO_FMAGNUS_ORG_USER',
  'SMTP_INFO_FMAGNUS_ORG_PASSWORD',
  'SMTP_INFO_FMAGNUS_ORG_PASS',
  'SMTP_INFO_FMAGNUS_ORG_FROM',
];

const ORIGINAL_SMTP_ENV = new Map(SMTP_ENV_KEYS.map(key => [key, process.env[key]]));

function resetSmtpEnv() {
  for (const key of SMTP_ENV_KEYS) delete process.env[key];
}

function resetConfig() {
  config.smtp.host = 'smtp.example.test';
  config.smtp.port = 465;
  config.smtp.user = 'info@fmagnus.org';
  config.smtp.password = 'secret';
  config.smtp.from = '"Test" <info@fmagnus.org>';
}

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(sendMailMock).mockReset().mockResolvedValue({ messageId: 'test-msg-id' });
  vi.mocked(createTransportMock).mockClear().mockReturnValue({ sendMail: sendMailMock });
  vi.mocked(backfillEmailAttachmentsMock).mockReset().mockResolvedValue({
    emailId: 1,
    attempted: true,
    saved: 0,
    available: 0,
  });
  resetSmtpEnv();
  resetConfig();
}

afterAll(() => {
  for (const key of SMTP_ENV_KEYS) {
    const value = ORIGINAL_SMTP_ENV.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// router.use(authenticateToken) + router.use(requirePermission('inbox:view'))
// employee has inbox:view

describe('GET / — email inbox', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
  });

  it('returns inbox for employee', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([EMAIL_ROW]) // emails
      .mockResolvedValueOnce([{ count: '1' }]); // total count

    const res = await request(app).get('/').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('uses denormalized attachment flags for inbox attachment indicators', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/?has_attachments=true')
      .set(authHeader(makeEmployeeUser()));

    expect(res.status).toBe(200);
    expect(String(vi.mocked(mockDb.query).mock.calls[0]?.[0])).toContain('COALESCE(email_messages.has_attachments, false)');
  });
});

describe('GET /counts — unread counts', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/counts');
    expect(res.status).toBe(401);
  });

  it('returns counts for employee', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      { direction: 'inbound', from_address: 'client@example.com', to_address: 'info@svoefoto.ru', cc_addresses: null, status: 'received' },
      { direction: 'inbound', from_address: 'client@example.com', to_address: 'info@fmagnus.org', cc_addresses: null, status: 'read' },
    ]);

    const res = await request(app).get('/counts').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.data.unread).toBe(1);
    expect(res.body.data.total).toBe(2);
  });
});

describe('GET /templates — email templates', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/templates');
    expect(res.status).toBe(401);
  });

  it('returns templates for employee', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ id: 1, name: 'welcome', subject_template: 'Welcome' }]);

    const res = await request(app).get('/templates').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /attachment/:attachmentId/download — email attachment download', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/attachment/7/download');
    expect(res.status).toBe(401);
  });

  it('streams the attachment through the authenticated API', async () => {
    const buffer = Buffer.from('pdf');
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce({
        id: 7,
        filename: 'invoice.pdf',
        mime_type: 'application/pdf',
        size_bytes: '3',
        s3_key: 'email-attachments/test/invoice.pdf',
        storage_url: null,
      });
    vi.mocked(storageService.downloadToBuffer).mockResolvedValueOnce({ buffer });

    const res = await request(app).get('/attachment/7/download').set(authHeader(makeEmployeeUser()));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('invoice.pdf');
    expect(res.body).toEqual(buffer);
    expect(storageService.downloadToBuffer).toHaveBeenCalledWith('email-attachments/test/invoice.pdf');
  });
});

describe('GET /:id — single email', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/1');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown email', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(null);       // not found

    const res = await request(app).get('/999').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(404);
  });

  it('returns email details', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(EMAIL_ROW);  // email found
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([]) // thread
      .mockResolvedValueOnce([]); // mark read update

    const res = await request(app).get('/1').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns persisted attachments when the email attachment flag is stale', async () => {
    const staleEmailRow = {
      ...EMAIL_ROW,
      status: 'read',
      thread_id: null,
      has_attachments: false,
    };
    const attachmentRow = {
      id: 7,
      filename: 'invoice.pdf',
      mime_type: 'application/pdf',
      size_bytes: '1234',
      storage_url: 'https://cdn.example.test/invoice.pdf',
      content_id: null,
      content_disposition: 'attachment',
    };

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(staleEmailRow);  // email found
    vi.mocked(mockDb.query).mockResolvedValueOnce([attachmentRow]);

    const res = await request(app).get('/1').set(authHeader(makeEmployeeUser()));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.has_attachments).toBe(true);
    expect(res.body.data.attachments).toEqual([
      {
        ...attachmentRow,
        download_url: '/api/crm/email/attachment/7/download',
      },
    ]);
    expect(backfillEmailAttachmentsMock).not.toHaveBeenCalled();
  });

  it('tries to recover attachments when metadata exists but saved file rows are missing', async () => {
    const staleEmailRow = {
      ...EMAIL_ROW,
      status: 'read',
      thread_id: null,
      has_attachments: true,
      attachment_count: 3,
    };

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(staleEmailRow);  // email found
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app).get('/1').set(authHeader(makeEmployeeUser()));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.has_attachments).toBe(true);
    expect(res.body.data.attachments).toEqual([]);
    expect(backfillEmailAttachmentsMock).toHaveBeenCalledWith(1);
  });

  it('returns recovered attachment rows after backfill', async () => {
    const staleEmailRow = {
      ...EMAIL_ROW,
      status: 'read',
      thread_id: null,
      has_attachments: true,
      attachment_count: 1,
    };
    const attachmentRow = {
      id: 8,
      filename: 'contract.pdf',
      mime_type: 'application/pdf',
      size_bytes: '2345',
      storage_url: 'https://cdn.example.test/contract.pdf',
      content_id: null,
      content_disposition: 'attachment',
    };

    vi.mocked(backfillEmailAttachmentsMock).mockResolvedValueOnce({
      emailId: 1,
      attempted: true,
      saved: 1,
      available: 1,
    });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(staleEmailRow);  // email found
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([attachmentRow]);

    const res = await request(app).get('/1').set(authHeader(makeEmployeeUser()));

    expect(res.status).toBe(200);
    expect(res.body.data.attachments).toEqual([
      {
        ...attachmentRow,
        download_url: '/api/crm/email/attachment/8/download',
      },
    ]);
  });
});

describe('POST /send — outbound email', () => {
  beforeEach(resetMocks);

  it('uses the SMTP identity for the selected configured sender', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: 55 }); // saved email

    const res = await request(app)
      .post('/send')
      .set(authHeader(makeEmployeeUser()))
      .send({
        from: 'info@fmagnus.org',
        to: 'client@example.com',
        subject: 'Hello',
        body_text: 'Message body',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({
      from: '"Test" <info@fmagnus.org>',
      to: 'client@example.com',
      subject: 'Hello',
      text: 'Message body',
    });
  });

  it('falls back to the shared SMTP relay for a configured mailbox without dedicated credentials', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: 57 }); // saved email

    const res = await request(app)
      .post('/send')
      .set(authHeader(makeEmployeeUser()))
      .send({
        from: 'info@svoefoto.ru',
        to: 'client@example.com',
        subject: 'Hello',
        body_text: 'Message body',
      });

    expect(res.status).toBe(201);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({
      from: '"Test" <info@fmagnus.org>',
      replyTo: 'info@svoefoto.ru',
      to: 'client@example.com',
    });
  });

  it('returns 503 when neither dedicated nor shared SMTP credentials are available', async () => {
    config.smtp.password = '';
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/send')
      .set(authHeader(makeEmployeeUser()))
      .send({
        from: 'info@svoefoto.ru',
        to: 'client@example.com',
        subject: 'Hello',
        body_text: 'Message body',
      });

    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).toContain('info@svoefoto.ru');
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('uses mailbox-specific SMTP environment for another sender', async () => {
    process.env['SMTP_INFO_SVOEFOTO_RU_USER'] = 'info@svoefoto.ru';
    process.env['SMTP_INFO_SVOEFOTO_RU_PASSWORD'] = 'svoefoto-secret';
    process.env['SMTP_INFO_SVOEFOTO_RU_FROM'] = '"Svoe Foto" <info@svoefoto.ru>';

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: 56 }); // saved email

    const res = await request(app)
      .post('/send')
      .set(authHeader(makeEmployeeUser()))
      .send({
        from: 'info@svoefoto.ru',
        to: 'client@example.com',
        subject: 'Hello',
        body_text: 'Message body',
      });

    expect(res.status).toBe(201);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({
      from: '"Svoe Foto" <info@svoefoto.ru>',
      to: 'client@example.com',
    });
  });
});
