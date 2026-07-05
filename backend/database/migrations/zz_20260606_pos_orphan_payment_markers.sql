-- Осиротевшие карт-оплаты POS: маркеры дедупа уведомлений.
--
-- Orphan = pos_transactions(transaction_type='payment', status='completed') без
-- привязанного чека (settled_receipt_id NULL, receipt_id NULL, нет строки в
-- pos_receipt_payments по transaction_id). Деньги списаны терминалом, но чек не
-- оформился. Колонки ниже — ТОЛЬКО для дедупа уведомлений (сотрудник/клиент),
-- факт оформления чека маркируется штатно (payment_resolution='resolved_paid' +
-- settled_receipt_id, как в /payments/:id/resolve).
--
-- Аддитивно и идемпотентно (3 NULL-колонки + частичный индекс). До первого
-- прогона sweep'а колонки только-NULL → happy-path не затронут.

ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS orphan_detected_at         timestamptz;
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS orphan_notified_at         timestamptz; -- сотрудник
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS orphan_client_notified_at  timestamptz; -- клиент в чат

-- Частичный индекс под детектор: покрывает WHERE sweep'а до NOT EXISTS-проверки
-- по pos_receipt_payments. orphan_notified_at IS NULL — детект до уведомления.
CREATE INDEX IF NOT EXISTS idx_pos_transactions_orphan_detect
  ON pos_transactions (studio_id, completed_at)
  WHERE transaction_type = 'payment' AND status = 'completed'
    AND payment_resolution IS NULL AND settled_receipt_id IS NULL
    AND receipt_id IS NULL AND orphan_notified_at IS NULL;
