/**
 * Account Channels Routes — привязка мессенджер-каналов к ЛК клиента.
 *
 * Prefix: /api/account/channels
 *
 * GET    /                   — список привязанных каналов
 * POST   /link/telegram      — генерация Telegram deep link
 * POST   /link/telegram/callback — callback от бота после перехода по deep link
 * POST   /link/vk            — автопривязка VK (через OAuth vk_id)
 * POST   /link/whatsapp      — привязка WhatsApp по телефону
 * DELETE /:channel           — отвязка канала
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import {
  getLinkedChannels,
  generateLinkToken,
  verifyLinkToken,
  linkVk,
  linkTelegram,
  linkWhatsapp,
  unlinkChannel,
} from '../services/channel-linking.service.js';

const router = Router();

interface TelegramCallbackBody {
  token?: unknown;
  telegram_user_id?: unknown;
}

function isTelegramCallbackBody(value: unknown): value is TelegramCallbackBody {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

// ─── GET / — список привязанных каналов ──────────────────────

router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  const channels = await getLinkedChannels(req.user!.id);
  res.json({ success: true, channels });
});

// ─── POST /link/telegram — генерация deep link ───────────────

router.post('/link/telegram', authenticateToken, async (req: AuthRequest, res: Response) => {
  // Если у пользователя есть telegram_id — сразу привязать без deep link
  const autoLinked = await linkTelegram(req.user!.id);
  if (autoLinked) {
    res.json({ success: true, linked: true, channel: autoLinked });
    return;
  }

  // Генерируем deep link token
  const token = await generateLinkToken(req.user!.id, 'telegram');
  const botUsername = config.telegram.botUsername;
  const deepLink = `https://t.me/${botUsername}?start=LINK_${token}`;

  res.json({
    success: true,
    linked: false,
    deepLink,
    expiresInSeconds: 600,
  });
});

// ─── POST /link/telegram/callback — callback от бота ─────────

router.post('/link/telegram/callback', async (req: Request, res: Response) => {
  // Защита: проверяем webhook secret header
  const secretHeader = req.headers['x-bot-secret'];
  const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
  if (!secret || secret !== config.telegram.webhookSecret) {
    throw new AppError(403, 'Invalid bot secret');
  }

  const body = isTelegramCallbackBody(req.body) ? req.body : {};
  const token = readString(body.token);
  const telegram_user_id = readString(body.telegram_user_id);

  if (!token || !telegram_user_id) {
    throw new AppError(400, 'token and telegram_user_id are required');
  }

  const result = await verifyLinkToken(token, telegram_user_id, 'telegram');

  if (!result.success) {
    throw new AppError(400, 'Недействительный или просроченный токен');
  }

  res.json({ success: true, channelUserId: result.channelUserId });
});

// ─── POST /link/vk — автопривязка VK ────────────────────────

router.post('/link/vk', authenticateToken, async (req: AuthRequest, res: Response) => {
  const result = await linkVk(req.user!.id);

  if (!result) {
    throw new AppError(
      404,
      'VK не найден по номеру аккаунта. Напишите нам из VK или войдите через VK ID и повторите привязку.',
      'channel_not_found',
    );
  }

  res.json({ success: true, linked: true, channel: result });
});

// ─── POST /link/whatsapp — привязка по телефону ──────────────

router.post('/link/whatsapp', authenticateToken, async (req: AuthRequest, res: Response) => {
  const result = await linkWhatsapp(req.user!.id);

  if (!result) {
    throw new AppError(
      404,
      'WhatsApp не найден по номеру аккаунта. Напишите нам в WhatsApp с этого номера и повторите привязку.',
      'channel_not_found',
    );
  }

  res.json({ success: true, linked: true, channel: result });
});

// ─── DELETE /:channel — отвязка канала ───────────────────────

router.delete('/:channel', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { channel } = req.params;

  const validChannels = ['telegram', 'vk', 'whatsapp', 'max'];
  if (!validChannels.includes(channel)) {
    throw new AppError(400, `Неподдерживаемый канал: ${channel}`);
  }

  const unlinked = await unlinkChannel(req.user!.id, channel);

  if (!unlinked) {
    throw new AppError(404, 'Привязка не найдена');
  }

  res.json({ success: true });
});

export default router;
