-- Migration 054: FK print_jobs.order_id → photo_print_orders.order_id
BEGIN;

-- Clean orphan references
UPDATE print_jobs
SET order_id = NULL
WHERE order_id IS NOT NULL
  AND order_id NOT IN (SELECT order_id FROM photo_print_orders WHERE order_id IS NOT NULL);

-- Add FK (idempotent: drop first)
ALTER TABLE print_jobs
  DROP CONSTRAINT IF EXISTS print_jobs_photo_print_order_fk;

ALTER TABLE print_jobs
  ADD CONSTRAINT print_jobs_photo_print_order_fk
    FOREIGN KEY (order_id) REFERENCES photo_print_orders(order_id)
    ON DELETE SET NULL;

COMMIT;
