-- Migration 127: Freeze service_option_features.name (no-rename policy).
-- Rationale: order_items.metadata.disabled_features хранит имена (snapshot, not FK).
-- Rename strings в service_option_features.name разошёл бы snapshot со справочником
-- и VIEW v_order_item_features перестал бы помечать is_disabled для старых заказов.
-- Вместо ALTER политики руками — RAISE EXCEPTION на UPDATE name. Safer.
-- Идемпотентно.

BEGIN;

CREATE OR REPLACE FUNCTION sof_reject_name_update() RETURNS trigger AS $fn$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION
      'service_option_features.name is immutable (feature-level pricing snapshot). '
      'To rename: set is_active=false on old row and INSERT new row.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sof_reject_name_update ON service_option_features;
CREATE TRIGGER trg_sof_reject_name_update
  BEFORE UPDATE OF name ON service_option_features
  FOR EACH ROW EXECUTE FUNCTION sof_reject_name_update();

COMMENT ON FUNCTION sof_reject_name_update() IS
  'Guard: enforces no-rename policy on service_option_features.name. Drop this trigger '
  'only if migrating to {id,name} jsonb snapshot in order_items.metadata.disabled_features.';

COMMIT;
