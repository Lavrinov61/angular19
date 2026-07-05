/**
 * chat-shared.ts — Shared types, interfaces, and utility functions
 * used across all visitor-chat split modules.
 *
 * Extracted from visitor-chat.routes.ts during refactoring.
 */

import { Request, Application } from 'express';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { logAudit } from '../../services/audit.service.js';
import { AuthRequest } from '../../middleware/auth.js';
import { pool } from '../../database/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createRateLimitStore } from '../../middleware/rate-limit-store.js';

import { createLogger } from '../../utils/logger.js';
// ============================================================================
// Re-exports
// ============================================================================

const logger = createLogger('chat-shared');
export { logAudit };
export type { AuthRequest };

// ============================================================================
// Ownership helper — auth-only chat
// ============================================================================

export interface OwnedConversation {
  id: string;
  contact_id: string;
  channel: string;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Проверяет, что разговор принадлежит контакту текущего пользователя.
 * Бросает 404 если conversation не найден, 403 при ownership mismatch.
 *
 * Паттерн ownership: users.id → contacts.user_id → conversations.contact_id.
 */
export async function getOwnedConversation(
  userId: string,
  conversationId: string,
): Promise<OwnedConversation> {
  const { rows } = await pool.query<OwnedConversation & { user_id: string | null }>(
    `SELECT c.id, c.contact_id, c.channel, c.status, c.created_at, c.updated_at,
            ct.user_id
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.deleted_at IS NULL
      WHERE c.id = $1
      LIMIT 1`,
    [conversationId],
  );

  const row = rows[0];
  if (!row) {
    throw new AppError(404, 'Conversation not found');
  }
  if (row.user_id !== userId) {
    throw new AppError(403, 'Forbidden: not your conversation');
  }

  return {
    id: row.id,
    contact_id: row.contact_id,
    channel: row.channel,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ============================================================================
// Telegram Mini App token interfaces
// ============================================================================

export interface TelegramMiniAppTokenPayload {
  chat_id: string;
  line_id: number;
  user_name?: string;
  service?: string;
  exp?: number;
}

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramWebAppInitPayload {
  user?: TelegramWebAppUser;
  chat_instance?: string;
  auth_date?: number;
}

// ============================================================================
// Base64 URL helpers (for Telegram Mini App JWT)
// ============================================================================

export function base64UrlEncode(value: Buffer | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value) : value;
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

// ============================================================================
// Bot interactive types
// ============================================================================

export interface BotButton {
  id: string;
  label: string;
  icon?: string;
  value: string;
  color?: string;
  visibleTo?: 'all' | 'operator' | 'visitor';
  url?: string;             // External link (button opens URL)
  data?: Record<string, unknown>; // Extra data (e.g. price for payment)
}

export interface BotCardItem {
  label: string;
  value: string;
}

export interface BotCard {
  title: string;
  subtitle?: string;
  icon?: string;
  price?: string;
  items?: BotCardItem[];
  buttons?: BotButton[];
}

export interface BotInteractive {
  type: 'buttons' | 'cards' | 'document_select' | 'size_select' | 'confirm' | 'chips';
  text?: string;
  buttons?: BotButton[];
  chips?: string[];
  cards?: BotCard[];
  step?: string;
  cartData?: Record<string, unknown>;
}

export interface BotMessageResult {
  content: string;
  interactive?: BotInteractive;
}

// ============================================================================
// Channel → Source + DeliveryMethod (Phase 2 Unification)
// ============================================================================

/** Откуда пришла сессия (маршрутизация, аналитика) */
export type ChatSource = 'web' | 'telegram' | 'max';

/** Способ получения результата (атрибут заказа, определяет цену) */
export type DeliveryMethod = 'electronic' | 'pickup' | 'postal';

/** Pre-selection с лендинга */
export interface EntryContext {
  /** Категория (slug), например 'photo-docs' */
  category?: string;
  /** Подсказка delivery, например 'electronic' */
  delivery?: DeliveryMethod;
  /** Конкретная опция, например 'retouch' */
  option?: string;
  /** Выбранный документ, например 'Паспорт РФ' */
  selectedDoc?: string;
  /** Несколько документов для комплекта */
  selectedDocs?: string[];
  /** Свободные пожелания клиента (размер, форма, особенности) */
  customerNote?: string;
  /** Выбранные опции конфигуратора */
  selectedOptions?: Array<{ option_slug: string; quantity?: number }>;
  /** Итого из конфигуратора до загрузки фото */
  configuratorTotal?: number;
  /** Произвольные данные с лендинга */
  [key: string]: unknown;
}

/** @deprecated Используй ChatSource + DeliveryMethod */
export type ChatChannel = 'online' | 'studio';

// ============================================================================
// Session interface
// ============================================================================

export interface VisitorSession {
  id: string;
  visitor_id: string;
  visitor_name?: string;
  selected_service?: string;
  selected_price?: number;
  page_url?: string;
  /** @deprecated Используй source + entry_context */
  channel: ChatChannel;
  /** Источник сессии */
  source: ChatSource;
  /** Pre-selection с лендинга */
  entry_context: EntryContext;
  status: 'open' | 'waiting' | 'active' | 'resolved' | 'closed';
}

// ============================================================================
// Delivery info interface
// ============================================================================

export interface DeliveryInfo {
  pickup: string;            // Display label for pickup point
  production: string;        // Production location
  deliveryAddress?: string;
  deliveryPhone?: string;
  deliveryPostalCode?: string;
  deliveryCost?: number;
  deliveryDaysMin?: number;
  deliveryDaysMax?: number;
}

// ============================================================================
// WebSocket access — unified utility
// ============================================================================

/**
 * Typed interface for the socket server attached to Express app.
 * Supports both direct .to() pattern (legacy) and .getIO().to() pattern.
 */
export interface SocketServer {
  to: (room: string) => { emit: (event: string, data: unknown) => void };
  getIO: () => { to: (room: string) => { emit: (event: string, data: unknown) => void } };
  io?: { to: (room: string) => { emit: (event: string, data: unknown) => void } };
}

/**
 * Retrieves the socket server instance from the Express app.
 * Returns undefined if not available (e.g. during tests or SSR).
 */
export function getSocketServer(app: Application): SocketServer | undefined {
  return (app as unknown as Record<string, unknown>)['socketServer'] as SocketServer | undefined;
}

// ============================================================================
// Message enrichment — extracts interactive metadata
// ============================================================================

/**
 * Enriches raw DB messages with top-level `interactive` field
 * extracted from metadata JSON. Used in all message-loading endpoints.
 */
export function enrichMessages(messages: any[]): any[] {
  return messages.map((msg: any) => {
    if (msg.metadata) {
      try {
        const meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
        const galleryUrls = Array.isArray(meta.gallery)
          ? meta.gallery.filter((url: unknown): url is string => typeof url === 'string' && url.length > 0)
          : [];
        if (meta.interactive) {
          return galleryUrls.length > 0
            ? { ...msg, interactive: meta.interactive, gallery_urls: galleryUrls }
            : { ...msg, interactive: meta.interactive };
        }
        if (galleryUrls.length > 0) return { ...msg, gallery_urls: galleryUrls };
      } catch (err) {
        logger.warn('Failed to enrich message with metadata', {
          error: err instanceof Error ? err.message : String(err),
          messageId: msg.id
        });
      }
    }
    return msg;
  });
}

// ============================================================================
// Path security — protection against Path Traversal
// ============================================================================

const BASE_DIR = process.cwd();

/** Safely resolves a path — ensures result stays within BASE_DIR */
export function safePath(relativePath: string): string | null {
  const cleaned = relativePath.replace(/^\//, '');
  const resolved = path.resolve(BASE_DIR, cleaned);
  if (!resolved.startsWith(BASE_DIR + path.sep) && resolved !== BASE_DIR) {
    logger.warn(`[Security] Path traversal blocked: ${relativePath} → ${resolved}`);
    return null;
  }
  return resolved;
}

// ============================================================================
// Multer originalname encoding fix
// ============================================================================

/**
 * Fix Multer's Latin-1 decoding of non-ASCII filenames.
 * Browsers send UTF-8 filenames in multipart, but the spec (and Multer)
 * decode Content-Disposition as Latin-1. Re-encode → decode as UTF-8.
 */
export function fixOriginalName(raw: string): string {
  try {
    const fixed = Buffer.from(raw, 'latin1').toString('utf8');
    return fixed.includes('\uFFFD') ? raw : fixed;
  } catch {
    return raw;
  }
}

// ============================================================================
// File upload configuration (Multer)
// ============================================================================

// Allowed MIME types
export const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
  // Video
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm',
  // Audio
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/mp4', 'audio/opus',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif', '.bmp', '.tiff',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.mp3', '.ogg', '.wav', '.aac', '.m4a', '.opus',
  '.pdf',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip',
]);

// Dangerous extensions — blocked even if MIME is spoofed
export const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
  '.sh', '.bash', '.csh', '.ksh',
  '.php', '.php3', '.php4', '.php5', '.phtml', '.phar',
  '.jsp', '.jspx', '.asp', '.aspx',
  '.py', '.rb', '.pl', '.cgi',
  '.html', '.htm', '.xhtml', '.svg', '.xml', '.xsl',
  '.js', '.mjs', '.ts', '.jsx', '.tsx',
  '.htaccess', '.htpasswd',
]);

