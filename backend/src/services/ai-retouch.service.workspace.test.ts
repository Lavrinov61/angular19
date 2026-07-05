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
const falRunMock = vi.hoisted(() => vi.fn());
const falDownloadImageMock = vi.hoisted(() => vi.fn());
const thumbnailMock = vi.hoisted(() => vi.fn());
const updateCountersMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

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
    run: falRunMock,
    downloadImage: falDownloadImageMock,
  },
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => loggerMock),
}));

const { buildCustomEditInputForTest, executePipeline } = await import('./ai-retouch.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.query.mockResolvedValue([]);
  dbMock.queryOne.mockResolvedValue({ current_operation: 0 });
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
  falDownloadImageMock.mockResolvedValue(Buffer.from('ai-result'));
  thumbnailMock.mockResolvedValue({ thumbnailUrl: 'https://cdn/thumb.jpg' });
});

describe('ai retouch custom edit workspace references', () => {
  it('passes source image first and references after it', () => {
    expect(buildCustomEditInputForTest('/media/source.jpg', {
      prompt: 'clean skin',
      reference_urls: ['/media/hair.jpg', '/media/makeup.jpg'],
    })).toEqual({
      prompt: 'clean skin',
      image_urls: ['/media/source.jpg', '/media/hair.jpg', '/media/makeup.jpg'],
      num_images: 1,
      output_format: 'png',
      resolution: '1K',
    });
  });

  it('includes workspace metadata in progress and completion events', async () => {
    const emit = vi.fn();
    const socketServer = {
      to: vi.fn(() => ({ emit })),
    };

    const result = await executePipeline({
      jobId: 'job-1',
      sessionId: 'session-1',
      sourcePhotoUrl: 'https://cdn/source.jpg',
      operations: [{ type: 'crop_document', params: { documentType: 'passport_rf', crownY: 200, chinY: 520, centerX: 400 } }],
      createdBy: 'user-1',
      resultMode: 'work_result',
      socketServer,
      workspaceItemId: 'item-1',
      workspaceVariantId: 'variant-1',
    });

    expect(result).toMatchObject({
      status: 'completed',
      jobId: 'job-1',
      resultUrl: 'https://cdn/approvals/final.jpg',
      resultThumbnailUrl: 'https://cdn/thumb.jpg',
      resultPhotoId: null,
    });
    expect(emit).toHaveBeenCalledWith('retouch:progress', expect.objectContaining({
      workspaceItemId: 'item-1',
      workspaceVariantId: 'variant-1',
    }));
    expect(emit).toHaveBeenCalledWith('retouch:completed', expect.objectContaining({
      workspaceItemId: 'item-1',
      workspaceVariantId: 'variant-1',
    }));
  });

  it('emits fal.ai queue statuses in workspace progress events', async () => {
    falRunMock.mockImplementation(async (_modelId: string, _input: unknown, opts?: {
      onStatus?: (status: { status: string; requestId?: string; logs?: Array<{ message: string; timestamp: string }> }) => void;
    }) => {
      opts?.onStatus?.({
        status: 'IN_QUEUE',
        requestId: 'request-1',
        logs: [{ message: 'queued', timestamp: '2026-07-04T16:00:00.000Z' }],
      });
      opts?.onStatus?.({
        status: 'IN_PROGRESS',
        requestId: 'request-1',
        logs: [{ message: 'processing', timestamp: '2026-07-04T16:00:01.000Z' }],
      });
      opts?.onStatus?.({ status: 'COMPLETED', requestId: 'request-1' });
      return { image: { url: 'https://fal.media/result.png' } };
    });
    const emit = vi.fn();
    const socketServer = {
      to: vi.fn(() => ({ emit })),
    };

    await executePipeline({
      jobId: 'job-1',
      sessionId: 'session-1',
      sourcePhotoUrl: 'https://cdn/source.jpg',
      operations: [{ type: 'custom_edit', params: { prompt: 'clean skin' } }],
      createdBy: 'user-1',
      resultMode: 'work_result',
      socketServer,
      workspaceItemId: 'item-1',
      workspaceVariantId: 'variant-1',
    });

    expect(emit).toHaveBeenCalledWith('retouch:progress', expect.objectContaining({
      provider: 'fal.ai',
      providerStatus: 'IN_QUEUE',
      providerRequestId: 'request-1',
      providerLogMessage: 'queued',
      workspaceVariantId: 'variant-1',
    }));
    expect(emit).toHaveBeenCalledWith('retouch:progress', expect.objectContaining({
      provider: 'fal.ai',
      providerStatus: 'IN_PROGRESS',
      providerLogMessage: 'processing',
      workspaceVariantId: 'variant-1',
    }));
    expect(emit).toHaveBeenCalledWith('retouch:progress', expect.objectContaining({
      provider: 'fal.ai',
      providerStatus: 'COMPLETED',
      workspaceVariantId: 'variant-1',
    }));
  });

  it('includes workspace metadata in failed events', async () => {
    const emit = vi.fn();
    const socketServer = {
      to: vi.fn(() => ({ emit })),
    };

    const result = await executePipeline({
      jobId: 'job-1',
      sessionId: 'session-1',
      sourcePhotoUrl: 'https://cdn/source.jpg',
      operations: [{ type: 'missing_operation' }],
      createdBy: 'user-1',
      socketServer,
      workspaceItemId: 'item-1',
      workspaceVariantId: 'variant-1',
    });

    expect(result).toMatchObject({
      status: 'failed',
      jobId: 'job-1',
      error: 'Unknown operation: missing_operation',
      failedOperation: 0,
    });
    expect(emit).toHaveBeenCalledWith('retouch:failed', expect.objectContaining({
      workspaceItemId: 'item-1',
      workspaceVariantId: 'variant-1',
    }));
  });
});
