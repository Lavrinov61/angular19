-- Migration 115: добавить uniform_description в photo_print_orders (2026-04-19)
--
-- Цель: отдельное поле для названия/описания формы при услуге "Подстановка формы".
-- Раньше такого поля не было — только чекбокс hasFormOverlay и загрузка образца.
-- wishes занят под пожелания по костюму (suitWishes), поэтому вводим новую колонку.

BEGIN;

ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS uniform_description text;

COMMENT ON COLUMN photo_print_orders.uniform_description IS
  'Название/описание формы для подстановки (пример: "парадная ВМФ", "полиция МВД"). Заполняется в форме создания CRM-заказа.';

COMMIT;
