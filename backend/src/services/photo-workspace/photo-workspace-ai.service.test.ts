import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoWorkspaceAiService } from './photo-workspace-ai.service.js';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

const executePipelineMock = vi.hoisted(() => vi.fn());

vi.mock('../../database/db.js', () => ({
  default: dbMock,
}));

vi.mock('../ai-retouch.service.js', () => ({
  executePipeline: executePipelineMock,
  estimateCost: vi.fn(() => 0.05),
}));

const repository = {
  getItemEnvelope: vi.fn(),
  createAiRetouchJob: vi.fn(),
  getLatestApprovalSessionIdForOrder: vi.fn(),
  ensureApprovalSessionForOrder: vi.fn(),
  updateItemApprovalSession: vi.fn(),
  markVariantGenerating: vi.fn(),
  claimItemVariantsForAiGeneration: vi.fn(),
  markVariantAiCompleted: vi.fn(),
  markVariantAiFailed: vi.fn(),
  getVariant: vi.fn(),
  addJournal: vi.fn(),
};

const execute = vi.fn();

function makeEnvelope(overrides: { approvalSessionId?: string | null } = {}) {
  const approvalSessionId = Object.hasOwn(overrides, 'approvalSessionId')
    ? overrides.approvalSessionId ?? null
    : 'session-1';
  return {
    item: {
      id: 'item-1',
      order_id: 'order-1',
      approval_session_id: approvalSessionId,
      crop_result_url: '/media/crop.jpg',
    },
    references: [
      { asset_url: '/media/ref.jpg', use_in_ai: true, roles: ['hair'], description: 'hair reference' },
      { asset_url: '/media/internal.jpg', use_in_ai: false, roles: ['style'], description: 'internal only' },
    ],
    wishes: [],
    variants: [
      { id: 'v1', enabled: true, prompt_ready: true, final_prompt: 'first', status: 'planned' },
      { id: 'v2', enabled: true, prompt_ready: true, final_prompt: 'second', status: 'planned' },
    ],
  };
}

