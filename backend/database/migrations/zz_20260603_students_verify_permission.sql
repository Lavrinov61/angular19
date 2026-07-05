-- Отдельный пермишен под фото-верификацию студентов (least privilege).
--
-- ДО: фича гейтилась `subscriptions:manage` → доступ только у admin/manager,
-- и этот же пермишен открывал управление подписками. Сотрудники (employee)
-- не могли проверять студенческие документы.
--
-- ПОСЛЕ: новый `students:verify` отвязывает «проверку фото» от «управления
-- подписками». Выдаём его admin, manager и employee (по решению владельца —
-- всем кассирам). Управление подписками остаётся за `subscriptions:manage`.
--
-- RBAC_USE_DB=true (dev и prod) → источник истины эти таблицы; статическая
-- карта config/permissions.ts — только фолбэк.
-- Идемпотентно: ON CONFLICT DO NOTHING.

INSERT INTO rbac_permissions (slug, display_name, description, module, sort_order, is_active)
VALUES (
  'students:verify',
  'Верификация студентов',
  'Проверка фото студенческих документов, утверждение/отклонение/отзыв студенческого статуса (даёт право на скидку).',
  'subscriptions',
  85,
  TRUE
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE p.slug = 'students:verify'
  AND r.slug IN ('admin', 'manager', 'employee')
ON CONFLICT (role_id, permission_id) DO NOTHING;
