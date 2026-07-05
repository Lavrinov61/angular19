import db from '../database/db.js';
import { config } from '../config/index.js';
import { deliverReply } from './channel-delivery.service.js';
import { sendSms } from './sms.service.js';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { TelegramChatIdLookup } from '../types/views/chat-views.js';

import { createLogger } from '../utils/logger.js';
// ─── Shared constants ──────────────────────────────────────────────

const logger = createLogger('booking-notify.service');
const STUDIO_PHONE = '+7 (901) 417-86-68';
const STUDIO_ADDRESS = 'Переулок Соборный 21, Ростов-на-Дону';
const STUDIO_HOURS = 'Пн\u2013Вс 09:00\u201319:30';
const YANDEX_MAPS_URL = 'https://yandex.ru/maps/-/CDxYrH5d';
const BOOKING_URL = 'https://svoefoto.ru/booking';

const BRAND_COLOR = '#1565c0';
const BRAND_LIGHT = '#e3f2fd';
const SUCCESS_COLOR = '#2e7d32';
const SUCCESS_LIGHT = '#e8f5e9';
const TEXT_PRIMARY = '#212121';
const TEXT_SECONDARY = '#616161';
const TEXT_MUTED = '#9e9e9e';
const BORDER = '#e0e0e0';
const BG = '#f5f5f5';
const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// ─── SMTP ──────────────────────────────────────────────────────────

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.smtp.user || !config.smtp.password) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Экранирует HTML-спецсимволы для вставки пользовательских данных в email-шаблоны.
 * Предотвращает XSS через имя, адрес и другие поля клиента.
 */
function escHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Moscow',
  });
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

function hasDeliverablePhone(phone: string | null | undefined): phone is string {
  return Boolean(phone && phone.replace(/\D/g, '').length >= 10);
}

// ─── Telegram chat_id lookup ───────────────────────────────────────

/**
 * Ищем Telegram chat_id клиента по телефону через conversations
 */
async function findTelegramChatId(phone: string): Promise<string | null> {
  // Нормализуем телефон — оставляем только цифры
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;

  // Берём последние 10 цифр (без кода страны)
  const last10 = digits.slice(-10);

  const result = await db.queryOne<TelegramChatIdLookup>(
    `SELECT metadata->>'externalChatId' AS chat_id
     FROM conversations
     WHERE channel = 'telegram'
       AND metadata->>'externalUserId' LIKE '%' || $1
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT 1`,
    [last10],
  );

  return result?.chat_id || null;
}

// ─── Email wrapper (copy of shared pattern) ────────────────────────

function emailWrapper(preheader: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Своё Фото</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT_STACK};-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">
    ${preheader}
    ${'&zwnj;&nbsp;'.repeat(30)}
  </div>
  <div style="max-width:600px;margin:0 auto;padding:20px 12px">
    <div style="text-align:center;padding:20px 0 16px">
      <div style="display:inline-block;background:${BRAND_COLOR};color:#fff;padding:10px 24px;border-radius:8px;font-size:20px;font-weight:700;letter-spacing:0.5px">
        \u{1F4F7} Своё Фото
      </div>
    </div>
    ${content}
    <div style="text-align:center;padding:16px 0 8px;color:${TEXT_MUTED};font-size:11px">
      <p style="margin:0 0 4px"><a href="https://svoefoto.ru" style="color:${TEXT_MUTED};text-decoration:none">svoefoto.ru</a></p>
      <p style="margin:0">${STUDIO_ADDRESS}</p>
      <p style="margin:4px 0 0">${STUDIO_HOURS}</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Email templates ───────────────────────────────────────────────

interface BookingEmailData {
  date: string;
  time: string;
  studioName: string;
  clientName: string;
  serviceName?: string | null;
}

function buildBookingConfirmationHtml(data: BookingEmailData): string {
  const content = `
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER}">
      <div style="background:${SUCCESS_LIGHT};padding:20px;text-align:center;border-bottom:1px solid #c8e6c9">
        <div style="font-size:36px;line-height:1">\u2705</div>
        <h2 style="margin:8px 0 0;font-size:20px;color:${SUCCESS_COLOR}">Запись подтверждена!</h2>
      </div>
      <div style="padding:20px 24px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_MUTED};width:100px">Дата:</td>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_PRIMARY};font-weight:600">${escHtml(data.date)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_MUTED}">Время:</td>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_PRIMARY};font-weight:600">${escHtml(data.time)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_MUTED}">Студия:</td>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_PRIMARY}">${escHtml(data.studioName)}</td>
          </tr>
          ${data.serviceName ? `<tr>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_MUTED}">Услуга:</td>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_PRIMARY}">${escHtml(data.serviceName)}</td>
          </tr>` : ''}
        </table>
        <div style="background:${BRAND_LIGHT};border-radius:8px;padding:14px 16px;margin-top:16px;border-left:4px solid ${BRAND_COLOR}">
          <p style="margin:0;font-size:13px;font-weight:600;color:${BRAND_COLOR}">\u{1F3E0} Адрес студии</p>
          <p style="margin:4px 0 0;font-size:13px;color:${TEXT_SECONDARY}">${STUDIO_ADDRESS}</p>
          <a href="${YANDEX_MAPS_URL}" style="display:inline-block;margin-top:8px;font-size:12px;color:${BRAND_COLOR};text-decoration:none">
            Открыть на карте &rarr;
          </a>
        </div>
        <div style="text-align:center;margin-top:20px">
          <p style="margin:0;font-size:13px;color:${TEXT_MUTED}">Есть вопросы? Позвоните: <a href="tel:+79014178668" style="color:${BRAND_COLOR};text-decoration:none">${STUDIO_PHONE}</a></p>
        </div>
      </div>
    </div>`;

  return emailWrapper(`Запись подтверждена: ${data.date} в ${data.time}`, content);
}

