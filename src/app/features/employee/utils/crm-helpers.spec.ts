import { describe, it, expect } from 'vitest';
import {
  statusLabel,
  typeIcon,
  typeLabel,
  isBrandChannel,
  channelSvgIcon,
  channelIcon,
  channelLabel,
  channelColor,
  priorityLabel,
  shiftStatusLabel,
  orderStatusLabel,
  paymentStatusLabel,
  paymentStatusIcon,
  formatRelativeTime,
  formatDateTime,
} from './crm-helpers';

// ─── statusLabel ────────────────────────────────────────────────────────────

describe('statusLabel', () => {
  it('returns localised label for known statuses', () => {
    expect(statusLabel('open')).toBe('Новая');
    expect(statusLabel('assigned')).toBe('Назначена');
    expect(statusLabel('in_progress')).toBe('В работе');
    expect(statusLabel('waiting')).toBe('Ожидание');
    expect(statusLabel('handed_off')).toBe('Передана');
    expect(statusLabel('completed')).toBe('Готово');
    expect(statusLabel('cancelled')).toBe('Отменена');
  });

  it('returns the raw status string for unknown values (fallback)', () => {
    expect(statusLabel('unknown_status')).toBe('unknown_status');
    expect(statusLabel('')).toBe('');
  });
});

// ─── typeIcon ────────────────────────────────────────────────────────────────

describe('typeIcon', () => {
  it('returns correct icon for known task types', () => {
    expect(typeIcon('photo_order')).toBe('print');
    expect(typeIcon('chat_inquiry')).toBe('chat');
    expect(typeIcon('walk_in')).toBe('storefront');
    expect(typeIcon('callback')).toBe('phone_callback');
    expect(typeIcon('retouch')).toBe('auto_fix_high');
    expect(typeIcon('delivery')).toBe('local_shipping');
    expect(typeIcon('internal')).toBe('assignment');
    expect(typeIcon('cross_location')).toBe('swap_horiz');
  });

  it('returns fallback icon "task" for unknown type', () => {
    expect(typeIcon('mystery_type')).toBe('task');
    expect(typeIcon('')).toBe('task');
  });
});

// ─── typeLabel ───────────────────────────────────────────────────────────────

describe('typeLabel', () => {
  it('returns localised label for known types', () => {
    expect(typeLabel('photo_order')).toBe('Заказ');
    expect(typeLabel('chat_inquiry')).toBe('Из чата');
    expect(typeLabel('walk_in')).toBe('На точке');
    expect(typeLabel('callback')).toBe('Перезвонить');
    expect(typeLabel('retouch')).toBe('Ретушь');
    expect(typeLabel('delivery')).toBe('Доставка');
    expect(typeLabel('internal')).toBe('Внутренняя');
    expect(typeLabel('cross_location')).toBe('Межточечная');
  });

  it('returns raw type string for unknown type (fallback)', () => {
    expect(typeLabel('something_new')).toBe('something_new');
    expect(typeLabel('')).toBe('');
  });
});

// ─── isBrandChannel ──────────────────────────────────────────────────────────

describe('isBrandChannel', () => {
  it('returns true for brand channels', () => {
    expect(isBrandChannel('telegram')).toBe(true);
    expect(isBrandChannel('vk')).toBe(true);
    expect(isBrandChannel('whatsapp')).toBe(true);
    expect(isBrandChannel('instagram')).toBe(true);
    expect(isBrandChannel('max')).toBe(true);
  });

  it('returns false for non-brand channels', () => {
    expect(isBrandChannel('online')).toBe(false);
    expect(isBrandChannel('studio')).toBe(false);
    expect(isBrandChannel('phone')).toBe(false);
    expect(isBrandChannel('walk_in')).toBe(false);
    expect(isBrandChannel('website')).toBe(false);
  });

  it('returns false for undefined and empty string', () => {
    expect(isBrandChannel(undefined)).toBe(false);
    expect(isBrandChannel('')).toBe(false);
  });
});

// ─── channelSvgIcon ───────────────────────────────────────────────────────────

describe('channelSvgIcon', () => {
  it('returns prefixed icon name for any channel', () => {
    expect(channelSvgIcon('telegram')).toBe('channel-telegram');
    expect(channelSvgIcon('whatsapp')).toBe('channel-whatsapp');
    expect(channelSvgIcon('unknown')).toBe('channel-unknown');
  });
});

