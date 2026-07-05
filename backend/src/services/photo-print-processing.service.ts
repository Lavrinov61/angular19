/**
 * photo-print-processing.service.ts — Photo print processing logic.
 *
 * Extracted from photo-print-orders.routes.ts to allow reuse
 * by the dedicated photo-worker process (Stage 8: Photo Worker).
 *
 * Contains:
 *  - processAndNotify()  — resize photos, create ZIP archives, update DB status
 *  - sendOrderNotification() — Telegram notification to admin + user
 *  - FORMAT_MAP — format ID → { size, printType }
 */

import fs from 'fs';
import path from 'path';
import db from '../database/db.js';
import { processPhotosForPrint, formatFileSize } from './photo-processor.service.js';
import { storageService } from './storage.service.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('photo-print-processing');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhotoPrintItem {
  uploadedUrl?: string;
  format: string;
  paperType: string;
  quantity: number;
  margins?: 'none' | '3mm';
  border?: string;
}

export interface PhotoPrintOrderRequest {
  mode: 'simple' | 'custom';
  items: PhotoPrintItem[];
  contact: {
    name: string;
    phone: string;
    email?: string;
    comments?: string;
  };
  pickupLocationId?: string;
  deadline?: 'standard' | 'urgent';
  options?: {
    autoEnhance?: boolean;
    removeRedEyes?: boolean;
  };
  totalPrice: number;
  source?: 'miniapp' | 'website' | 'bot';
}