// Rate limit for file uploads — DDoS protection via large files
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // 100 upload requests per 15 min (= up to 2000 photos with batch of 20)
  message: 'Слишком много загрузок. Подождите немного.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('chat-ul:'),
});

// Rate limit for session creation — brute force protection
// POST /sessions используется и для создания, и для восстановления сессий при каждой
// загрузке страницы (desktop auto-open, mobile lazy), поэтому 10 — слишком агрессивно.
export const sessionCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Слишком много запросов. Подождите.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('chat-sess:'),
});

// Rate limit for media download (ZIP) — resource-intensive
export const mediaDownloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Слишком много скачиваний. Подождите.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('chat-dl:'),
});

// Rate limit for general chat API calls (messages, cart, etc.)
export const chatApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => (req as any).user?.id ?? req.ip,
  message: 'Слишком много запросов.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('chat-api:'),
  handler: (req, res, _next, options) => {
    console.warn('[429 chatApiLimiter]', req.method, req.originalUrl, 'user:', (req as any).user?.id, 'ip:', req.ip);
    res.status(options.statusCode).json({ error: options.message });
  },
});

// Rate limit for high-frequency reads (presence, mentions) — per-user 120/min
export const chatPresenceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => (req as any).user?.id ?? req.ip,
  message: 'Слишком много запросов.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('chat-presence:'),
  handler: (req, res, _next, options) => {
    console.warn('[429 chatPresenceLimiter]', req.method, req.originalUrl, 'user:', (req as any).user?.id, 'ip:', req.ip);
    res.status(options.statusCode).json({ error: options.message });
  },
});

