import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer/index.js';
import { config } from '../config/index.js';
import { withServiceCall, SERVICE_BREAKERS } from '../utils/circuit-breaker.js';

import { createLogger } from '../utils/logger.js';
let transporter: Transporter | null = null;

const logger = createLogger('email.service');
export function getTransporter(): Transporter | null {
  if (!config.smtp.user || !config.smtp.password) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.password,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

/**
 * Send email with circuit breaker protection.
 * Prevents cascading failures when SMTP server is down.
 */
export async function sendMailWithCB(mailOptions: Mail.Options): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    logger.warn('[Email] SMTP not configured, skipping email');
    return;
  }

  await withServiceCall(SERVICE_BREAKERS.smtp, async () => {
    await transport.sendMail(mailOptions);
  });
}

export interface OrderEmailData {
  order_id: string;
  contact_name?: string | null;
  total_price: number;
  items: { service?: string; tariff?: string; document?: string; price?: number }[];
  promo_code?: string | null;
  promo_discount?: number | null;
  delivery_cost?: number | null;
  delivery_address?: string | null;
  receipt_url?: string | null;
  created_at: string;
}

function formatPrice(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n));
}

function formatDate(d: string): string {
  return new Date(d).toLocaleString('ru-RU', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

// ─── Shared styles ───────────────────────────────────────────────

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

const STUDIO_ADDRESS = 'Переулок Соборный 21, Ростов-на-Дону';
const STUDIO_HOURS = 'Пн\u2013Вс 09:00\u201319:30';
const STUDIO_PHONE = '+7 (901) 417-86-68';
const STUDIO_PHONE_RAW = '+79014178668';
const YANDEX_MAPS_URL = 'https://yandex.ru/maps/-/CDxYrH5d';
const MAX_BOT_URL = 'https://max.ru/id262603741214_bot';
const APP_DOWNLOAD_URL = 'https://svoefoto.ru/app/svoefoto.apk';

function emailWrapper(preheader: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>Своё Фото</title>
  <!--[if mso]>
  <style>table,td{font-family:Arial,sans-serif!important}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT_STACK};-webkit-text-size-adjust:100%">
  <!-- Preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">
    ${preheader}
    ${'&zwnj;&nbsp;'.repeat(30)}
  </div>

  <div style="max-width:600px;margin:0 auto;padding:20px 12px">
    <!-- Logo header -->
    <div style="text-align:center;padding:20px 0 16px">
      <div style="display:inline-block;background:${BRAND_COLOR};color:#fff;padding:10px 24px;border-radius:8px;font-size:20px;font-weight:700;letter-spacing:0.5px">
        ${'\u{1F4F7}'} &#1057;&#1074;&#1086;&#1105; &#1060;&#1086;&#1090;&#1086;
      </div>
    </div>

    ${content}

    <!-- Contact block -->
    <div style="background:#fff;border-radius:12px;padding:20px;margin-top:12px;text-align:center;border:1px solid ${BORDER}">
      <p style="margin:0 0 14px;font-size:14px;color:${TEXT_SECONDARY}">&#1053;&#1072;&#1087;&#1080;&#1096;&#1080;&#1090;&#1077; &#1085;&#1072;&#1084; &#1074; &#1083;&#1102;&#1073;&#1086;&#1081; &#1084;&#1077;&#1089;&#1089;&#1077;&#1085;&#1076;&#1078;&#1077;&#1088;</p>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:4px;width:25%">
            <a href="https://wa.me/${STUDIO_PHONE_RAW}" style="display:block;padding:10px 4px;background:${SUCCESS_LIGHT};color:${SUCCESS_COLOR};text-decoration:none;border-radius:8px;font-size:12px;font-weight:600">
              WhatsApp
            </a>
          </td>
          <td style="padding:4px;width:25%">
            <a href="https://t.me/magnus_photo" style="display:block;padding:10px 4px;background:${BRAND_LIGHT};color:${BRAND_COLOR};text-decoration:none;border-radius:8px;font-size:12px;font-weight:600">
              Telegram
            </a>
          </td>
          <td style="padding:4px;width:25%">
            <a href="${MAX_BOT_URL}" style="display:block;padding:10px 4px;background:#e8eaf6;color:#3949ab;text-decoration:none;border-radius:8px;font-size:12px;font-weight:600">
              Max
            </a>
          </td>
          <td style="padding:4px;width:25%">
            <a href="tel:${STUDIO_PHONE_RAW}" style="display:block;padding:10px 4px;background:#f5f5f5;color:${TEXT_SECONDARY};text-decoration:none;border-radius:8px;font-size:12px;font-weight:600">
              &#1047;&#1074;&#1086;&#1085;&#1086;&#1082;
            </a>
          </td>
        </tr>
      </table>
    </div>

    <!-- App download -->
    <div style="background:#fff;border-radius:12px;padding:16px 20px;margin-top:12px;border:1px solid ${BORDER}">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="vertical-align:middle">
            <p style="margin:0;font-size:14px;font-weight:600;color:${TEXT_PRIMARY}">&#1053;&#1072;&#1096;&#1077; &#1087;&#1088;&#1080;&#1083;&#1086;&#1078;&#1077;&#1085;&#1080;&#1077;</p>
            <p style="margin:4px 0 0;font-size:12px;color:${TEXT_MUTED}">&#1047;&#1072;&#1082;&#1072;&#1079;&#1099;, &#1079;&#1072;&#1087;&#1080;&#1089;&#1100;, &#1089;&#1082;&#1080;&#1076;&#1082;&#1080;</p>
          </td>
          <td style="vertical-align:middle;text-align:right">
            <a href="${APP_DOWNLOAD_URL}" style="display:inline-block;padding:8px 20px;background:${TEXT_PRIMARY};color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600">
              &#1057;&#1082;&#1072;&#1095;&#1072;&#1090;&#1100;
            </a>
          </td>
        </tr>
      </table>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px 0 8px;color:${TEXT_MUTED};font-size:11px">
      <p style="margin:0 0 4px">
        <a href="https://svoefoto.ru" style="color:${TEXT_MUTED};text-decoration:none">svoefoto.ru</a>
      </p>
      <p style="margin:0">${STUDIO_ADDRESS}</p>
      <p style="margin:4px 0 0">${STUDIO_HOURS}</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Order Confirmation ──────────────────────────────────────────

function buildOrderEmailHtml(order: OrderEmailData): string {
  const items = Array.isArray(order.items) ? order.items : [];
  const greeting = order.contact_name
    ? `${order.contact_name.split(' ')[0]}, &#1089;&#1087;&#1072;&#1089;&#1080;&#1073;&#1086; &#1079;&#1072; &#1079;&#1072;&#1082;&#1072;&#1079;!`
    : '&#1057;&#1087;&#1072;&#1089;&#1080;&#1073;&#1086; &#1079;&#1072; &#1079;&#1072;&#1082;&#1072;&#1079;!';

  // Items table
  const itemsHtml = items.map((item, i) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:${TEXT_PRIMARY}">
        <span style="color:${TEXT_MUTED};font-size:12px">${i + 1}.</span>&nbsp;
        ${item.service || item.tariff || 'Услуга'}${item.document ? `<br><span style="color:${TEXT_MUTED};font-size:12px;padding-left:18px">${item.document}</span>` : ''}
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:right;white-space:nowrap;color:${TEXT_PRIMARY};vertical-align:top">
        ${item.price ? `${formatPrice(item.price)}&nbsp;\u20BD` : ''}
      </td>
    </tr>
  `).join('');

  // Pricing rows
  const promoDiscount = Number(order.promo_discount) || 0;
  const deliveryCost = Number(order.delivery_cost) || 0;

  let pricingHtml = '';
  if (promoDiscount > 0) {
    const subtotal = Number(order.total_price) + promoDiscount;
    pricingHtml += `
      <tr>
        <td style="padding:6px 0;font-size:14px;color:${TEXT_SECONDARY}">&#1057;&#1091;&#1084;&#1084;&#1072;:</td>
        <td style="padding:6px 0;font-size:14px;text-align:right;color:${TEXT_SECONDARY}">${formatPrice(subtotal)}&nbsp;\u20BD</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;color:${SUCCESS_COLOR}">&#1057;&#1082;&#1080;&#1076;&#1082;&#1072;${order.promo_code ? ` (${order.promo_code})` : ''}:</td>
        <td style="padding:6px 0;font-size:14px;text-align:right;color:${SUCCESS_COLOR}">&minus;${formatPrice(promoDiscount)}&nbsp;\u20BD</td>
      </tr>
    `;
  }
  if (deliveryCost > 0) {
    pricingHtml += `
      <tr>
        <td style="padding:6px 0;font-size:14px;color:${TEXT_SECONDARY}">&#1044;&#1086;&#1089;&#1090;&#1072;&#1074;&#1082;&#1072;:</td>
        <td style="padding:6px 0;font-size:14px;text-align:right;color:${TEXT_SECONDARY}">${formatPrice(deliveryCost)}&nbsp;\u20BD</td>
      </tr>
    `;
  }

  // Delivery or pickup section
  let pickupOrDeliveryHtml = '';
  if (order.delivery_address) {
    pickupOrDeliveryHtml = `
      <div style="background:#fff8e1;border-radius:8px;padding:14px 16px;margin-top:16px;border-left:4px solid #ff9800">
        <p style="margin:0;font-size:13px;font-weight:600;color:#e65100">\u{1F4E6} &#1044;&#1086;&#1089;&#1090;&#1072;&#1074;&#1082;&#1072;</p>
        <p style="margin:4px 0 0;font-size:13px;color:${TEXT_SECONDARY}">${order.delivery_address}</p>
        <p style="margin:4px 0 0;font-size:12px;color:${TEXT_MUTED}">&#1058;&#1088;&#1077;&#1082;-&#1085;&#1086;&#1084;&#1077;&#1088; &#1073;&#1091;&#1076;&#1077;&#1090; &#1086;&#1090;&#1087;&#1088;&#1072;&#1074;&#1083;&#1077;&#1085; &#1086;&#1090;&#1076;&#1077;&#1083;&#1100;&#1085;&#1099;&#1084; &#1087;&#1080;&#1089;&#1100;&#1084;&#1086;&#1084;</p>
      </div>
    `;
  } else {
    pickupOrDeliveryHtml = `
      <div style="background:${BRAND_LIGHT};border-radius:8px;padding:14px 16px;margin-top:16px;border-left:4px solid ${BRAND_COLOR}">
        <p style="margin:0;font-size:13px;font-weight:600;color:${BRAND_COLOR}">\u{1F3E0} &#1057;&#1072;&#1084;&#1086;&#1074;&#1099;&#1074;&#1086;&#1079;</p>
        <p style="margin:4px 0 0;font-size:13px;color:${TEXT_SECONDARY}">${STUDIO_ADDRESS}</p>
        <p style="margin:4px 0 0;font-size:12px;color:${TEXT_MUTED}">${STUDIO_HOURS}</p>
        <a href="${YANDEX_MAPS_URL}" style="display:inline-block;margin-top:8px;font-size:12px;color:${BRAND_COLOR};text-decoration:none">
          &#1054;&#1090;&#1082;&#1088;&#1099;&#1090;&#1100; &#1085;&#1072; &#1082;&#1072;&#1088;&#1090;&#1077; &rarr;
        </a>
      </div>
    `;
  }

  // Next steps
  const stepsHtml = `
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #f0f0f0">
      <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:${TEXT_PRIMARY}">&#1063;&#1090;&#1086; &#1076;&#1072;&#1083;&#1100;&#1096;&#1077;?</p>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:6px 12px 6px 0;vertical-align:top;width:24px">
            <div style="width:22px;height:22px;border-radius:50%;background:${SUCCESS_COLOR};color:#fff;text-align:center;line-height:22px;font-size:12px;font-weight:700">&#10003;</div>
          </td>
          <td style="padding:6px 0;font-size:13px;color:${TEXT_PRIMARY}">&#1054;&#1087;&#1083;&#1072;&#1090;&#1072; &#1087;&#1086;&#1083;&#1091;&#1095;&#1077;&#1085;&#1072;</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;vertical-align:top">
            <div style="width:22px;height:22px;border-radius:50%;background:${BRAND_COLOR};color:#fff;text-align:center;line-height:22px;font-size:12px;font-weight:700">2</div>
          </td>
          <td style="padding:6px 0;font-size:13px;color:${TEXT_PRIMARY}">&#1052;&#1099; &#1075;&#1086;&#1090;&#1086;&#1074;&#1080;&#1084; &#1074;&#1072;&#1096; &#1079;&#1072;&#1082;&#1072;&#1079;</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;vertical-align:top">
            <div style="width:22px;height:22px;border-radius:50%;background:${BORDER};color:${TEXT_MUTED};text-align:center;line-height:22px;font-size:12px;font-weight:700">3</div>
          </td>
          <td style="padding:6px 0;font-size:13px;color:${TEXT_MUTED}">${order.delivery_address ? '&#1054;&#1090;&#1087;&#1088;&#1072;&#1074;&#1083;&#1103;&#1077;&#1084; &#1087;&#1086;&#1095;&#1090;&#1086;&#1081;' : '&#1059;&#1074;&#1077;&#1076;&#1086;&#1084;&#1080;&#1084; &#1086; &#1075;&#1086;&#1090;&#1086;&#1074;&#1085;&#1086;&#1089;&#1090;&#1080;'}</td>
        </tr>
      </table>
    </div>
  `;

  const content = `
    <!-- Main card -->
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER}">
      <!-- Success banner -->
      <div style="background:${SUCCESS_LIGHT};padding:20px;text-align:center;border-bottom:1px solid #c8e6c9">
        <div style="font-size:36px;line-height:1">\u2705</div>
        <h2 style="margin:8px 0 0;font-size:20px;color:${SUCCESS_COLOR}">${greeting}</h2>
        <p style="margin:6px 0 0;font-size:13px;color:${TEXT_SECONDARY}">
          &#1047;&#1072;&#1082;&#1072;&#1079; <strong>${order.order_id}</strong> &middot; ${formatDate(order.created_at)}
        </p>
      </div>

      <div style="padding:20px 24px">
        <!-- Items -->
        ${items.length > 0 ? `
        <table style="width:100%;border-collapse:collapse">
          ${itemsHtml}
        </table>` : ''}

        <!-- Total -->
        <table style="width:100%;border-collapse:collapse;margin-top:8px;border-top:2px solid ${BORDER}">
          ${pricingHtml}
          <tr>
            <td style="padding:12px 0 0;font-size:20px;font-weight:700;color:${TEXT_PRIMARY}">&#1048;&#1090;&#1086;&#1075;&#1086;:</td>
            <td style="padding:12px 0 0;font-size:20px;font-weight:700;text-align:right;color:${TEXT_PRIMARY}">${formatPrice(Number(order.total_price))}&nbsp;\u20BD</td>
          </tr>
        </table>

        ${pickupOrDeliveryHtml}
        ${stepsHtml}

        <!-- CTA buttons -->
        <div style="text-align:center;margin-top:24px">
          <a href="https://svoefoto.ru/track/${order.order_id}"
             style="display:inline-block;padding:14px 40px;background:${BRAND_COLOR};color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;min-width:200px">
            &#1054;&#1090;&#1089;&#1083;&#1077;&#1078;&#1080;&#1074;&#1072;&#1090;&#1100; &#1079;&#1072;&#1082;&#1072;&#1079;
          </a>
        </div>
        ${order.receipt_url ? `
        <div style="text-align:center;margin-top:12px">
          <a href="${order.receipt_url}"
             style="font-size:13px;color:${BRAND_COLOR};text-decoration:none">
            &#1057;&#1082;&#1072;&#1095;&#1072;&#1090;&#1100; &#1095;&#1077;&#1082; &darr;
          </a>
        </div>` : ''}
      </div>
    </div>
  `;

  const preheader = order.contact_name
    ? `${order.contact_name.split(' ')[0]}, ваш заказ ${order.order_id} оплачен \u2014 ${formatPrice(Number(order.total_price))} \u20BD`
    : `Заказ ${order.order_id} оплачен \u2014 ${formatPrice(Number(order.total_price))} \u20BD`;

  return emailWrapper(preheader, content);
}

// ─── Status Update ───────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: string; color: string; bgColor: string; message: string }> = {
  processing:  { icon: '\u2699\uFE0F',  color: '#1565c0', bgColor: '#e3f2fd', message: 'Ваш заказ принят в работу' },
  ready:       { icon: '\u2705',         color: '#2e7d32', bgColor: '#e8f5e9', message: 'Заказ готов! Можете забирать' },
  shipped:     { icon: '\u{1F4E6}',      color: '#e65100', bgColor: '#fff3e0', message: 'Заказ передан в доставку' },
  delivered:   { icon: '\u{1F389}',      color: '#2e7d32', bgColor: '#e8f5e9', message: 'Заказ доставлен' },
  completed:   { icon: '\u2B50',         color: '#f9a825', bgColor: '#fffde7', message: 'Заказ выполнен. Спасибо!' },
  cancelled:   { icon: '\u274C',         color: '#c62828', bgColor: '#ffebee', message: 'Заказ отменён' },
};

function buildStatusSteps(currentStatus: string): string {
  const steps = [
    { key: 'paid',       label: 'Оплачен' },
    { key: 'processing', label: 'В работе' },
    { key: 'ready',      label: 'Готов' },
  ];
  const statusOrder = ['paid', 'processing', 'ready', 'shipped', 'delivered', 'completed'];
  const currentIdx = statusOrder.indexOf(currentStatus);

  return steps.map((step, i) => {
    const stepIdx = statusOrder.indexOf(step.key);
    const isDone = stepIdx <= currentIdx;
    const isCurrent = step.key === currentStatus || (currentStatus === 'shipped' && step.key === 'ready') || (currentStatus === 'delivered' && step.key === 'ready') || (currentStatus === 'completed' && step.key === 'ready');
    const dotBg = isDone ? SUCCESS_COLOR : BORDER;
    const dotColor = isDone ? '#fff' : TEXT_MUTED;
    const textColor = isDone ? TEXT_PRIMARY : TEXT_MUTED;
    const connector = i < steps.length - 1
      ? `<td style="padding:0;height:2px;width:100%"><div style="height:2px;background:${isDone && stepIdx < currentIdx ? SUCCESS_COLOR : BORDER}"></div></td>`
      : '';

    return `
      <td style="padding:0;text-align:center;width:60px">
        <div style="width:28px;height:28px;border-radius:50%;background:${dotBg};color:${dotColor};text-align:center;line-height:28px;font-size:13px;font-weight:700;margin:0 auto">${isDone ? '&#10003;' : i + 1}</div>
        <div style="font-size:11px;color:${textColor};margin-top:4px">${step.label}</div>
      </td>
      ${connector}
    `;
  }).join('');
}

function buildStatusEmailHtml(orderId: string, status: string, statusLabel: string): string {
  const cfg = STATUS_CONFIG[status] || { icon: '\u{1F4CB}', color: BRAND_COLOR, bgColor: BRAND_LIGHT, message: statusLabel };

  const content = `
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER}">
      <!-- Status banner -->
      <div style="background:${cfg.bgColor};padding:24px 20px;text-align:center;border-bottom:1px solid ${BORDER}">
        <div style="font-size:40px;line-height:1">${cfg.icon}</div>
        <h2 style="margin:8px 0 0;font-size:18px;color:${cfg.color}">${cfg.message}</h2>
        <p style="margin:8px 0 0;font-size:14px;color:${TEXT_SECONDARY}">&#1047;&#1072;&#1082;&#1072;&#1079; <strong>${orderId}</strong></p>
      </div>

      <div style="padding:24px">
        <!-- Progress steps -->
        ${status !== 'cancelled' ? `
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr>${buildStatusSteps(status)}</tr>
        </table>` : ''}

        ${status === 'ready' ? `
        <div style="background:${BRAND_LIGHT};border-radius:8px;padding:14px 16px;margin-bottom:16px;border-left:4px solid ${BRAND_COLOR}">
          <p style="margin:0;font-size:13px;font-weight:600;color:${BRAND_COLOR}">\u{1F3E0} &#1047;&#1072;&#1073;&#1077;&#1088;&#1080;&#1090;&#1077; &#1074; &#1089;&#1090;&#1091;&#1076;&#1080;&#1080;</p>
          <p style="margin:4px 0 0;font-size:13px;color:${TEXT_SECONDARY}">${STUDIO_ADDRESS}</p>
          <p style="margin:4px 0 0;font-size:12px;color:${TEXT_MUTED}">${STUDIO_HOURS}</p>
          <a href="${YANDEX_MAPS_URL}" style="display:inline-block;margin-top:8px;font-size:12px;color:${BRAND_COLOR};text-decoration:none">
            &#1054;&#1090;&#1082;&#1088;&#1099;&#1090;&#1100; &#1085;&#1072; &#1082;&#1072;&#1088;&#1090;&#1077; &rarr;
          </a>
        </div>` : ''}

        <!-- CTA -->
        <div style="text-align:center">
          <a href="https://svoefoto.ru/track/${orderId}"
             style="display:inline-block;padding:14px 40px;background:${BRAND_COLOR};color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">
            &#1055;&#1086;&#1076;&#1088;&#1086;&#1073;&#1085;&#1077;&#1077;
          </a>
        </div>
      </div>
    </div>
  `;

  return emailWrapper(`Заказ ${orderId}: ${statusLabel}`, content);
}

// ─── Payment Reminder ───────────────────────────────────────────

interface PaymentReminderData {
  order_id: string;
  contact_name?: string | null;
  total_price: number;
  payment_url?: string | null;
  isFinal?: boolean;
  volumeHint?: string | null;
}

function buildPaymentReminderHtml(data: PaymentReminderData): string {
  const greeting = data.contact_name
    ? `${data.contact_name.split(' ')[0]}, ваш заказ ждёт оплаты`
    : 'Ваш заказ ждёт оплаты';

  const urgencyColor = data.isFinal ? '#c62828' : '#e65100';
  const urgencyBg = data.isFinal ? '#ffebee' : '#fff3e0';
  const urgencyIcon = data.isFinal ? '\u23F0' : '\u{1F6D2}';
  const urgencyText = data.isFinal
    ? 'Заказ будет автоматически отменён через 2 часа'
    : 'Ссылка на оплату действует ещё 22 часа';

  const ctaHtml = data.payment_url ? `
    <div style="text-align:center;margin-top:24px">
      <a href="${data.payment_url}"
         style="display:inline-block;padding:14px 40px;background:${data.isFinal ? '#c62828' : SUCCESS_COLOR};color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;min-width:200px">
        \u{1F4B3} &#1054;&#1087;&#1083;&#1072;&#1090;&#1080;&#1090;&#1100; ${formatPrice(data.total_price)}&nbsp;\u20BD
      </a>
    </div>
  ` : '';

  const content = `
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER}">
      <div style="background:${urgencyBg};padding:20px;text-align:center;border-bottom:1px solid ${BORDER}">
        <div style="font-size:36px;line-height:1">${urgencyIcon}</div>
        <h2 style="margin:8px 0 0;font-size:20px;color:${urgencyColor}">${greeting}</h2>
        <p style="margin:6px 0 0;font-size:13px;color:${TEXT_SECONDARY}">
          &#1047;&#1072;&#1082;&#1072;&#1079; <strong>${data.order_id}</strong> &middot; ${formatPrice(data.total_price)}&nbsp;\u20BD
        </p>
      </div>

      <div style="padding:20px 24px">
        <p style="margin:0 0 16px;font-size:14px;color:${TEXT_SECONDARY};text-align:center">
          ${urgencyText}
        </p>
        ${ctaHtml}
        ${data.volumeHint ? `
        <div style="margin-top:16px;padding:12px 16px;background:#e8f5e9;border-radius:8px;text-align:center">
          <p style="margin:0;font-size:13px;color:#2e7d32;font-weight:500">${data.volumeHint}</p>
        </div>` : ''}
      </div>
    </div>
  `;

  const preheader = data.isFinal
    ? `Последнее напоминание: заказ ${data.order_id} на ${formatPrice(data.total_price)} \u20BD`
    : `Не забудьте оплатить заказ ${data.order_id} на ${formatPrice(data.total_price)} \u20BD`;

  return emailWrapper(preheader, content);
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Отправить email-подтверждение оплаты заказа.
 */
export async function sendOrderConfirmation(email: string, order: OrderEmailData): Promise<void> {
  await sendMailWithCB({
    from: config.smtp.from,
    to: email,
    subject: `\u2705 Заказ ${order.order_id} оплачен \u2014 Своё Фото`,
    html: buildOrderEmailHtml(order),
  });

  logger.info(`[Email] Order confirmation sent to ${email} for ${order.order_id}`);
}

/**
 * Отправить email о смене статуса заказа.
 */
export async function sendOrderStatusUpdate(
  email: string,
  orderId: string,
  status: string,
  statusLabel: string,
): Promise<void> {
  const cfg = STATUS_CONFIG[status];
  const subjectIcon = cfg?.icon || '\u{1F4CB}';

  await sendMailWithCB({
    from: config.smtp.from,
    to: email,
    subject: `${subjectIcon} ${statusLabel} \u2014 заказ ${orderId}`,
    html: buildStatusEmailHtml(orderId, status, statusLabel),
  });

  logger.info(`[Email] Status update sent to ${email}: ${orderId} \u2192 ${status}`);
}

/**
 * Отправить напоминание об оплате.
 */
export async function sendPaymentReminder(email: string, data: PaymentReminderData): Promise<void> {
  const subject = data.isFinal
    ? `\u23F0 Последнее напоминание: заказ ${data.order_id} \u2014 Своё Фото`
    : `\u{1F6D2} Не забудьте оплатить заказ ${data.order_id} \u2014 Своё Фото`;

  await sendMailWithCB({
    from: config.smtp.from,
    to: email,
    subject,
    html: buildPaymentReminderHtml(data),
  });

  logger.info(`[Email] Payment reminder sent to ${email} for ${data.order_id} (final: ${!!data.isFinal})`);
}

// ─── Review Request ─────────────────────────────────────────────

export interface ReviewRequestEmailData {
  clientName?: string | null;
  reviewToken: string;
  locationSlug?: string | null;
}

function buildReviewRequestHtml(data: ReviewRequestEmailData): string {
  const baseUrl = 'https://svoefoto.ru';
  const name = data.clientName ? data.clientName.split(' ')[0] : '';
  const greeting = name ? `${name}, спасибо за визит!` : 'Спасибо за визит!';

  const makeBtn = (platform: string, label: string, icon: string, color: string, bgColor: string) => {
    const url = `${baseUrl}/api/reviews/go?t=${data.reviewToken}&p=${platform}`;
    return `
      <td style="padding:6px;width:33.33%">
        <a href="${url}" style="display:block;padding:16px 8px;background:${bgColor};color:${color};text-decoration:none;border-radius:12px;text-align:center">
          <div style="font-size:28px;line-height:1;margin-bottom:6px">${icon}</div>
          <div style="font-size:13px;font-weight:600">${label}</div>
        </a>
      </td>
    `;
  };

  const content = `
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER}">
      <!-- Review banner -->
      <div style="background:#fffde7;padding:24px 20px;text-align:center;border-bottom:1px solid ${BORDER}">
        <div style="font-size:40px;line-height:1">\u2B50</div>
        <h2 style="margin:8px 0 0;font-size:20px;color:#f9a825">${greeting}</h2>
        <p style="margin:8px 0 0;font-size:14px;color:${TEXT_SECONDARY}">
          Нам важно ваше мнение о нашей работе
        </p>
      </div>

      <div style="padding:24px 20px">
        <p style="margin:0 0 16px;font-size:14px;color:${TEXT_PRIMARY};text-align:center">
          Оставьте отзыв на любой удобной площадке \u2014 это займёт пару минут:
        </p>

        <!-- Platform buttons -->
        <table style="width:100%;border-collapse:collapse">
          <tr>
            ${makeBtn('google', 'Google', '\u{1F310}', '#1a73e8', '#e8f0fe')}
            ${makeBtn('2gis', '2\u0413\u0418\u0421', '\u{1F4CD}', '#2e7d32', '#e8f5e9')}
            ${makeBtn('yandex', '\u042F\u043D\u0434\u0435\u043A\u0441', '\u{1F4F1}', '#c62828', '#ffebee')}
          </tr>
        </table>

        <p style="margin:20px 0 0;font-size:13px;color:${TEXT_MUTED};text-align:center">
          Ваш отзыв помогает нам становиться лучше
          и помогает другим клиентам сделать выбор
        </p>
      </div>
    </div>
  `;

  return emailWrapper('Оставьте отзыв о визите в Своё Фото', content);
}

/**
 * Отправить email с просьбой оставить отзыв.
 */
export async function sendReviewRequestEmail(email: string, data: ReviewRequestEmailData): Promise<void> {
  await sendMailWithCB({
    from: config.smtp.from,
    to: email,
    subject: '\u2B50 \u041E\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u043E\u0442\u0437\u044B\u0432 \u2014 \u0421\u0432\u043E\u0451 \u0424\u043E\u0442\u043E',
    html: buildReviewRequestHtml(data),
  });

  logger.info(`[Email] Review request sent to ${email}`);
}

// ─── Password Reset ───────────────────────────────────────────────

function buildPasswordResetHtml(displayName: string, resetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Сброс пароля — Своё Фото</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr>
        <td style="background:${BRAND_COLOR};padding:28px 32px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Своё Фото</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;">svoefoto.ru</div>
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td style="padding:36px 32px;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;background:${BRAND_LIGHT};border-radius:50%;width:64px;height:64px;line-height:64px;font-size:28px;">🔐</div>
          </div>
          <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_PRIMARY};text-align:center;">Сброс пароля</h2>
          <p style="margin:0 0 8px;font-size:15px;color:${TEXT_SECONDARY};text-align:center;">
            Здравствуйте${displayName ? ', ' + displayName : ''}!
          </p>
          <p style="margin:0 0 28px;font-size:15px;color:${TEXT_SECONDARY};text-align:center;line-height:1.5;">
            Мы получили запрос на сброс пароля для вашего аккаунта.<br>
            Ссылка действительна <strong>1 час</strong>.
          </p>
          <!-- CTA Button -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding-bottom:28px;">
                <a href="${resetUrl}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                  Сбросить пароль
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:${TEXT_MUTED};text-align:center;line-height:1.5;">
            Если кнопка не работает, скопируйте ссылку:
          </p>
          <p style="margin:0;font-size:12px;color:${BRAND_COLOR};text-align:center;word-break:break-all;">
            <a href="${resetUrl}" style="color:${BRAND_COLOR};">${resetUrl}</a>
          </p>
          <div style="margin-top:28px;padding:16px;background:#fff3e0;border-radius:8px;border-left:3px solid #ff9800;">
            <p style="margin:0;font-size:13px;color:#e65100;line-height:1.5;">
              Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.
              Ваш пароль останется неизменным.
            </p>
          </div>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#fafafa;border-top:1px solid ${BORDER};padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:${TEXT_MUTED};">
            📍 Переулок Соборный 21, Ростов-на-Дону &nbsp;|&nbsp; Пн–Вс 09:00–19:30<br>
            +7 (901) 417-86-68 &nbsp;|&nbsp; <a href="https://svoefoto.ru" style="color:${BRAND_COLOR};text-decoration:none;">svoefoto.ru</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export async function sendPasswordResetEmail(
  email: string,
  displayName: string | null,
  resetUrl: string,
): Promise<void> {
  if (!getTransporter()) {
    logger.warn('[Email] SMTP not configured, skipping password reset email');
    logger.warn(`[Email] Reset URL for ${email}: ${resetUrl}`);
    return;
  }

  await sendMailWithCB({
    from: config.smtp.from,
    to: email,
    subject: 'Сброс пароля — Своё Фото',
    html: buildPasswordResetHtml(displayName || '', resetUrl),
  });

  logger.info(`[Email] Password reset email sent to ${email}`);
}

// ─── Email Verification ───────────────────────────────────────────────

function buildEmailVerificationHtml(displayName: string, verificationUrl: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Подтверждение email — Своё Фото</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr>
        <td style="background:${BRAND_COLOR};padding:28px 32px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Своё Фото</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;">svoefoto.ru</div>
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td style="padding:36px 32px;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;background:${BRAND_LIGHT};border-radius:50%;width:64px;height:64px;line-height:64px;font-size:28px;">✉️</div>
          </div>
          <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_PRIMARY};text-align:center;">Подтвердите ваш email</h2>
          <p style="margin:0 0 8px;font-size:15px;color:${TEXT_SECONDARY};text-align:center;">
            Здравствуйте${displayName ? ', ' + displayName : ''}!
          </p>
          <p style="margin:0 0 28px;font-size:15px;color:${TEXT_SECONDARY};text-align:center;line-height:1.5;">
            Для завершения регистрации в «Своём Фото»<br>
            перейдите по ссылке ниже. Ссылка действительна <strong>24 часа</strong>.
          </p>
          <!-- CTA Button -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding-bottom:28px;">
                <a href="${verificationUrl}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                  Подтвердить email
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:${TEXT_MUTED};text-align:center;line-height:1.5;">
            Если кнопка не работает, скопируйте ссылку:
          </p>
          <p style="margin:0;font-size:12px;color:${BRAND_COLOR};text-align:center;word-break:break-all;">
            <a href="${verificationUrl}" style="color:${BRAND_COLOR};">${verificationUrl}</a>
          </p>
          <div style="margin-top:28px;padding:16px;background:#fff3e0;border-radius:8px;border-left:3px solid #ff9800;">
            <p style="margin:0;font-size:13px;color:#e65100;line-height:1.5;">
              Если вы не регистрировались в «Своём Фото» — просто проигнорируйте это письмо.
            </p>
          </div>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#fafafa;border-top:1px solid ${BORDER};padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:${TEXT_MUTED};">
            📍 Переулок Соборный 21, Ростов-на-Дону &nbsp;|&nbsp; Пн–Вс 09:00–19:30<br>
            +7 (901) 417-86-68 &nbsp;|&nbsp; <a href="https://svoefoto.ru" style="color:${BRAND_COLOR};text-decoration:none;">svoefoto.ru</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export async function sendEmailVerificationEmail(
  email: string,
  displayName: string | null,
  verificationUrl: string,
): Promise<void> {
  if (!getTransporter()) {
    logger.warn('[Email] SMTP not configured, skipping verification email');
    logger.warn(`[Email] Verification URL for ${email}: ${verificationUrl}`);
    return;
  }

  await sendMailWithCB({
    from: config.smtp.from,
    to: email,
    subject: 'Подтвердите email — Своё Фото',
    html: buildEmailVerificationHtml(displayName || '', verificationUrl),
  });

  logger.info(`[Email] Verification email sent to ${email}`);
}

// ─── Gift activation: one-time 4-digit code ───────────────────────

function buildGiftActivationCodeHtml(code: string, ttlMinutes: number): string {
  // Разбиваем код по цифрам для крупного «OTP»-отображения.
  const digits = code
    .split('')
    .map(
      (d) =>
        `<span style="display:inline-block;min-width:44px;margin:0 4px;padding:14px 0;background:${BRAND_LIGHT};border-radius:10px;font-size:30px;font-weight:700;color:${BRAND_COLOR};letter-spacing:2px;">${d}</span>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Код подтверждения — Своё Фото</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr>
        <td style="background:${BRAND_COLOR};padding:28px 32px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Своё Фото</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;">svoefoto.ru</div>
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td style="padding:36px 32px;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;background:${BRAND_LIGHT};border-radius:50%;width:64px;height:64px;line-height:64px;font-size:28px;">🎁</div>
          </div>
          <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_PRIMARY};text-align:center;">Код активации подарка</h2>
          <p style="margin:0 0 24px;font-size:15px;color:${TEXT_SECONDARY};text-align:center;line-height:1.5;">
            Введите этот код на странице активации подписки.<br>
            Код действителен <strong>${ttlMinutes} минут</strong>.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            ${digits}
          </div>
          <div style="padding:16px;background:#fff3e0;border-radius:8px;border-left:3px solid #ff9800;">
            <p style="margin:0;font-size:13px;color:#e65100;line-height:1.5;">
              Никому не сообщайте этот код. Если вы не активировали подарок — просто проигнорируйте это письмо.
            </p>
          </div>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#fafafa;border-top:1px solid ${BORDER};padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:${TEXT_MUTED};">
            📍 Переулок Соборный 21, Ростов-на-Дону &nbsp;|&nbsp; Пн–Вс 09:00–19:30<br>
            +7 (901) 417-86-68 &nbsp;|&nbsp; <a href="https://svoefoto.ru" style="color:${BRAND_COLOR};text-decoration:none;">svoefoto.ru</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/**
 * Sends a one-time 4-digit gift-activation code by email.
 * Returns true if the message was handed to SMTP, false if SMTP is
 * not configured (caller decides whether that is a hard failure).
 */
