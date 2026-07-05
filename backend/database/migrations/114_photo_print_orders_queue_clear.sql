-- Migration 114: Очистка очереди photo_print_orders (2026-04-19)
--
-- Цель:
--   Перевести все активные заказы печати (58 шт: 56 processing + 2 new)
--   в статус 'completed' для разгрузки очереди производства.
--
-- Скоуп: status IN ('new', 'pending_payment', 'paid', 'processing', 'ready').
-- НЕ трогать: 'payment_failed', 'expired', 'cancelled', 'completed', 'refunded'.
--
-- Идемпотентно: CREATE TABLE IF NOT EXISTS + UPDATE по статус-фильтру.

BEGIN;

CREATE TABLE IF NOT EXISTS backup_photo_print_orders_queue_clear_2026_04_19 AS
SELECT *
FROM photo_print_orders
WHERE status IN ('new', 'pending_payment', 'paid', 'processing', 'ready');

COMMENT ON TABLE backup_photo_print_orders_queue_clear_2026_04_19 IS
  'Снимок активных photo_print_orders перед массовой очисткой очереди 2026-04-19. Источник отката для migration 114.';

DO $$
DECLARE
  active_before INTEGER;
  backup_size INTEGER;
BEGIN
  SELECT COUNT(*) INTO active_before
  FROM photo_print_orders
  WHERE status IN ('new', 'pending_payment', 'paid', 'processing', 'ready');

  SELECT COUNT(*) INTO backup_size
  FROM backup_photo_print_orders_queue_clear_2026_04_19;

  RAISE NOTICE 'Активных заказов к обработке: %, размер бэкапа: %', active_before, backup_size;

  IF active_before > 0 AND backup_size < active_before THEN
    RAISE EXCEPTION 'Backup size (%) < active rows (%). Abort.', backup_size, active_before;
  END IF;
END$$;

WITH updated AS (
  UPDATE photo_print_orders
  SET
    status       = 'completed',
    completed_at = NOW(),
    processed_at = COALESCE(processed_at, NOW())
  WHERE status IN ('new', 'pending_payment', 'paid', 'processing', 'ready')
  RETURNING id, status
)
SELECT COUNT(*) AS rows_completed FROM updated;

DO $$
DECLARE
  active_after INTEGER;
  total_completed INTEGER;
BEGIN
  SELECT COUNT(*) INTO active_after
  FROM photo_print_orders
  WHERE status IN ('new', 'pending_payment', 'paid', 'processing', 'ready');

  SELECT COUNT(*) INTO total_completed
  FROM photo_print_orders
  WHERE status = 'completed';

  RAISE NOTICE 'После UPDATE: активных=%, completed=%', active_after, total_completed;

  IF active_after > 0 THEN
    RAISE EXCEPTION 'Migration failed: осталось % активных заказов', active_after;
  END IF;
END$$;

COMMIT;

-- ==============================================================
-- ROLLBACK (выполнять ВРУЧНУЮ отдельной транзакцией если нужно):
-- ==============================================================
-- BEGIN;
-- UPDATE photo_print_orders AS p
-- SET status=b.status, completed_at=b.completed_at, processed_at=b.processed_at
-- FROM backup_photo_print_orders_queue_clear_2026_04_19 AS b
-- WHERE p.id = b.id;
-- COMMIT;
--
-- Удаление бэкапа после успешного применения (спустя 7-14 дней):
--   DROP TABLE IF EXISTS backup_photo_print_orders_queue_clear_2026_04_19;
