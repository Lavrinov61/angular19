/**
 * Partners Service — ФотоПульт CRM Wave 6
 */

import db from '../database/db.js';

import { createLogger } from '../utils/logger.js';
export interface PartnerTierRow {
  slug: string;
  name: string;
  min_monthly_revenue: string;
  commission_first_percent: number;
  commission_repeat_percent: number;
  commission_lifetime_percent: number;
  client_discount_percent: number;
  cookie_ttl_days: number;
  is_manual_only: boolean;
  downgrade_grace_months: number;
}

const logger = createLogger('partners.service');

// ── Commission Rules ──────────────────────────────────────────

export interface CommissionRuleRow {
  id: number;
  partner_id: number;
  service_category_slug: string | null;
  order_type: string | null;
  commission_percent: string | null;
  commission_fixed: string | null;
  min_order_amount: string;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface ApplicableCommission {
  source: 'rule' | 'tier' | 'legacy';
  rule_id: number | null;
  commission_percent: number | null;
  commission_fixed: number | null;
  min_order_amount: number;
}

export interface PartnerRow {
  id: number;
  user_id: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  type: 'referral' | 'business' | 'affiliate' | 'promoter' | 'agent' | 'online';
  status: 'pending' | 'approved' | 'suspended' | 'rejected';
  commission_rate: string;
  tier_slug: string;
  monthly_revenue: string;
  balance: string;
  total_earned: string;
  promo_code: string | null;
  referral_url: string | null;
  payout_details: PartnerPayoutDetails;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  hourly_rate: string | null;
  inn: string | null;
  self_employed_status: 'not_checked' | 'pending' | 'verified' | 'rejected';
  self_employed_verified_at: string | null;
  self_employed_checked_by: string | null;
  created_at: string;
  updated_at: string;
}

interface PartnerPayoutDetails {
  [key: string]: unknown;
  client_discount_enabled?: unknown;
  unique_phone_commission?: unknown;
}

interface PartnerCountRow {
  total: string;
}

interface PartnerReferralCountRow {
  total: string;
  total_commission: string;
}

interface PartnerPromoDiscountLookupRow {
  partner_id: number;
  partner_name: string;
  tier_slug: string;
  client_discount_percent: number;
}

interface PartnerCommissionRateRow {
  commission_rate: string;
}

interface DeletedCommissionRuleRow {
  id: number;
}

interface PartnerReferralConfigRow {
  tier_slug: string | null;
  payout_details: PartnerPayoutDetails | null;
}

interface PartnerPositiveReferralPhoneRow {
  id: number;
  client_phone: string | null;
}

interface PendingPartnerReferralRow {
  id: number;
  partner_id: number;
  commission_amount: string;
  status: string;
  client_phone: string | null;
}

interface PartnerPayoutDetailsRow {
  payout_details: PartnerPayoutDetails | null;
}

interface PartnerPayoutProcessedRow {
  partner_id: number;
  amount: string;
}

function hasFlag(details: PartnerPayoutDetails | null | undefined, flag: keyof PartnerPayoutDetails, value: boolean): boolean {
  return details?.[flag] === value;
}

export function normalizePartnerReferralPhone(phone: string | null | undefined): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;

  const compact = digits.length > 11 ? digits.slice(-11) : digits;
  if (compact.length === 10) return `7${compact}`;
  if (compact.length === 11 && compact.startsWith('8')) return `7${compact.slice(1)}`;
  return compact;
}

async function getPositiveReferralPhones(partnerId: number): Promise<PartnerPositiveReferralPhoneRow[]> {
  return db.query<PartnerPositiveReferralPhoneRow>(
    `SELECT id, client_phone
     FROM partner_referrals
     WHERE partner_id = $1
       AND status IN ('confirmed', 'paid')
       AND commission_amount > 0
       AND client_phone IS NOT NULL`,
    [partnerId],
  );
}

async function hasPositiveReferralForPhone(
  partnerId: number,
  normalizedPhone: string,
  excludeReferralId?: number,
): Promise<boolean> {
  const rows = await getPositiveReferralPhones(partnerId);
  return rows.some((row) => {
    if (excludeReferralId !== undefined && row.id === excludeReferralId) return false;
    return normalizePartnerReferralPhone(row.client_phone) === normalizedPhone;
  });
}

