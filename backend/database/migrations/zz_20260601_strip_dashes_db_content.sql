-- zz_20260601_strip_dashes_db_content.sql
-- Убираем длинное (—) и среднее (–) тире из ПУБЛИЧНОГО контента в БД.
-- Правило владельца: в пользовательских текстах тире не используем
-- (диапазоны цифр -> дефис, тире-разделитель предложения -> запятая).
-- Идемпотентно: повторный запуск ничего не меняет (тире уже нет).
-- Запускается ПОСЛЕ сид-миграций (префикс zz_), поэтому при чистой установке
-- сначала вставляется сид с тире, затем эта миграция его вычищает.
--
-- 4 прохода (вложенный regexp_replace, внутренний выполняется первым):
--   A  ([0-9]) — ([0-9])                 -> дефис   (диапазоны 10–15, 400–600)
--   B  (alnum)—(alnum) без пробелов       -> дефис   (Пн–Вс и т.п.)
--   C  пробел(ы) — пробел(ы)              -> запятая (тире-разделитель)
--   D  любой оставшийся —/–               -> дефис

-- promotions.description
UPDATE promotions SET description = regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  description,
  '([0-9])[ ]*[—–][ ]*([0-9])','\1-\2','g'),
  '([0-9A-Za-zА-Яа-яЁё])[—–]([0-9A-Za-zА-Яа-яЁё])','\1-\2','g'),
  '[ ]+[—–][ ]+',', ','g'),
  '[—–]','-','g')
WHERE description ~ '[—–]';

-- subscription_plans.description
UPDATE subscription_plans SET description = regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  description,
  '([0-9])[ ]*[—–][ ]*([0-9])','\1-\2','g'),
  '([0-9A-Za-zА-Яа-яЁё])[—–]([0-9A-Za-zА-Яа-яЁё])','\1-\2','g'),
  '[ ]+[—–][ ]+',', ','g'),
  '[—–]','-','g')
WHERE description ~ '[—–]';

-- service_categories.description
UPDATE service_categories SET description = regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  description,
  '([0-9])[ ]*[—–][ ]*([0-9])','\1-\2','g'),
  '([0-9A-Za-zА-Яа-яЁё])[—–]([0-9A-Za-zА-Яа-яЁё])','\1-\2','g'),
  '[ ]+[—–][ ]+',', ','g'),
  '[—–]','-','g')
WHERE description ~ '[—–]';

-- photographers.bio
UPDATE photographers SET bio = regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  bio,
  '([0-9])[ ]*[—–][ ]*([0-9])','\1-\2','g'),
  '([0-9A-Za-zА-Яа-яЁё])[—–]([0-9A-Za-zА-Яа-яЁё])','\1-\2','g'),
  '[ ]+[—–][ ]+',', ','g'),
  '[—–]','-','g')
WHERE bio ~ '[—–]';

-- service_options: description, promo_description, name
UPDATE service_options SET
  description = regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    description,
    '([0-9])[ ]*[—–][ ]*([0-9])','\1-\2','g'),
    '([0-9A-Za-zА-Яа-яЁё])[—–]([0-9A-Za-zА-Яа-яЁё])','\1-\2','g'),
    '[ ]+[—–][ ]+',', ','g'),
    '[—–]','-','g'),
  promo_description = regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    promo_description,
    '([0-9])[ ]*[—–][ ]*([0-9])','\1-\2','g'),
    '([0-9A-Za-zА-Яа-яЁё])[—–]([0-9A-Za-zА-Яа-яЁё])','\1-\2','g'),
    '[ ]+[—–][ ]+',', ','g'),
    '[—–]','-','g'),
  name = regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    name,
    '([0-9])[ ]*[—–][ ]*([0-9])','\1-\2','g'),
    '([0-9A-Za-zА-Яа-яЁё])[—–]([0-9A-Za-zА-Яа-яЁё])','\1-\2','g'),
    '[ ]+[—–][ ]+',', ','g'),
    '[—–]','-','g')
WHERE description ~ '[—–]' OR promo_description ~ '[—–]' OR name ~ '[—–]';
