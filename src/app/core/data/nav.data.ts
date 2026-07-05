export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  activeIcon?: string;
  badge?: number;
  children?: NavItem[];
  isExpanded?: boolean;
  description?: string;
  group?: string;
}

export const MAIN_MENU: NavItem[] = [
  { label: 'Услуги', href: '/services', icon: 'business_center_outlined', activeIcon: 'business_center' },
  {
    label: 'Фотографы',
    href: '/photographers',
    icon: 'person_outlined',
    activeIcon: 'person'
  },
  { label: 'Отзывы', href: '/testimonials', icon: 'star_border', activeIcon: 'star' },
  { label: 'Запись', href: '/booking', icon: 'event_outlined', activeIcon: 'event' },
  { label: 'Контакты', href: '/contacts', icon: 'phone_outlined', activeIcon: 'phone' }
];

/** Компактное меню «Мой кабинет» для sidenav (авторизованный клиент) */
export const CLIENT_CABINET_MENU: NavItem[] = [
  { label: 'Профиль', href: '/user-profile', icon: 'person_outlined', activeIcon: 'person' },
  { label: 'Выгодно', href: '/user-profile/subscription', icon: 'percent_outlined', activeIcon: 'percent' },
  { label: 'Заказы', href: '/user-profile/orders', icon: 'receipt_long_outlined', activeIcon: 'receipt_long' },
  { label: 'Мои записи', href: '/user-profile/bookings', icon: 'event_outlined', activeIcon: 'event' },
  { label: 'Аккаунт', href: '/user-profile/account', icon: 'manage_accounts_outlined', activeIcon: 'manage_accounts' },
];

export const PHOTOGRAPHER_DASHBOARD_MENU: NavItem[] = [
  { label: 'Дашборд фотографа', href: '/photographer-dashboard', icon: 'dashboard_outlined', activeIcon: 'dashboard' },
  { label: 'Управление расписанием', href: '/photographer-dashboard/schedule', icon: 'schedule_outlined', activeIcon: 'schedule' },
  { label: 'Мои бронирования', href: '/photographer-dashboard/bookings', icon: 'book_online_outlined', activeIcon: 'book_online' },
  { label: 'Профиль фотографа', href: '/photographer-dashboard/profile', icon: 'photo_camera_outlined', activeIcon: 'photo_camera' }
];
