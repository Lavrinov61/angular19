import { Router, type Response } from 'express';
import { authenticateToken, requireUser, type AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import {
  adminGetB2BOrganization,
  adminListB2BOrganizations,
  adminListBankTransactions,
  adminListReconciliationTasks,
  adminListVerificationTasks,
  adminRegenerateDocument,
  adminResolveReconciliationTask,
  adminResolveVerificationTask,
  adminSendDocumentToEdo,
  adminUpdateB2BOrganization,
  createB2BInvoice,
  createB2BMember,
  createB2BOrganization,
  failBankIdentityCallback,
  getB2BBalance,
  getB2BDocument,
  getB2BInvoice,
  getB2BVerificationStatus,
  getBankIdentityProviders,
  getMyB2BOrganization,
  listB2BDocuments,
  listB2BInvoices,
  listB2BMembers,
  listB2BUsage,
  parseBankIdentityProviderCode,
  startBankIdentityVerification,
  updateB2BMember,
  updateMyB2BOrganization,
} from '../services/b2b.service.js';
import {
  adminUpdateB2BOrganizationSchema,
  b2bListQuerySchema,
  createB2BInvoiceSchema,
  createB2BMemberSchema,
  createB2BOrganizationSchema,
  resolveB2BReconciliationTaskSchema,
  resolveB2BVerificationTaskSchema,
  updateB2BMemberSchema,
  updateB2BOrganizationSchema,
} from '../schemas/b2b.schema.js';

const router = Router();
export const b2bAdminRoutes = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseListQuery(query: unknown) {
  const parsed = b2bListQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues.map(issue => issue.message).join('; '), ErrorCode.VALIDATION_ERROR);
  }
  return parsed.data;
}

function requireUuid(value: string | undefined, label: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new AppError(400, `${label} должен быть UUID`, ErrorCode.VALIDATION_ERROR);
  }
  return value;
}

function getQueryString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : null;
  }
  return null;
}

// Public callback endpoint. Real provider token exchange is intentionally not
// faked: until connector credentials and mapping are configured, the attempt is
// marked failed and API returns 501.
router.get('/verification/bank-identity/:provider/callback', async (req, res: Response): Promise<void> => {
  const provider = parseBankIdentityProviderCode(String(req.params['provider'] ?? ''));
  const state = getQueryString(req.query['state']);
  if (!state) throw new AppError(400, 'state обязателен', ErrorCode.VALIDATION_ERROR);

  const verification = await failBankIdentityCallback(
    provider,
    state,
    getQueryString(req.query['error']),
    getQueryString(req.query['error_description']),
  );
  res.json({ success: true, data: verification });
});

router.use(authenticateToken);

router.get('/organizations/current', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const organization = await getMyB2BOrganization(req.user.id);
  res.json({ success: true, data: organization });
});

router.post(
  '/organizations',
  validate(createB2BOrganizationSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const organization = await createB2BOrganization(req.user.id, req.body);
    res.status(201).json({ success: true, data: organization });
  },
);

router.patch(
  '/organizations/current',
  validate(updateB2BOrganizationSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const organization = await updateMyB2BOrganization(req.user.id, req.body);
    res.json({ success: true, data: organization });
  },
);

router.get('/verification/status', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const status = await getB2BVerificationStatus(req.user.id);
  res.json({ success: true, data: status });
});

router.get('/verification/bank-identity/providers', async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ success: true, data: getBankIdentityProviders() });
});

router.post('/verification/bank-identity/:provider/start', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const provider = parseBankIdentityProviderCode(String(req.params['provider'] ?? ''));
  const result = await startBankIdentityVerification(req.user.id, provider);
  res.status(201).json({ success: true, data: result });
});

router.get('/members', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const members = await listB2BMembers(req.user.id);
  res.json({ success: true, data: members });
});

router.post('/members', validate(createB2BMemberSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const member = await createB2BMember(req.user.id, req.body);
  res.status(201).json({ success: true, data: member });
});

router.patch('/members/:id', validate(updateB2BMemberSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const memberId = requireUuid(req.params['id'], 'id участника');
  const member = await updateB2BMember(req.user.id, memberId, req.body);
  res.json({ success: true, data: member });
});

router.get('/invoices', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const result = await listB2BInvoices(req.user.id, parseListQuery(req.query));
  res.json({ success: true, data: result.rows, total: result.total });
});

router.post('/invoices', validate(createB2BInvoiceSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const invoice = await createB2BInvoice(req.user.id, req.body);
  res.status(201).json({ success: true, data: invoice });
});

router.get('/invoices/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const invoice = await getB2BInvoice(req.user.id, requireUuid(req.params['id'], 'id счета'));
  res.json({ success: true, data: invoice });
});

router.get('/documents', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const result = await listB2BDocuments(req.user.id, parseListQuery(req.query));
  res.json({ success: true, data: result.rows, total: result.total });
});

router.get('/documents/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const document = await getB2BDocument(req.user.id, requireUuid(req.params['id'], 'id пакета документов'));
  res.json({ success: true, data: document });
});

router.get('/balance', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const balance = await getB2BBalance(req.user.id);
  res.json({ success: true, data: balance });
});

router.get('/usage', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const result = await listB2BUsage(req.user.id, parseListQuery(req.query));
  res.json({ success: true, data: result.rows, total: result.total });
});

b2bAdminRoutes.get('/organizations', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = await adminListB2BOrganizations(parseListQuery(req.query));
  res.json({ success: true, data: result.rows, total: result.total });
});

b2bAdminRoutes.get('/organizations/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const organization = await adminGetB2BOrganization(requireUuid(req.params['id'], 'id организации'));
  res.json({ success: true, data: organization });
});

b2bAdminRoutes.patch(
  '/organizations/:id',
  validate(adminUpdateB2BOrganizationSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const organization = await adminUpdateB2BOrganization(
      req.user.id,
      requireUuid(req.params['id'], 'id организации'),
      req.body,
    );
    res.json({ success: true, data: organization });
  },
);

b2bAdminRoutes.get('/bank-transactions', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = await adminListBankTransactions(parseListQuery(req.query));
  res.json({ success: true, data: result.rows, total: result.total });
});

b2bAdminRoutes.get('/reconciliation-tasks', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = await adminListReconciliationTasks(parseListQuery(req.query));
  res.json({ success: true, data: result.rows, total: result.total });
});

b2bAdminRoutes.post(
  '/reconciliation-tasks/:id/resolve',
  validate(resolveB2BReconciliationTaskSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const task = await adminResolveReconciliationTask(
      req.user.id,
      requireUuid(req.params['id'], 'id задачи'),
      req.body,
    );
    res.json({ success: true, data: task });
  },
);

b2bAdminRoutes.get('/verification-tasks', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = await adminListVerificationTasks(parseListQuery(req.query));
  res.json({ success: true, data: result.rows, total: result.total });
});

b2bAdminRoutes.post(
  '/verification-tasks/:id/resolve',
  validate(resolveB2BVerificationTaskSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const task = await adminResolveVerificationTask(
      req.user.id,
      requireUuid(req.params['id'], 'id заявки'),
      req.body,
    );
    res.json({ success: true, data: task });
  },
);

b2bAdminRoutes.post('/documents/:id/regenerate', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const document = await adminRegenerateDocument(req.user.id, requireUuid(req.params['id'], 'id пакета документов'));
  res.json({ success: true, data: document });
});

b2bAdminRoutes.post('/documents/:id/send-edo', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const document = await adminSendDocumentToEdo(req.user.id, requireUuid(req.params['id'], 'id пакета документов'));
  res.json({ success: true, data: document });
});

export default router;