export async function sendGiftActivationCodeEmail(
  email: string,
  code: string,
  ttlMinutes: number,
): Promise<boolean> {
  if (!getTransporter()) {
    logger.warn('[Email] SMTP not configured, skipping gift activation code email');
    return false;
  }

  await sendMailWithCB({
    from: config.smtp.from,
    to: email,
    subject: 'Код активации подарка — Своё Фото',
    html: buildGiftActivationCodeHtml(code, ttlMinutes),
  });

  logger.info(`[Email] Gift activation code sent to ${email}`);
  return true;
}

// ─── Security: Login Alert ────────────────────────────────────────

export async function sendLoginAlertEmail(
  email: string,
  displayName: string | null,
  ip: string,
  userAgent: string,
  loginTime: Date,
): Promise<void> {
  if (!getTransporter()) return;

  const formattedTime = loginTime.toLocaleString('ru-RU', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });

  const frontendUrl = (config.cors.origin || 'https://svoefoto.ru').split(',')[0];
  const resetUrl = `${frontendUrl}/auth/forgot-password`;
  const safeUa = (userAgent || '').replace(/</g, '&lt;').substring(0, 120);

  const html = emailWrapper(
    'Новый вход в аккаунт',
    `<div style="padding:36px 32px;">
      <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_PRIMARY};text-align:center;">Вход с нового устройства</h2>
      <p style="margin:0 0 20px;font-size:15px;color:${TEXT_SECONDARY};text-align:center;">
        ${displayName ? displayName + ', в' : 'В'} ваш аккаунт выполнен вход с нового IP-адреса.
      </p>
      <div style="background:${BG};border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="font-size:13px;color:${TEXT_MUTED};padding:4px 0;">IP-адрес:</td><td style="font-size:13px;color:${TEXT_PRIMARY};padding:4px 0;text-align:right;"><strong>${ip}</strong></td></tr>
          <tr><td style="font-size:13px;color:${TEXT_MUTED};padding:4px 0;">Устройство:</td><td style="font-size:13px;color:${TEXT_PRIMARY};padding:4px 0;text-align:right;">${safeUa}</td></tr>
          <tr><td style="font-size:13px;color:${TEXT_MUTED};padding:4px 0;">Время:</td><td style="font-size:13px;color:${TEXT_PRIMARY};padding:4px 0;text-align:right;">${formattedTime} (МСК)</td></tr>
        </table>
      </div>
      <div style="margin-bottom:24px;padding:16px;background:#fff3e0;border-radius:8px;border-left:3px solid #ff9800;">
        <p style="margin:0;font-size:13px;color:#e65100;line-height:1.5;">
          Если это были не вы — немедленно смените пароль.
        </p>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center">
          <a href="${resetUrl}" style="display:inline-block;background:#d32f2f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
            Это не я &mdash; сменить пароль
          </a>
        </td></tr>
      </table>
    </div>`
  );

  await sendMailWithCB({
    from: config.smtp.from,
    to: email,
    subject: 'Вход с нового устройства — Своё Фото',
    html,
  });

  logger.info(`[Email] Login alert sent to ${email} (new IP: ${ip})`);
}