describe('PhotoWorkspaceAiService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs enabled prompt-ready variants one by one from the cropped source', async () => {
    const envelope = makeEnvelope();
    repository.getItemEnvelope.mockResolvedValue(envelope);
    repository.claimItemVariantsForAiGeneration.mockResolvedValue(envelope.variants);
    execute.mockResolvedValue({
      status: 'completed',
      jobId: 'job-1',
      resultUrl: '/media/ai-raw.jpg',
      resultThumbnailUrl: '/media/ai-thumb.jpg',
      resultPhotoId: null,
      actualCostUsd: 0.05,
    });
    const emit = vi.fn();
    const socketServer = { to: vi.fn(() => ({ emit })) };

    await new PhotoWorkspaceAiService(repository as never, execute).runItemGeneration({
      itemId: 'item-1',
      actorUserId: 'user-1',
      socketServer,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(repository.createAiRetouchJob).toHaveBeenCalledTimes(2);
    expect(repository.createAiRetouchJob).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: 'session-1',
      sourcePhotoUrl: '/media/crop.jpg',
      createdBy: 'user-1',
      costEstimateUsd: 0.05,
    }));
    expect(execute.mock.calls[0][0]).toMatchObject({
      sessionId: 'session-1',
      sourcePhotoUrl: '/media/crop.jpg',
      resultMode: 'work_result',
      workspaceItemId: 'item-1',
      workspaceVariantId: 'v1',
      operations: [{
        type: 'custom_edit',
        params: {
          prompt: expect.stringContaining('first'),
          reference_urls: ['/media/ref.jpg'],
        },
      }],
    });
    expect(execute.mock.calls[0]?.[0].operations[0]?.params.prompt).toBe('first');
    expect(execute.mock.calls[0]?.[0].operations[0]?.params.prompt).not.toContain('поправить структуру волос');
    expect(execute.mock.calls[0]?.[0].operations[0]?.params.prompt).not.toContain('сделать фон белым');
    expect(repository.markVariantGenerating).toHaveBeenNthCalledWith(1, 'v1', 'user-1');
    expect(repository.markVariantGenerating).toHaveBeenNthCalledWith(2, 'v2', 'user-1');
    expect(repository.markVariantAiCompleted).toHaveBeenCalledTimes(2);
    expect(repository.markVariantAiCompleted).toHaveBeenNthCalledWith(1, expect.objectContaining({
      variantId: 'v1',
      actorUserId: 'user-1',
      aiJobId: 'job-1',
      aiOriginalUrl: '/media/ai-raw.jpg',
      aiOriginalThumbnailUrl: '/media/ai-thumb.jpg',
    }));
    expect(emit).toHaveBeenCalledWith('photo-workspace:ai-complete', {
      orderId: 'order-1',
      itemId: 'item-1',
      completed: 2,
      failed: 0,
    });
  });

  it('links a missing approval session before running generated variants', async () => {
    const envelope = makeEnvelope({ approvalSessionId: null });
    repository.getItemEnvelope.mockResolvedValue(envelope);
    repository.claimItemVariantsForAiGeneration.mockResolvedValue(envelope.variants);
    repository.getLatestApprovalSessionIdForOrder.mockResolvedValue('session-1');
    repository.updateItemApprovalSession.mockResolvedValue({
      id: 'item-1',
      order_id: 'order-1',
      approval_session_id: 'session-1',
      crop_result_url: '/media/crop.jpg',
    });
    execute.mockResolvedValue({
      status: 'completed',
      jobId: 'job-1',
      resultUrl: '/media/ai-raw.jpg',
      resultThumbnailUrl: null,
      resultPhotoId: null,
      actualCostUsd: 0.05,
    });

    await new PhotoWorkspaceAiService(repository as never, execute).runItemGeneration({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });

    expect(repository.updateItemApprovalSession).toHaveBeenCalledWith({
      itemId: 'item-1',
      approvalSessionId: 'session-1',
      actorUserId: 'user-1',
    });
    expect(repository.createAiRetouchJob).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
    }));
  });

  it('creates an approval session when AI generation starts before any approval exists', async () => {
    const envelope = makeEnvelope({ approvalSessionId: null });
    repository.getItemEnvelope.mockResolvedValue(envelope);
    repository.claimItemVariantsForAiGeneration.mockResolvedValue(envelope.variants);
    repository.getLatestApprovalSessionIdForOrder.mockResolvedValue(null);
    repository.ensureApprovalSessionForOrder.mockResolvedValue('session-created');
    repository.updateItemApprovalSession.mockResolvedValue({
      id: 'item-1',
      order_id: 'order-1',
      approval_session_id: 'session-created',
      crop_result_url: '/media/crop.jpg',
    });
    execute.mockResolvedValue({
      status: 'completed',
      jobId: 'job-1',
      resultUrl: '/media/ai-raw.jpg',
      resultThumbnailUrl: null,
      resultPhotoId: null,
      actualCostUsd: 0.05,
    });

    await new PhotoWorkspaceAiService(repository as never, execute).runItemGeneration({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });

    expect(repository.ensureApprovalSessionForOrder).toHaveBeenCalledWith({
      orderId: 'order-1',
      actorUserId: 'user-1',
    });
    expect(repository.updateItemApprovalSession).toHaveBeenCalledWith({
      itemId: 'item-1',
      approvalSessionId: 'session-created',
      actorUserId: 'user-1',
    });
    expect(repository.createAiRetouchJob).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-created',
    }));
  });

  it('marks one failed variant and continues with the next eligible variant', async () => {
    const envelope = makeEnvelope();
    repository.getItemEnvelope.mockResolvedValue(envelope);
    repository.claimItemVariantsForAiGeneration.mockResolvedValue(envelope.variants);
    execute
      .mockResolvedValueOnce({
        status: 'failed',
        jobId: 'job-1',
        error: 'AI provider failed',
        failedOperation: 1,
      })
      .mockResolvedValueOnce({
        status: 'completed',
        jobId: 'job-2',
        resultUrl: '/media/ai-v2.jpg',
        resultThumbnailUrl: null,
        resultPhotoId: null,
        actualCostUsd: 0.05,
      });

    await new PhotoWorkspaceAiService(repository as never, execute).runItemGeneration({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });

    expect(repository.markVariantAiFailed).toHaveBeenCalledWith('v1', 'user-1', 'AI provider failed');
    expect(repository.markVariantGenerating).toHaveBeenNthCalledWith(2, 'v2', 'user-1');
    expect(repository.markVariantAiCompleted).toHaveBeenCalledWith(expect.objectContaining({
      variantId: 'v2',
      aiJobId: 'job-2',
      aiOriginalUrl: '/media/ai-v2.jpg',
    }));
  });

  it('runs claimed variants with a concurrency limit of two instead of strictly one by one', async () => {
    const envelope = makeEnvelope();
    const variants = [
      ...envelope.variants,
      { id: 'v3', enabled: true, prompt_ready: true, final_prompt: 'third', status: 'planned' },
    ];
    repository.getItemEnvelope.mockResolvedValue({ ...envelope, variants });
    repository.claimItemVariantsForAiGeneration.mockResolvedValue(variants);
    const resolveVariant: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    execute.mockImplementation(input => new Promise(resolve => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const variantId = String(input.workspaceVariantId);
      resolveVariant.push(() => {
        active -= 1;
        resolve({
          status: 'completed',
          jobId: `job-${variantId}`,
          resultUrl: `/media/${variantId}.jpg`,
          resultThumbnailUrl: null,
          resultPhotoId: null,
          actualCostUsd: 0.05,
        });
      });
    }));

    const pending = new PhotoWorkspaceAiService(repository as never, execute).runItemGeneration({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls.map(call => call[0].workspaceVariantId)).toEqual(['v1', 'v2']);
    expect(maxActive).toBe(2);

    resolveVariant[0]?.();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(execute.mock.calls[2]?.[0].workspaceVariantId).toBe('v3');

    resolveVariant[1]?.();
    resolveVariant[2]?.();
    await expect(pending).resolves.toEqual({ completed: 3, failed: 0 });
    expect(maxActive).toBe(2);
  });

  it('stores fal.ai billing failures as a readable employee-facing message', async () => {
    const envelope = makeEnvelope();
    repository.getItemEnvelope.mockResolvedValue(envelope);
    repository.claimItemVariantsForAiGeneration.mockResolvedValue([envelope.variants[0]]);
    execute.mockResolvedValue({
      status: 'failed',
      jobId: 'job-1',
      error: 'fal.ai submit failed (403): {"detail":"User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing."}',
      failedOperation: 1,
    });

    await new PhotoWorkspaceAiService(repository as never, execute).runItemGeneration({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });

    expect(repository.markVariantAiFailed).toHaveBeenCalledWith(
      'v1',
      'user-1',
      'AI-сервис недоступен: закончился баланс fal.ai. Сообщите администратору, чтобы пополнить баланс.',
    );
  });

  it('stores fal.ai circuit breaker failures as a readable employee-facing message', async () => {
    const envelope = makeEnvelope();
    repository.getItemEnvelope.mockResolvedValue(envelope);
    repository.claimItemVariantsForAiGeneration.mockResolvedValue([envelope.variants[0]]);
    execute.mockResolvedValue({
      status: 'failed',
      jobId: 'job-1',
      error: 'Circuit breaker OPEN for fal-ai — 7 failures, last: fal.ai submit failed (403): {"detail":"User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing."}',
      failedOperation: 1,
    });

    await new PhotoWorkspaceAiService(repository as never, execute).runItemGeneration({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });

    expect(repository.markVariantAiFailed).toHaveBeenCalledWith(
      'v1',
      'user-1',
      'AI-сервис недоступен: закончился баланс fal.ai. Сообщите администратору, чтобы пополнить баланс.',
    );
  });

  it('retries one runnable variant without rerunning other variants', async () => {
    repository.getVariant
      .mockResolvedValueOnce({ id: 'v1', item_id: 'item-1' })
      .mockResolvedValueOnce({ id: 'v1', item_id: 'item-1', status: 'needs_photoshop_check' });
    repository.getItemEnvelope.mockResolvedValue(makeEnvelope());
    execute.mockResolvedValue({
      status: 'completed',
      jobId: 'job-1',
      resultUrl: '/media/ai-v1.jpg',
      resultThumbnailUrl: null,
      resultPhotoId: null,
      actualCostUsd: 0.05,
    });

    const result = await new PhotoWorkspaceAiService(repository as never, execute).retryVariant({
      variantId: 'v1',
      actorUserId: 'user-1',
    });

    expect(result).toMatchObject({ id: 'v1', status: 'needs_photoshop_check' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({
      workspaceVariantId: 'v1',
      sourcePhotoUrl: '/media/crop.jpg',
    });
    expect(repository.markVariantGenerating).toHaveBeenCalledWith('v1', 'user-1');
    expect(repository.markVariantAiCompleted).toHaveBeenCalledWith(expect.objectContaining({
      variantId: 'v1',
      aiOriginalUrl: '/media/ai-v1.jpg',
    }));
  });

  it('does not start duplicate jobs when item variants were already claimed', async () => {
    repository.getItemEnvelope.mockResolvedValue(makeEnvelope());
    repository.claimItemVariantsForAiGeneration.mockResolvedValue([]);

    const result = await new PhotoWorkspaceAiService(repository as never, execute).runItemGeneration({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });

    expect(result).toEqual({ completed: 0, failed: 0 });
    expect(repository.claimItemVariantsForAiGeneration).toHaveBeenCalledWith('item-1', 'user-1');
    expect(repository.createAiRetouchJob).not.toHaveBeenCalled();
    expect(repository.markVariantGenerating).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