function buildBookingCancelledHtml(data: BookingEmailData): string {
  const content = `
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER}">
      <div style="background:#ffebee;padding:20px;text-align:center;border-bottom:1px solid ${BORDER}">
        <div style="font-size:36px;line-height:1">\u274C</div>
        <h2 style="margin:8px 0 0;font-size:20px;color:#c62828">Запись отменена</h2>
      </div>
      <div style="padding:20px 24px;text-align:center">
        <p style="margin:0 0 8px;font-size:14px;color:${TEXT_SECONDARY}">
          Запись на ${escHtml(data.date)} в ${escHtml(data.time)} (${escHtml(data.studioName)}) отменена.
        </p>
        <p style="margin:16px 0 0">
          <a href="${BOOKING_URL}" style="display:inline-block;padding:14px 40px;background:${BRAND_COLOR};color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">
            Записаться снова
          </a>
        </p>
      </div>
    </div>`;

  return emailWrapper(`Запись на ${data.date} отменена`, content);
}

function buildBookingRescheduledHtml(data: BookingEmailData & { oldDate: string; oldTime: string }): string {
  const content = `
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER}">
      <div style="background:#fff3e0;padding:20px;text-align:center;border-bottom:1px solid ${BORDER}">
        <div style="font-size:36px;line-height:1">\u{1F504}</div>
        <h2 style="margin:8px 0 0;font-size:20px;color:#e65100">Запись перенесена</h2>
      </div>
      <div style="padding:20px 24px">
        <p style="margin:0 0 16px;font-size:13px;color:${TEXT_MUTED};text-align:center">
          <s>${escHtml(data.oldDate)} в ${escHtml(data.oldTime)}</s>
        </p>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_MUTED};width:120px">Новая дата:</td>
            <td style="padding:8px 0;font-size:16px;color:${SUCCESS_COLOR};font-weight:700">${escHtml(data.date)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_MUTED}">Новое время:</td>
            <td style="padding:8px 0;font-size:16px;color:${SUCCESS_COLOR};font-weight:700">${escHtml(data.time)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_MUTED}">Студия:</td>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_PRIMARY}">${escHtml(data.studioName)}</td>
          </tr>
        </table>
        <div style="background:${BRAND_LIGHT};border-radius:8px;padding:14px 16px;margin-top:16px;border-left:4px solid ${BRAND_COLOR}">
          <p style="margin:0;font-size:13px;color:${TEXT_SECONDARY}">${STUDIO_ADDRESS}</p>
          <a href="${YANDEX_MAPS_URL}" style="display:inline-block;margin-top:8px;font-size:12px;color:${BRAND_COLOR};text-decoration:none">Открыть на карте &rarr;</a>
        </div>
      </div>
    </div>`;

  return emailWrapper(`Запись перенесена на ${data.date} в ${data.time}`, content);
}