// ─── Security: Registration Attempt Alert ─────────────────────────

export async function sendRegistrationAttemptEmail(
  email: string,
  displayName: string | null,
): Promise<void> {
  if (!getTransporter()) return;

  const frontendUrl = (config.cors.origin || 'https://svoefoto.ru').split(',')[0];

  const html = emailWrapper(
    'Попытка регистрации',
    `<div style="padding:36px 32px;">
      <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_PRIMARY};text-align:center;">Попытка регистрации</h2>
      <p style="margin:0 0 20px;font-size:15px;color:${TEXT_SECONDARY};text-align:center;line-height:1.5;">
        ${displayName ? displayName + ', к' : 'К'}то-то попытался зарегистрировать аккаунт с вашим email.<br>
        Если это были вы &mdash; вы уже зарегистрированы, просто <a href="${frontendUrl}/auth/login" style="color:${BRAND_COLOR};">войдите</a>.<br>
        Если забыли пароль &mdash; <a href="${frontendUrl}/auth/forgot-password" style="color:${BRAND_COLOR};">сбросьте его</a>.
      </p>
    </div>`
  );

  await sendMailWithCB({
    from: config.smtp.from,
    to: email,
    subject: 'Попытка регистрации — Своё Фото',
    html,
  });

  logger.info(`[Email] Registration attempt alert sent to ${email}`);
}

