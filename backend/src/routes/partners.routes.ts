/**
 * Partners Routes — ФотоПульт CRM Wave 6
 */

import { Router, Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  getPartners,
  getPartnerById,
  createPartner,
  updatePartner,
  setPartnerStatus,
  getPartnerReferrals,
  getPartnerPayouts,
  createPayout,
  processPayoutStatus,
  getCommissionRules,
  getCommissionRuleById,
  createCommissionRule,
  updateCommissionRule,
  deleteCommissionRule,
  getApplicableCommissionRule,
} from '../services/partners.service.js';
import { validateInn, checkSelfEmployedStatus } from '../services/fns-verification.service.js';

const router = Router();
router.use(authenticateToken, requirePermission('partners:manage'));

const VALID_TYPES = ['referral', 'business', 'affiliate', 'promoter', 'agent', 'online'] as const;
const VALID_STATUSES = ['approved', 'suspended', 'rejected'] as const;

// ── GET /api/partners ─────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { status, type, search, limit, offset } = req.query;

  const { rows, total } = await getPartners({
    status: status ? String(status) : undefined,
    type: type ? String(type) : undefined,
    search: search ? String(search) : undefined,
    limit: limit ? parseInt(String(limit), 10) : 50,
    offset: offset ? parseInt(String(offset), 10) : 0,
  });

  res.json({ success: true, data: rows, total });
});

// ── POST /api/partners ────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, email, phone, type, commission_rate, promo_code, referral_url, payout_details, notes, user_id } = req.body;

  if (!name?.trim()) throw new AppError(400, 'name обязателен');
  if (!type || !VALID_TYPES.includes(type)) {
    throw new AppError(400, `type должен быть: ${VALID_TYPES.join(', ')}`);
  }
  if (commission_rate !== undefined && (commission_rate < 0 || commission_rate > 100)) {
    throw new AppError(400, 'commission_rate должен быть от 0 до 100');
  }

  const partner = await createPartner({
    name: name.trim(),
    email: email?.trim() || null,
    phone: phone?.trim() || null,
    type,
    commission_rate: commission_rate ?? 15,
    promo_code: promo_code?.trim() || null,
    referral_url: referral_url?.trim() || null,
    payout_details: payout_details || {},
    notes: notes?.trim() || null,
    user_id: user_id ? parseInt(String(user_id), 10) : null,
  });

  res.status(201).json({ success: true, data: partner });
});

// ── GET /api/partners/:id ─────────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const partner = await getPartnerById(id);
  if (!partner) throw new AppError(404, 'Партнёр не найден');

  res.json({ success: true, data: partner });
});

// ── PATCH /api/partners/:id ───────────────────────────────────

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const { name, email, phone, commission_rate, promo_code, referral_url, payout_details, notes } = req.body;

  if (commission_rate !== undefined && (commission_rate < 0 || commission_rate > 100)) {
    throw new AppError(400, 'commission_rate должен быть от 0 до 100');
  }

  const partner = await updatePartner(id, {
    ...(name !== undefined && { name: String(name).trim() }),
    ...(email !== undefined && { email: email?.trim() || null }),
    ...(phone !== undefined && { phone: phone?.trim() || null }),
    ...(commission_rate !== undefined && { commission_rate: Number(commission_rate) }),
    ...(promo_code !== undefined && { promo_code: promo_code?.trim() || null }),
    ...(referral_url !== undefined && { referral_url: referral_url?.trim() || null }),
    ...(payout_details !== undefined && { payout_details }),
    ...(notes !== undefined && { notes: notes?.trim() || null }),
  });

  if (!partner) throw new AppError(404, 'Партнёр не найден');
  res.json({ success: true, data: partner });
});

// ── POST /api/partners/:id/approve ────────────────────────────

router.post('/:id/approve', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const { status } = req.body;
  if (!status || !VALID_STATUSES.includes(status)) {
    throw new AppError(400, `status должен быть: ${VALID_STATUSES.join(', ')}`);
  }

  const partner = await setPartnerStatus(id, status, String(req.user.id));
  if (!partner) throw new AppError(404, 'Партнёр не найден');

  res.json({ success: true, data: partner });
});

