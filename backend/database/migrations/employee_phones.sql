-- Обновление телефонов сотрудников (идемпотентно)
UPDATE users SET phone = '89888952182' WHERE display_name ILIKE '%Анна%' AND role IN ('employee', 'photographer') AND (phone IS NULL OR phone != '89888952182');
UPDATE users SET phone = '89081999839' WHERE display_name ILIKE '%Ольга%' AND role IN ('employee', 'photographer') AND (phone IS NULL OR phone != '89081999839');
UPDATE users SET phone = '89885307050' WHERE display_name ILIKE '%Маргарита%' AND role IN ('employee', 'photographer') AND (phone IS NULL OR phone != '89885307050');
UPDATE users SET phone = '89896238448' WHERE role = 'admin' AND (phone IS NULL OR phone != '89896238448');
