/**
 * Partner Public Self-Service API
 * Монтируется на /api/partner (singular — отличается от admin /api/partners)
 */
import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import {
  getPartnerByUserId,
  generateUniquePromoCode,
  getPartnerMonthlyStats,
  updatePartner,
  getPartnerReferrals,
  getPartnerPayouts,
  createPayout,
} from '../services/partners.service.js';
import { notifyAdminsNewPartner } from '../services/partner-notify.service.js';
import { validateInn, checkSelfEmployedStatus } from '../services/fns-verification.service.js';

import { createLogger } from '../utils/logger.js';
const router = Router();
router.use(authenticateToken);

const logger = createLogger('partner-public.routes');
// GET /api/partner/me — профиль текущего партнёра
router.get('/me', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const partner = await getPartnerByUserId(req.user.id);
  if (!partner) throw new AppError(404, 'Вы не являетесь партнёром');
  res.json({ success: true, data: partner });
});

// POST /api/partner/register — самостоятельная регистрация
router.post('/register', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const existing = await getPartnerByUserId(req.user.id);
  if (existing) throw new AppError(409, 'Вы уже зарегистрированы как партнёр');

  const { type, inn } = req.body;
  const VALID_TYPES = ['referral', 'business', 'affiliate', 'promoter', 'agent', 'online'] as const;
  if (!type || !VALID_TYPES.includes(type)) {
    throw new AppError(400, `type должен быть: ${VALID_TYPES.join(', ')}`);
  }

  // promoter/agent require INN (self-employed); online = auto-approved like referral
  const requiresInn = type === 'promoter' || type === 'agent' || type === 'business' || type === 'affiliate';
  if (requiresInn && !inn) {
    throw new AppError(400, 'ИНН обязателен для данного типа партнёрства');
  }
  if (inn && !validateInn(inn)) {
    throw new AppError(400, 'Некорректный ИНН (должен содержать 12 цифр с правильной контрольной суммой)');
  }

  const user = await db.queryOne<{
    email: string;
    display_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  }>('SELECT email, display_name, first_name, last_name, phone FROM users WHERE id = $1', [req.user.id]);
  if (!user) throw new AppError(404, 'Пользователь не найден');

  const name = user.display_name ||
    [user.first_name, user.last_name].filter(Boolean).join(' ') ||
    user.email?.split('@')[0] || 'user';

  const promoCode = await generateUniquePromoCode(name);
  const referralUrl = `https://svoefoto.ru/?ref=${promoCode}`;

  // online/referral = auto-approved; promoter/agent/business/affiliate = pending (needs review)
  const autoApproved = type === 'referral' || type === 'online';
  const status = autoApproved ? 'approved' : 'pending';

  // Commission rates by type
  const COMMISSION_BY_TYPE: Record<string, number> = {
    promoter: 10, agent: 15, online: 20,
    referral: 50, business: 50, affiliate: 50,
  };
  const commissionRate = COMMISSION_BY_TYPE[type] ?? 15;
  const hourlyRate = type === 'promoter' ? 150 : null;

  // Check self-employed status via FNS API for business/affiliate
  let selfEmployedStatus: 'not_checked' | 'pending' | 'verified' | 'rejected' = 'not_checked';
  let selfEmployedCheckedBy: string | null = null;
  let selfEmployedVerifiedAt: string | null = null;

  if (requiresInn && inn) {
    try {
      const fnsResult = await checkSelfEmployedStatus(inn);
      selfEmployedCheckedBy = fnsResult.source;
      selfEmployedVerifiedAt = fnsResult.checked_at;
      selfEmployedStatus = fnsResult.is_self_employed ? 'verified' : 'rejected';
    } catch {
      // FNS API unavailable — mark for manual review
      selfEmployedStatus = 'pending';
      logger.warn('[PartnerPublic] FNS API unavailable, partner needs manual verification', {
        userId: req.user.id,
        inn: inn.slice(0, 4) + '****',
      });
    }
  }

  const rows = await db.query(
    `INSERT INTO partners (name, email, phone, type, status, commission_rate, hourly_rate, promo_code, referral_url, payout_details, user_id,
                           inn, self_employed_status, self_employed_checked_by, self_employed_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}', $10, $11, $12, $13, $14)
     RETURNING *`,
    [name, user.email, user.phone, type, status, commissionRate, hourlyRate, promoCode, referralUrl, req.user.id,
     inn || null, selfEmployedStatus, selfEmployedCheckedBy, selfEmployedVerifiedAt],
  );

  const created = rows[0];

  // Fire-and-forget: notify admins about new partner registration
  if (!autoApproved) {
    notifyAdminsNewPartner({
      id: created.id,
      name: created.name,
      type: created.type,
      email: created.email,
      phone: created.phone,
    }).catch(err => logger.error('[PartnerPublic] notifyAdminsNewPartner error', { error: String(err) }));
  }

  res.status(201).json({ success: true, data: created });
});

