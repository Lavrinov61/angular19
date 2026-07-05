-- Migration: print_job_completion_trigger
-- When ALL print_jobs for an order_id are completed/cancelled,
-- auto-update photo_print_orders.status → 'ready'
-- Idempotent: CREATE OR REPLACE

CREATE OR REPLACE FUNCTION public.on_print_jobs_all_done()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only act when status transitions to a terminal state
  IF NEW.status NOT IN ('completed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Only act if there's an order_id linked
  IF NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if ALL print_jobs for this order are in terminal state
  -- If none remain in non-terminal state, mark order as 'ready'
  UPDATE photo_print_orders
  SET status = 'ready',
      updated_at = NOW()
  WHERE order_id = NEW.order_id
    AND status = 'processing'
    AND NOT EXISTS (
      SELECT 1 FROM print_jobs
      WHERE order_id = NEW.order_id
        AND status NOT IN ('completed', 'cancelled')
    );

  RETURN NEW;
END;
$$;

-- Drop old trigger if exists, then create
DROP TRIGGER IF EXISTS trg_print_jobs_all_done ON public.print_jobs;

CREATE TRIGGER trg_print_jobs_all_done
  AFTER UPDATE OF status ON public.print_jobs
  FOR EACH ROW
  WHEN (NEW.status IN ('completed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.on_print_jobs_all_done();
