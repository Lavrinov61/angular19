/**
 * Partner Notification Service
 * Sends notifications for partner program events:
 * - New partner registration (to admins: in-app + Telegram)
 * - Partner status change (to partner: in-app + email)
 * - Referral confirmed (to partner: in-app)
 * - Payout processed (to partner: in-app + email)
 */

import db from '../database/db.js';
import { NotificationService } from './notification.service.js';
import { sendMailWithCB } from './email.service.js';

import { config } from '../config/index.js';

import { createLogger } from '../utils/logger.js';
const BASE_URL = process.env['BASE_URL'] || 'https://svoefoto.ru';

const logger = createLogger('partner-notify.service');
// ─── Helpers ─────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return '***';
  const visible = name.slice(0, 1);
  return `${visible}***@${domain}`;
}

async function getAdminUserIds(): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE role IN ('admin', 'manager') AND status = 'active'`,
  );
  return rows.map(r => r.id);
}

async function getPartnerUserId(partnerId: number): Promise<string | null> {
  const row = await db.queryOne<{ user_id: string | null }>(
    `SELECT user_id FROM partners WHERE id = $1`,
    [partnerId],
  );
  return row?.user_id || null;
}

async function getPartnerEmail(partnerId: number): Promise<string | null> {
  const row = await db.queryOne<{ email: string | null }>(
    `SELECT email FROM partners WHERE id = $1`,
    [partnerId],
  );
  return row?.email || null;
}

async function sendPartnerEmail(to: string, subject: string, html: string): Promise<void> {
  await sendMailWithCB({
    from: config.smtp.from,
    to,
    subject,
    html,
  });
  logger.info(`[PartnerNotify] Email sent to ${maskEmail(to)}: ${subject}`);
}

// ─── 1. Партнёр зарегистрировался → Админам (in-app + Telegram) ──

export async function notifyAdminsNewPartner(partner: {
  id: number;
  name: string;
  type: string;
  email?: string | null;
  phone?: string | null;
}): Promise<void> {
  try {
    const adminIds = await getAdminUserIds();
    const typeLabels: Record<string, string> = {
      referral: 'Реферальный',
      business: 'Бизнес',
      affiliate: 'Партнёрский',
    };
    const typeLabel = typeLabels[partner.type] || partner.type;

    for (const adminId of adminIds) {
      // In-app notification
      NotificationService.create({
        userId: adminId,
        title: 'Новый партнёр',
        body: `${partner.name} (${typeLabel}) подал заявку на вступление в программу`,
        type: 'partner_registration',
        data: { partnerId: partner.id },
      }).catch(err => logger.error('[PartnerNotify] In-app error', { error: String(err) }));

    }
  } catch (err) {
    logger.error('[PartnerNotify] notifyAdminsNewPartner error:', { error: String(err) });
  }
}

// ─── 2. Заявка одобрена/отклонена → Партнёру (in-app + email) ─────

export async function notifyPartnerStatusChange(partner: {
  id: number;
  name: string;
  status: 'approved' | 'suspended' | 'rejected';
  promo_code?: string | null;
  referral_url?: string | null;
}): Promise<void> {
  try {
    const userId = await getPartnerUserId(partner.id);
    const email = await getPartnerEmail(partner.id);

    const statusMessages: Record<string, { title: string; body: string; emailSubject: string }> = {
      approved: {
        title: 'Заявка в партнёрскую программу одобрена',
        body: `Ваша заявка одобрена! Промокод: ${partner.promo_code || '—'}`,
        emailSubject: '✅ Добро пожаловать в партнёрскую программу Своё Фото',
      },
      suspended: {
        title: 'Партнёрский аккаунт приостановлен',
        body: 'Ваш партнёрский аккаунт временно приостановлен. Свяжитесь с нами для уточнения.',
        emailSubject: '⚠️ Партнёрский аккаунт приостановлен — Своё Фото',
      },
      rejected: {
        title: 'Заявка в партнёрскую программу отклонена',
        body: 'К сожалению, ваша заявка не была одобрена. Свяжитесь с нами для уточнения.',
        emailSubject: '❌ Заявка в партнёрскую программу отклонена — Своё Фото',
      },
    };

    const msg = statusMessages[partner.status];
    if (!msg) return;

    // In-app notification
    if (userId) {
      NotificationService.create({
        userId,
        title: msg.title,
        body: msg.body,
        type: 'partner_status',
        data: { partnerId: partner.id, status: partner.status },
      }).catch(err => logger.error('[PartnerNotify] In-app error', { error: String(err) }));
    }

    // Email
    if (email) {
      const htmlContent = partner.status === 'approved'
        ? buildApprovedEmailHtml(partner.name, partner.promo_code, partner.referral_url)
        : buildStatusEmailHtml(partner.name, msg.body);

      sendPartnerEmail(email, msg.emailSubject, htmlContent)
        .catch(err => logger.error('[PartnerNotify] Email error', { error: String(err) }));
    }
  } catch (err) {
    logger.error('[PartnerNotify] notifyPartnerStatusChange error:', { error: String(err) });
  }
}

// ─── 3. Реферал подтверждён (оплата) → Партнёру (in-app) ─────────

export async function notifyPartnerReferralConfirmed(partner: {
  id: number;
  name: string;
}, commission: number): Promise<void> {
  try {
    const userId = await getPartnerUserId(partner.id);
    if (!userId) return;

    NotificationService.create({
      userId,
      title: 'Комиссия начислена',
      body: `Заказ оплачен — вам начислено ${commission.toFixed(0)} ₽`,
      type: 'partner_referral',
      data: { partnerId: partner.id, commission },
    }).catch(err => logger.error('[PartnerNotify] In-app error', { error: String(err) }));
  } catch (err) {
    logger.error('[PartnerNotify] notifyPartnerReferralConfirmed error:', { error: String(err) });
  }
}

// ─── 4. Выплата обработана → Партнёру (in-app + email) ───────────

export async function notifyPartnerPayoutProcessed(partner: {
  id: number;
  name: string;
}, amount: number, status: 'completed' | 'failed' | 'cancelled'): Promise<void> {
  try {
    const userId = await getPartnerUserId(partner.id);
    const email = await getPartnerEmail(partner.id);

    const statusLabels: Record<string, { title: string; body: string; emailSubject: string }> = {
      completed: {
        title: 'Выплата выполнена',
        body: `${amount.toFixed(0)} ₽ переведено на ваши реквизиты`,
        emailSubject: '💰 Выплата выполнена — Своё Фото',
      },
      failed: {
        title: 'Выплата не выполнена',
        body: `Не удалось перевести ${amount.toFixed(0)} ₽. Сумма возвращена на баланс. Свяжитесь с нами.`,
        emailSubject: '❌ Ошибка выплаты — Своё Фото',
      },
      cancelled: {
        title: 'Выплата отменена',
        body: `Выплата на ${amount.toFixed(0)} ₽ отменена. Сумма возвращена на баланс.`,
        emailSubject: '⚠️ Выплата отменена — Своё Фото',
      },
    };

    const msg = statusLabels[status];
    if (!msg) return;

    // In-app notification
    if (userId) {
      NotificationService.create({
        userId,
        title: msg.title,
        body: msg.body,
        type: 'partner_payout',
        data: { partnerId: partner.id, amount, status },
      }).catch(err => logger.error('[PartnerNotify] In-app error', { error: String(err) }));
    }

    // Email
    if (email) {
      sendPartnerEmail(email, msg.emailSubject, buildPayoutEmailHtml(partner.name, amount, status, msg.body))
        .catch(err => logger.error('[PartnerNotify] Email error', { error: String(err) }));
    }
  } catch (err) {
    logger.error('[PartnerNotify] notifyPartnerPayoutProcessed error:', { error: String(err) });
  }
}

// ─── 5. Изменение тира → Партнёру (in-app) ───────────────────────

export async function notifyPartnerTierChange(info: {
  id: number;
  name: string;
  oldTier: string;
  newTier: string;
  direction: 'upgrade' | 'downgrade';
}): Promise<void> {
  try {
    const userId = await getPartnerUserId(info.id);
    if (!userId) return;

    const isUpgrade = info.direction === 'upgrade';
    const title = isUpgrade ? '🎉 Уровень партнёра повышен!' : 'Изменение уровня партнёра';
    const body = isUpgrade
      ? `Вы достигли уровня ${info.newTier.toUpperCase()}! Теперь вы зарабатываете больше с каждого клиента.`
      : `Ваш уровень изменён с ${info.oldTier} до ${info.newTier}. Нарастите объём продаж для повышения.`;

    NotificationService.create({
      userId,
      title,
      body,
      type: 'partner_referral',
      data: { partnerId: info.id, oldTier: info.oldTier, newTier: info.newTier },
    }).catch(err => logger.error('[PartnerNotify] In-app tier error', { error: String(err) }));
  } catch (err) {
    logger.error('[PartnerNotify] notifyPartnerTierChange error:', { error: String(err) });
  }
}

// ─── Email templates ──────────────────────────────────────────────

function buildApprovedEmailHtml(name: string, promoCode?: string | null, referralUrl?: string | null): string {
  const safeReferralUrl = sanitizeUrl(referralUrl);
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>Своё Фото</title></head>
<body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <div style="text-align:center;margin-bottom:24px">
      <div style="display:inline-block;background:#1565c0;color:#fff;padding:10px 24px;border-radius:8px;font-size:20px;font-weight:700">
        📷 Своё Фото
      </div>
    </div>
    <h2 style="color:#1565c0;margin-top:0">Добро пожаловать в партнёрскую программу!</h2>
    <p>Привет, <strong>${escapeHtml(name)}</strong>!</p>
    <p>Ваша заявка одобрена. Теперь вы можете зарабатывать, приводя клиентов в Своё Фото.</p>
    ${promoCode ? `
    <div style="background:#e3f2fd;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
      <div style="font-size:12px;color:#666;margin-bottom:4px">ВАШ ПРОМОКОД</div>
      <div style="font-size:24px;font-weight:700;color:#1565c0;letter-spacing:2px">${escapeHtml(promoCode)}</div>
    </div>
    ` : ''}
    ${safeReferralUrl ? `
    <div style="background:#f5f5f5;border-radius:8px;padding:12px;margin:12px 0;word-break:break-all">
      <div style="font-size:12px;color:#666;margin-bottom:4px">РЕФЕРАЛЬНАЯ ССЫЛКА</div>
      <a href="${escapeHtml(safeReferralUrl)}" style="color:#1565c0;font-size:13px">${escapeHtml(safeReferralUrl)}</a>
    </div>
    ` : ''}
    <p>Поделитесь ссылкой или промокодом — и получайте 50% комиссии с каждого заказа.</p>
    <div style="text-align:center;margin-top:24px">
      <a href="${BASE_URL}/profile/partner" style="display:inline-block;background:#1565c0;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">
        Открыть дашборд
      </a>
    </div>
  </div>
</body></html>`;
}

