-- Bind chat/payment-link revenue to the employee workday that created it.
-- Also snapshot the per-address base payout rate on the shift itself so
-- historical payroll does not change when studio rates are edited later.

BEGIN;

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS employee_shift_rate numeric(10,2);

UPDATE public.studios
SET employee_shift_rate = 1500
WHERE location_code = 'soborny'
  AND employee_shift_rate IS NULL;

UPDATE public.studios
SET employee_shift_rate = 2000
WHERE location_code = 'barrikadnaya-4'
  AND employee_shift_rate IS NULL;

UPDATE public.studios
SET employee_shift_rate = 1500
WHERE employee_shift_rate IS NULL;

ALTER TABLE public.employee_shifts
  ADD COLUMN IF NOT EXISTS base_pay_rate numeric(10,2);

UPDATE public.employee_shifts es
SET base_pay_rate = COALESCE(
  s.employee_shift_rate,
  CASE WHEN s.location_code = 'barrikadnaya-4' THEN 2000 ELSE 1500 END
)
FROM public.studios s
WHERE s.id = es.studio_id
  AND es.base_pay_rate IS NULL;

ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS employee_shift_id uuid
  REFERENCES public.employee_shifts(id) ON DELETE SET NULL;

ALTER TABLE public.photo_print_orders
  ADD COLUMN IF NOT EXISTS employee_shift_id uuid
  REFERENCES public.employee_shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_links_employee_shift_id
  ON public.payment_links(employee_shift_id)
  WHERE employee_shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_photo_print_orders_employee_shift_id
  ON public.photo_print_orders(employee_shift_id)
  WHERE employee_shift_id IS NOT NULL;

UPDATE public.payment_links pl
SET employee_shift_id = (
  SELECT es.id
  FROM public.employee_shifts es
  WHERE es.employee_id = pl.created_by
    AND es.shift_date = pl.created_at::date
    AND es.status <> 'cancelled'
  ORDER BY CASE es.status
    WHEN 'active' THEN 0
    WHEN 'completed' THEN 1
    WHEN 'scheduled' THEN 2
    ELSE 3
  END,
  es.checked_in_at DESC NULLS LAST,
  es.created_at DESC NULLS LAST
  LIMIT 1
)
WHERE pl.employee_shift_id IS NULL
  AND pl.created_by IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.employee_shifts es
    WHERE es.employee_id = pl.created_by
      AND es.shift_date = pl.created_at::date
      AND es.status <> 'cancelled'
  );

UPDATE public.photo_print_orders p
SET employee_shift_id = (
  SELECT es.id
  FROM public.employee_shifts es
  WHERE es.employee_id = COALESCE(p.assigned_employee_id, p.initiated_by)
    AND es.shift_date = p.created_at::date
    AND es.status <> 'cancelled'
  ORDER BY CASE es.status
    WHEN 'active' THEN 0
    WHEN 'completed' THEN 1
    WHEN 'scheduled' THEN 2
    ELSE 3
  END,
  es.checked_in_at DESC NULLS LAST,
  es.created_at DESC NULLS LAST
  LIMIT 1
)
WHERE p.employee_shift_id IS NULL
  AND COALESCE(p.assigned_employee_id, p.initiated_by) IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.employee_shifts es
    WHERE es.employee_id = COALESCE(p.assigned_employee_id, p.initiated_by)
      AND es.shift_date = p.created_at::date
      AND es.status <> 'cancelled'
  );

COMMENT ON COLUMN public.employee_shifts.base_pay_rate IS
  'Snapshot of the base payout for this employee shift at creation/start time.';

COMMENT ON COLUMN public.payment_links.employee_shift_id IS
  'Employee workday that created the payment link; used for online revenue attribution.';

COMMENT ON COLUMN public.photo_print_orders.employee_shift_id IS
  'Employee workday that created the chat/payment order; used for online revenue attribution.';

COMMIT;