// POST /api/partner/me/verify-inn — повторная проверка ИНН через ФНС
router.post('/me/verify-inn', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const partner = await getPartnerByUserId(req.user.id);
  if (!partner) throw new AppError(404, 'Вы не являетесь партнёром');

  const { inn } = req.body;
  if (!inn || !validateInn(inn)) {
    throw new AppError(400, 'Некорректный ИНН (должен содержать 12 цифр с правильной контрольной суммой)');
  }

  // Rate limit: 1 check per hour
  if (partner.self_employed_verified_at) {
    const lastCheck = new Date(partner.self_employed_verified_at).getTime();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    if (lastCheck > oneHourAgo) {
      throw new AppError(429, 'Проверку можно выполнять не чаще 1 раза в час');
    }
  }

  try {
    const fnsResult = await checkSelfEmployedStatus(inn);
    await updatePartner(partner.id, {
      inn,
      self_employed_status: fnsResult.is_self_employed ? 'verified' : 'rejected',
      self_employed_checked_by: fnsResult.source,
      self_employed_verified_at: fnsResult.checked_at,
    });

    res.json({
      success: true,
      data: {
        self_employed_status: fnsResult.is_self_employed ? 'verified' : 'rejected',
        message: fnsResult.raw_message,
      },
    });
  } catch {
    await updatePartner(partner.id, {
      inn,
      self_employed_status: 'pending',
      self_employed_verified_at: new Date().toISOString(),
    });
    throw new AppError(503, 'ФНС API недоступен. Заявка отправлена на ручную проверку.');
  }
});

// GET /api/partner/me/referrals — список рефералов
router.get('/me/referrals', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const partner = await getPartnerByUserId(req.user.id);
  if (!partner) throw new AppError(404, 'Вы не являетесь партнёром');

  const limit = Math.min(parseInt(String(req.query['limit'] || '20'), 10), 100);
  const offset = parseInt(String(req.query['offset'] || '0'), 10);

  const { rows, total, total_commission } = await getPartnerReferrals(partner.id, limit, offset);
  res.json({ success: true, data: rows, total, total_commission });
});

// GET /api/partner/me/payouts — история выплат
router.get('/me/payouts', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const partner = await getPartnerByUserId(req.user.id);
  if (!partner) throw new AppError(404, 'Вы не являетесь партнёром');

  const payouts = await getPartnerPayouts(partner.id);
  res.json({ success: true, data: payouts });
});

// POST /api/partner/me/payouts — запрос выплаты
router.post('/me/payouts', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const partner = await getPartnerByUserId(req.user.id);
  if (!partner) throw new AppError(404, 'Вы не являетесь партнёром');

  const { amount, method } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    throw new AppError(400, 'amount должен быть положительным числом');
  }
  if (Number(amount) < 10000) {
    throw new AppError(400, 'Минимальная сумма вывода: 10 000 ₽');
  }
  if (!method || !['card', 'phone', 'bank_transfer'].includes(method)) {
    throw new AppError(400, 'method должен быть: card, phone, bank_transfer');
  }

  const result = await createPayout(partner.id, Number(amount), method);
  res.status(201).json({ success: true, data: result });
});

