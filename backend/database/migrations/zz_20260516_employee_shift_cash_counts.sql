ALTER TABLE public.employee_shifts
  ADD COLUMN IF NOT EXISTS cash_at_open numeric(12,2),
  ADD COLUMN IF NOT EXISTS cash_at_close numeric(12,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employee_shifts_cash_at_open_nonnegative'
  ) THEN
    ALTER TABLE public.employee_shifts
      ADD CONSTRAINT employee_shifts_cash_at_open_nonnegative
      CHECK (cash_at_open IS NULL OR cash_at_open >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employee_shifts_cash_at_close_nonnegative'
  ) THEN
    ALTER TABLE public.employee_shifts
      ADD CONSTRAINT employee_shifts_cash_at_close_nonnegative
      CHECK (cash_at_close IS NULL OR cash_at_close >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.employee_shifts.cash_at_open IS 'Фактическая наличка в кассе при начале рабочего дня сотрудника';
COMMENT ON COLUMN public.employee_shifts.cash_at_close IS 'Фактическая наличка в кассе при закрытии рабочего дня сотрудника';
