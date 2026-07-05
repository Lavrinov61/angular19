-- ============================================================
-- Transactional Outbox for crm_inbox synchronization
--
-- PG triggers on 5 source tables guarantee that every committed
-- write produces an outbox event. Node.js poller reads events
-- and UPSERTs crm_inbox — no MV REFRESH needed.
--
-- Replaces broken REFRESH MATERIALIZED VIEW on YC Managed PG
-- (PgBouncer port 6432 doesn't reliably refresh MVs).
--
-- Idempotent: IF NOT EXISTS, OR REPLACE
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_event_outbox (
  id          BIGSERIAL PRIMARY KEY,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  op          TEXT NOT NULL, -- INSERT, UPDATE, DELETE
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_outbox_unprocessed
  ON crm_event_outbox (id ASC);

-- Trigger function: captures INSERT/UPDATE/DELETE on source tables
CREATE OR REPLACE FUNCTION crm_outbox_notify() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO crm_event_outbox (table_name, row_id, op)
    VALUES (TG_TABLE_NAME, OLD.id::text, TG_OP);
    RETURN OLD;
  ELSE
    INSERT INTO crm_event_outbox (table_name, row_id, op)
    VALUES (TG_TABLE_NAME, NEW.id::text, TG_OP);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers before recreating (idempotent)
DROP TRIGGER IF EXISTS trg_crm_outbox ON visitor_chat_sessions;
DROP TRIGGER IF EXISTS trg_crm_outbox ON work_tasks;
DROP TRIGGER IF EXISTS trg_crm_outbox ON bookings;
DROP TRIGGER IF EXISTS trg_crm_outbox ON photo_print_orders;
DROP TRIGGER IF EXISTS trg_crm_outbox ON photo_approval_sessions;

-- Attach triggers to 5 source tables
CREATE TRIGGER trg_crm_outbox
  AFTER INSERT OR UPDATE OR DELETE ON visitor_chat_sessions
  FOR EACH ROW EXECUTE FUNCTION crm_outbox_notify();

CREATE TRIGGER trg_crm_outbox
  AFTER INSERT OR UPDATE OR DELETE ON work_tasks
  FOR EACH ROW EXECUTE FUNCTION crm_outbox_notify();

CREATE TRIGGER trg_crm_outbox
  AFTER INSERT OR UPDATE OR DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION crm_outbox_notify();

CREATE TRIGGER trg_crm_outbox
  AFTER INSERT OR UPDATE OR DELETE ON photo_print_orders
  FOR EACH ROW EXECUTE FUNCTION crm_outbox_notify();

CREATE TRIGGER trg_crm_outbox
  AFTER INSERT OR UPDATE OR DELETE ON photo_approval_sessions
  FOR EACH ROW EXECUTE FUNCTION crm_outbox_notify();

\echo '✅ crm_event_outbox table + triggers on 5 source tables created'