function buildBookingReminderHtml(data: BookingEmailData, type: '24h' | '1h'): string {
  const title = type === '24h' ? 'Напоминание: запись завтра' : 'Запись через 1 час!';
  const icon = type === '24h' ? '\u{1F4C5}' : '\u23F0';
  const bgColor = type === '24h' ? BRAND_LIGHT : '#fff3e0';
  const textColor = type === '24h' ? BRAND_COLOR : '#e65100';

  const content = `
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER}">
      <div style="background:${bgColor};padding:20px;text-align:center;border-bottom:1px solid ${BORDER}">
        <div style="font-size:36px;line-height:1">${icon}</div>
        <h2 style="margin:8px 0 0;font-size:20px;color:${textColor}">${title}</h2>
      </div>
      <div style="padding:20px 24px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_MUTED};width:100px">Дата:</td>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_PRIMARY};font-weight:600">${data.date}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_MUTED}">Время:</td>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_PRIMARY};font-weight:600">${data.time}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_MUTED}">Студия:</td>
            <td style="padding:8px 0;font-size:14px;color:${TEXT_PRIMARY}">${data.studioName}</td>
          </tr>
        </table>
        <div style="background:${BRAND_LIGHT};border-radius:8px;padding:14px 16px;margin-top:16px;border-left:4px solid ${BRAND_COLOR}">
          <p style="margin:0;font-size:13px;color:${TEXT_SECONDARY}">${STUDIO_ADDRESS}</p>
          <a href="${YANDEX_MAPS_URL}" style="display:inline-block;margin-top:8px;font-size:12px;color:${BRAND_COLOR};text-decoration:none">Открыть на карте &rarr;</a>
        </div>
        <div style="text-align:center;margin-top:16px">
          <p style="margin:0;font-size:13px;color:${TEXT_MUTED}">Тел: <a href="tel:+79014178668" style="color:${BRAND_COLOR};text-decoration:none">${STUDIO_PHONE}</a></p>
        </div>
      </div>
    </div>`;

  return emailWrapper(`${title}: ${data.date} в ${data.time}`, content);
}

// ─── Public API ────────────────────────────────────────────────────

export interface BookingNotifyData {
  id: string;
  client_name: string;
  client_phone: string;
  client_email?: string | null;
  start_time: string;
  end_time: string;
  service_name?: string | null;
  studio_id: string;
}

/**
 * Уведомление о подтверждении записи
 */
export async function notifyBookingCreated(booking: BookingNotifyData, studioName: string): Promise<void> {
  const dateStr = formatDate(booking.start_time);
  const timeStr = formatTime(booking.start_time);

  // 1. Telegram Bot
  try {
    const chatId = await findTelegramChatId(booking.client_phone);
    if (chatId) {
      const text = `\u2705 Своё Фото: запись подтверждена!\n\n\u{1F4C5} ${dateStr}\n\u23F0 ${timeStr}\n\u{1F3E0} ${studioName}${booking.service_name ? `\n\u{1F4CB} ${booking.service_name}` : ''}\n\nАдрес: ${STUDIO_ADDRESS}\nТел: ${STUDIO_PHONE}`;
      await deliverReply('telegram', chatId, text);
      logger.info(`[BookingNotify] Telegram sent to chat_id ${chatId}`);
    }
  } catch (err) {
    logger.warn('[BookingNotify] Telegram failed:', { error: String(err) });
  }

  // 2. Email
  if (booking.client_email) {
    try {
      const transport = getTransporter();
      if (transport) {
        await transport.sendMail({
          from: config.smtp.from,
          to: booking.client_email,
          subject: `\u2705 Запись подтверждена \u2014 ${dateStr} в ${timeStr}`,
          html: buildBookingConfirmationHtml({
            date: dateStr,
            time: timeStr,
            studioName,
            clientName: booking.client_name,
            serviceName: booking.service_name,
          }),
        });
        logger.info(`[BookingNotify] Email sent to ${booking.client_email}`);
      }
    } catch (err) {
      logger.warn('[BookingNotify] Email failed:', { error: String(err) });
    }
  }

  // 3. SMS (если есть телефон и SMS включены)
  if (hasDeliverablePhone(booking.client_phone) && config.sms.enabled) {
    const smsText = `Своё Фото: запись подтверждена! ${dateStr} в ${timeStr}. ${studioName}. Тел: ${STUDIO_PHONE}`;
    sendSms(booking.client_phone, smsText).catch(err => logger.warn('[BookingNotify] SMS failed', { error: String(err) }));
  }

  // 4. Обновить confirmation_sent_at
  await db.query(
    `UPDATE bookings SET confirmation_sent_at = NOW() WHERE id = $1`,
    [booking.id],
  );
}

/**
 * Уведомление об отмене записи
 */
export async function notifyBookingCancelled(booking: BookingNotifyData, studioName: string): Promise<void> {
  const dateStr = formatDate(booking.start_time);
  const timeStr = formatTime(booking.start_time);

  // Telegram
  try {
    const chatId = await findTelegramChatId(booking.client_phone);
    if (chatId) {
      const text = `\u274C Своё Фото: запись на ${dateStr} в ${timeStr} отменена.\n\nЗаписаться снова: ${BOOKING_URL}\nТел: ${STUDIO_PHONE}`;
      await deliverReply('telegram', chatId, text);
    }
  } catch (err) {
    logger.warn('[BookingNotify] Telegram cancel failed:', { error: String(err) });
  }

  // SMS при отмене
  if (hasDeliverablePhone(booking.client_phone) && config.sms.enabled) {
    const smsText = `Своё Фото: запись на ${dateStr} в ${timeStr} отменена. Записаться: ${BOOKING_URL}`;
    sendSms(booking.client_phone, smsText).catch(err => logger.warn('[BookingNotify] SMS cancel failed', { error: String(err) }));
  }

  // Email
  if (booking.client_email) {
    try {
      const transport = getTransporter();
      if (transport) {
        await transport.sendMail({
          from: config.smtp.from,
          to: booking.client_email,
          subject: `\u274C Запись отменена \u2014 ${dateStr}`,
          html: buildBookingCancelledHtml({
            date: dateStr,
            time: timeStr,
            studioName,
            clientName: booking.client_name,
          }),
        });
      }
    } catch (err) {
      logger.warn('[BookingNotify] Email cancel failed:', { error: String(err) });
    }
  }
}

