-- P3 #15 — audit log для payment_links (compliance ФЗ-54)
-- Migration 124 (2026-04-19)

CREATE TABLE IF NOT EXISTS public.payment_links_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_link_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  old_data JSONB,
  new_data JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index для запросов истории конкретной ссылки
CREATE INDEX IF NOT EXISTS idx_payment_links_history_link_changed
  ON public.payment_links_history (payment_link_id, changed_at DESC);

-- Trigger function: AFTER INSERT/UPDATE/DELETE captures full row JSON
CREATE OR REPLACE FUNCTION public.fn_payment_links_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.payment_links_history (payment_link_id, action, new_data)
    VALUES (NEW.id, 'insert', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Skip if nothing relevant changed (avoid noise on updated_at-only changes)
    IF OLD IS DISTINCT FROM NEW THEN
      INSERT INTO public.payment_links_history (payment_link_id, action, old_data, new_data)
      VALUES (NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.payment_links_history (payment_link_id, action, old_data)
    VALUES (OLD.id, 'delete', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger привязан к payment_links table
DROP TRIGGER IF EXISTS trg_payment_links_audit ON public.payment_links;
CREATE TRIGGER trg_payment_links_audit
AFTER INSERT OR UPDATE OR DELETE ON public.payment_links
FOR EACH ROW EXECUTE FUNCTION public.fn_payment_links_audit();

-- Comment for documentation
COMMENT ON TABLE public.payment_links_history IS 'Audit log для payment_links (P3 #15) — все INSERT/UPDATE/DELETE captured by trigger trg_payment_links_audit. Compliance ФЗ-54.';
COMMENT ON COLUMN public.payment_links_history.action IS 'insert | update | delete';
COMMENT ON COLUMN public.payment_links_history.old_data IS 'Полная старая строка (NULL для insert)';
COMMENT ON COLUMN public.payment_links_history.new_data IS 'Полная новая строка (NULL для delete)';
