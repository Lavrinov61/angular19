-- ============================================================================
-- RBAC Seed Data
-- Seeds 5 roles, 21 permissions, and role-permission mappings
-- mirroring the current static ROLE_PERMISSIONS map.
-- ============================================================================

-- 1. Permissions (19 existing + pricing:manage + pricing:read)
INSERT INTO rbac_permissions (slug, display_name, module, sort_order) VALUES
  ('inbox:view',           'Просмотр входящих',             'inbox',         10),
  ('inbox:manage',         'Управление входящими',          'inbox',         20),
  ('chat:reply',           'Ответ в чате',                  'chat',          30),
  ('chat:assign',          'Назначение чата',               'chat',          40),
  ('tasks:manage',         'Управление задачами',           'tasks',         50),
  ('pos:use',              'Касса (POS)',                   'pos',           60),
  ('catalog:manage',       'Управление каталогом',          'catalog',       70),
  ('subscriptions:manage', 'Управление подписками',         'subscriptions', 80),
  ('analytics:view',       'Просмотр аналитики',            'analytics',     90),
  ('shifts:manage',        'Управление сменами',            'shifts',        100),
  ('reports:view',         'Просмотр отчётов',              'reports',       110),
  ('clients:view',         'Просмотр клиентов',             'clients',       120),
  ('team:chat',            'Командный чат',                 'team',          130),
  ('bookings:manage',      'Управление записями',           'bookings',      140),
  ('settings:manage',      'Системные настройки',           'settings',      150),
  ('workflows:manage',     'Автоматизации',                 'workflows',     160),
  ('partners:manage',      'Управление партнёрами',         'partners',      170),
  ('users:manage',         'Управление пользователями',     'users',         180),
  ('production:manage',    'Управление производством',      'production',    190),
  ('pricing:manage',       'Редактирование прайса',         'pricing',       200),
  ('pricing:read',         'Просмотр прайса (CRM)',         'pricing',       210)
ON CONFLICT (slug) DO NOTHING;

-- 2. Roles
INSERT INTO rbac_roles (slug, display_name, description, is_system, sort_order) VALUES
  ('admin',        'Администратор', 'Полный доступ ко всем функциям системы',          TRUE, 10),
  ('manager',      'Менеджер',      'Управление операциями без системных настроек',    TRUE, 20),
  ('employee',     'Сотрудник',     'Базовые рабочие инструменты',                    TRUE, 30),
  ('photographer', 'Фотограф',      'Съёмка, согласование, коммуникация с клиентами', TRUE, 40),
  ('client',       'Клиент',        'Публичная часть сайта и личный кабинет',          TRUE, 50),
  ('partner',      'Партнёр',       'Участник партнёрской программы. Нет CRM-прав — доступ через таблицу partners.', TRUE, 60)
ON CONFLICT (slug) DO NOTHING;

-- 3. Role-permission mappings

-- Admin: all 21 permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r CROSS JOIN rbac_permissions p
WHERE r.slug = 'admin' AND p.is_active = TRUE
ON CONFLICT DO NOTHING;

-- Manager: all except settings:manage, users:manage
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r CROSS JOIN rbac_permissions p
WHERE r.slug = 'manager'
  AND p.is_active = TRUE
  AND p.slug NOT IN ('settings:manage', 'users:manage')
ON CONFLICT DO NOTHING;

-- Employee: inbox:view, inbox:manage, chat:reply, chat:assign, tasks:manage,
--           pos:use, team:chat, bookings:manage, production:manage, pricing:read, clients:view
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r, rbac_permissions p
WHERE r.slug = 'employee'
  AND p.slug IN (
    'inbox:view', 'inbox:manage', 'chat:reply', 'chat:assign',
    'tasks:manage', 'pos:use', 'team:chat', 'bookings:manage',
    'production:manage', 'pricing:read', 'clients:view'
  )
ON CONFLICT DO NOTHING;

-- Photographer: inbox:view, chat:reply, tasks:manage, team:chat, bookings:manage, clients:view
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r, rbac_permissions p
WHERE r.slug = 'photographer'
  AND p.slug IN (
    'inbox:view', 'chat:reply', 'tasks:manage', 'team:chat',
    'bookings:manage', 'clients:view'
  )
ON CONFLICT DO NOTHING;

-- Client: no permissions (intentionally empty)