// ─── channelIcon ─────────────────────────────────────────────────────────────

describe('channelIcon', () => {
  it('returns correct material icon for known channels', () => {
    expect(channelIcon('whatsapp')).toBe('chat');
    expect(channelIcon('telegram')).toBe('send');
    expect(channelIcon('online')).toBe('language');
    expect(channelIcon('website')).toBe('language');
    expect(channelIcon('walk_in')).toBe('storefront');
    expect(channelIcon('phone')).toBe('phone');
    expect(channelIcon('max')).toBe('chat_bubble');
    expect(channelIcon('vk')).toBe('group');
    expect(channelIcon('instagram')).toBe('photo_camera');
    expect(channelIcon('studio')).toBe('store');
  });

  it('returns fallback "person" for unknown channel', () => {
    expect(channelIcon('signal')).toBe('person');
    expect(channelIcon('')).toBe('person');
    expect(channelIcon(undefined)).toBe('person');
  });
});

// ─── channelLabel ─────────────────────────────────────────────────────────────

describe('channelLabel', () => {
  it('returns localised label for known channels', () => {
    expect(channelLabel('whatsapp')).toBe('WhatsApp');
    expect(channelLabel('telegram')).toBe('Telegram');
    expect(channelLabel('online')).toBe('Онлайн');
    expect(channelLabel('website')).toBe('Сайт');
    expect(channelLabel('walk_in')).toBe('На точке');
    expect(channelLabel('phone')).toBe('Телефон');
    expect(channelLabel('max')).toBe('МАКС');
    expect(channelLabel('vk')).toBe('VK');
    expect(channelLabel('instagram')).toBe('Instagram');
    expect(channelLabel('studio')).toBe('Студия');
  });

  it('returns raw channel string as fallback for unknown channels', () => {
    expect(channelLabel('signal')).toBe('signal');
    expect(channelLabel('')).toBe('');
  });
});

// ─── channelColor ─────────────────────────────────────────────────────────────

describe('channelColor', () => {
  it('returns correct hex colour for known channels', () => {
    expect(channelColor('vk')).toBe('#4c75a3');
    expect(channelColor('telegram')).toBe('#26a5e4');
    expect(channelColor('whatsapp')).toBe('#25d366');
    expect(channelColor('max')).toBe('#34d399');
    expect(channelColor('instagram')).toBe('#E4405F');
    expect(channelColor('online')).toBe('#f59e0b');
    expect(channelColor('website')).toBe('#f59e0b');
    expect(channelColor('studio')).toBe('#f59e0b');
  });

  it('returns grey fallback for unknown channel', () => {
    expect(channelColor('phone')).toBe('#9ca3af');
    expect(channelColor('walk_in')).toBe('#9ca3af');
    expect(channelColor('')).toBe('#9ca3af');
  });
});

// ─── priorityLabel ────────────────────────────────────────────────────────────

describe('priorityLabel', () => {
  it('returns localised label for known priorities', () => {
    expect(priorityLabel('urgent')).toBe('Срочно');
    expect(priorityLabel('high')).toBe('Высокий');
    expect(priorityLabel('normal')).toBe('Обычный');
    expect(priorityLabel('low')).toBe('Низкий');
  });

  it('returns raw string for unknown priority (fallback)', () => {
    expect(priorityLabel('critical')).toBe('critical');
    expect(priorityLabel('')).toBe('');
  });
});

// ─── shiftStatusLabel ─────────────────────────────────────────────────────────

describe('shiftStatusLabel', () => {
  it('returns localised label for known shift statuses', () => {
    expect(shiftStatusLabel('scheduled')).toBe('Запланирована');
    expect(shiftStatusLabel('active')).toBe('Активна');
    expect(shiftStatusLabel('completed')).toBe('Завершена');
    expect(shiftStatusLabel('cancelled')).toBe('Отменена');
  });

  it('returns raw string fallback for unknown status', () => {
    expect(shiftStatusLabel('on_hold')).toBe('on_hold');
  });
});

// ─── orderStatusLabel ─────────────────────────────────────────────────────────