// PATCH /api/partner/me/profile — обновить реквизиты выплат
router.patch('/me/profile', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const partner = await getPartnerByUserId(req.user.id);
  if (!partner) throw new AppError(404, 'Вы не являетесь партнёром');

  const { payout_details } = req.body;
  if (!payout_details || typeof payout_details !== 'object') {
    throw new AppError(400, 'payout_details обязателен');
  }

  const updated = await updatePartner(partner.id, { payout_details });
  res.json({ success: true, data: updated });
});

// GET /api/partner/me/stats — помесячная статистика
router.get('/me/stats', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const partner = await getPartnerByUserId(req.user.id);
  if (!partner) throw new AppError(404, 'Вы не являетесь партнёром');

  const stats = await getPartnerMonthlyStats(partner.id);
  res.json({ success: true, data: stats });
});

// POST /api/partner/me/regenerate-promo — перегенерировать промокод
router.post('/me/regenerate-promo', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const partner = await getPartnerByUserId(req.user.id);
  if (!partner) throw new AppError(404, 'Вы не являетесь партнёром');

  // Нельзя менять если есть pending-рефералы с текущим кодом
  const activeReferrals = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM partner_referrals
     WHERE partner_id = $1 AND promo_code = $2 AND status = 'pending'`,
    [partner.id, partner.promo_code]
  );
  if (parseInt(activeReferrals?.count || '0') > 0) {
    throw new AppError(
      400,
      'Есть ожидающие рефералы с текущим промокодом. Дождитесь их подтверждения.'
    );
  }

  const newPromoCode = await generateUniquePromoCode(partner.name);
  const newReferralUrl = `https://svoefoto.ru/?ref=${newPromoCode}`;
  await updatePartner(partner.id, { promo_code: newPromoCode, referral_url: newReferralUrl });

  res.json({ success: true, data: { promo_code: newPromoCode, referral_url: newReferralUrl } });
});

// GET /api/partner/me/landing-links — список всех лендингов с реферальным кодом
router.get('/me/landing-links', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const partner = await getPartnerByUserId(req.user.id);
  if (!partner) throw new AppError(404, 'Вы не являетесь партнёром');

  const code = partner.promo_code || '';
  const base = 'https://svoefoto.ru';
  const suffix = `?ref=${code}`;

  const links = [
    { title: 'Фото на документы',           url: `${base}/foto-na-document${suffix}` },
    { title: 'Фото на паспорт',              url: `${base}/foto-na-pasport${suffix}` },
    { title: 'Фото на загранпаспорт',        url: `${base}/foto-zagranpasport${suffix}` },
    { title: 'Портретная съёмка',            url: `${base}/portret${suffix}` },
    { title: 'Художественная ретушь',        url: `${base}/retush${suffix}` },
    { title: 'Печать фотографий',            url: `${base}/pechat-foto${suffix}` },
    { title: 'Товарная съёмка (маркетплейс)',url: `${base}/tovarnaya-sjomka${suffix}` },
    { title: 'Инфографика карточек',         url: `${base}/infografika-kartochek${suffix}` },
    { title: 'SMM-контент',                  url: `${base}/smm-content${suffix}` },
    { title: 'Супер-пакет «Продающий»',      url: `${base}/super-paket-prodayushiy${suffix}` },
    { title: 'Главная страница',             url: `${base}/${suffix}` },
  ];

  res.json({ success: true, data: links });
});

// POST /api/partner/me/verify-bank — верифицировать банковские реквизиты
router.post('/me/verify-bank', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const partner = await getPartnerByUserId(req.user.id);
  if (!partner) throw new AppError(404, 'Вы не являетесь партнёром');

  const { method, details } = req.body;
  const VALID_METHODS = ['card', 'sbp', 'bank_transfer'] as const;
  if (!method || !VALID_METHODS.includes(method)) {
    throw new AppError(400, `method должен быть: ${VALID_METHODS.join(', ')}`);
  }
  if (!details || typeof details !== 'object') {
    throw new AppError(400, 'details обязателен');
  }

  const payout_details = { ...partner.payout_details, method, ...details };
  const updated = await updatePartner(partner.id, { payout_details });
  res.json({ success: true, data: updated });
});

export default router;