// ── CRUD ─────────────────────────────────────────────────────

export async function getPartners(filters: {
  status?: string;
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: PartnerRow[]; total: number }> {
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status); conditions.push(`p.status = $${params.length}`);
  }
  if (filters.type) {
    params.push(filters.type); conditions.push(`p.type = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(p.name ILIKE $${params.length} OR p.phone ILIKE $${params.length} OR p.email ILIKE $${params.length} OR p.promo_code ILIKE $${params.length})`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const rows = await db.query<PartnerRow>(
    `SELECT p.*,
            u.display_name AS user_name,
            approver.display_name AS approved_by_name,
            (SELECT COUNT(*) FROM partner_referrals pr WHERE pr.partner_id = p.id) AS referral_count,
            (SELECT COALESCE(SUM(pp.amount), 0) FROM partner_payouts pp WHERE pp.partner_id = p.id AND pp.status = 'completed') AS paid_out
     FROM partners p
     LEFT JOIN users u ON u.id = p.user_id
     LEFT JOIN users approver ON approver.id = p.approved_by
     ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const countRows = await db.query<PartnerCountRow>(
    `SELECT COUNT(*) AS total FROM partners p ${where}`,
    params,
  );

  return { rows, total: parseInt(countRows[0]?.total || '0', 10) };
}

export async function getPartnerById(id: number): Promise<PartnerRow | null> {
  const rows = await db.query<PartnerRow>(
    `SELECT p.*, u.display_name AS user_name, approver.display_name AS approved_by_name
     FROM partners p
     LEFT JOIN users u ON u.id = p.user_id
     LEFT JOIN users approver ON approver.id = p.approved_by
     WHERE p.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function createPartner(data: {
  name: string;
  email?: string | null;
  phone?: string | null;
  type: 'referral' | 'business' | 'affiliate' | 'promoter' | 'agent' | 'online';
  commission_rate?: number;
  promo_code?: string | null;
  referral_url?: string | null;
  payout_details?: PartnerPayoutDetails;
  notes?: string | null;
  user_id?: number | null;
}): Promise<PartnerRow> {
  const rows = await db.query<PartnerRow>(
    `INSERT INTO partners
       (name, email, phone, type, commission_rate, promo_code, referral_url, payout_details, notes, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.name,
      data.email || null,
      data.phone || null,
      data.type,
      data.commission_rate ?? 15.00,
      data.promo_code || null,
      data.referral_url || null,
      JSON.stringify(data.payout_details || {}),
      data.notes || null,
      data.user_id || null,
    ],
  );
  const created = rows[0];

  import('./partner-notify.service.js').then(({ notifyAdminsNewPartner }) => {
    notifyAdminsNewPartner({
      id: created.id,
      name: created.name,
      type: created.type,
      email: created.email,
      phone: created.phone,
    }).catch(err => logger.error('[Partners] notifyAdminsNewPartner error', { error: String(err) }));
  }).catch(() => {/* ignore import error */});

  return created;
}

export async function updatePartner(id: number, data: Partial<{
  name: string;
  email: string | null;
  phone: string | null;
  commission_rate: number;
  promo_code: string | null;
  referral_url: string | null;
  payout_details: PartnerPayoutDetails;
  notes: string | null;
  hourly_rate: number | null;
  inn: string | null;
  self_employed_status: PartnerRow['self_employed_status'];
  self_employed_verified_at: string | null;
  self_employed_checked_by: string | null;
}>): Promise<PartnerRow | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.name !== undefined) { params.push(data.name); fields.push(`name = $${params.length}`); }
  if (data.email !== undefined) { params.push(data.email); fields.push(`email = $${params.length}`); }
  if (data.phone !== undefined) { params.push(data.phone); fields.push(`phone = $${params.length}`); }
  if (data.commission_rate !== undefined) { params.push(data.commission_rate); fields.push(`commission_rate = $${params.length}`); }
  if (data.promo_code !== undefined) { params.push(data.promo_code); fields.push(`promo_code = $${params.length}`); }
  if (data.referral_url !== undefined) { params.push(data.referral_url); fields.push(`referral_url = $${params.length}`); }
  if (data.payout_details !== undefined) { params.push(JSON.stringify(data.payout_details)); fields.push(`payout_details = $${params.length}`); }
  if (data.notes !== undefined) { params.push(data.notes); fields.push(`notes = $${params.length}`); }
  if (data.hourly_rate !== undefined) { params.push(data.hourly_rate); fields.push(`hourly_rate = $${params.length}`); }
  if (data.inn !== undefined) { params.push(data.inn); fields.push(`inn = $${params.length}`); }
  if (data.self_employed_status !== undefined) { params.push(data.self_employed_status); fields.push(`self_employed_status = $${params.length}`); }
  if (data.self_employed_verified_at !== undefined) { params.push(data.self_employed_verified_at); fields.push(`self_employed_verified_at = $${params.length}`); }
  if (data.self_employed_checked_by !== undefined) { params.push(data.self_employed_checked_by); fields.push(`self_employed_checked_by = $${params.length}`); }

  if (fields.length === 0) return getPartnerById(id);

  params.push(new Date().toISOString()); fields.push(`updated_at = $${params.length}`);
  params.push(id);

  const rows = await db.query<PartnerRow>(
    `UPDATE partners SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

export async function setPartnerStatus(
  id: number,
  status: 'approved' | 'suspended' | 'rejected',
  approvedBy: string,
): Promise<PartnerRow | null> {
  const rows = await db.query<PartnerRow>(
    `UPDATE partners SET
       status = $1,
       approved_by = $2,
       approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END,
       updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [status, approvedBy, id],
  );
  const partner = rows[0] || null;

  if (partner) {
    // Fire-and-forget: notify partner about status change
    import('./partner-notify.service.js').then(({ notifyPartnerStatusChange }) => {
      notifyPartnerStatusChange({
        id: partner.id,
        name: partner.name,
        status,
        promo_code: partner.promo_code,
        referral_url: partner.referral_url,
      }).catch(err => logger.error('[Partners] notifyPartnerStatusChange error', { error: String(err) }));
    }).catch(() => {/* ignore import error */});
  }

  return partner;
}

// ── Referrals ─────────────────────────────────────────────────

export async function getPartnerReferrals(partnerId: number, limit = 50, offset = 0) {
  const rows = await db.query(
    `SELECT * FROM partner_referrals WHERE partner_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [partnerId, limit, offset],
  );
  const countRows = await db.query<PartnerReferralCountRow>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(commission_amount), 0) AS total_commission
     FROM partner_referrals WHERE partner_id = $1`,
    [partnerId],
  );
  return {
    rows,
    total: parseInt(countRows[0]?.total || '0', 10),
    total_commission: countRows[0]?.total_commission || '0',
  };
}

export async function validatePartnerPromoCode(code: string): Promise<PartnerRow | null> {
  const rows = await db.query<PartnerRow>(
    `SELECT * FROM partners WHERE UPPER(promo_code) = UPPER($1) AND status = 'approved'`,
    [code],
  );
  return rows[0] || null;
}

export async function getPartnerTierBySlug(tierSlug: string): Promise<PartnerTierRow | null> {
  const rows = await db.query<PartnerTierRow>(
    `SELECT * FROM partner_tiers WHERE slug = $1`,
    [tierSlug],
  );
  return rows[0] || null;
}

export async function getPartnerPromoDiscount(promoCode: string): Promise<{
  discount_percent: number;
  partner_id: number;
  partner_name: string;
  tier_slug: string;
} | null> {
  const rows = await db.query<PartnerPromoDiscountLookupRow>(
    `SELECT p.id AS partner_id, p.name AS partner_name,
            COALESCE(p.tier_slug, 'start') AS tier_slug,
            CASE
              WHEN p.payout_details @> '{"client_discount_enabled": false}'::jsonb THEN 0
              ELSE COALESCE(pt.client_discount_percent, 5)
            END AS client_discount_percent
     FROM partners p
     LEFT JOIN partner_tiers pt ON pt.slug = COALESCE(p.tier_slug, 'start')
     WHERE UPPER(p.promo_code) = UPPER($1) AND p.status = 'approved'`,
    [promoCode],
  );
  if (!rows[0]) return null;
  return {
    discount_percent: rows[0].client_discount_percent,
    partner_id: rows[0].partner_id,
    partner_name: rows[0].partner_name,
    tier_slug: rows[0].tier_slug,
  };
}

export async function getClientOrderCountForPartner(partnerId: number, clientPhone: string): Promise<number> {
  const normalizedPhone = normalizePartnerReferralPhone(clientPhone);
  if (!normalizedPhone) return 0;
  const rows = await getPositiveReferralPhones(partnerId);
  return rows.filter(row => normalizePartnerReferralPhone(row.client_phone) === normalizedPhone).length;
}

/**
 * Specificity-first commission rule lookup (4 levels):
 *  1. exact:    (partner_id, slug, order_type)
 *  2. category: (partner_id, slug, NULL)
 *  3. type:     (partner_id, NULL, order_type)
 *  4. global:   (partner_id, NULL, NULL)
 * Fallback: partner's legacy commission_rate
 */
export async function getApplicableCommissionRule(
  partnerId: number,
  serviceCategorySlug?: string | null,
  orderType?: string | null,
): Promise<ApplicableCommission> {
  // Build specificity-ordered query: most specific first, then by priority DESC
  const row = await db.queryOne<CommissionRuleRow>(
    `SELECT * FROM partner_commission_rules
     WHERE partner_id = $1 AND is_active = TRUE
       AND (
         (service_category_slug = $2 AND order_type = $3)
         OR (service_category_slug = $2 AND order_type IS NULL)
         OR (service_category_slug IS NULL AND order_type = $3)
         OR (service_category_slug IS NULL AND order_type IS NULL)
       )
     ORDER BY
       CASE
         WHEN service_category_slug = $2 AND order_type = $3 THEN 0
         WHEN service_category_slug = $2 AND order_type IS NULL THEN 1
         WHEN service_category_slug IS NULL AND order_type = $3 THEN 2
         ELSE 3
       END,
       priority DESC
     LIMIT 1`,
    [partnerId, serviceCategorySlug || null, orderType || null],
  );

  if (row) {
    return {
      source: 'rule',
      rule_id: row.id,
      commission_percent: row.commission_percent ? parseFloat(row.commission_percent) : null,
      commission_fixed: row.commission_fixed ? parseFloat(row.commission_fixed) : null,
      min_order_amount: parseFloat(row.min_order_amount) || 0,
    };
  }

  // Fallback: legacy commission_rate from partners table
  const partner = await db.queryOne<PartnerCommissionRateRow>(
    `SELECT commission_rate FROM partners WHERE id = $1`,
    [partnerId],
  );

  return {
    source: 'legacy',
    rule_id: null,
    commission_percent: partner ? parseFloat(partner.commission_rate) : 15,
    commission_fixed: null,
    min_order_amount: 0,
  };
}

export async function getCommissionRules(partnerId: number): Promise<CommissionRuleRow[]> {
  return db.query<CommissionRuleRow>(
    `SELECT * FROM partner_commission_rules
     WHERE partner_id = $1
     ORDER BY priority DESC, service_category_slug NULLS LAST, order_type NULLS LAST`,
    [partnerId],
  );
}

export async function getCommissionRuleById(ruleId: number): Promise<CommissionRuleRow | null> {
  return db.queryOne<CommissionRuleRow>(
    `SELECT * FROM partner_commission_rules WHERE id = $1`,
    [ruleId],
  );
}

export async function createCommissionRule(data: {
  partner_id: number;
  service_category_slug?: string | null;
  order_type?: string | null;
  commission_percent?: number | null;
  commission_fixed?: number | null;
  min_order_amount?: number;
  priority?: number;
}): Promise<CommissionRuleRow> {
  const rows = await db.query<CommissionRuleRow>(
    `INSERT INTO partner_commission_rules
       (partner_id, service_category_slug, order_type, commission_percent,
        commission_fixed, min_order_amount, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.partner_id,
      data.service_category_slug || null,
      data.order_type || null,
      data.commission_percent ?? null,
      data.commission_fixed ?? null,
      data.min_order_amount ?? 0,
      data.priority ?? 0,
    ],
  );
  return rows[0];
}

export async function updateCommissionRule(
  ruleId: number,
  data: Partial<{
    service_category_slug: string | null;
    order_type: string | null;
    commission_percent: number | null;
    commission_fixed: number | null;
    min_order_amount: number;
    is_active: boolean;
    priority: number;
  }>,
): Promise<CommissionRuleRow | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.service_category_slug !== undefined) { params.push(data.service_category_slug); fields.push(`service_category_slug = $${params.length}`); }
  if (data.order_type !== undefined) { params.push(data.order_type); fields.push(`order_type = $${params.length}`); }
  if (data.commission_percent !== undefined) { params.push(data.commission_percent); fields.push(`commission_percent = $${params.length}`); }
  if (data.commission_fixed !== undefined) { params.push(data.commission_fixed); fields.push(`commission_fixed = $${params.length}`); }
  if (data.min_order_amount !== undefined) { params.push(data.min_order_amount); fields.push(`min_order_amount = $${params.length}`); }
  if (data.is_active !== undefined) { params.push(data.is_active); fields.push(`is_active = $${params.length}`); }
  if (data.priority !== undefined) { params.push(data.priority); fields.push(`priority = $${params.length}`); }

  if (fields.length === 0) return getCommissionRuleById(ruleId);

  params.push(ruleId);
  const rows = await db.query<CommissionRuleRow>(
    `UPDATE partner_commission_rules SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

export async function deleteCommissionRule(ruleId: number): Promise<boolean> {
  const rows = await db.query<DeletedCommissionRuleRow>(
    `DELETE FROM partner_commission_rules WHERE id = $1 RETURNING id`,
    [ruleId],
  );
  return rows.length > 0;
}

export async function recordReferral(data: {
  partner_id: number;
  order_id?: string;
  order_type?: string;
  order_amount: number;
  promo_code?: string;
  client_phone?: string;
  service_category_slug?: string;
  status?: 'pending' | 'confirmed';
}): Promise<void> {
  // Get partner tier info
  const partnerRows = await db.query<PartnerReferralConfigRow>(
    `SELECT tier_slug, payout_details FROM partners WHERE id = $1 AND status = 'approved'`,
    [data.partner_id],
  );
  if (!partnerRows[0]) return;

  const tierSlug = partnerRows[0].tier_slug || 'start';
  const payoutDetails = partnerRows[0].payout_details || null;
  const uniquePhoneCommission = hasFlag(payoutDetails, 'unique_phone_commission', true);
  const tier = await getPartnerTierBySlug(tierSlug);
  const normalizedPhone = normalizePartnerReferralPhone(data.client_phone);

  // Determine how many orders this client has placed through this partner (completed)
  const prevCount = normalizedPhone
    ? await getClientOrderCountForPartner(data.partner_id, normalizedPhone)
    : 0;

  const clientOrderCount = prevCount + 1;

  let commissionType: 'first' | 'repeat' | 'lifetime';
  if (clientOrderCount === 1) {
    commissionType = 'first';
  } else if (clientOrderCount <= 5) {
    commissionType = 'repeat';
  } else {
    commissionType = 'lifetime';
  }

  // Try commission rules first (specificity-based), fallback to tier rates
  const rule = await getApplicableCommissionRule(
    data.partner_id,
    data.service_category_slug,
    data.order_type,
  );

  // Check min_order_amount
  if (data.order_amount < rule.min_order_amount) return;

  let commission: number;
  if (rule.source === 'rule') {
    // Rule-based: fixed takes priority over percent
    if (rule.commission_fixed != null && rule.commission_fixed > 0) {
      commission = rule.commission_fixed;
    } else {
      commission = (data.order_amount * (rule.commission_percent ?? 15)) / 100;
    }
  } else {
    // Tier-based (legacy fallback): use tier rates by client order count
    let tierPercent: number;
    if (commissionType === 'first') {
      tierPercent = tier?.commission_first_percent ?? 15;
    } else if (commissionType === 'repeat') {
      tierPercent = tier?.commission_repeat_percent ?? 10;
    } else {
      tierPercent = tier?.commission_lifetime_percent ?? 5;
    }
    commission = (data.order_amount * tierPercent) / 100;
  }
  const referralStatus = data.status || 'pending';
  const isPayableCommission = commission > 0;

  if (uniquePhoneCommission) {
    if (!normalizedPhone || !isPayableCommission) return;
    if (await hasPositiveReferralForPhone(data.partner_id, normalizedPhone)) return;
  }

  await db.query(
    `INSERT INTO partner_referrals
       (partner_id, order_id, order_type, order_amount, commission_amount,
        promo_code, client_phone, status, commission_type, client_order_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (partner_id, order_id, order_type) DO NOTHING`,
    [
      data.partner_id,
      data.order_id || null,
      data.order_type || 'print',
      data.order_amount,
      commission,
      data.promo_code || null,
      uniquePhoneCommission ? normalizedPhone : (data.client_phone || null),
      referralStatus,
      commissionType,
      clientOrderCount,
    ],
  );

  // Increment balance only when confirmed
  if (referralStatus === 'confirmed') {
    await db.query(
      `UPDATE partners SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
       WHERE id = $2`,
      [commission, data.partner_id],
    );
  }
}

export async function confirmReferral(orderId: string, orderType: string): Promise<PartnerRow | null> {
  // Find referral and update status pending → confirmed
  const referral = await db.queryOne<PendingPartnerReferralRow>(
    `SELECT id, partner_id, commission_amount, status, client_phone FROM partner_referrals
     WHERE order_id = $1 AND order_type = $2 AND status = 'pending'`,
    [orderId, orderType],
  );
  if (!referral) return null;

  const partnerFlags = await db.queryOne<PartnerPayoutDetailsRow>(
    `SELECT payout_details FROM partners WHERE id = $1`,
    [referral.partner_id],
  );
  const uniquePhoneCommission = hasFlag(partnerFlags?.payout_details, 'unique_phone_commission', true);
  const commission = parseFloat(referral.commission_amount);

  if (uniquePhoneCommission && commission > 0) {
    const normalizedPhone = normalizePartnerReferralPhone(referral.client_phone);
    const shouldCancel = !normalizedPhone
      || await hasPositiveReferralForPhone(referral.partner_id, normalizedPhone, referral.id);

    if (shouldCancel) {
      await db.query(
        `UPDATE partner_referrals
         SET status = 'cancelled',
             notes = COALESCE(NULLIF(notes, '') || E'\n', '') || 'Duplicate or missing phone for unique-phone partner commission'
         WHERE id = $1`,
        [referral.id],
      );
      return getPartnerById(referral.partner_id);
    }
  }

  await db.query(
    `UPDATE partner_referrals SET status = 'confirmed' WHERE id = $1`,
    [referral.id],
  );

  await db.query(
    `UPDATE partners SET balance = balance + $1, total_earned = total_earned + $1,
      monthly_revenue = monthly_revenue + $1, updated_at = NOW()
     WHERE id = $2`,
    [referral.commission_amount, referral.partner_id],
  );

  const partner = await getPartnerById(referral.partner_id);

  if (partner) {
    // Fire-and-forget: notify partner about confirmed referral
    import('./partner-notify.service.js').then(({ notifyPartnerReferralConfirmed }) => {
      notifyPartnerReferralConfirmed(
        { id: partner.id, name: partner.name },
        commission,
      ).catch(err => logger.error('[Partners] notifyPartnerReferralConfirmed error', { error: String(err) }));
    }).catch(() => {/* ignore import error */});
  }

  return partner;
}

export async function markReferralsPaid(partnerId: number): Promise<void> {
  await db.query(
    `UPDATE partner_referrals SET status = 'paid'
     WHERE partner_id = $1 AND status = 'confirmed'`,
    [partnerId],
  );
}

// ── Payouts ───────────────────────────────────────────────────

export async function getPartnerPayouts(partnerId: number) {
  return db.query(
    `SELECT pp.*, u.name AS processed_by_name
     FROM partner_payouts pp
     LEFT JOIN users u ON u.id = pp.processed_by
     WHERE pp.partner_id = $1
     ORDER BY pp.created_at DESC`,
    [partnerId],
  );
}

export async function createPayout(
  partnerId: number,
  amount: number,
  method: string,
): Promise<{ id: number }> {
  return db.transaction(async (client) => {
    const partnerRows = await client.query(
      `SELECT balance FROM partners WHERE id = $1 AND status = 'approved'`,
      [partnerId],
    );
    if (!partnerRows.rows[0]) throw new Error('Партнёр не найден или не активен');

    const balance = parseFloat(partnerRows.rows[0].balance);
    if (amount > balance) throw new Error(`Сумма ${amount} ₽ превышает баланс ${balance} ₽`);

    const result = await client.query(
      `INSERT INTO partner_payouts (partner_id, amount, method, status) VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [partnerId, amount, method],
    );

    await client.query(
      `UPDATE partners SET balance = balance - $1, updated_at = NOW() WHERE id = $2`,
      [amount, partnerId],
    );

    return { id: result.rows[0].id };
  });
}

