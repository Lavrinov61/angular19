/**
 * Shared welcome-message constants for all messenger channels.
 * Single source of truth — Telegram, VK, Max, WhatsApp import from here.
 */

const BASE_URL = process.env['BASE_URL'] || 'https://svoefoto.ru';

export const WELCOME_BUTTONS = [
  { label: 'Чат на сайте', emoji: '\u{1F4AC}', url: `${BASE_URL}/chat` },
  { label: 'Личный кабинет', emoji: '\u{1F464}', url: `${BASE_URL}/user-profile` },
] as const;

export const WELCOME_TEXT_LINES = [
  '\u{1F44B} Добро пожаловать в <b>Своё Фото</b>!',
  '',
  'Фотостудия в Ростове-на-Дону.',
  'Фото на документы, портреты, печать фото.',
  '',
  'Вы можете писать сюда — оператор ответит в ближайшее время.',
] as const;

/**
 * Welcome text with HTML formatting (Telegram, VK).
 */
export function getWelcomeHtml(): string {
  return WELCOME_TEXT_LINES.join('\n');
}

/**
 * Plain-text welcome with URLs (WhatsApp, fallback).
 * WhatsApp auto-links URLs — no need for special markup.
 */
export function getWelcomePlainText(): string {
  const lines = WELCOME_TEXT_LINES.map(l => l.replace(/<\/?b>/g, ''));
  const urls = WELCOME_BUTTONS.map(b => `${b.emoji} ${b.label}: ${b.url}`);
  return [...lines, '', ...urls].join('\n');
}

// ─── Phone request (F70) ────────────────────────────────────────────────────

export const PHONE_REQUEST_TEXT =
  '📱 Оставьте номер телефона — мы свяжемся с вами для оформления заказа';

export const PHONE_SKIP_CALLBACK = 'skip_phone_request' as const;
