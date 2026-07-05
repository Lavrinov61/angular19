import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const uuid = z.string().uuid();
const educationRole = z.enum(['student', 'applicant', 'teacher', 'lecturer', 'staff']);
const documentType = z.enum([
  'student_card',
  'grade_book',
  'study_certificate',
  'teacher_id',
  'admission_document',
  'other',
]);
const referralChannel = z.enum([
  'classmate',
  'friend',
  'social',
  'repeat_customer',
  'walk_in',
  'employee_told',
  'other',
]);

export const completeStudentVerificationUploadSchema = z.object({
  institution_name: z.string().trim().min(2).max(200).optional(),
  institutionName: z.string().trim().min(2).max(200).optional(),
  education_role: educationRole.optional(),
  educationRole: educationRole.optional(),
  document_expires_at: dateOnly.nullable().optional(),
  documentExpiresAt: dateOnly.nullable().optional(),
}).passthrough().transform((body, ctx) => {
  const institutionName = body.institution_name ?? body.institutionName;
  if (!institutionName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'institution_name is required',
      path: ['institution_name'],
    });
    return z.NEVER;
  }
  return {
    institutionName,
    educationRole: body.education_role ?? body.educationRole ?? 'student',
    documentExpiresAt: body.document_expires_at ?? body.documentExpiresAt ?? null,
  };
});

export type CompleteStudentVerificationUploadInput = z.infer<typeof completeStudentVerificationUploadSchema>;

export const listStudentVerificationsQuerySchema = z.object({
  status: z.enum(['pending', 'pending_in_person', 'approved', 'rejected', 'cancelled', 'all']).optional().default('pending'),
  limit: z.coerce.number().int().min(1).max(250).optional().default(50),
});

export type ListStudentVerificationsQuery = z.infer<typeof listStudentVerificationsQuerySchema>;

export const approveStudentVerificationSchema = z.object({
  expires_at: dateOnly,
  review_notes: z.string().trim().max(1000).nullable().optional(),
});

export type ApproveStudentVerificationInput = z.infer<typeof approveStudentVerificationSchema>;

export const rejectStudentVerificationSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
  review_notes: z.string().trim().max(1000).nullable().optional(),
});

export type RejectStudentVerificationInput = z.infer<typeof rejectStudentVerificationSchema>;

export const revokeStudentAccountSchema = z.object({
  account_id: uuid.optional(),
  reason: z.string().trim().min(3).max(1000),
});

export type RevokeStudentAccountInput = z.infer<typeof revokeStudentAccountSchema>;

export const prepareInPersonStudentVerificationSchema = z.object({
  phone: z.string().trim().min(10).max(32),
  institution_name: z.string().trim().min(2).max(200),
  education_role: educationRole.optional().default('student'),
  document_type: documentType,
  document_expires_at: dateOnly,
  referral_channel: referralChannel.optional().default('walk_in'),
  referrer_code: z.string().trim().max(80).nullable().optional(),
  referrer_phone: z.string().trim().max(32).nullable().optional(),
  conversation_id: uuid.nullable().optional(),
});

export type PrepareInPersonStudentVerificationInput = z.infer<typeof prepareInPersonStudentVerificationSchema>;

export const confirmInPersonStudentVerificationSchema = z.object({
  consent_version: z.string().trim().min(3).max(80),
  marketing_consent: z.boolean().optional().default(false),
});

export type ConfirmInPersonStudentVerificationInput = z.infer<typeof confirmInPersonStudentVerificationSchema>;

export const withdrawStudentProgramConsentSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});

export type WithdrawStudentProgramConsentInput = z.infer<typeof withdrawStudentProgramConsentSchema>;
