import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TelegramInitPayload {
  user: TelegramUser;
  chat_instance?: string;
  auth_date?: number;
}

/**
 * Verify Telegram WebApp initData using HMAC-SHA256.
 * Returns parsed payload or null if invalid.
 */
export function verifyTelegramInitData(initData: string): TelegramInitPayload | null {
  if (!initData) return null;

  const botToken = process.env['TELEGRAM_BOT_TOKEN'] || '';
  if (!botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const signature = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (signature.length !== hash.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(hash))) return null;

  try {
    const userRaw = params.get('user');
    const user = userRaw ? (JSON.parse(userRaw) as TelegramUser) : undefined;
    if (!user?.id) return null;

    const chatInstance = params.get('chat_instance') || undefined;
    const authDate = Number(params.get('auth_date') || NaN);

    return {
      user,
      chat_instance: chatInstance,
      auth_date: Number.isFinite(authDate) ? authDate : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Express middleware: requires valid Telegram initData in X-Telegram-Init-Data header.
 * Attaches `req.telegramUser` on success.
 */
export function requireTelegramAuth(req: Request, res: Response, next: NextFunction): void {
  const initData = req.get('X-Telegram-Init-Data') || '';
  const payload = verifyTelegramInitData(initData);

  if (!payload) {
    res.status(401).json({ success: false, error: 'Invalid Telegram auth' });
    return;
  }

  // Attach to request
  (req as any).telegramUser = payload.user;
  (req as any).telegramPayload = payload;
  next();
}
