import { z } from 'zod';

const uuid = z.string().uuid();
const inn = z.string().trim().regex(/^(\d{10}|\d{12})$/, 'ИНН должен содержать 10 или 12 цифр');
const kpp = z.string().trim().regex(/^\d{9}$/, 'КПП должен содержать 9 цифр');
const ogrn = z.string().trim().regex(/^(\d{13}|\d{15})$/, 'ОГРН/ОГРНИП должен содержать 13 или 15 цифр');
const money = z.coerce.number().finite().min(0);
const optionalText = z.string().trim().min(1).optional();
const nullableText = z.string().trim().min(1).nullable().optional();

export const b2bListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
});

export type B2BListQueryInput = z.infer<typeof b2bListQuerySchema>;

export const createB2BOrganizationSchema = z.object({
  inn,
  kpp: kpp.nullable().optional(),
  ogrn: ogrn.nullable().optional(),
  legal_name: z.string().trim().min(2, 'legal_name обязателен'),
  short_name: nullableText,
  legal_address: nullableText,
  postal_address: nullableText,
  accountant_email: z.string().trim().email().nullable().optional(),
  accountant_phone: nullableText,
  edo_provider: nullableText,
  edo_operator_id: nullableText,
  tax_system: nullableText,
  vat_rate: money.max(100).optional().default(0),
  payment_mode: z.enum(['prepaid', 'postpaid', 'mixed']).optional().default('prepaid'),
  credit_limit: money.optional().default(0),
  metadata: z.record(z.unknown()).optional().default({}),
});

export type CreateB2BOrganizationInput = z.infer<typeof createB2BOrganizationSchema>;

export const updateB2BOrganizationSchema = createB2BOrganizationSchema
  .omit({
    inn: true,
    kpp: true,
    ogrn: true,
    payment_mode: true,
    credit_limit: true,
  })
  .partial()
  .refine(value => Object.keys(value).length > 0, 'Нет полей для обновления');

export type UpdateB2BOrganizationInput = z.infer<typeof updateB2BOrganizationSchema>;

export const adminUpdateB2BOrganizationSchema = z.object({
  status: z.enum(['draft', 'active', 'suspended', 'closed']).optional(),
  verification_status: z.enum([
    'unverified',
    'pending',
    'bank_identity_verified',
    'verified',
    'mismatch',
    'manual_review',
    'rejected',
  ]).optional(),
  payment_mode: z.enum(['prepaid', 'postpaid', 'mixed']).optional(),
  billing_status: z.enum(['active', 'blocked', 'closed']).optional(),
  credit_limit: money.optional(),
  block_reason: z.string().trim().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
}).refine(value => Object.keys(value).length > 0, 'Нет полей для обновления');

export type AdminUpdateB2BOrganizationInput = z.infer<typeof adminUpdateB2BOrganizationSchema>;

export const createB2BMemberSchema = z.object({
  user_id: uuid.optional(),
  invited_email: z.string().trim().email().optional(),
  role: z.enum(['accountant', 'manager', 'employee']).optional().default('employee'),
  cost_center_id: uuid.nullable().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
}).refine(value => Boolean(value.user_id || value.invited_email), 'Нужен user_id или invited_email');

export type CreateB2BMemberInput = z.infer<typeof createB2BMemberSchema>;

export const updateB2BMemberSchema = z.object({
  role: z.enum(['owner', 'accountant', 'manager', 'employee']).optional(),
  status: z.enum(['active', 'invited', 'disabled']).optional(),
  cost_center_id: uuid.nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
}).refine(value => Object.keys(value).length > 0, 'Нет полей для обновления');

export type UpdateB2BMemberInput = z.infer<typeof updateB2BMemberSchema>;

const createInvoiceLineSchema = z.object({
  description: z.string().trim().min(1, 'description обязателен'),
  quantity: z.coerce.number().finite().positive().optional().default(1),
  unit_price: money,
  vat_rate: money.max(100).optional().default(0),
  metadata: z.record(z.unknown()).optional().default({}),
});

export const createB2BInvoiceSchema = z.object({
  lines: z.array(createInvoiceLineSchema).min(1, 'Нужна хотя бы одна строка счета'),
  due_at: z.string().datetime().optional(),
  period_start: z.string().date().optional(),
  period_end: z.string().date().optional(),
  payment_purpose: optionalText,
  metadata: z.record(z.unknown()).optional().default({}),
}).refine(
  value => !value.period_start || !value.period_end || value.period_end >= value.period_start,
  'period_end не может быть раньше period_start',
);

export type CreateB2BInvoiceInput = z.infer<typeof createB2BInvoiceSchema>;

export const resolveB2BVerificationTaskSchema = z.object({
  action: z.enum(['approve', 'reject', 'manual_review']),
  reason: z.string().trim().min(1).optional(),
  verification_status: z.enum(['verified', 'mismatch', 'manual_review', 'rejected']).optional(),
});

export type ResolveB2BVerificationTaskInput = z.infer<typeof resolveB2BVerificationTaskSchema>;

export const resolveB2BReconciliationTaskSchema = z.object({
  status: z.enum(['resolved', 'cancelled']).optional().default('resolved'),
  resolution_note: z.string().trim().min(1).optional(),
});

export type ResolveB2BReconciliationTaskInput = z.infer<typeof resolveB2BReconciliationTaskSchema>;
