import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  keyFromUrl: vi.fn(),
  downloadToBuffer: vi.fn(),
}));

const thumbnailMock = vi.hoisted(() => vi.fn());

vi.mock('../database/db.js', () => ({
  pool: poolMock,
}));

vi.mock('./storage.service.js', () => ({
  storageService: storageMock,
}));

vi.mock('./approval-thumbnail.service.js', () => ({
  generateThumbnail: thumbnailMock,
}));

import { saveApprovalOriginalFromUrl } from './approval-original.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.keyFromUrl.mockReturnValue('approvals/ai/job/result.jpg');
  storageMock.downloadToBuffer.mockResolvedValue({ buffer: Buffer.from('image') });
  thumbnailMock.mockResolvedValue({ thumbnailUrl: 'https://cdn/thumb.jpg' });
});

describe('saveApprovalOriginalFromUrl', () => {
  it('rejects non-storage urls before updating approval session', async () => {
    storageMock.keyFromUrl.mockReturnValue(null);

    await expect(
      saveApprovalOriginalFromUrl('session-1', 'https://evil.example.com/photo.jpg'),
    ).rejects.toThrow(/storage/);

    expect(poolMock.query).not.toHaveBeenCalled();
  });

  it('stores cropped result as session original and backfills photos without creating approval photo', async () => {
    poolMock.query
      .mockResolvedValueOnce({ rows: [{ id: 'session-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await saveApprovalOriginalFromUrl(
      'session-1',
      'https://cdn.example.com/approvals/ai/job/result.jpg',
    );

    expect(result).toEqual({
      url: 'https://cdn.example.com/approvals/ai/job/result.jpg',
      thumbnailUrl: 'https://cdn/thumb.jpg',
    });
    expect(poolMock.query).toHaveBeenCalledTimes(3);
    expect(poolMock.query.mock.calls[1][0]).toContain('UPDATE photo_approval_sessions');
    expect(poolMock.query.mock.calls[2][0]).toContain('UPDATE photo_approvals');
    expect(poolMock.query.mock.calls.some(call => String(call[0]).includes('INSERT INTO photo_approvals'))).toBe(false);
  });
});
