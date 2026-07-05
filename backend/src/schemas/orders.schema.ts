import { z } from 'zod';

// ── Shared ──────────────────────────────────────────────────────────

const phoneSchema = z.string().transform((v) => v.replace(/\D/g, '')).pipe(
  z.string().min(10, 'Телефон должен содержать минимум 10 цифр'),
);

// ── POST / (create photo print order from MiniApp/website) ──────────

const photoPrintItemSchema = z.object({
  uploadedUrl: z.string().min(1).optional(),
  photoUrl: z.string().optional(),
  format: z.string().min(1, 'format is required'),
  paperType: z.string().min(1, 'paperType is required'),
  quantity: z.coerce.number().int().min(1, 'quantity must be >= 1'),
  margins: z.enum(['none', '3mm']).optional(),
  border: z.string().max(50).optional(),
});

const contactSchema = z.object({
  name: z.string().min(2, 'Имя — минимум 2 символа'),
  phone: z.string().min(1, 'Телефон обязателен'),
  email: z.string().email().optional(),
  comments: z.string().optional(),
});

/**
 * Курьерская доставка (Яндекс.Доставка). Опциональный блок при создании заказа печати.
 * Цена/зона НЕ принимаются от клиента — сервер пере-резолвит их по координатам адреса
 * (P0-2/P1-4). `coordinates` — только хинт для UX, авторитет — серверный DaData по `address`.
 */
const orderDeliverySchema = z.object({
  method: z.literal('courier'),
  address: z.string().min(5, 'Укажите адрес доставки'),
  // Хинт от клиента [lon, lat]; сервер всё равно валидирует адрес заново (не доверяем).
  coordinates: z.tuple([z.coerce.number(), z.coerce.number()]).optional(),
});

export const createPhotoPrintOrderSchema = z.object({
  mode: z.enum(['simple', 'custom']),
  items: z.array(photoPrintItemSchema).min(1, 'Необходимо загрузить хотя бы одну фотографию'),
  contact: contactSchema,
  pickupLocationId: z.string().min(1).max(80).optional(),
  deadline: z.enum(['standard', 'urgent']).optional(),
  options: z.object({
    autoEnhance: z.boolean().optional(),
    removeRedEyes: z.boolean().optional(),
  }).optional(),
  totalPrice: z.coerce.number().min(0),
  source: z.enum(['miniapp', 'website', 'bot']).optional(),
  delivery: orderDeliverySchema.optional(),
});

export type CreatePhotoPrintOrderInput = z.infer<typeof createPhotoPrintOrderSchema>;

// ── POST /import-bot-photos ─────────────────────────────────────────

export const importBotPhotosSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1, 'fileIds array required').max(30, 'Max 30 files at once'),
});

export type ImportBotPhotosInput = z.infer<typeof importBotPhotosSchema>;

// ── POST /import-bot-photo ──────────────────────────────────────────

export const importBotPhotoSchema = z.object({
  fileId: z.string().min(1, 'fileId required'),
});

export type ImportBotPhotoInput = z.infer<typeof importBotPhotoSchema>;

// ── POST /walk-in ───────────────────────────────────────────────────

const walkInItemSchema = z.object({
  name: z.string().min(1, 'Item name is required'),
  slug: z.string().optional(),
  uploadedUrl: z.string().optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  sla_quantity: z.coerce.number().int().min(1).optional(),
  price: z.coerce.number().min(0),
  options: z.array(z.string()).optional(),
  service_option_id: z.string().uuid().optional(),
});

export const createWalkInOrderSchema = z.object({
  items: z.array(walkInItemSchema).min(1, 'Добавьте хотя бы одну услугу в заказ'),
  client_name: z.string().min(2, 'Имя клиента должно содержать минимум 2 символа').optional(),
  client_phone: z.string().optional().refine(
    (v) => !v || v.replace(/\D/g, '').length === 0 || v.replace(/\D/g, '').length >= 10,
    'Укажите корректный номер телефона',
  ),
  client_email: z.string().email('Некорректный email').optional().or(z.literal('')),
  total_price: z.coerce.number().min(0, 'Укажите корректную сумму заказа'),
  payment_method: z.enum(['cash', 'card', 'sbp', 'transfer']).optional(),
  comment: z.string().optional(),
  studio_id: z.string().optional(),
  // Wizard fields
  document_template_id: z.string().uuid().optional(),
  photo_size: z.string().max(20).optional(),
  medals_required: z.boolean().optional(),
  medals_description: z.string().optional(),
  uniform_description: z.string().optional(),
  wishes: z.string().optional(),
});

