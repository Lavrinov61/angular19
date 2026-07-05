-- Migration 113: users.department + backfill фамилий сотрудниц reception
-- Дата: 2026-04-17
--
-- Цель:
--   1. Добавить колонку department для классификации сотрудников по отделам
--      (photography / retouching / printing / reception / management).
--   2. Заполнить first_name / last_name / display_name для двух действующих
--      reception-сотрудниц (Бутенко Оля, Яковлева Ольга).
--
-- Идемпотентно: IF NOT EXISTS, DO-block для CHECK, UPDATE по id.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department VARCHAR(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_department_check'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_department_check
      CHECK (
        department IS NULL
        OR department IN ('photography', 'retouching', 'printing', 'reception', 'management')
      );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_users_department
  ON users(department)
  WHERE department IS NOT NULL;

COMMENT ON COLUMN users.department IS
  'Отдел сотрудника: photography, retouching, printing, reception, management. NULL для клиентов и аккаунтов вне штатного расписания.';

COMMENT ON COLUMN users.first_name IS
  'Имя сотрудника (для отображения в staff-chat, CRM, подписей в уведомлениях).';

COMMENT ON COLUMN users.last_name IS
  'Фамилия сотрудника (для поиска в CRM и формирования display_name вида "Фамилия Имя").';

UPDATE users
SET first_name   = 'Оля',
    last_name    = 'Бутенко',
    display_name = 'Бутенко Оля',
    department   = 'reception'
WHERE id = '95cbc327-eca5-4ac5-a4d3-063346231ae9';

UPDATE users
SET first_name   = 'Ольга',
    last_name    = 'Яковлева',
    display_name = 'Яковлева Ольга',
    department   = 'reception'
WHERE id = 'b92127a0-c435-4c91-81ad-ee86dc35c3a0';

COMMIT;