// ─── Security: OAuth Link Confirmation ──────────────────────────

const PROVIDER_NAMES: Record<string, string> = {
  yandex: 'Яндекс ID',
  google: 'Google',
  apple: 'Apple',
  vk: 'VK ID',
  sber: 'Сбер ID',
  mts: 'МТС ID',
};

export async function sendOAuthLinkConfirmEmail(
  email: string,
  displayName: string | null,
  provider: string,
  confirmUrl: string,
): Promise<void> {
  if (!getTransporter()) return;

  const providerLabel = PROVIDER_NAMES[provider] || provider;

  const html = emailWrapper(
    'Подтверждение привязки аккаунта',
    `<div style="padding:36px 32px;">
      <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT_PRIMARY};text-align:center;">Привязка аккаунта ${providerLabel}</h2>
      <p style="margin:0 0 20px;font-size:15px;color:${TEXT_SECONDARY};text-align:center;line-height:1.5;">
        ${displayName ? displayName + ', к' : 'К'}то-то вошёл через ${providerLabel} с вашим email.<br>
        Если это были вы &mdash; нажмите кнопку ниже, чтобы привязать аккаунт.<br>
        Если это не вы &mdash; просто проигнорируйте это письмо.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${confirmUrl}" style="display:inline-block;padding:14px 36px;background:${BRAND_COLOR};color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;">Подтвердить привязку</a>
      </div>
      <p style="margin:0;font-size:13px;color:${TEXT_MUTED};text-align:center;">Ссылка действительна 1 час.</p>
    </div>`
  );

  await sendMailWithCB({
    from: config.smtp.from,
    to: email,
    subject: `Подтверждение привязки ${providerLabel} — Своё Фото`,
    html,
  });

  logger.info(`[Email] OAuth link confirmation sent to ${email} (provider: ${provider})`);
}