export type CreateWalkInOrderInput = z.infer<typeof createWalkInOrderSchema>;

// ── POST /crm-create ────────────────────────────────────────────────

const crmItemSchema = z.object({
  name: z.string().min(1, 'Название позиции обязательно'),
  slug: z.string().optional(),
  quantity: z.coerce.number().int().positive().default(1),
  sla_quantity: z.coerce.number().int().positive().optional(),
  price: z.coerce.number().nonnegative(),
  options: z.record(z.unknown()).optional(),
  service_option_id: z.string().uuid().optional(),
  disabled_features: z.array(z.string()).optional().default([]),
});

const crmSlaItemSchema = z.object({
  service_option_id: z.string().uuid(),
  quantity: z.coerce.number().int().positive().optional(),
  sla_quantity: z.coerce.number().int().positive().optional(),
});

export const crmCreateOrderSchema = z.object({
  items: z.array(crmItemSchema).min(1, 'Добавьте хотя бы одну позицию'),
  sla_items: z.array(crmSlaItemSchema).optional().default([]),
  total_price: z.coerce.number().nonnegative(),
  description: z.string().optional(),
  client_name: z.string().optional(),
  client_phone: z.string().optional().refine(
    (v) => !v || v.replace(/\D/g, '').length === 0 || v.replace(/\D/g, '').length >= 10,
    'Укажите корректный номер телефона',
  ),
  client_email: z.string().email('Некорректный email').optional().or(z.literal('')),
  contact_id: z.string().uuid().optional(),
  chat_session_id: z.string().uuid().nullable().optional(),
  assigned_employee_id: z.string().uuid().optional(),
  studio_id: z.string().uuid().optional(),
  deadline_at: z.string().datetime().optional(),
  priority: z.enum(['normal', 'urgent', 'vip']).default('normal'),
  comment: z.string().optional(),
  source: z.enum(['crm', 'chat', 'phone', 'walk_in']).default('crm'),
  payment_method: z.enum(['cash', 'card', 'sbp', 'online', 'later', 'transfer']).optional(),
  promo_code: z.string().max(50).optional(),
  // Конфигуратор «Супер обработки» — выбор галочек ретуши (бесплатные, инструкции ретушёру).
  // Структура источник-агностична: backend ресолвит её через resolveRetouchConfig (анти-tamper).
  retouch_config: z.object({
    gender: z.enum(['male', 'female', 'any']).optional(),
    // Лимиты против DoS: slug/массив ограничены; число групп с верхним пределом
    // (в каталоге 15 групп — запас 50). Неизвестное всё равно отбросит resolveRetouchConfig.
    groups: z.record(z.string().max(64), z.array(z.string().max(64)).max(50))
      .refine((g) => Object.keys(g).length <= 50, 'Слишком много групп ретуши'),
    notes: z.string().max(2000).optional(),
  }).optional(),
  // Wizard fields
  document_template_id: z.string().uuid().optional(),
  photo_size: z.string().max(20).optional(),
  medals_required: z.boolean().optional(),
  medals_description: z.string().optional(),
  uniform_description: z.string().optional(),
  wishes: z.string().optional(),
});

export type CrmCreateOrderInput = z.infer<typeof crmCreateOrderSchema>;

// ── PUT /:orderId/edit ──────────────────────────────────────────────

export const editOrderSchema = z.object({
  contact_name: z.string().min(1).optional(),
  contact_phone: z.string().optional(),
  contact_email: z.string().email().optional().or(z.literal('')),
  delivery_address: z.string().optional(),
  comments: z.string().optional(),
  tracking_number: z.string().optional(),
  priority: z.enum(['normal', 'urgent', 'vip']).optional(),
  chat_session_id: z.union([z.string().uuid(), z.literal(''), z.null()]).optional(),
  deadline_at: z.string().datetime().optional().or(z.literal('')),
  description: z.string().optional(),
  source: z.enum(['online', 'crm', 'chat', 'phone', 'walk_in', 'pos']).optional(),
  wishes: z.string().optional(),
  medals_required: z.boolean().optional(),
  medals_description: z.string().optional(),
  uniform_description: z.string().optional(),
  document_template_id: z.string().uuid().nullable().optional(),
  photo_size: z.string().max(20).optional(),
});

