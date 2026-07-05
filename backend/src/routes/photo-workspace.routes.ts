import { Router, type Response } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { authenticateToken, requirePermission, requireUser, type AuthRequest } from '../middleware/auth.js';
import { PhotoWorkspaceAiService } from '../services/photo-workspace/photo-workspace-ai.service.js';
import { PhotoWorkspaceApprovalService } from '../services/photo-workspace/photo-workspace-approval.service.js';
import { PhotoWorkspaceService } from '../services/photo-workspace/photo-workspace.service.js';
import { createLogger } from '../utils/logger.js';
import type { PhotoWorkspaceCropPayloadJsonb } from '../types/jsonb/photo-workspace-jsonb.js';

interface SocketServerLike {
  to: (room: string) => { emit: (event: string, data: unknown) => void };
}

interface UnknownObject {
  [key: string]: unknown;
}

interface UpdateWorkspaceItemInput {
  itemId: string;
  actorUserId: string;
  label: string;
  tariffLevel: string;
  documentType: string;
  activeSection: string;
}

interface ImportApprovalFeedbackInput {
  itemId: string;
  actorUserId: string;
}

interface RetryVariantInput {
  variantId: string;
  actorUserId: string;
  socketServer?: SocketServerLike;
}

interface StreamAiArchiveInput {
  itemId: string;
  actorUserId: string;
  response: Response;
}

interface PhotoWorkspaceRouteService {
  getOrderWorkspace: PhotoWorkspaceService['getOrderWorkspace'];
  createItem: PhotoWorkspaceService['createItem'];
  saveCrop: PhotoWorkspaceService['saveCrop'];
  runCrop: PhotoWorkspaceService['runCrop'];
  addReference: PhotoWorkspaceService['addReference'];
  updateReference: PhotoWorkspaceService['updateReference'];
  deleteReference: PhotoWorkspaceService['deleteReference'];
  addWish: PhotoWorkspaceService['addWish'];
  updateWish: PhotoWorkspaceService['updateWish'];
  rebuildPromptPlan: PhotoWorkspaceService['rebuildPromptPlan'];
  updateVariantPrompt: PhotoWorkspaceService['updateVariantPrompt'];
  getJournal: PhotoWorkspaceService['getJournal'];
  updateItem?: (input: UpdateWorkspaceItemInput) => Promise<unknown>;
  importApprovalFeedback?: (input: ImportApprovalFeedbackInput) => Promise<unknown>;
}

interface PhotoWorkspaceAiRouteService {
  runItemGeneration: PhotoWorkspaceAiService['runItemGeneration'];
  retryVariant?: (input: RetryVariantInput) => Promise<unknown>;
  streamAiArchive?: (input: StreamAiArchiveInput) => Promise<void>;
}

const router = Router();
const workspaceService: PhotoWorkspaceRouteService = new PhotoWorkspaceService();
const aiService: PhotoWorkspaceAiRouteService = new PhotoWorkspaceAiService();
const approvalService = new PhotoWorkspaceApprovalService();
const logger = createLogger('photo-workspace.routes');

router.use(authenticateToken, requirePermission('bookings:manage'));

router.get('/orders/:orderId', async (req: AuthRequest, res): Promise<void> => {
  const data = await workspaceService.getOrderWorkspace(routeParam(req, 'orderId'));
  sendData(res, data);
});

router.post('/orders/:orderId/items', async (req: AuthRequest, res): Promise<void> => {
  const actorUserId = actorId(req, res);
  const sourceAssetName = readStringWithDefault(req.body, 'sourceAssetName', 'Фото');
  const data = await workspaceService.createItem({
    orderId: routeParam(req, 'orderId'),
    approvalSessionId: readNullableString(req.body, 'approvalSessionId'),
    sourceAssetId: readNullableString(req.body, 'sourceAssetId'),
    sourceAssetUrl: readString(req.body, 'sourceAssetUrl'),
    sourceAssetName,
    label: readStringWithDefault(req.body, 'label', sourceAssetName),
    tariffLevel: readTariffLevel(req.body),
    actorUserId,
  });
  sendData(res, data, 201);
});