// ─── Chat Digest Email (offline fallback) ────────────────────────

export interface ChatDigestMessage {
  sender_name: string;
  content: string;
  created_at: string;
}

export async function sendChatDigestEmail(
  email: string,
  visitorName: string | null,
  messages: ChatDigestMessage[],
): Promise<void> {
  if (!getTransporter()) return;

  const name = visitorName || 'Посетитель';
  const msgRows = messages.map(m => {
    const time = new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
    const snippet = m.content.length > 200 ? m.content.slice(0, 200) + '…' : m.content;
    return `<tr>
      <td style="padding:8px 12px;font-size:13px;color:${TEXT_MUTED};white-space:nowrap;vertical-align:top">${time}</td>
      <td style="padding:8px 12px;font-size:14px;color:${TEXT_PRIMARY};line-height:1.4">${snippet}</td>
    </tr>`;
  }).join('');

  const html = emailWrapper(
    'У вас непрочитанные сообщения в чате',
    `<div style="background:#fff;border-radius:12px;padding:32px;border:1px solid ${BORDER}">
      <h2 style="margin:0 0 12px;font-size:18px;font-weight:700;color:${TEXT_PRIMARY};text-align:center">
        У вас ${messages.length} непрочитанных сообщений
      </h2>
      <p style="margin:0 0 20px;font-size:14px;color:${TEXT_SECONDARY};text-align:center;line-height:1.5">
        Мы ответили вам в чате на svoefoto.ru, но вы были офлайн.
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;overflow:hidden">
        <thead><tr style="background:${BG}">
          <th style="padding:8px 12px;font-size:12px;color:${TEXT_MUTED};text-align:left">Время</th>
          <th style="padding:8px 12px;font-size:12px;color:${TEXT_MUTED};text-align:left">Сообщение</th>
        </tr></thead>
        <tbody>${msgRows}</tbody>
      </table>
      <div style="text-align:center;margin:24px 0 0">
        <a href="https://svoefoto.ru" style="display:inline-block;padding:14px 36px;background:${BRAND_COLOR};color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600">
          Открыть чат
        </a>
      </div>
    </div>`,
  );

  await sendMailWithCB({
    from: config.smtp.from,
    to: email,
    subject: `У вас ${messages.length} новых сообщений — Своё Фото`,
    html,
  });

  logger.info(`[Email] Chat digest sent to ${email} (${messages.length} messages)`);
}

