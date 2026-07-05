-- Store explicit personal-data/privacy consents with document version and source.
CREATE TABLE IF NOT EXISTS public.privacy_consents (
  id UUID DEFAULT public.uuid_generate_v4() NOT NULL,
  user_id UUID,
  visitor_id VARCHAR(128),
  document_type VARCHAR(64) NOT NULL,
  document_version VARCHAR(32) NOT NULL,
  scope TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  source VARCHAR(80) NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT TRUE,
  ip INET,
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT privacy_consents_document_type_check CHECK (document_type <> ''),
  CONSTRAINT privacy_consents_document_version_check CHECK (document_version <> ''),
  CONSTRAINT privacy_consents_source_check CHECK (source <> '')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'privacy_consents_pkey'
  ) THEN
    ALTER TABLE public.privacy_consents
      ADD CONSTRAINT privacy_consents_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'privacy_consents_user_id_fkey'
  ) THEN
    ALTER TABLE public.privacy_consents
      ADD CONSTRAINT privacy_consents_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_privacy_consents_user_id_created_at
  ON public.privacy_consents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_privacy_consents_visitor_id_created_at
  ON public.privacy_consents (visitor_id, created_at DESC)
  WHERE visitor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_privacy_consents_document
  ON public.privacy_consents (document_type, document_version, created_at DESC);

COMMENT ON TABLE public.privacy_consents IS 'Versioned personal-data/privacy consents accepted by users or visitors.';
