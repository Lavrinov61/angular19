import { AuthProvider, RecentRegistration } from '../../services/registrations-api.service';

export function displayName(row: RecentRegistration): string {
  if (row.display_name) return row.display_name;
  const parts = [row.first_name, row.last_name].filter((v): v is string => !!v);
  return parts.join(' ');
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  client: 'Клиент',
  employee: 'Сотрудник',
  admin: 'Админ',
  photographer: 'Фотограф',
};
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

const PROVIDER_LABELS: Readonly<Record<AuthProvider, string>> = {
  yandex: 'Яндекс',
  telegram: 'Telegram',
  google: 'Google',
  apple: 'Apple',
  vk: 'VK',
  sber: 'Сбер',
  mts: 'МТС',
  email: 'Email',
  phone: 'Телефон',
};
export function providerLabel(p: AuthProvider): string {
  return PROVIDER_LABELS[p] ?? p;
}

const PROVIDER_ICONS: Readonly<Record<AuthProvider, string>> = {
  yandex: 'account_circle',
  telegram: 'send',
  google: 'public',
  apple: 'phone_iphone',
  vk: 'group',
  sber: 'account_balance',
  mts: 'sim_card',
  email: 'mail',
  phone: 'phone',
};
export function providerIcon(p: AuthProvider): string {
  return PROVIDER_ICONS[p] ?? 'login';
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export function initials(row: RecentRegistration): string {
  const name = displayName(row);
  const base = (name || row.email || '').trim();
  if (!base) return '?';
  const ch = base.charAt(0);
  return ch.toUpperCase();
}
