-- Бэкфил смен за февраль и март 2026 + выручка за февраль
-- Идемпотентно: ON CONFLICT DO UPDATE

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 0. Очистка тестовых данных (scheduled-смены Feb 21)
-- ═══════════════════════════════════════════════════════════════
DELETE FROM employee_shifts
WHERE shift_date = '2026-02-21'
  AND status = 'scheduled'
  AND employee_id IN (
    'b92127a0-c435-4c91-81ad-ee86dc35c3a0',  -- Оля
    'f6e46c1b-205e-496b-a231-bb3903653dd9',  -- Маргарита
    'fd5ebe64-eb34-4412-82f9-d5e850ff460f'   -- Анна
  );

-- ═══════════════════════════════════════════════════════════════
-- 1. ФЕВРАЛЬ 2026 — все completed, все на Соборном
-- ═══════════════════════════════════════════════════════════════

-- Анна — 13 дней (fd5ebe64-eb34-4412-82f9-d5e850ff460f)
INSERT INTO employee_shifts (employee_id, studio_id, shift_date, start_time, end_time, status)
VALUES
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-01', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-05', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-06', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-09', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-10', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-13', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-14', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-17', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-18', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-21', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-22', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-25', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-26', '09:00', '19:30', 'completed')
ON CONFLICT (employee_id, shift_date) DO UPDATE SET
  studio_id = EXCLUDED.studio_id,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  status = EXCLUDED.status,
  updated_at = NOW();

-- Маргарита — 5 дней (f6e46c1b-205e-496b-a231-bb3903653dd9)
INSERT INTO employee_shifts (employee_id, studio_id, shift_date, start_time, end_time, status)
VALUES
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-02', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-03', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-04', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-07', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-08', '09:00', '19:30', 'completed')
ON CONFLICT (employee_id, shift_date) DO UPDATE SET
  studio_id = EXCLUDED.studio_id,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  status = EXCLUDED.status,
  updated_at = NOW();

-- Оля — 10 дней (b92127a0-c435-4c91-81ad-ee86dc35c3a0)
INSERT INTO employee_shifts (employee_id, studio_id, shift_date, start_time, end_time, status)
VALUES
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-11', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-12', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-15', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-16', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-19', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-20', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-23', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-24', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-27', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-02-28', '09:00', '19:30', 'completed')
ON CONFLICT (employee_id, shift_date) DO UPDATE SET
  studio_id = EXCLUDED.studio_id,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  status = EXCLUDED.status,
  updated_at = NOW();

-- ═══════════════════════════════════════════════════════════════
-- 2. МАРТ 2026 — Анна + Оля на Соборном (3/3 → 2/2)
-- ═══════════════════════════════════════════════════════════════

-- Анна — 16 дней на Соборном
INSERT INTO employee_shifts (employee_id, studio_id, shift_date, start_time, end_time, status)
VALUES
  -- 3/3 блок
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-01', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-02', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-03', '09:00', '19:30', 'completed'),
  -- 2/2 блоки
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-07', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-08', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-11', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-12', '09:00', '19:30', 'completed'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-15', '09:00', '19:30', 'scheduled'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-16', '09:00', '19:30', 'scheduled'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-19', '09:00', '19:30', 'scheduled'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-20', '09:00', '19:30', 'scheduled'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-23', '09:00', '19:30', 'scheduled'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-24', '09:00', '19:30', 'scheduled'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-27', '09:00', '19:30', 'scheduled'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-28', '09:00', '19:30', 'scheduled'),
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-31', '09:00', '19:30', 'scheduled')
ON CONFLICT (employee_id, shift_date) DO UPDATE SET
  studio_id = EXCLUDED.studio_id,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  status = EXCLUDED.status,
  updated_at = NOW();

-- Оля — 15 дней на Соборном
INSERT INTO employee_shifts (employee_id, studio_id, shift_date, start_time, end_time, status)
VALUES
  -- 3/3 блок
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-04', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-05', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-06', '09:00', '19:30', 'completed'),
  -- 2/2 блоки
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-09', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-10', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-13', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-14', '09:00', '19:30', 'completed'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-17', '09:00', '19:30', 'scheduled'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-18', '09:00', '19:30', 'scheduled'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-21', '09:00', '19:30', 'scheduled'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-22', '09:00', '19:30', 'scheduled'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-25', '09:00', '19:30', 'scheduled'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-26', '09:00', '19:30', 'scheduled'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-29', '09:00', '19:30', 'scheduled'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-30', '09:00', '19:30', 'scheduled')
ON CONFLICT (employee_id, shift_date) DO UPDATE SET
  studio_id = EXCLUDED.studio_id,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  status = EXCLUDED.status,
  updated_at = NOW();

-- ═══════════════════════════════════════════════════════════════
-- 3. МАРТ 2026 — Маргарита: 7,8 Соборный + 2/2 Баррикадная с 10
-- ═══════════════════════════════════════════════════════════════

INSERT INTO employee_shifts (employee_id, studio_id, shift_date, start_time, end_time, status)
VALUES
  -- 7, 8 — Соборный
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-07', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', '2026-03-08', '09:00', '19:30', 'completed'),
  -- 2/2 на Баррикадной: 10,11, 14,15, 18,19, 22,23, 26,27, 30,31
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-10', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-11', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-14', '09:00', '19:30', 'completed'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-15', '09:00', '19:30', 'scheduled'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-18', '09:00', '19:30', 'scheduled'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-19', '09:00', '19:30', 'scheduled'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-22', '09:00', '19:30', 'scheduled'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-23', '09:00', '19:30', 'scheduled'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-26', '09:00', '19:30', 'scheduled'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-27', '09:00', '19:30', 'scheduled'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-30', '09:00', '19:30', 'scheduled'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', '2026-03-31', '09:00', '19:30', 'scheduled')
ON CONFLICT (employee_id, shift_date) DO UPDATE SET
  studio_id = EXCLUDED.studio_id,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  status = EXCLUDED.status,
  updated_at = NOW();

-- ═══════════════════════════════════════════════════════════════
-- 4. ВЫРУЧКА ЗА ФЕВРАЛЬ — employee_manual_revenue
-- ═══════════════════════════════════════════════════════════════

INSERT INTO employee_manual_revenue (employee_id, month, amount, description, created_by)
VALUES
  ('fd5ebe64-eb34-4412-82f9-d5e850ff460f', '2026-02', 114915.50, 'Касса февраль 2026', '724ba1f2-5ae9-4556-b269-2d916c30b118'),
  ('f6e46c1b-205e-496b-a231-bb3903653dd9', '2026-02', 64239.00, 'Касса февраль 2026', '724ba1f2-5ae9-4556-b269-2d916c30b118'),
  ('b92127a0-c435-4c91-81ad-ee86dc35c3a0', '2026-02', 29984.50, 'Касса февраль 2026', '724ba1f2-5ae9-4556-b269-2d916c30b118')
ON CONFLICT (employee_id, month) DO UPDATE SET
  amount = EXCLUDED.amount,
  description = EXCLUDED.description,
  updated_at = NOW();

COMMIT;