// Rate limit for external channel webhooks
export const channelWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many requests.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('chat-wh:'),
});

// ============================================================================
// File type detection
// ============================================================================

/** Detect message_type by MIME type + fallback by file extension */
export function detectMessageType(mimetype: string, filename?: string): 'image' | 'video' | 'audio' | 'file' {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';

  // Fallback by extension (MIME may not be detected for .webp, .heic, etc.)
  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    const imageExts = ['.webp', '.heic', '.heif', '.avif', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff'];
    const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    const audioExts = ['.mp3', '.ogg', '.wav', '.aac', '.m4a', '.opus'];
    if (imageExts.includes(ext)) return 'image';
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
  }

  return 'file';
}

/** Emoji icon for file type */
export function fileTypeCaption(type: 'image' | 'video' | 'audio' | 'file'): string {
  switch (type) {
    case 'image': return '📷 Фото';
    case 'video': return '📹 Видео';
    case 'audio': return '🎵 Аудио';
    default: return '📎 Файл';
  }
}

// ============================================================================
// Visitor name generation
// ============================================================================

/** Determine device type from User-Agent */
export function getDeviceType(userAgent?: string): { icon: string; label: string } {
  if (!userAgent) return { icon: '🌐', label: 'Веб' };
  const ua = userAgent.toLowerCase();

  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
    return ua.includes('ipad') ? { icon: '📱', label: 'iPad' } : { icon: '📱', label: 'iPhone' };
  }
  if (ua.includes('android')) {
    return ua.includes('mobile') ? { icon: '📱', label: 'Android' } : { icon: '📱', label: 'Android-планшет' };
  }
  if (ua.includes('windows')) return { icon: '💻', label: 'Windows' };
  if (ua.includes('macintosh') || ua.includes('mac os')) return { icon: '💻', label: 'Mac' };
  if (ua.includes('linux')) return { icon: '💻', label: 'Linux' };

  return { icon: '🌐', label: 'Веб' };
}

/**
 * Generate a human-readable visitor name.
 * Format: "icon Имя Фамилия" (logged-in) or "icon Обращение #1002" (anonymous)
 */
export function generateVisitorName(sessionNumber: number, userAgent?: string, displayName?: string): string {
  const device = getDeviceType(userAgent);
  if (displayName?.trim()) {
    return `${device.icon} ${displayName.trim()}`;
  }
  return `${device.icon} Обращение #${sessionNumber}`;
}

/**
 * Get next sequential session number from PostgreSQL sequence.
 * Starts at 1000, increments by 1 for each new chat session.
 */
export async function getNextSessionNumber(): Promise<number> {
  const { rows } = await pool.query<{ nextval: string }>(`SELECT nextval('chat_session_number_seq')`);
  return parseInt(rows[0].nextval, 10);
}