export async function processPayoutStatus(
  payoutId: number,
  status: 'completed' | 'failed' | 'cancelled',
  processedBy: string,
): Promise<{ partner_id: number; amount: string } | undefined> {
  await db.transaction(async (client) => {
    const rows = await client.query(
      `SELECT partner_id, amount, status FROM partner_payouts WHERE id = $1`,
      [payoutId],
    );
    if (!rows.rows[0]) throw new Error('Выплата не найдена');
    if (rows.rows[0].status !== 'pending') throw new Error('Выплата уже обработана');

    await client.query(
      `UPDATE partner_payouts SET status = $1, processed_by = $2, processed_at = NOW() WHERE id = $3`,
      [status, processedBy, payoutId],
    );

    if (status === 'cancelled' || status === 'failed') {
      await client.query(
        `UPDATE partners SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
        [rows.rows[0].amount, rows.rows[0].partner_id],
      );
    }

    if (status === 'completed') {
      await client.query(
        `UPDATE partner_referrals SET status = 'paid'
         WHERE partner_id = $1 AND status = 'confirmed'`,
        [rows.rows[0].partner_id],
      );
    }
  });

  // Return partner info + fire notification
  const payoutRow = await db.queryOne<PartnerPayoutProcessedRow>(
    `SELECT partner_id, amount FROM partner_payouts WHERE id = $1`,
    [payoutId],
  );

  if (payoutRow) {
    const partner = await getPartnerById(payoutRow.partner_id);
    if (partner) {
      const amount = parseFloat(payoutRow.amount);
      import('./partner-notify.service.js').then(({ notifyPartnerPayoutProcessed }) => {
        notifyPartnerPayoutProcessed(
          { id: partner.id, name: partner.name },
          amount,
          status,
        ).catch(err => logger.error('[Partners] notifyPartnerPayoutProcessed error', { error: String(err) }));
      }).catch(() => {/* ignore import error */});
    }
  }

  return payoutRow || undefined;
}

// ── Public Self-Service ───────────────────────────────────────

export interface MonthlyStatRow {
  month: string;
  referral_count: string;
  total_amount: string;
  total_commission: string;
}

const TRANSLIT_MAP: Record<string, string> = {
  'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'E','Ж':'ZH',
  'З':'Z','И':'I','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O',
  'П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'KH','Ц':'TS',
  'Ч':'CH','Ш':'SH','Щ':'SCH','Ъ':'','Ы':'Y','Ь':'','Э':'E','Ю':'YU','Я':'YA',
};

export async function getPartnerByUserId(userId: string): Promise<PartnerRow | null> {
  const rows = await db.query<PartnerRow>(
    `SELECT p.*, u.display_name AS user_name
     FROM partners p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

export async function generateUniquePromoCode(name: string): Promise<string> {
  const cleanName = name.toUpperCase().replace(/[^A-ZА-ЯЁ]/g, '');
  const translitName = cleanName.split('').map(c => TRANSLIT_MAP[c] || c).join('');
  const prefix = translitName.slice(0, 3).padEnd(3, 'X');

  for (let i = 0; i < 10; i++) {
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    const code = `SVF-${prefix}-${digits}`;
    const existing = await db.query('SELECT 1 FROM partners WHERE promo_code = $1', [code]);
    if (existing.length === 0) return code;
  }
  throw new Error('Не удалось сгенерировать уникальный промокод');
}

export async function getPartnerMonthlyStats(partnerId: number): Promise<MonthlyStatRow[]> {
  return db.query<MonthlyStatRow>(
    `SELECT
       date_trunc('month', created_at) AS month,
       COUNT(*)::text AS referral_count,
       COALESCE(SUM(order_amount), 0)::text AS total_amount,
       COALESCE(SUM(commission_amount), 0)::text AS total_commission
     FROM partner_referrals
     WHERE partner_id = $1
     GROUP BY date_trunc('month', created_at)
     ORDER BY month DESC
     LIMIT 12`,
    [partnerId],
  );
}