// ── POST /api/partners/:id/verify-self-employed — ручная верификация самозанятости
router.post('/:id/verify-self-employed', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const partner = await getPartnerById(id);
  if (!partner) throw new AppError(404, 'Партнёр не найден');

  const { action, inn, reason } = req.body;
  if (!action || !['approve', 'reject', 'check_fns'].includes(action)) {
    throw new AppError(400, 'action должен быть: approve, reject, check_fns');
  }

  if (action === 'check_fns') {
    const innToCheck = inn || partner.inn;
    if (!innToCheck || !validateInn(innToCheck)) {
      throw new AppError(400, 'Некорректный или отсутствующий ИНН');
    }
    const fnsResult = await checkSelfEmployedStatus(innToCheck);
    await updatePartner(id, {
      inn: innToCheck,
      self_employed_status: fnsResult.is_self_employed ? 'verified' : 'rejected',
      self_employed_checked_by: 'fns_api',
      self_employed_verified_at: fnsResult.checked_at,
    });
    const updated = await getPartnerById(id);
    res.json({ success: true, data: updated, fns_message: fnsResult.raw_message });
    return;
  }

  await updatePartner(id, {
    self_employed_status: action === 'approve' ? 'verified' : 'rejected',
    self_employed_checked_by: 'admin_manual',
    self_employed_verified_at: new Date().toISOString(),
  });

  const updated = await getPartnerById(id);
  res.json({ success: true, data: updated });
});

// ── GET /api/partners/:id/referrals ──────────────────────────

router.get('/:id/referrals', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const limit = Math.min(parseInt(String(req.query['limit'] || '50'), 10), 200);
  const offset = parseInt(String(req.query['offset'] || '0'), 10);

  const { rows, total, total_commission } = await getPartnerReferrals(id, limit, offset);
  res.json({ success: true, data: rows, total, total_commission });
});

// ── GET /api/partners/:id/payouts ─────────────────────────────

router.get('/:id/payouts', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const payouts = await getPartnerPayouts(id);
  res.json({ success: true, data: payouts });
});

// ── POST /api/partners/:id/payouts ────────────────────────────

router.post('/:id/payouts', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const { amount, method } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    throw new AppError(400, 'amount должен быть положительным числом');
  }
  if (!method || !['card', 'phone', 'bank_transfer'].includes(method)) {
    throw new AppError(400, 'method должен быть: card, phone, bank_transfer');
  }

  const result = await createPayout(id, Number(amount), method);
  res.status(201).json({ success: true, data: result });
});

// ── PATCH /api/partners/payouts/:pid ─────────────────────────

router.patch('/payouts/:pid', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const pid = parseInt(req.params['pid'], 10);
  if (isNaN(pid)) throw new AppError(400, 'Некорректный id выплаты');

  const { status } = req.body;
  if (!status || !['completed', 'failed', 'cancelled'].includes(status)) {
    throw new AppError(400, 'status должен быть: completed, failed, cancelled');
  }

  await processPayoutStatus(pid, status, String(req.user.id));
  res.json({ success: true });
});

// ── GET /api/partners/:id/commission-rules ────────────────────

router.get('/:id/commission-rules', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const rules = await getCommissionRules(id);
  res.json({ success: true, data: rules });
});

// ── POST /api/partners/:id/commission-rules ───────────────────

const VALID_ORDER_TYPES = ['pos', 'print', 'booking', 'order'] as const;

router.post('/:id/commission-rules', async (req: AuthRequest, res: Response): Promise<void> => {
  const partnerId = parseInt(req.params['id'], 10);
  if (isNaN(partnerId)) throw new AppError(400, 'Некорректный id');

  const partner = await getPartnerById(partnerId);
  if (!partner) throw new AppError(404, 'Партнёр не найден');

  const { service_category_slug, order_type, commission_percent, commission_fixed, min_order_amount, priority } = req.body;

  if (commission_percent == null && commission_fixed == null) {
    throw new AppError(400, 'Нужно указать commission_percent или commission_fixed');
  }
  if (commission_percent != null && (commission_percent < 0 || commission_percent > 100)) {
    throw new AppError(400, 'commission_percent должен быть от 0 до 100');
  }
  if (commission_fixed != null && commission_fixed < 0) {
    throw new AppError(400, 'commission_fixed не может быть отрицательным');
  }
  if (order_type && !VALID_ORDER_TYPES.includes(order_type)) {
    throw new AppError(400, `order_type должен быть: ${VALID_ORDER_TYPES.join(', ')}`);
  }

  const rule = await createCommissionRule({
    partner_id: partnerId,
    service_category_slug: service_category_slug || null,
    order_type: order_type || null,
    commission_percent: commission_percent ?? null,
    commission_fixed: commission_fixed ?? null,
    min_order_amount: min_order_amount ?? 0,
    priority: priority ?? 0,
  });

  res.status(201).json({ success: true, data: rule });
});