// ─── Production Order Email ─────────────────────────────────────

export interface ProductionEmailData {
  order_number: string;
  items: Array<{
    product_name: string;
    category: string;
    specs: Record<string, unknown>;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
  total_cost: number;
  deadline_at: string | null;
  delivery_method: string;
  printing_house_notes: string | null;
  file_links: Array<{ name: string; url: string }>;
  operator_name: string;
  created_at: string;
}

function buildProductionOrderEmailHtml(data: ProductionEmailData): string {
  const deliveryLabels: Record<string, string> = {
    pickup: 'Самовывоз', courier: 'Курьер', post: 'Почта',
  };

  const itemRows = data.items.map((item, i) => {
    const specsStr = Object.entries(item.specs || {})
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', ');
    return `<tr>
      <td style="padding:8px 12px;font-size:13px;color:${TEXT_SECONDARY};border-bottom:1px solid ${BORDER}">${i + 1}</td>
      <td style="padding:8px 12px;font-size:13px;color:${TEXT_PRIMARY};border-bottom:1px solid ${BORDER}">
        <strong>${item.product_name}</strong>
        ${specsStr ? `<br><span style="font-size:11px;color:${TEXT_MUTED}">${specsStr}</span>` : ''}
      </td>
      <td style="padding:8px 12px;font-size:13px;color:${TEXT_PRIMARY};text-align:center;border-bottom:1px solid ${BORDER}">${item.quantity}</td>
      <td style="padding:8px 12px;font-size:13px;color:${TEXT_PRIMARY};text-align:right;border-bottom:1px solid ${BORDER}">${formatPrice(item.unit_price)}&nbsp;\u20BD</td>
      <td style="padding:8px 12px;font-size:13px;color:${TEXT_PRIMARY};text-align:right;font-weight:600;border-bottom:1px solid ${BORDER}">${formatPrice(item.total_price)}&nbsp;\u20BD</td>
    </tr>`;
  }).join('');

