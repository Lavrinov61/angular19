/**
 * Static permission map for role-based access control.
 * 6 roles, 21 permissions — no DB table needed for static fallback.
 *
 * NOTE: `partner` is a business entity (table `partners`), not a CRM role.
 * A user with role `partner` has zero CRM permissions; access to partner
 * self-service API is controlled by presence of a record in `partners`.
 */

export type Permission =
  | 'inbox:view'
  | 'inbox:manage'
  | 'inbox:all_chats'
  | 'chat:reply'
  | 'chat:assign'
  | 'chat:transfer'
  | 'chat:claim'
  | 'tasks:manage'
  | 'pos:use'
  | 'catalog:manage'
  | 'subscriptions:manage'
  | 'students:verify'
  | 'analytics:view'
  | 'shifts:manage'
  | 'reports:view'
  | 'clients:view'
  | 'team:chat'
  | 'bookings:manage'
  | 'settings:manage'
  | 'workflows:manage'
  | 'partners:manage'
  | 'users:manage'
  | 'production:manage'
  | 'pricing:manage'
  | 'pricing:read'
  | 'campaigns:manage';

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [
    'inbox:view', 'inbox:manage', 'inbox:all_chats',
    'chat:reply', 'chat:assign', 'chat:transfer', 'chat:claim',
    'tasks:manage', 'pos:use', 'catalog:manage', 'subscriptions:manage', 'students:verify',
    'analytics:view', 'shifts:manage', 'reports:view', 'clients:view',
    'team:chat', 'bookings:manage', 'settings:manage',
    'workflows:manage', 'partners:manage', 'users:manage', 'production:manage',
    'pricing:manage', 'pricing:read', 'campaigns:manage',
  ],
  // manager = admin минус settings:manage и inbox:all_chats
  manager: [
    'inbox:view', 'inbox:manage',
    'chat:reply', 'chat:assign', 'chat:transfer', 'chat:claim',
    'tasks:manage', 'pos:use', 'catalog:manage', 'subscriptions:manage', 'students:verify',
    'analytics:view', 'shifts:manage', 'reports:view', 'clients:view',
    'team:chat', 'bookings:manage',
    'workflows:manage', 'partners:manage', 'production:manage',
    'pricing:manage', 'pricing:read', 'campaigns:manage',
  ],
  employee: [
    'inbox:view', 'inbox:manage',
    'chat:reply', 'chat:assign', 'chat:transfer', 'chat:claim',
    'tasks:manage', 'pos:use', 'team:chat', 'bookings:manage',
    'production:manage', 'pricing:read', 'clients:view',
    'shifts:manage', 'students:verify',
  ],
  photographer: [
    'inbox:view', 'chat:reply', 'tasks:manage', 'team:chat',
    'bookings:manage', 'clients:view',
  ],
  client: [],
  // partner = пользователь, зарегистрированный в партнёрской программе.
  // Не имеет CRM-прав — доступ к кабинету партнёра через таблицу partners, не через RBAC.
  partner: [],
};

export function hasPermission(role: string, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

export function getPermissions(role: string): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}