/**
 * Уведомление о переносе записи
 */
export async function notifyBookingRescheduled(
  booking: BookingNotifyData,
  oldDate: string,
  oldTime: string,
  studioName: string,
): Promise<void> {
  const newDateStr = formatDate(booking.start_time);
  const newTimeStr = formatTime(booking.start_time);

  // Telegram
  try {
    const chatId = await findTelegramChatId(booking.client_phone);
    if (chatId) {
      const text = `\u{1F504} Своё Фото: запись перенесена.\n\nНовое время: ${newDateStr} в ${newTimeStr}\n\u{1F3E0} ${studioName}\n\nАдрес: ${STUDIO_ADDRESS}\nТел: ${STUDIO_PHONE}`;
      await deliverReply('telegram', chatId, text);
    }
  } catch (err) {
    logger.warn('[BookingNotify] Telegram reschedule failed:', { error: String(err) });
  }

  // Email
  if (booking.client_email) {
    try {
      const transport = getTransporter();
      if (transport) {
        await transport.sendMail({
          from: config.smtp.from,
          to: booking.client_email,
          subject: `\u{1F504} Запись перенесена \u2014 ${newDateStr} в ${newTimeStr}`,
          html: buildBookingRescheduledHtml({
            date: newDateStr,
            time: newTimeStr,
            oldDate,
            oldTime,
            studioName,
            clientName: booking.client_name,
          }),
        });
      }
    } catch (err) {
      logger.warn('[BookingNotify] Email reschedule failed:', { error: String(err) });
    }
  }

  // SMS при переносе
  if (hasDeliverablePhone(booking.client_phone) && config.sms.enabled) {
    const smsText = `Своё Фото: запись перенесена. Новое время: ${newDateStr} в ${newTimeStr}. ${studioName}. Тел: ${STUDIO_PHONE}`;
    sendSms(booking.client_phone, smsText).catch(err => logger.warn('[BookingNotify] SMS reschedule failed', { error: String(err) }));
  }
}

/**
 * Напоминание о записи (24ч или 1ч)
 */
export async function sendBookingReminder(
  booking: BookingNotifyData,
  type: '24h' | '1h',
  studioName: string,
): Promise<void> {
  const dateStr = formatDate(booking.start_time);
  const timeStr = formatTime(booking.start_time);

  const prefix = type === '24h'
    ? `\u{1F4C5} Напоминаем: завтра запись в Своё Фото`
    : `\u23F0 Через 1 час \u2014 запись в Своё Фото`;

  // Telegram
  try {
    const chatId = await findTelegramChatId(booking.client_phone);
    if (chatId) {
      const text = `${prefix}\n\n\u23F0 ${timeStr}\n\u{1F3E0} ${studioName}${booking.service_name ? `\n\u{1F4CB} ${booking.service_name}` : ''}\n\nАдрес: ${STUDIO_ADDRESS}\nТел: ${STUDIO_PHONE}`;
      await deliverReply('telegram', chatId, text);
    }
  } catch (err) {
    logger.warn(`[BookingNotify] Telegram ${type} reminder failed:`, { error: String(err) });
  }

  // Email
  if (booking.client_email) {
    try {
      const transport = getTransporter();
      if (transport) {
        const subject = type === '24h'
          ? `\u{1F4C5} Напоминание: запись завтра в ${timeStr}`
          : `\u23F0 Запись через 1 час \u2014 ${timeStr}`;
        await transport.sendMail({
          from: config.smtp.from,
          to: booking.client_email,
          subject,
          html: buildBookingReminderHtml({
            date: dateStr,
            time: timeStr,
            studioName,
            clientName: booking.client_name,
            serviceName: booking.service_name,
          }, type),
        });
      }
    } catch (err) {
      logger.warn(`[BookingNotify] Email ${type} reminder failed:`, { error: String(err) });
    }
  }

  // Обновить поле reminder
  const field = type === '24h' ? 'reminder_24h_sent_at' : 'reminder_1h_sent_at';
  await db.query(
    `UPDATE bookings SET ${field} = NOW() WHERE id = $1`,
    [booking.id],
  );

  logger.info(`[BookingNotify] ${type} reminder sent for booking ${booking.id}`);
}
