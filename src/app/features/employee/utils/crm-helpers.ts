export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    open: 'Новая', assigned: 'Назначена', in_progress: 'В работе',
    waiting: 'Ожидание', handed_off: 'Передана', completed: 'Готово', cancelled: 'Отменена',
  };
  return labels[status] || status;
}

export function typeIcon(type: string): string {
  const icons: Record<string, string> = {
    photo_order: 'print', chat_inquiry: 'chat', walk_in: 'storefront',
    callback: 'phone_callback', retouch: 'auto_fix_high', delivery: 'local_shipping',
    internal: 'assignment', cross_location: 'swap_horiz',
  };
  return icons[type] || 'task';
}

export function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    photo_order: 'Заказ', chat_inquiry: 'Из чата', walk_in: 'На точке',
    callback: 'Перезвонить', retouch: 'Ретушь', delivery: 'Доставка',
    internal: 'Внутренняя', cross_location: 'Межточечная',
  };
  return labels[type] || type;
}

const BRAND_CHANNELS = new Set(['telegram', 'vk', 'whatsapp', 'instagram', 'max']);

export function isBrandChannel(channel?: string): boolean {
  return BRAND_CHANNELS.has(channel || '');
}

export function channelSvgIcon(channel: string): string {
  return `channel-${channel}`;
}

export function channelIcon(channel?: string): string {
  const icons: Record<string, string> = {
    whatsapp: 'chat', telegram: 'send', online: 'language',
    website: 'language', web: 'language', walk_in: 'storefront', phone: 'phone',
    max: 'chat_bubble', vk: 'group', instagram: 'photo_camera', studio: 'store',
  };
  return icons[channel || ''] || 'person';
}

export function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    whatsapp: 'WhatsApp', telegram: 'Telegram', online: 'Онлайн',
    website: 'Сайт', web: 'Сайт', walk_in: 'На точке', phone: 'Телефон',
    max: 'МАКС', vk: 'VK', instagram: 'Instagram', studio: 'Студия',
  };
  return labels[channel] || channel;
}

export function channelColor(channel: string): string {
  const colors: Record<string, string> = {
    vk: '#4c75a3', telegram: '#26a5e4', whatsapp: '#25d366',
    max: '#34d399', instagram: '#E4405F',
    online: '#f59e0b', website: '#f59e0b', web: '#f59e0b', studio: '#f59e0b',
  };
  return colors[channel] || '#9ca3af';
}

export function priorityLabel(priority: string): string {
  const labels: Record<string, string> = {
    urgent: 'Срочно', high: 'Высокий', normal: 'Обычный', low: 'Низкий',
  };
  return labels[priority] || priority;
}

export function shiftStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    scheduled: 'Запланирована', active: 'Активна', completed: 'Завершена', cancelled: 'Отменена',
  };
  return labels[status] || status;
}

export function orderStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: 'Новый', pending_payment: 'Ожидание оплаты', processing: 'В работе',
    ready: 'Готов', completed: 'Завершён', cancelled: 'Отменён',
    payment_failed: 'Ошибка оплаты', expired: 'Истёк',
  };
  return labels[status] || status;
}

export function paymentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    none: 'Нет', pending: 'Ожидание', paid: 'Оплачен',
    failed: 'Ошибка', refunded: 'Возврат', expired: 'Истёк', cancelled: 'Отменён',
  };
  return labels[status] || status;
}

export function paymentStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    paid: 'check_circle', pending: 'schedule', none: 'radio_button_unchecked',
    failed: 'error', refunded: 'undo', expired: 'timer_off', cancelled: 'cancel',
  };
  return icons[status] || 'help';
}

export function formatRelativeTime(iso: string, _tick?: number): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} дн назад`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
