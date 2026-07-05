BEGIN;

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS employee_shift_rate numeric(10,2);

ALTER TABLE public.employee_shifts
  ADD COLUMN IF NOT EXISTS shift_kind varchar(20) NOT NULL DEFAULT 'studio';

ALTER TABLE public.employee_shifts
  DROP CONSTRAINT IF EXISTS employee_shifts_shift_kind_check;

ALTER TABLE public.employee_shifts
  ADD CONSTRAINT employee_shifts_shift_kind_check
  CHECK (shift_kind IN ('studio', 'virtual'));

INSERT INTO public.studios (
  name,
  address,
  description,
  location_code,
  timezone,
  operating_hours,
  location_type,
  region,
  city,
  status,
  employee_shift_rate,
  is_infra_enabled
)
VALUES (
  'Онлайн смена',
  NULL,
  'Рабочее место для онлайн-заказов и ссылок на оплату',
  'online',
  'Europe/Moscow',
  '{}'::jsonb,
  'virtual',
  'Ростовская область',
  'Ростов-на-Дону',
  'open',
  1500,
  false
)
ON CONFLICT (location_code) DO UPDATE
SET name = EXCLUDED.name,
    address = EXCLUDED.address,
    description = EXCLUDED.description,
    timezone = EXCLUDED.timezone,
    operating_hours = EXCLUDED.operating_hours,
    location_type = EXCLUDED.location_type,
    region = EXCLUDED.region,
    city = EXCLUDED.city,
    status = EXCLUDED.status,
    employee_shift_rate = COALESCE(public.studios.employee_shift_rate, EXCLUDED.employee_shift_rate),
    is_infra_enabled = EXCLUDED.is_infra_enabled,
    updated_at = NOW();

UPDATE public.employee_shifts es
SET shift_kind = 'virtual',
    updated_at = NOW()
FROM public.studios s
WHERE s.id = es.studio_id
  AND (s.location_code = 'online' OR s.location_type = 'virtual')
  AND es.shift_kind <> 'virtual';

CREATE INDEX IF NOT EXISTS idx_employee_shifts_virtual
  ON public.employee_shifts (employee_id, shift_date)
  WHERE shift_kind = 'virtual';

COMMIT;