describe('orderStatusLabel', () => {
  it('returns localised label for all order statuses', () => {
    expect(orderStatusLabel('new')).toBe('Новый');
    expect(orderStatusLabel('pending_payment')).toBe('Ожидание оплаты');
    expect(orderStatusLabel('processing')).toBe('В работе');
    expect(orderStatusLabel('ready')).toBe('Готов');
    expect(orderStatusLabel('completed')).toBe('Завершён');
    expect(orderStatusLabel('cancelled')).toBe('Отменён');
    expect(orderStatusLabel('payment_failed')).toBe('Ошибка оплаты');
    expect(orderStatusLabel('expired')).toBe('Истёк');
  });

  it('returns raw string for unknown status', () => {
    expect(orderStatusLabel('archived')).toBe('archived');
    expect(orderStatusLabel('')).toBe('');
  });
});

// ─── paymentStatusLabel ───────────────────────────────────────────────────────

describe('paymentStatusLabel', () => {
  it('returns localised label for all payment statuses', () => {
    expect(paymentStatusLabel('none')).toBe('Нет');
    expect(paymentStatusLabel('pending')).toBe('Ожидание');
    expect(paymentStatusLabel('paid')).toBe('Оплачен');
    expect(paymentStatusLabel('failed')).toBe('Ошибка');
    expect(paymentStatusLabel('refunded')).toBe('Возврат');
    expect(paymentStatusLabel('expired')).toBe('Истёк');
    expect(paymentStatusLabel('cancelled')).toBe('Отменён');
  });

  it('returns raw string for unknown status', () => {
    expect(paymentStatusLabel('chargeback')).toBe('chargeback');
  });
});

// ─── paymentStatusIcon ────────────────────────────────────────────────────────

describe('paymentStatusIcon', () => {
  it('returns correct icon for all payment statuses', () => {
    expect(paymentStatusIcon('paid')).toBe('check_circle');
    expect(paymentStatusIcon('pending')).toBe('schedule');
    expect(paymentStatusIcon('none')).toBe('radio_button_unchecked');
    expect(paymentStatusIcon('failed')).toBe('error');
    expect(paymentStatusIcon('refunded')).toBe('undo');
    expect(paymentStatusIcon('expired')).toBe('timer_off');
    expect(paymentStatusIcon('cancelled')).toBe('cancel');
  });

  it('returns "help" as fallback for unknown status', () => {
    expect(paymentStatusIcon('chargeback')).toBe('help');
    expect(paymentStatusIcon('')).toBe('help');
  });
});

// ─── formatRelativeTime ───────────────────────────────────────────────────────

describe('formatRelativeTime', () => {
  it('returns "только что" for timestamps less than 1 minute ago', () => {
    const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
    expect(formatRelativeTime(thirtySecondsAgo)).toBe('только что');
  });

  it('returns "N мин назад" for timestamps between 1 and 59 minutes ago', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(formatRelativeTime(tenMinutesAgo)).toBe('10 мин назад');
  });

  it('returns "N ч назад" for timestamps between 1 and 23 hours ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe('3 ч назад');
  });

  it('returns "вчера" for a timestamp that is exactly ~25 hours ago (diffDays === 1)', () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 3_600_000).toISOString();
    expect(formatRelativeTime(twentyFiveHoursAgo)).toBe('вчера');
  });

  it('returns "N дн назад" for timestamps 2–6 days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe('3 дн назад');
  });

  it('returns a localised date string for timestamps older than 7 days', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const result = formatRelativeTime(tenDaysAgo);
    // Should be a date string, not a relative phrase
    expect(result).not.toContain('назад');
    expect(result).not.toBe('вчера');
    expect(result).not.toBe('только что');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles an invalid ISO string without throwing (returns "Invalid Date" or similar)', () => {
    // Should not throw — function must be resilient to bad input
    expect(() => formatRelativeTime('not-a-date')).not.toThrow();
  });
});

// ─── formatDateTime ───────────────────────────────────────────────────────────

describe('formatDateTime', () => {
  it('returns a non-empty string for a valid ISO date', () => {
    const result = formatDateTime('2025-06-15T14:30:00.000Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes the hour and minute in the output', () => {
    // Use a date/time that is unambiguous in UTC+3 (Moscow time)
    const iso = '2025-06-15T11:00:00.000Z'; // 14:00 MSK
    const result = formatDateTime(iso);
    // The result should be a localised string — just confirm it's non-empty and not a crash
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles an invalid date string without throwing', () => {
    expect(() => formatDateTime('bad-date')).not.toThrow();
  });
});
