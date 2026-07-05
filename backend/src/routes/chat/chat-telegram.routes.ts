import { Router, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config/index.js';

const router = Router();

interface TelegramMiniAppTokenPayload {
  chat_id: string;
  line_id: number;
  user_name?: string;
  service?: string;
  exp?: number;
}

interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramWebAppInitPayload {
  user?: TelegramWebAppUser;
  chat_instance?: string;
  auth_date?: number;
}

function base64UrlEncode(value: Buffer | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value) : value;
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function verifyTelegramMiniAppToken(token: string): TelegramMiniAppTokenPayload | null {
  const secret = process.env['TELEGRAM_MINIAPP_SECRET']
    || config.actions.apiKey
    || config.actions.paymentSecret
    || '';
  if (!secret) {
    return null;
  }

  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) {
    return null;
  }

  const expectedSignature = base64UrlEncode(
    createHmac('sha256', secret).update(payloadPart).digest(),
  );

  if (expectedSignature.length !== signaturePart.length) {
    return null;
  }

  if (!timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signaturePart))) {
    return null;
  }

  try {
    const payloadJson = base64UrlDecode(payloadPart).toString('utf8');
    const payload = JSON.parse(payloadJson) as TelegramMiniAppTokenPayload;
    if (!payload.chat_id || !payload.line_id) {
      return null;
    }
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function verifyTelegramWebAppInitData(initData: string): TelegramWebAppInitPayload | null {
  if (!initData) {
    return null;
  }

  const botToken = process.env['TELEGRAM_BOT_TOKEN'] || '';
  if (!botToken) {
    return null;
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    return null;
  }

  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const signature = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (signature.length !== hash.length) {
    return null;
  }
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(hash))) {
    return null;
  }

  try {
    const userRaw = params.get('user');
    const user = userRaw ? (JSON.parse(userRaw) as TelegramWebAppUser) : undefined;
    const chatInstance = params.get('chat_instance') || undefined;
    const authDateRaw = params.get('auth_date');
    const authDate = authDateRaw ? Number(authDateRaw) : undefined;

    if (!user?.id) {
      return null;
    }

    return {
      user,
      chat_instance: chatInstance,
      auth_date: Number.isFinite(authDate ?? NaN) ? authDate : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Создать контекст сессии для Telegram Mini App по токену
 * POST /telegram/session
 */
router.post('/telegram/session', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.body as { token?: string };

  if (!token) {
    res.status(400).json({ success: false, error: 'token is required' });
    return;
  }

  const payload = verifyTelegramMiniAppToken(token);
  if (!payload) {
    res.status(403).json({ success: false, error: 'invalid token' });
    return;
  }

  const visitorId = `tg_${payload.line_id}_${payload.chat_id}`;
  res.json({
    success: true,
    data: {
      visitorId,
      visitorName: payload.user_name || '',
      selectedService: payload.service || '',
      selectedPrice: null,
      channel: 'online',
    },
  });
});

/**
 * Создать контекст сессии для Telegram Mini App по initData
 * POST /telegram/session-from-init
 */
router.post('/telegram/session-from-init', async (req: Request, res: Response): Promise<void> => {
  const { initData } = req.body as { initData?: string };

  if (!initData) {
    res.status(400).json({ success: false, error: 'initData is required' });
    return;
  }

  const payload = verifyTelegramWebAppInitData(initData);
  if (!payload?.user?.id) {
    res.status(403).json({ success: false, error: 'invalid initData' });
    return;
  }

  const chatInstance = payload.chat_instance || 'chat';
  const visitorId = `tg_${chatInstance}_${payload.user.id}`;
  const visitorName = [payload.user.first_name, payload.user.last_name]
    .filter(Boolean)
    .join(' ')
    || payload.user.username
    || '';

  res.json({
    success: true,
    data: {
      visitorId,
      visitorName,
      selectedService: '',
      selectedPrice: null,
      channel: 'online',
    },
  });
});

export default router;
