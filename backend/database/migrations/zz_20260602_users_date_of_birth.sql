-- Дата рождения как отдельная колонка users.date_of_birth — для точной идентификации
-- студента при фото-верификации. Ранее ДР хранилась только в personal_data->>'dateOfBirth'
-- (заполнена частично, без типа/валидации). Идемпотентно.

ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth date;

-- Бэкофилл из исторического personal_data->>'dateOfBirth' (только валидный формат YYYY-MM-DD)
UPDATE users
   SET date_of_birth = (personal_data->>'dateOfBirth')::date
 WHERE date_of_birth IS NULL
   AND personal_data->>'dateOfBirth' ~ '^\d{4}-\d{2}-\d{2}$';

COMMENT ON COLUMN users.date_of_birth IS
  'Дата рождения (идентификация). Бэкофилл из personal_data.dateOfBirth 2026-06-02.';
