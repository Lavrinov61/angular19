-- Стажировочный бонус: +500₽/смена за первые 5 рабочих дней при трудоустройстве
-- Идемпотентно

BEGIN;

-- 1. Колонка hired_date в users
ALTER TABLE users ADD COLUMN IF NOT EXISTS hired_date DATE;

-- 2. Проставить даты трудоустройства
UPDATE users SET hired_date = '2026-01-23' WHERE id = 'f6e46c1b-205e-496b-a231-bb3903653dd9'; -- Маргарита (фактический первый рабочий день)
UPDATE users SET hired_date = '2026-02-06' WHERE id = 'b92127a0-c435-4c91-81ad-ee86dc35c3a0'; -- Оля
-- Анна и Админ: hired_date = NULL (стажировка до начала данных)

-- 3. Январские смены Маргариты (стажировочные) — Соборный, completed
INSERT INTO employee_shifts (employee_id, studio_id, shift_date, start_time, end_time, status)
VALUES
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-01-23', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-01-26', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-01-27', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-01-30', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-01-31', '09:00', '19:30', 'completed')
ON CONFLICT (employee_id, shift_date) DO UPDATE SET
  studio_id = EXCLUDED.studio_id,
  status = EXCLUDED.status,
  updated_at = NOW();

COMMIT;