router.patch('/items/:itemId', async (req: AuthRequest, res): Promise<void> => {
  const updateItem = workspaceService.updateItem;
  if (!updateItem) throw notImplemented('Workspace item metadata update is not implemented');

  const data = await updateItem({
    itemId: routeParam(req, 'itemId'),
    actorUserId: actorId(req, res),
    label: readString(req.body, 'label'),
    tariffLevel: readString(req.body, 'tariffLevel'),
    documentType: readString(req.body, 'documentType'),
    activeSection: readString(req.body, 'activeSection'),
  });
  sendData(res, data);
});

router.put('/items/:itemId/crop', async (req: AuthRequest, res): Promise<void> => {
  const data = await workspaceService.saveCrop({
    itemId: routeParam(req, 'itemId'),
    actorUserId: actorId(req, res),
    cropPayload: readCropPayload(req.body),
  });
  sendData(res, data);
});

router.post('/items/:itemId/crop/run', async (req: AuthRequest, res): Promise<void> => {
  const data = await workspaceService.runCrop({
    itemId: routeParam(req, 'itemId'),
    actorUserId: actorId(req, res),
  });
  sendData(res, data);
});

router.post('/items/:itemId/references', async (req: AuthRequest, res): Promise<void> => {
  const data = await workspaceService.addReference({
    itemId: routeParam(req, 'itemId'),
    assetId: readNullableString(req.body, 'assetId'),
    assetUrl: readString(req.body, 'assetUrl'),
    assetName: readStringWithDefault(req.body, 'assetName', 'Референс'),
    thumbnailUrl: readNullableString(req.body, 'thumbnailUrl'),
    source: readStringWithDefault(req.body, 'source', 'order'),
    roles: readStringArray(req.body, 'roles'),
    useInAi: readBoolean(req.body, 'useInAi'),
    description: readString(req.body, 'description'),
    actorUserId: actorId(req, res),
  });
  sendData(res, data, 201);
});

router.patch('/references/:referenceId', async (req: AuthRequest, res): Promise<void> => {
  const data = await workspaceService.updateReference({
    referenceId: routeParam(req, 'referenceId'),
    roles: readStringArray(req.body, 'roles'),
    useInAi: readBoolean(req.body, 'useInAi'),
    description: readString(req.body, 'description'),
    actorUserId: actorId(req, res),
  });
  sendData(res, data);
});

router.delete('/references/:referenceId', async (req: AuthRequest, res): Promise<void> => {
  const deleted = await workspaceService.deleteReference(routeParam(req, 'referenceId'));
  sendData(res, { deleted });
});

router.post('/items/:itemId/wishes', async (req: AuthRequest, res): Promise<void> => {
  const data = await workspaceService.addWish({
    itemId: routeParam(req, 'itemId'),
    sourceType: readStringWithDefault(req.body, 'sourceType', 'manual'),
    sourceId: readNullableString(req.body, 'sourceId'),
    sourceLabel: readNullableString(req.body, 'sourceLabel'),
    text: readString(req.body, 'text'),
    actorUserId: actorId(req, res),
  });
  sendData(res, data, 201);
});

router.post('/items/:itemId/wishes/import-approval-feedback', async (req: AuthRequest, res): Promise<void> => {
  if (!workspaceService.importApprovalFeedback) throw notImplemented('Workspace approval feedback import is not implemented');

  const data = await workspaceService.importApprovalFeedback({
    itemId: routeParam(req, 'itemId'),
    actorUserId: actorId(req, res),
  });
  sendData(res, data);
});

router.patch('/wishes/:wishId', async (req: AuthRequest, res): Promise<void> => {
  const data = await workspaceService.updateWish({
    wishId: routeParam(req, 'wishId'),
    text: readString(req.body, 'text'),
    status: readWishStatus(req.body),
    rejectReason: readNullableString(req.body, 'rejectReason'),
    actorUserId: actorId(req, res),
  });
  sendData(res, data);
});

