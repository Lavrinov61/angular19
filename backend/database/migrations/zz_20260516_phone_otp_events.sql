-- Auditable phone OTP lifecycle events without storing OTP codes or raw logs.
CREATE TABLE IF NOT EXISTS public.phone_otp_events (
  id UUID DEFAULT public.uuid_generate_v4() NOT NULL,
  user_id UUID,
  verification_code_id UUID,
  phone_hash TEXT NOT NULL,
  phone_last4 VARCHAR(4) NOT NULL,
  purpose VARCHAR(40) NOT NULL DEFAULT 'phone_login',
  event_type VARCHAR(40) NOT NULL,
  provider VARCHAR(40),
  provider_request_id VARCHAR(120),
  call_session_history_id VARCHAR(120),
  caller_id VARCHAR(32),
  fingerprint_visitor_id VARCHAR(120),
  ip INET,
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT phone_otp_events_event_type_check CHECK (
    event_type IN (
      'code_requested',
      'delivery_started',
      'delivery_failed',
      'verify_failed',
      'verify_max_attempts',
      'verified',
      'call_history_resolved',
      'call_not_reached',
      'code_expired_or_missing',
      'code_abandoned',
      'phone_requirement_skipped'
    )
  ),
  CONSTRAINT phone_otp_events_phone_last4_check CHECK (phone_last4 ~ '^[0-9]{0,4}$')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'phone_otp_events_pkey'
  ) THEN
    ALTER TABLE public.phone_otp_events
      ADD CONSTRAINT phone_otp_events_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'phone_otp_events_user_id_fkey'
  ) THEN
    ALTER TABLE public.phone_otp_events
      ADD CONSTRAINT phone_otp_events_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'phone_otp_events_verification_code_id_fkey'
  ) THEN
    ALTER TABLE public.phone_otp_events
      ADD CONSTRAINT phone_otp_events_verification_code_id_fkey
      FOREIGN KEY (verification_code_id) REFERENCES public.verification_codes(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_phone_otp_events_created_at
  ON public.phone_otp_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_phone_otp_events_type_created_at
  ON public.phone_otp_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_phone_otp_events_phone_hash_created_at
  ON public.phone_otp_events (phone_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_phone_otp_events_user_created_at
  ON public.phone_otp_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_otp_events_code_event_once
  ON public.phone_otp_events (verification_code_id, event_type)
  WHERE verification_code_id IS NOT NULL;

COMMENT ON TABLE public.phone_otp_events IS 'Phone OTP lifecycle events for support and abuse analysis; stores hashed phone only.';
