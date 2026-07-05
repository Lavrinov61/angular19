-- Поля для отслеживания отправленных напоминаний об оплате
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS final_reminder_sent_at TIMESTAMPTZ;
