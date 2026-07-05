import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  upload: vi.fn(),
  keyFromUrl: vi.fn(),
  downloadToBuffer: vi.fn(),
}));

const executeCropMock = vi.hoisted(() => vi.fn());
const thumbnailMock = vi.hoisted(() => vi.fn());
const updateCountersMock = vi.hoisted(() => vi.fn());

vi.mock('../database/db.js', () => ({
  default: dbMock,
}));

vi.mock('./storage.service.js', () => ({
  storageService: storageMock,
}));

vi.mock('./crop/crop-document.executor.js', () => ({
  executeCropDocument: executeCropMock,
}));

vi.mock('./approval-thumbnail.service.js', () => ({
  generateThumbnail: thumbnailMock,
}));

vi.mock('./approval-counters.service.js', () => ({
  updateSessionCounters: updateCountersMock,
}));

vi.mock('./fal-ai.service.js', () => ({
  falAIService: {
    enabled: true,
    run: vi.fn(),
    downloadImage: vi.fn(),
  },
}));

import { executePipeline } from './ai-retouch.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  executeCropMock.mockResolvedValue({
    buffer: Buffer.from('cropped'),
    plan: {
      extract: { left: 0, top: 0, width: 1, height: 1 },
      extend: { top: 0, bottom: 0, left: 0, right: 0 },
      target: { width: 1102, height: 1417 },
      density: 800,
      jpegQuality: 92,
      warnings: [],
    },
  });
  storageMock.upload
    .mockResolvedValueOnce({ url: 'https://cdn/approvals/ai/job-1/step-1.jpg', key: 'approvals/ai/job-1/step-1.jpg' })
    .mockResolvedValueOnce({ url: 'https://cdn/approvals/final.jpg', key: 'approvals/final.jpg' });
  storageMock.keyFromUrl.mockReturnValue('approvals/ai/job-1/step-1.jpg');
  storageMock.downloadToBuffer.mockResolvedValue({ buffer: Buffer.from('cropped') });
  thumbnailMock.mockResolvedValue({ thumbnailUrl: 'https://cdn/thumb.jpg' });
});

describe('executePipeline resultMode=work_result', () => {
  it('completes crop job with downloadable result without inserting a photo_approvals row', async () => {
    await executePipeline({
      jobId: 'job-1',
      sessionId: 'session-1',
      sourcePhotoUrl: 'https://cdn/source.jpg',
      operations: [{ type: 'crop_document', params: { documentType: 'passport_rf', crownY: 200, chinY: 520, centerX: 400 } }],
      createdBy: 'user-1',
      resultMode: 'work_result',
    });

    const sqlCalls = dbMock.query.mock.calls.map(call => String(call[0]));
    expect(sqlCalls.some(sql => sql.includes('INSERT INTO photo_approvals'))).toBe(false);
    expect(updateCountersMock).not.toHaveBeenCalled();
    expect(sqlCalls.some(sql => sql.includes('result_photo_id = $4'))).toBe(true);
    const completionCall = dbMock.query.mock.calls.find(call => String(call[0]).includes('result_photo_id = $4'));
    expect(completionCall?.[1]).toEqual(['job-1', 'https://cdn/approvals/final.jpg', 'https://cdn/thumb.jpg', null, 0]);
  });
});
