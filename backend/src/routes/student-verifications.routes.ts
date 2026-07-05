import { Router, type Request, type Response } from 'express';
import { authenticateToken, requirePermission, requireUser, type AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import {
  createPresignedUploadRoutes,
  type VerifiedFile,
} from './shared/presigned-upload.factory.js';
import {
  approveStudentVerification,
  confirmInPersonStudentVerification,
  getPendingInPersonStudentVerification,
  getMyStudentVerificationStatus,
  listStudentVerifications,
  lookupInPersonStudentClientByPhone,
  prepareInPersonStudentVerification,
  rejectStudentVerification,
  revokeStudentAccount,
  STUDENT_VERIFICATION_IMAGE_MIMES,
  submitStudentVerification,
  withdrawStudentProgramConsent,
} from '../services/student-verification.service.js';
import {
  approveStudentVerificationSchema,
  confirmInPersonStudentVerificationSchema,
  completeStudentVerificationUploadSchema,
  listStudentVerificationsQuerySchema,
  prepareInPersonStudentVerificationSchema,
  rejectStudentVerificationSchema,
  revokeStudentAccountSchema,
  withdrawStudentProgramConsentSchema,
} from '../schemas/student-verifications.schema.js';

const router = Router();

router.use(authenticateToken);

const uploadRouter = createPresignedUploadRoutes({
  prefix: 'student-verifications',
  allowedMimes: STUDENT_VERIFICATION_IMAGE_MIMES,
  maxFileSize: 12 * 1024 * 1024,
  maxFiles: 1,
  auth: [],
  rateLimiter: createUploadLimiter('ul-student-ver:', 10, 15 * 60 * 1000),
  onComplete: async (files: VerifiedFile[], req: Request, res: Response) => {
    const authReq: AuthRequest = req;
    requireUser(authReq);
    const file = files[0];
    if (!file) {
      throw new AppError(400, 'Фото документа обязательно', ErrorCode.VALIDATION_ERROR);
    }

    const parsed = completeStudentVerificationUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues.map(issue => issue.message).join('; '), ErrorCode.VALIDATION_ERROR);
    }

    const status = await submitStudentVerification({
      userId: authReq.user.id,
      institutionName: parsed.data.institutionName,
      educationRole: parsed.data.educationRole,
      documentExpiresAt: parsed.data.documentExpiresAt,
      file,
    });
    res.json({ success: true, data: status });
  },
});

router.use('/uploads', uploadRouter);

router.get('/me', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const status = await getMyStudentVerificationStatus(req.user.id);
  res.json({ success: true, data: status });
});

router.get('/admin', requirePermission('students:verify'), async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const parsed = listStudentVerificationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues.map(issue => issue.message).join('; '), ErrorCode.VALIDATION_ERROR);
  }
  const items = await listStudentVerifications(parsed.data);
  res.json({ success: true, data: { items } });
});

router.get(
  '/admin/in-person/lookup',
  requirePermission('students:verify'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const phone = typeof req.query['phone'] === 'string' ? req.query['phone'] : '';
    const matchedUser = await lookupInPersonStudentClientByPhone(phone);
    res.json({ success: true, data: { matched_user: matchedUser } });
  },
);

router.post(
  '/admin/in-person/prepare',
  requirePermission('students:verify'),
  validate(prepareInPersonStudentVerificationSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const payload = await prepareInPersonStudentVerification({
      phone: req.body.phone,
      employeeId: req.user.id,
      institutionName: req.body.institution_name,
      educationRole: req.body.education_role,
      documentType: req.body.document_type,
      documentExpiresAt: req.body.document_expires_at,
      referralChannel: req.body.referral_channel,
      referrerPhone: req.body.referrer_phone ?? null,
      referrerCode: req.body.referrer_code ?? null,
      conversationId: req.body.conversation_id ?? null,
      requestIp: req.ip ?? null,
      requestUserAgent: req.get('user-agent') ?? null,
    });
    res.json({ success: true, data: payload });
  },
);

router.post(
  '/admin/:id/approve',
  requirePermission('students:verify'),
  validate(approveStudentVerificationSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const verificationId = req.params['id'];
    if (!verificationId) throw new AppError(400, 'verification id required', ErrorCode.VALIDATION_ERROR);
    const status = await approveStudentVerification({
      verificationId,
      reviewerId: req.user.id,
      expiresAt: req.body.expires_at,
      reviewNotes: req.body.review_notes ?? null,
    });
    res.json({ success: true, data: status });
  },
);

router.post(
  '/admin/:id/reject',
  requirePermission('students:verify'),
  validate(rejectStudentVerificationSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const verificationId = req.params['id'];
    if (!verificationId) throw new AppError(400, 'verification id required', ErrorCode.VALIDATION_ERROR);
    const status = await rejectStudentVerification({
      verificationId,
      reviewerId: req.user.id,
      reason: req.body.reason,
      reviewNotes: req.body.review_notes ?? null,
    });
    res.json({ success: true, data: status });
  },
);

router.post(
  '/admin/accounts/:accountId/revoke',
  requirePermission('students:verify'),
  validate(revokeStudentAccountSchema.omit({ account_id: true })),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const accountId = req.params['accountId'];
    if (!accountId) throw new AppError(400, 'account id required', ErrorCode.VALIDATION_ERROR);
    const status = await revokeStudentAccount({
      accountId,
      reviewerId: req.user.id,
      reason: req.body.reason,
    });
    res.json({ success: true, data: status });
  },
);

router.get('/in-person/pending', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const verification = await getPendingInPersonStudentVerification(req.user.id);
  res.json({ success: true, data: { verification } });
});

router.post(
  '/in-person/withdraw',
  validate(withdrawStudentProgramConsentSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const status = await withdrawStudentProgramConsent({
      userId: req.user.id,
      reason: req.body.reason ?? null,
    });
    res.json({ success: true, data: status });
  },
);

router.post(
  '/in-person/:id/confirm',
  validate(confirmInPersonStudentVerificationSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const verificationId = req.params['id'];
    if (!verificationId) throw new AppError(400, 'verification id required', ErrorCode.VALIDATION_ERROR);
    const status = await confirmInPersonStudentVerification({
      verificationId,
      userId: req.user.id,
      consentVersion: req.body.consent_version,
      marketingConsent: req.body.marketing_consent,
      requestIp: req.ip ?? null,
      requestUserAgent: req.get('user-agent') ?? null,
    });
    res.json({ success: true, data: status });
  },
);

export default router;
