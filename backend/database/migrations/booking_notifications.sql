-- Миграция: поля для уведомлений и напоминаний записей
-- Дата: 2026-02-15

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_email VARCHAR(255);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_1h_sent_at TIMESTAMPTZ;
