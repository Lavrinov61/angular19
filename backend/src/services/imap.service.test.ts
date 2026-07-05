import { describe, expect, it, vi } from 'vitest';
import {
  shouldSkipExistingEmailAttachmentBackfill,
  type ExistingEmailAttachmentState,
} from './imap.service.js';

vi.mock('imapflow', () => ({ ImapFlow: vi.fn() }));
vi.mock('mailparser', () => ({ simpleParser: vi.fn() }));
vi.mock('../config/index.js', () => ({
  config: {
    imap: {
      host: 'imap.test',
      port: 993,
      secure: true,
      user: '',
      password: '',
      mailbox: 'INBOX',
      pollIntervalMs: 30000,
    },
  },
}));
vi.mock('../database/db.js', () => ({
  default: {
    query: vi.fn(),
    queryOne: vi.fn(),
  },
}));
vi.mock('./storage.service.js', () => ({
  storageService: {
    upload: vi.fn(),
  },
}));
vi.mock('./connectors/core/account-store.js', () => ({
  getAccountByChannel: vi.fn().mockResolvedValue(null),
}));
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

function existingEmailState(overrides: Partial<ExistingEmailAttachmentState>): ExistingEmailAttachmentState {
  return {
    id: 1,
    has_attachments: false,
    attachment_count: 0,
    has_saved_attachments: false,
    ...overrides,
  };
}

describe('shouldSkipExistingEmailAttachmentBackfill', () => {
  it('does not skip when only denormalized attachment flags are set', () => {
    expect(shouldSkipExistingEmailAttachmentBackfill(existingEmailState({
      has_attachments: true,
      attachment_count: 0,
      has_saved_attachments: false,
    }))).toBe(false);

    expect(shouldSkipExistingEmailAttachmentBackfill(existingEmailState({
      has_attachments: false,
      attachment_count: 2,
      has_saved_attachments: false,
    }))).toBe(false);
  });

  it('skips only when attachment rows are already persisted', () => {
    expect(shouldSkipExistingEmailAttachmentBackfill(existingEmailState({
      has_attachments: false,
      attachment_count: 0,
      has_saved_attachments: true,
    }))).toBe(true);

    expect(shouldSkipExistingEmailAttachmentBackfill(null)).toBe(false);
  });
});
