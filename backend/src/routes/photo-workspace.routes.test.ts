import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../middleware/errorHandler.js';
import photoWorkspaceRoutes from './photo-workspace.routes.js';

vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, {
      user: {
        id: 'user-1',
        role: 'employee',
        permissions: ['bookings:manage'],
      },
    });
    next();
  },
  requirePermission: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireUser: (req: Request) => {
    if (!Reflect.get(req, 'user')) throw new Error('Unauthorized');
  },
}));

const service = vi.hoisted(() => ({
  getOrderWorkspace: vi.fn(),
  createItem: vi.fn(),
  saveCrop: vi.fn(),
  runCrop: vi.fn(),
  addReference: vi.fn(),
  updateReference: vi.fn(),
  deleteReference: vi.fn(),
  addWish: vi.fn(),
  updateWish: vi.fn(),
  rebuildPromptPlan: vi.fn(),
  updateVariantPrompt: vi.fn(),
  getJournal: vi.fn(),
}));
const aiService = vi.hoisted(() => ({
  runItemGeneration: vi.fn(),
  retryVariant: vi.fn(),
  streamAiArchive: vi.fn(),
}));
const approvalService = vi.hoisted(() => ({
  completePhotoshopUpload: vi.fn(),
  setChecked: vi.fn(),
  sendVerified: vi.fn(),
  replaceApprovalFile: vi.fn(),
  deleteApprovalFile: vi.fn(),
}));

vi.mock('../services/photo-workspace/photo-workspace.service.js', () => ({
  PhotoWorkspaceService: vi.fn(function PhotoWorkspaceServiceMock() {
    return service;
  }),
}));

vi.mock('../services/photo-workspace/photo-workspace-ai.service.js', () => ({
  PhotoWorkspaceAiService: vi.fn(function PhotoWorkspaceAiServiceMock() {
    return aiService;
  }),
}));

vi.mock('../services/photo-workspace/photo-workspace-approval.service.js', () => ({
  PhotoWorkspaceApprovalService: vi.fn(function PhotoWorkspaceApprovalServiceMock() {
    return approvalService;
  }),
}));

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/', photoWorkspaceRoutes);
  app.use(errorHandler);
  return app;
}

describe('photo workspace routes', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns order workspace', async () => {
    service.getOrderWorkspace.mockResolvedValue([{ item: { id: 'item-1' }, references: [], wishes: [], variants: [] }]);

    const res = await request(makeApp()).get('/orders/order-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ item: { id: 'item-1' }, references: [], wishes: [], variants: [] }] });
    expect(service.getOrderWorkspace).toHaveBeenCalledWith('order-1');
  });

  it('creates item using authenticated actor', async () => {
    service.createItem.mockResolvedValue({ id: 'item-1' });

    const res = await request(makeApp())
      .post('/orders/order-1/items')
      .send({
        approvalSessionId: 'session-1',
        sourceAssetUrl: '/media/source.jpg',
        sourceAssetName: 'Фото',
        label: 'Фото',
        tariffLevel: 'basic',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { id: 'item-1' } });
    expect(service.createItem).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-1',
      actorUserId: 'user-1',
      sourceAssetUrl: '/media/source.jpg',
      sourceAssetName: 'Фото',
      tariffLevel: 'basic',
    }));
  });

  it('saves crop payload with authenticated actor', async () => {
    service.saveCrop.mockResolvedValue({ id: 'item-1', crop_payload: { documentType: 'passport_rf' } });

    const cropPayload = {
      documentType: 'passport_rf',
      crownY: 100,
      chinY: 300,
      centerX: 220,
      rotationDeg: 0,
      imageNaturalWidth: 500,
      imageNaturalHeight: 700,
      updatedAt: '2026-06-22T10:00:00.000Z',
    };
    const res = await request(makeApp())
      .put('/items/item-1/crop')
      .send({ cropPayload });

    expect(res.status).toBe(200);
    expect(service.saveCrop).toHaveBeenCalledWith({
      itemId: 'item-1',
      actorUserId: 'user-1',
      cropPayload,
    });
  });

  it('runs deterministic crop with authenticated actor', async () => {
    service.runCrop.mockResolvedValue({ id: 'item-1', crop_result_url: '/media/crop.jpg' });

    const res = await request(makeApp())
      .post('/items/item-1/crop/run')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 'item-1', crop_result_url: '/media/crop.jpg' } });
    expect(service.runCrop).toHaveBeenCalledWith({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });
  });

  it('starts AI generation in the background without waiting for all variants', async () => {
    let resolveGeneration!: (value: { completed: number; failed: number }) => void;
    aiService.runItemGeneration.mockReturnValue(new Promise(resolve => {
      resolveGeneration = resolve;
    }));

    const responsePromise = request(makeApp())
      .post('/items/item-1/ai/run')
      .send({});
    const result = await Promise.race([
      responsePromise.then(res => ({ kind: 'response' as const, res })),
      new Promise<{ kind: 'timeout' }>(resolve => setTimeout(() => resolve({ kind: 'timeout' }), 25)),
    ]);

    if (result.kind === 'timeout') {
      resolveGeneration({ completed: 2, failed: 0 });
    }

    expect(result.kind).toBe('response');
    if (result.kind !== 'response') return;
    expect(result.res.status).toBe(202);
    expect(result.res.body).toEqual({ success: true, data: { status: 'processing' } });
    expect(aiService.runItemGeneration).toHaveBeenCalledWith({
      itemId: 'item-1',
      actorUserId: 'user-1',
      socketServer: undefined,
    });
  });

  it('retries one AI variant with authenticated actor', async () => {
    aiService.retryVariant.mockResolvedValue({ id: 'variant-1', status: 'needs_photoshop_check' });

    const res = await request(makeApp())
      .post('/variants/variant-1/ai/retry')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 'variant-1', status: 'needs_photoshop_check' } });
    expect(aiService.retryVariant).toHaveBeenCalledWith({
      variantId: 'variant-1',
      actorUserId: 'user-1',
      socketServer: undefined,
    });
  });

  it('calls AI retry with the service receiver intact', async () => {
    aiService.retryVariant.mockImplementation(function (this: unknown) {
      if (this !== aiService) {
        throw new Error('lost retry receiver');
      }
      return Promise.resolve({ id: 'variant-1', status: 'error' });
    });

    const res = await request(makeApp())
      .post('/variants/variant-1/ai/retry')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 'variant-1', status: 'error' } });
  });

  it('returns item journal entries', async () => {
    service.getJournal.mockResolvedValue([{ id: 'journal-1', event_type: 'crop_saved' }]);

    const res = await request(makeApp()).get('/items/item-1/journal');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ id: 'journal-1', event_type: 'crop_saved' }] });
    expect(service.getJournal).toHaveBeenCalledWith({ itemId: 'item-1' });
  });

  it('publishes checked Photoshop variants', async () => {
    approvalService.sendVerified.mockResolvedValue(undefined);

    const res = await request(makeApp())
      .post('/items/item-1/send-verified')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { sent: true } });
    expect(approvalService.sendVerified).toHaveBeenCalledWith({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });
  });
});
