-- Admin-only storage for reusable ready-made form files.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ready_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(255) NOT NULL,
  description text,
  original_name varchar(500) NOT NULL,
  stored_name varchar(255) NOT NULL,
  storage_path text NOT NULL,
  mime_type varchar(100) NOT NULL,
  file_size bigint NOT NULL,
  extension varchar(10) NOT NULL,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ready_forms_created_at
  ON public.ready_forms(created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ready_forms_uploaded_by
  ON public.ready_forms(uploaded_by)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.ready_forms IS
  'Admin-only repository for reusable PSD/JPG/PNG ready-made form files.';

COMMIT;