// ── PATCH /api/partners/:id/commission-rules/:ruleId ──────────

router.patch('/:id/commission-rules/:ruleId', async (req: AuthRequest, res: Response): Promise<void> => {
  const partnerId = parseInt(req.params['id'], 10);
  const ruleId = parseInt(req.params['ruleId'], 10);
  if (isNaN(partnerId) || isNaN(ruleId)) throw new AppError(400, 'Некорректный id');

  const existing = await getCommissionRuleById(ruleId);
  if (!existing || existing.partner_id !== partnerId) {
    throw new AppError(404, 'Правило не найдено');
  }

  const { service_category_slug, order_type, commission_percent, commission_fixed, min_order_amount, is_active, priority } = req.body;

  if (commission_percent != null && (commission_percent < 0 || commission_percent > 100)) {
    throw new AppError(400, 'commission_percent должен быть от 0 до 100');
  }
  if (commission_fixed != null && commission_fixed < 0) {
    throw new AppError(400, 'commission_fixed не может быть отрицательным');
  }
  if (order_type !== undefined && order_type !== null && !VALID_ORDER_TYPES.includes(order_type)) {
    throw new AppError(400, `order_type должен быть: ${VALID_ORDER_TYPES.join(', ')}`);
  }

  const rule = await updateCommissionRule(ruleId, {
    ...(service_category_slug !== undefined && { service_category_slug }),
    ...(order_type !== undefined && { order_type }),
    ...(commission_percent !== undefined && { commission_percent }),
    ...(commission_fixed !== undefined && { commission_fixed }),
    ...(min_order_amount !== undefined && { min_order_amount }),
    ...(is_active !== undefined && { is_active }),
    ...(priority !== undefined && { priority }),
  });

  res.json({ success: true, data: rule });
});

// ── DELETE /api/partners/:id/commission-rules/:ruleId ─────────

router.delete('/:id/commission-rules/:ruleId', async (req: AuthRequest, res: Response): Promise<void> => {
  const partnerId = parseInt(req.params['id'], 10);
  const ruleId = parseInt(req.params['ruleId'], 10);
  if (isNaN(partnerId) || isNaN(ruleId)) throw new AppError(400, 'Некорректный id');

  const existing = await getCommissionRuleById(ruleId);
  if (!existing || existing.partner_id !== partnerId) {
    throw new AppError(404, 'Правило не найдено');
  }

  await deleteCommissionRule(ruleId);
  res.json({ success: true });
});

// ── GET /api/partners/:id/commission-estimate ─────────────────

router.get('/:id/commission-estimate', async (req: AuthRequest, res: Response): Promise<void> => {
  const partnerId = parseInt(req.params['id'], 10);
  if (isNaN(partnerId)) throw new AppError(400, 'Некорректный id');

  const category = (req.query['category'] as string) || null;
  const orderType = (req.query['order_type'] as string) || null;
  const amount = parseFloat(req.query['amount'] as string);

  if (isNaN(amount) || amount <= 0) {
    throw new AppError(400, 'amount обязателен и должен быть > 0');
  }

  const rule = await getApplicableCommissionRule(partnerId, category, orderType);

  // Check min_order_amount
  if (amount < rule.min_order_amount) {
    res.json({
      success: true,
      data: {
        applicable: false,
        reason: `Сумма заказа ${amount}₽ меньше минимальной ${rule.min_order_amount}₽`,
        source: rule.source,
        rule_id: rule.rule_id,
      },
    });
    return;
  }

  let commission: number;
  if (rule.commission_fixed != null && rule.commission_fixed > 0) {
    commission = rule.commission_fixed;
  } else {
    commission = (amount * (rule.commission_percent ?? 15)) / 100;
  }

  res.json({
    success: true,
    data: {
      applicable: true,
      source: rule.source,
      rule_id: rule.rule_id,
      commission_percent: rule.commission_percent,
      commission_fixed: rule.commission_fixed,
      min_order_amount: rule.min_order_amount,
      order_amount: amount,
      estimated_commission: Math.round(commission * 100) / 100,
    },
  });
});

export default router;