interface TelegramApiResponse {
  ok?: boolean;
  description?: string;
  [key: string]: unknown;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Map store format ID → { size for worker, printType label } */
export const FORMAT_MAP: Record<string, { size: string; printType: string }> = {
  '10x15':        { size: '10x15', printType: 'премиум' },
  '10x15_super':  { size: '10x15', printType: 'супер' },
  '10x15_matte':  { size: '10x15', printType: 'матовая' },
  '10x15_glossy': { size: '10x15', printType: 'глянцевая' },
  '10x15_satin':  { size: '10x15', printType: 'сатин' },
  '10x15_supergloss': { size: '10x15', printType: 'суперглянец' },
  '15x20':        { size: '15x20', printType: 'премиум' },
  '15x20_super':  { size: '15x20', printType: 'супер' },
  '15x20_matte':  { size: '15x20', printType: 'матовая' },
  '15x20_glossy': { size: '15x20', printType: 'глянцевая' },
  '15x20_satin':  { size: '15x20', printType: 'сатин' },
  '15x20_supergloss': { size: '15x20', printType: 'суперглянец' },
  '20x30':        { size: '20x30', printType: 'премиум' },
  '20x30_super':  { size: '20x30', printType: 'супер' },
  '20x30_matte':  { size: '20x30', printType: 'матовая' },
  '20x30_glossy': { size: '20x30', printType: 'глянцевая' },
  '20x30_satin':  { size: '20x30', printType: 'сатин' },
  '20x30_supergloss': { size: '20x30', printType: 'суперглянец' },
  '30x40':        { size: '30x40', printType: 'печать' },
  '40x50':        { size: '40x50', printType: 'печать' },
  '30x40_canvas': { size: '30x40', printType: 'холст' },
  '50x70_canvas': { size: '50x70', printType: 'холст' },
  '70x100_canvas':{ size: '70x100', printType: 'холст' },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Path traversal protection */
function safePath(basedir: string, relativePath: string): string | null {
  const cleaned = relativePath.replace(/^\//, '');
  const resolved = path.resolve(basedir, cleaned);
  if (!resolved.startsWith(basedir + path.sep) && resolved !== basedir) {
    log.warn('Path traversal blocked', { relativePath });
    return null;
  }
  return resolved;
}

/**
 * Resolve an uploaded URL to an absolute file path.
 * Handles both local (/uploads/print/...) and S3 URLs.
 * For S3 URLs, downloads to a temp file first.
 */
async function resolveToLocalPath(cwd: string, uploadedUrl: string): Promise<string | null> {
  // S3 URL → download to temp
  if (storageService.isS3Url(uploadedUrl)) {
    const key = storageService.keyFromUrl(uploadedUrl);
    if (!key) return null;
    try {
      return await storageService.downloadToTemp(key);
    } catch (err) {
      log.error('S3 download failed', { key, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  // Local path
  const absPath = safePath(cwd, uploadedUrl);
  if (!absPath || !fs.existsSync(absPath)) return null;
  return absPath;
}

function resolveBorderInfo(body: PhotoPrintOrderRequest): string {
  if (body.items.some(item => item.border && item.border !== 'none')) {
    return body.items
      .map(item => item.border)
      .filter((border): border is string => !!border && border !== 'none')
      .join(', ');
  }

  if (body.items.some(item => item.margins === '3mm')) {
    return 'Поля 3 мм';
  }

  if (body.items.length > 0 && body.items.every(item => item.margins === 'none')) {
    return 'Без полей';
  }

  return body.contact?.comments?.match(/Поля:\s*(.+)/)?.[1] || 'На усмотрение';
}

// ─── Main processing function ─────────────────────────────────────────────────

/**
 * Process photos for a print order:
 *  1. Groups items by format
 *  2. Resizes photos to print dimensions (via child_process worker)
 *  3. Creates ZIP archives
 *  4. Updates order status in DB
 *  5. Sends Telegram notification
 */
export async function processAndNotify(
  orderId: string,
  body: PhotoPrintOrderRequest,
  tgUserId?: string,
  tgUsername?: string,
): Promise<void> {
  const cwd = process.cwd();
  const borderInfo = resolveBorderInfo(body);

  // Group items by format (each format → separate archive)
  const groups = new Map<string, { items: PhotoPrintItem[]; info: { size: string; printType: string } }>();
  for (const item of body.items) {
    const key = item.format;
    if (!groups.has(key)) {
      const mapped = FORMAT_MAP[key] || { size: key.replace(/_.*/, '').replace('x', 'x'), printType: '' };
      groups.set(key, { items: [], info: mapped });
    }
    groups.get(key)!.items.push(item);
  }

  const archives: { url: string; size: number; label: string }[] = [];

  for (const [formatKey, group] of groups) {
    try {
      const sourcePaths: string[] = [];
      const perPhotoCopies: Record<string, number> = {};
      const pathToMessageId: Record<string, string> = {};

      for (let i = 0; i < group.items.length; i++) {
        const item = group.items[i];
        const relUrl = item.uploadedUrl!;
        const absPath = await resolveToLocalPath(cwd, relUrl);

        if (!absPath) {
          log.warn(`File not found or blocked: ${relUrl}`, { orderId });
          continue;
        }

        sourcePaths.push(absPath);
        const msgId = `item_${i}`;
        pathToMessageId[absPath] = msgId;
        perPhotoCopies[msgId] = item.quantity;
      }

      if (sourcePaths.length === 0) continue;

      const result = await processPhotosForPrint({
        size: group.info.size,
        copies: 1,
        sourcePaths,
        sessionId: `miniapp_${orderId}_${formatKey}`,
        printType: group.info.printType,
        borders: borderInfo,
        orderNumber: parseInt(orderId.replace(/\D/g, '').slice(0, 6)) || 0,
        perPhotoCopies,
        pathToMessageId,
      });

      archives.push({
        url: result.archiveUrl,
        size: result.archiveSize,
        label: `${group.info.size} ${group.info.printType}`,
      });

      log.info(`Processed ${formatKey}: ${result.totalFiles} files, ${formatFileSize(result.archiveSize)}`, { orderId });
    } catch (err) {
      log.error(`Failed to process ${formatKey}`, { orderId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Update order status
  try {
    await db.queryOne(
      `UPDATE photo_print_orders SET status = $1, processed_at = NOW() WHERE order_id = $2 RETURNING *`,
      [archives.length > 0 ? 'ready' : 'new', orderId],
    );
  } catch { /* non-critical */ }

  // Send Telegram notification
  await sendOrderNotification(orderId, body, archives, tgUserId, tgUsername);
}

// ─── Telegram notification ────────────────────────────────────────────────────

async function sendOrderNotification(
  orderId: string,
  order: PhotoPrintOrderRequest,
  archives: { url: string; size: number; label: string }[],
  tgUserId?: string,
  tgUsername?: string,
): Promise<void> {
  const botToken = process.env['TELEGRAM_BOT_TOKEN'] || '';
  const adminChatId = process.env['TELEGRAM_ADMIN_CHAT_ID'] || '';
  if (!botToken) {
    log.warn('TELEGRAM_BOT_TOKEN not set, skipping notification');
    return;
  }

  const photoCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const baseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';

  // Format items summary by format
  const formatSummary = new Map<string, number>();
  for (const item of order.items) {
    const fmt = FORMAT_MAP[item.format];
    const label = fmt ? `${fmt.size} ${fmt.printType}` : item.format;
    formatSummary.set(label, (formatSummary.get(label) || 0) + item.quantity);
  }
  const itemLines = [...formatSummary.entries()].map(([label, qty]) => `  \u2022 ${label}: ${qty} шт.`).join('\n');

  let archiveLines = '';
  if (archives.length > 0) {
    archiveLines = '\n\ud83d\udce6 Архивы (готовы к печати):\n' +
      archives.map(a => `  \u2022 ${a.label}: ${baseUrl}${a.url} (${formatFileSize(a.size)})`).join('\n');
  }

  const userLine = tgUsername ? `\ud83d\udc64 @${tgUsername} (${order.contact.name})` : `\ud83d\udc64 ${order.contact.name}`;

  const sourceLabel = order.source === 'website'
    ? 'с сайта'
    : order.source === 'bot'
      ? 'из бота'
      : 'из MiniApp';

  const message = [
    `\ud83d\udcf7 Новый заказ на печать фото ${sourceLabel}!`,
    ``,
    `\ud83c\udd94 Номер: ${orderId}`,
    userLine,
    order.contact.phone && order.contact.phone !== '+70000000000' ? `\ud83d\udcf1 Телефон: ${order.contact.phone}` : '',
    ``,
    `\ud83d\udcca Состав заказа:`,
    itemLines,
    ``,
    `\ud83d\udcb0 Сумма: ~${order.totalPrice}\u20bd`,
    order.contact.comments ? `\ud83d\udcac ${order.contact.comments}` : '',
    archiveLines,
  ].filter(Boolean).join('\n');

  const userMessage = [
    `\u2705 Заказ ${orderId} принят!`,
    ``,
    `\ud83d\udcca ${order.items.length} фото, ~${order.totalPrice}\u20bd`,
    ``,
    `Фото обработаны и готовы к печати.`,
    `Мы свяжемся с вами, когда заказ будет готов.`,
  ].join('\n');

  const sendText = async (chatId: string, text: string) => {
    const res = await fetchWithTimeout(`${config.telegram.apiUrl}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    return (await res.json()) as TelegramApiResponse;
  };

  const sendDoc = async (chatId: string, filePath: string, caption: string) => {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('document', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
    await fetchWithTimeout(`${config.telegram.apiUrl}/bot${botToken}/sendDocument`, { method: 'POST', body: form });
  };

  try {
    // 1. Send to admin chat (full details + archives)
    if (adminChatId) {
      const result = await sendText(adminChatId, message);
      if (!result.ok) {
        log.error('Admin notification error', { description: result.description });
      }

      for (const archive of archives) {
        const absPath = path.resolve(process.cwd(), archive.url.replace(/^\//, ''));
        if (fs.existsSync(absPath)) {
          try {
            await sendDoc(adminChatId, absPath, `\ud83d\udce6 ${orderId} \u2014 ${archive.label}`);
          } catch (docErr) {
            log.error('Failed to send archive to admin', { error: String(docErr) });
          }
        }
      }
    }

    // 2. Send confirmation to user
    if (tgUserId) {
      try {
        await sendText(tgUserId, userMessage);
      } catch {
        // User may not have started the bot — ignore
      }
    }
  } catch (err) {
    log.error('Failed to send Telegram notification', { error: err instanceof Error ? err.message : String(err) });
  }
}