function buildStatusEmailHtml(name: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>Своё Фото</title></head>
<body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <div style="text-align:center;margin-bottom:24px">
      <div style="display:inline-block;background:#1565c0;color:#fff;padding:10px 24px;border-radius:8px;font-size:20px;font-weight:700">
        📷 Своё Фото
      </div>
    </div>
    <p>Привет, <strong>${escapeHtml(name)}</strong>!</p>
    <p>${escapeHtml(message)}</p>
    <p>По всем вопросам пишите нам в <a href="https://wa.me/79014178668" style="color:#1565c0">WhatsApp</a>.</p>
  </div>
</body></html>`;
}

function buildPayoutEmailHtml(name: string, amount: number, status: string, message: string): string {
  const statusEmoji = status === 'completed' ? '✅' : status === 'failed' ? '❌' : '⚠️';
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>Своё Фото</title></head>
<body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <div style="text-align:center;margin-bottom:24px">
      <div style="display:inline-block;background:#1565c0;color:#fff;padding:10px 24px;border-radius:8px;font-size:20px;font-weight:700">
        📷 Своё Фото
      </div>
    </div>
    <h2 style="color:#1565c0;margin-top:0">${statusEmoji} Выплата ${amount.toFixed(0)} ₽</h2>
    <p>Привет, <strong>${escapeHtml(name)}</strong>!</p>
    <p>${escapeHtml(message)}</p>
    <div style="text-align:center;margin-top:24px">
      <a href="${BASE_URL}/profile/partner" style="display:inline-block;background:#1565c0;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">
        Открыть дашборд
      </a>
    </div>
  </div>
</body></html>`;
}