  const fileRows = data.file_links.length > 0
    ? `<div style="margin-top:20px">
        <h3 style="margin:0 0 10px;font-size:15px;color:${TEXT_PRIMARY}">Файлы для производства</h3>
        <ol style="margin:0;padding-left:20px">
          ${data.file_links.map(f => `<li style="margin-bottom:6px;font-size:13px">
            <a href="${f.url}" style="color:${BRAND_COLOR};text-decoration:none">${f.name}</a>
          </li>`).join('')}
        </ol>
      </div>`
    : '';

  const notesBlock = data.printing_house_notes
    ? `<div style="margin-top:16px;padding:12px 16px;background:#fff3e0;border-radius:8px;border-left:3px solid #ff9800">
        <p style="margin:0;font-size:13px;color:#e65100;line-height:1.5"><strong>Примечания:</strong> ${data.printing_house_notes}</p>
      </div>`
    : '';

  const deadlineBlock = data.deadline_at
    ? `<div style="margin-top:12px;font-size:14px;color:${TEXT_PRIMARY}"><strong>Дедлайн:</strong> ${formatDate(data.deadline_at)}</div>`
    : '';

  const content = `
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER}">
      <div style="background:${BRAND_COLOR};padding:24px 20px;text-align:center">
        <h2 style="margin:0;font-size:22px;color:#fff">Заказ на производство</h2>
        <p style="margin:6px 0 0;font-size:14px;color:rgba(255,255,255,0.85)">
          ${data.order_number} &middot; ${formatDate(data.created_at)}
        </p>
      </div>

      <div style="padding:24px">
        <table style="width:100%;border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:${BG}">
              <th style="padding:8px 12px;font-size:12px;color:${TEXT_MUTED};text-align:left">#</th>
              <th style="padding:8px 12px;font-size:12px;color:${TEXT_MUTED};text-align:left">Продукт</th>
              <th style="padding:8px 12px;font-size:12px;color:${TEXT_MUTED};text-align:center">Кол-во</th>
              <th style="padding:8px 12px;font-size:12px;color:${TEXT_MUTED};text-align:right">Цена</th>
              <th style="padding:8px 12px;font-size:12px;color:${TEXT_MUTED};text-align:right">Итого</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
          <tfoot>
            <tr style="background:${BG}">
              <td colspan="4" style="padding:10px 12px;font-size:14px;font-weight:600;color:${TEXT_PRIMARY};text-align:right">Итого:</td>
              <td style="padding:10px 12px;font-size:16px;font-weight:700;color:${BRAND_COLOR};text-align:right">${formatPrice(data.total_cost)}&nbsp;\u20BD</td>
            </tr>
          </tfoot>
        </table>

        ${fileRows}
        ${notesBlock}
        ${deadlineBlock}

        <div style="margin-top:12px;font-size:14px;color:${TEXT_PRIMARY}">
          <strong>Доставка:</strong> ${deliveryLabels[data.delivery_method] || data.delivery_method}
        </div>
        <div style="margin-top:4px;font-size:13px;color:${TEXT_SECONDARY}">
          Оператор: ${data.operator_name}
        </div>
      </div>

      <div style="background:#fafafa;border-top:1px solid ${BORDER};padding:16px 20px;text-align:center">
        <p style="margin:0;font-size:12px;color:${TEXT_MUTED}">
          Своё Фото &middot; ${STUDIO_ADDRESS} &middot; ${STUDIO_PHONE}
        </p>
      </div>
    </div>
  `;

  return emailWrapper(`Заказ на производство ${data.order_number}`, content);
}

export async function sendProductionOrderEmail(recipientEmail: string, data: ProductionEmailData): Promise<void> {
  await sendMailWithCB({
    from: config.smtp.from,
    to: recipientEmail,
    subject: `\u{1F3ED} Заказ на производство ${data.order_number} \u2014 Своё Фото`,
    html: buildProductionOrderEmailHtml(data),
  });

  logger.info(`[Email] Production order email sent to ${recipientEmail} for ${data.order_number}`);
}
