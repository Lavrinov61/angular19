import db from '../src/database/db.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('setup-migal-offline-partner');

const PARTNER_NAME = 'Владимир Мигаль';
const PARTNER_EMAIL = 'vladimir.migal.partner@svoefoto.local';
const PROMO_CODE = 'MIGA';
const REFERRAL_URL = `https://svoefoto.ru/?ref=${PROMO_CODE}`;
const COMMISSION_FIXED = '100.00';
const ELIGIBLE_CATEGORIES = ['photo-docs', 'portrait', 'retouch', 'restoration', 'photo-restore'] as const;
const ELIGIBLE_ORDER_TYPES = ['pos', 'print', 'order'] as const;

interface UserIdRow {
  id: string;
}

interface PartnerIdRow {
  id: number;
}

interface RuleCountRow {
  count: string;
}

const payoutDetails = {
  client_discount_enabled: false,
  unique_phone_commission: true,
  offline_partner: true,
  quality_marker: true,
  managed_by_staff: true,
};

async function upsertPartnerUser(): Promise<UserIdRow> {
  const existing = await db.queryOne<UserIdRow>(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [PARTNER_EMAIL],
  );

  if (existing) {
    const updated = await db.queryOne<UserIdRow>(
      `UPDATE users
       SET display_name = $2,
           role = 'partner',
           is_active = TRUE,
           email_verified = TRUE,
           force_password_change = TRUE,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [existing.id, PARTNER_NAME],
    );
    if (!updated) throw new Error('Failed to update partner user');
    return updated;
  }

  const created = await db.queryOne<UserIdRow>(
    `INSERT INTO users
       (email, display_name, role, is_active, email_verified, force_password_change, created_at, updated_at)
     VALUES ($1, $2, 'partner', TRUE, TRUE, TRUE, NOW(), NOW())
     RETURNING id`,
    [PARTNER_EMAIL, PARTNER_NAME],
  );
  if (!created) throw new Error('Failed to create partner user');
  return created;
}

async function upsertPartner(userId: string): Promise<PartnerIdRow> {
  const partner = await db.queryOne<PartnerIdRow>(
    `INSERT INTO partners
       (user_id, name, email, type, status, commission_rate, promo_code, referral_url,
        payout_details, notes, approved_at, created_at, updated_at)
     VALUES
       ($1, $2, $3, 'promoter', 'approved', 0, $4, $5, $6, $7, NOW(), NOW(), NOW())
     ON CONFLICT (promo_code)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       type = EXCLUDED.type,
       status = EXCLUDED.status,
       commission_rate = EXCLUDED.commission_rate,
       referral_url = EXCLUDED.referral_url,
       payout_details = EXCLUDED.payout_details,
       notes = EXCLUDED.notes,
       approved_at = COALESCE(partners.approved_at, NOW()),
       updated_at = NOW()
     RETURNING id`,
    [
      userId,
      PARTNER_NAME,
      PARTNER_EMAIL,
      PROMO_CODE,
      REFERRAL_URL,
      JSON.stringify(payoutDetails),
      'Офлайн-партнёр: 100 ₽ за первого уникального клиента по телефону. Клиентской скидки нет; код является отметкой качества.',
    ],
  );
  if (!partner) throw new Error('Failed to upsert partner');
  return partner;
}

async function upsertCommissionRules(partnerId: number): Promise<void> {
  for (const category of ELIGIBLE_CATEGORIES) {
    for (const orderType of ELIGIBLE_ORDER_TYPES) {
      await db.query(
        `INSERT INTO partner_commission_rules
           (partner_id, service_category_slug, order_type, commission_percent,
            commission_fixed, min_order_amount, is_active, priority)
         VALUES ($1, $2, $3, NULL, $4, 0, TRUE, 100)
         ON CONFLICT (partner_id, service_category_slug, order_type)
         DO UPDATE SET
           commission_percent = NULL,
           commission_fixed = EXCLUDED.commission_fixed,
           min_order_amount = 0,
           is_active = TRUE,
           priority = 100`,
        [partnerId, category, orderType, COMMISSION_FIXED],
      );
    }
  }
}

async function verifySetup(partnerId: number): Promise<number> {
  const row = await db.queryOne<RuleCountRow>(
    `SELECT COUNT(*)::text AS count
     FROM partner_commission_rules
     WHERE partner_id = $1
       AND service_category_slug = ANY($2::text[])
       AND order_type = ANY($3::text[])
       AND commission_fixed = $4
       AND is_active = TRUE`,
    [partnerId, [...ELIGIBLE_CATEGORIES], [...ELIGIBLE_ORDER_TYPES], COMMISSION_FIXED],
  );
  return Number(row?.count || 0);
}

async function main(): Promise<void> {
  const user = await upsertPartnerUser();
  const partner = await upsertPartner(user.id);
  await upsertCommissionRules(partner.id);
  const ruleCount = await verifySetup(partner.id);

  logger.info('Migal offline partner setup complete', {
    partnerId: partner.id,
    userId: user.id,
    promoCode: PROMO_CODE,
    ruleCount,
  });
}

main()
  .catch((error: unknown) => {
    logger.error('Migal offline partner setup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  })
  .finally(() => {
    db.close().catch((error: unknown) => {
      logger.error('Failed to close database pool', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    });
  });
