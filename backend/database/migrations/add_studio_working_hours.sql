-- Миграция: рабочие часы студий
-- Таблица хранит расписание работы каждой студии по дням недели
-- Используется как fallback для генерации слотов когда нет employee_shifts

-- Шаг 1: добавить location_code в studios если ещё не существует
ALTER TABLE studios ADD COLUMN IF NOT EXISTS location_code VARCHAR(20) UNIQUE;

-- Шаг 2: создать студии если отсутствуют
INSERT INTO studios (name, address, description)
SELECT 'Студия на Соборном', 'г. Ростов-на-Дону, переулок Соборный 21', 'Фотостудия в центре города'
WHERE NOT EXISTS (SELECT 1 FROM studios WHERE name ILIKE '%соборн%');

INSERT INTO studios (name, address, description)
SELECT 'Студия на 2-ой Баррикадной', 'г. Ростов-на-Дону, ул. 2-ая Баррикадная 4', 'Фотостудия на Стачки'
WHERE NOT EXISTS (SELECT 1 FROM studios WHERE name ILIKE '%баррикад%');

-- Шаг 3: проставить location_code если не заполнен
UPDATE studios SET location_code = 'soborny' WHERE name ILIKE '%соборн%' AND location_code IS NULL;
UPDATE studios SET location_code = 'barrikadnaya-4' WHERE name ILIKE '%баррикад%' AND location_code IS NULL;

-- Шаг 4: создать таблицу рабочих часов
CREATE TABLE IF NOT EXISTS studio_working_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Пн, 1=Вт, 2=Ср, 3=Чт, 4=Пт, 5=Сб, 6=Вс
  start_time TIME NOT NULL DEFAULT '09:00',
  end_time TIME NOT NULL DEFAULT '19:30',
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (studio_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_studio_working_hours_studio ON studio_working_hours(studio_id);

-- Шаг 5: начальные данные — Пн–Вс 09:00–19:30 для обеих студий
INSERT INTO studio_working_hours (studio_id, day_of_week, start_time, end_time, is_open)
SELECT s.id, d.day, '09:00'::TIME, '19:30'::TIME, TRUE
FROM studios s
CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6)) AS d(day)
WHERE s.location_code IN ('soborny', 'barrikadnaya-4')
ON CONFLICT (studio_id, day_of_week) DO NOTHING;

