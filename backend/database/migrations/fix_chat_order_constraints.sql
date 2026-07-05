-- Миграция: Ослабить NOT NULL constraints для чат-заказов
-- Чат-заказы (от посетителей сайта) не всегда имеют телефон и имя клиента.
-- contact_phone и contact_name были NOT NULL, что блокировало создание чат-заказов.

ALTER TABLE photo_print_orders ALTER COLUMN contact_phone DROP NOT NULL;
ALTER TABLE photo_print_orders ALTER COLUMN contact_name DROP NOT NULL;