router.post('/items/:itemId/prompt-plan/rebuild', async (req: AuthRequest, res): Promise<void> => {
  const data = await workspaceService.rebuildPromptPlan({
    itemId: routeParam(req, 'itemId'),
    actorUserId: actorId(req, res),
    variantLimit: readNumberWithDefault(req.body, 'variantLimit', 0),
    acceptedWishes: readStringArray(req.body, 'acceptedWishes'),
    retouchOptions: readStringArray(req.body, 'retouchOptions'),
    documentLabel: readStringWithDefault(req.body, 'documentLabel', 'Фото на документы'),
  });
  sendData(res, data);
});

router.patch('/variants/:variantId/prompt', async (req: AuthRequest, res): Promise<void> => {
  const data = await workspaceService.updateVariantPrompt({
    variantId: routeParam(req, 'variantId'),
    actorUserId: actorId(req, res),
    basePrompt: readString(req.body, 'basePrompt'),
    manualPrompt: readString(req.body, 'manualPrompt'),
    referencesSummary: readString(req.body, 'referencesSummary'),
  });
  sendData(res, data);
});

router.post('/items/:itemId/ai/run', async (req: AuthRequest, res): Promise<void> => {
  const itemId = routeParam(req, 'itemId');
  void aiService.runItemGeneration({
    itemId,
    actorUserId: actorId(req, res),
    socketServer: getSocketServer(req.app),
  }).catch((error: unknown) => {
    logger.error('Photo workspace AI generation failed in background', {
      itemId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  sendData(res, { status: 'processing' }, 202);
});

router.post('/variants/:variantId/ai/retry', async (req: AuthRequest, res): Promise<void> => {
  if (!aiService.retryVariant) throw notImplemented('Workspace AI variant retry is not implemented');

  const data = await aiService.retryVariant({
    variantId: routeParam(req, 'variantId'),
    actorUserId: actorId(req, res),
    socketServer: getSocketServer(req.app),
  });
  sendData(res, data);
});

router.get('/items/:itemId/ai/archive', async (req: AuthRequest, res): Promise<void> => {
  if (!aiService.streamAiArchive) throw notImplemented('Workspace AI archive stream is not implemented');

  await aiService.streamAiArchive({
    itemId: routeParam(req, 'itemId'),
    actorUserId: actorId(req, res),
    response: res,
  });
  if (!res.headersSent) sendData(res, { streamed: true });
});

router.post('/variants/:variantId/photoshop', async (req: AuthRequest, res): Promise<void> => {
  const data = await approvalService.completePhotoshopUpload({
    variantId: routeParam(req, 'variantId'),
    s3Key: readString(req.body, 's3Key'),
    actorUserId: actorId(req, res),
  });
  sendData(res, data);
});

router.patch('/variants/:variantId/check', async (req: AuthRequest, res): Promise<void> => {
  const data = await approvalService.setChecked({
    variantId: routeParam(req, 'variantId'),
    checked: readBoolean(req.body, 'checked'),
    actorUserId: actorId(req, res),
  });
  sendData(res, data);
});

router.post('/items/:itemId/send-verified', async (req: AuthRequest, res): Promise<void> => {
  const socketServer = getSocketServer(req.app);
  await approvalService.sendVerified({
    itemId: routeParam(req, 'itemId'),
    actorUserId: actorId(req, res),
    ...(socketServer ? { socketServer } : {}),
  });
  sendData(res, { sent: true });
});

router.put('/variants/:variantId/approval-file', async (req: AuthRequest, res): Promise<void> => {
  const socketServer = getSocketServer(req.app);
  await approvalService.replaceApprovalFile({
    variantId: routeParam(req, 'variantId'),
    s3Key: readString(req.body, 's3Key'),
    actorUserId: actorId(req, res),
    ...(socketServer ? { socketServer } : {}),
  });
  sendData(res, { replaced: true });
});

router.delete('/variants/:variantId/approval-file', async (req: AuthRequest, res): Promise<void> => {
  const socketServer = getSocketServer(req.app);
  await approvalService.deleteApprovalFile({
    variantId: routeParam(req, 'variantId'),
    actorUserId: actorId(req, res),
    ...(socketServer ? { socketServer } : {}),
  });
  sendData(res, { deleted: true });
});

router.get('/items/:itemId/journal', async (req: AuthRequest, res): Promise<void> => {
  const data = await workspaceService.getJournal({ itemId: routeParam(req, 'itemId') });
  sendData(res, data);
});

function sendData(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}

function actorId(req: AuthRequest, res: Response): string {
  requireUser(req, res);
  return req.user.id;
}

function routeParam(req: AuthRequest, key: string): string {
  const value = req.params[key];
  if (!value) throw new AppError(400, `${key} is required`);
  return value;
}

function notImplemented(message: string): AppError {
  return new AppError(501, message);
}

function isRecord(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getField(body: unknown, key: string): unknown {
  return isRecord(body) ? Reflect.get(body, key) : undefined;
}

function readString(body: unknown, key: string): string {
  const value = getField(body, key);
  return typeof value === 'string' ? value.trim() : '';
}

function readStringWithDefault(body: unknown, key: string, fallback: string): string {
  const value = readString(body, key);
  return value || fallback;
}

function readNullableString(body: unknown, key: string): string | null {
  const value = readString(body, key);
  return value || null;
}

function readStringArray(body: unknown, key: string): string[] {
  const value = getField(body, key);
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function readBoolean(body: unknown, key: string): boolean {
  return getField(body, key) === true;
}

function readNumberWithDefault(body: unknown, key: string, fallback: number): number {
  const value = getField(body, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readTariffLevel(body: unknown): 'basic' | 'extended' | 'maximum' | 'super' {
  const value = readString(body, 'tariffLevel');
  if (value === 'extended' || value === 'maximum' || value === 'super') return value;
  return 'basic';
}

function readWishStatus(body: unknown): 'pending' | 'accepted' | 'rejected' {
  const value = readString(body, 'status');
  if (value === 'accepted' || value === 'rejected') return value;
  return 'pending';
}

function readCropPayload(body: unknown): PhotoWorkspaceCropPayloadJsonb {
  const nestedPayload = getField(body, 'cropPayload');
  const source = isRecord(nestedPayload) ? nestedPayload : body;
  return {
    documentType: readStringWithDefault(source, 'documentType', 'passport_rf'),
    crownY: readNumberWithDefault(source, 'crownY', 0),
    chinY: readNumberWithDefault(source, 'chinY', 0),
    centerX: readNumberWithDefault(source, 'centerX', 0),
    rotationDeg: readNumberWithDefault(source, 'rotationDeg', 0),
    imageNaturalWidth: readNumberWithDefault(source, 'imageNaturalWidth', 0),
    imageNaturalHeight: readNumberWithDefault(source, 'imageNaturalHeight', 0),
    updatedAt: readStringWithDefault(source, 'updatedAt', new Date().toISOString()),
  };
}

function getSocketServer(app: unknown): SocketServerLike | undefined {
  if (!isRecord(app)) return undefined;
  const socketServer = Reflect.get(app, 'socketServer');
  if (!isRecord(socketServer)) return undefined;
  const to = Reflect.get(socketServer, 'to');
  if (typeof to === 'function') return { to: to.bind(socketServer) };
  const getIO = Reflect.get(socketServer, 'getIO');
  if (typeof getIO !== 'function') return undefined;
  const io: unknown = getIO.call(socketServer);
  if (!isRecord(io)) return undefined;
  const ioTo = Reflect.get(io, 'to');
  return typeof ioTo === 'function' ? { to: ioTo.bind(io) } : undefined;
}

export default router;