export type EditOrderInput = z.infer<typeof editOrderSchema>;

// ── PUT /:orderId/assign ────────────────────────────────────────────

export const assignOrderSchema = z.object({
  employee_id: z.string().nullable(),
});

export type AssignOrderInput = z.infer<typeof assignOrderSchema>;

// ── PUT /:orderId/status ────────────────────────────────────────────

export const updateOrderStatusSchema = z.object({
  status: z.enum(['new', 'pending_payment', 'processing', 'ready', 'completed', 'cancelled']),
  override_location: z.boolean().optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

// ── POST /:orderId/workflow-action ─────────────────────────────────

export const workflowActionSchema = z.object({
  action: z.enum(['print', 'download']),
});

export type WorkflowActionInput = z.infer<typeof workflowActionSchema>;

// ── PUT /:orderId/record-payment ────────────────────────────────────

export const recordPaymentSchema = z.object({
  payment_method: z.enum(['cash', 'card', 'sbp', 'subscription', 'transfer']),
  transaction_id: z.string().optional(),
  card_info: z.string().optional(),
  pos_receipt_id: z.string().uuid().optional(),
  subscription_id: z.string().uuid().optional(),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const payWithSubscriptionSchema = z.object({
  subscription_id: z.string().uuid(),
});

export type PayWithSubscriptionInput = z.infer<typeof payWithSubscriptionSchema>;

// ── POST /:orderId/remind ──────────────────────────────────────────

export const remindPaymentSchema = z.object({}).strict();

export type RemindPaymentInput = z.infer<typeof remindPaymentSchema>;

// ── POST /:orderId/mark-paid ───────────────────────────────────────

export const markPaidSchema = z.object({
  method: z.enum(['cash', 'transfer', 'other']),
  note: z.string().max(500).optional(),
});

export type MarkPaidInput = z.infer<typeof markPaidSchema>;

// ── POST /:orderId/cancel-payment ──────────────────────────────────

export const cancelPaymentSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type CancelPaymentInput = z.infer<typeof cancelPaymentSchema>;

// ── POST / (mobile app — create order) ────────────────────────────

const mobileOrderItemSchema = z.object({
  name: z.string().optional(),
  service: z.string().optional(),
  quantity: z.coerce.number().int().min(1).optional().default(1),
  price: z.coerce.number().optional(),
}).passthrough();

const mobileContactSchema = z.object({
  name: z.string().min(1, 'Contact name is required'),
  phone: z.string().min(1, 'Contact phone is required'),
  email: z.string().email().optional(),
});

export const createMobileOrderSchema = z.object({
  items: z.array(mobileOrderItemSchema).min(1, 'Items are required'),
  contact: mobileContactSchema,
  totalAmount: z.coerce.number().positive('Total amount must be positive'),
  deliveryMethod: z.string().optional(),
  deliveryAddress: z.string().optional(),
  comment: z.string().optional(),
  promoCode: z.string().optional(),
  fingerprintVisitorId: z.string().optional(),
  partnerPromoCode: z.string().optional(),
  categorySlug: z.string().optional(),
  selectedOptions: z.record(z.array(z.string())).optional(),
});

export type CreateMobileOrderInput = z.infer<typeof createMobileOrderSchema>;

// ── POST /:id/comments ────────────────────────────────────────────

export const addOrderCommentSchema = z.object({
  comment: z.string().min(1, 'Comment is required'),
});

export type AddOrderCommentInput = z.infer<typeof addOrderCommentSchema>;

// ── PATCH /:orderId/items/:itemId ─────────────────────────────────

export const patchOrderItemSchema = z.object({
  disabled_features: z.array(z.string()).optional(),
});

export type PatchOrderItemInput = z.infer<typeof patchOrderItemSchema>;
