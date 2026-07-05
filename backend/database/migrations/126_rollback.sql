-- Rollback для 126_service_option_features.sql
-- Применять только если миграция откатывается. Данные order_items.metadata.disabled_features
-- НЕ удаляются (safe snapshot). service_options.features (JSONB) не трогалась миграцией.

BEGIN;

DROP VIEW  IF EXISTS v_order_item_features;
DROP INDEX IF EXISTS ix_order_items_disabled_features;
DROP TRIGGER IF EXISTS trg_sof_updated_at ON service_option_features;
DROP TABLE IF EXISTS service_option_features;
DROP FUNCTION IF EXISTS sof_set_updated_at();

COMMIT;
