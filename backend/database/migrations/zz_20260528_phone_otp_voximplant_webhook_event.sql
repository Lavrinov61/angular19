BEGIN;

ALTER TABLE public.phone_otp_events
  DROP CONSTRAINT IF EXISTS phone_otp_events_event_type_check;

ALTER TABLE public.phone_otp_events
  ADD CONSTRAINT phone_otp_events_event_type_check CHECK (
    event_type IN (
      'code_requested',
      'delivery_started',
      'delivery_failed',
      'verify_failed',
      'verify_max_attempts',
      'verified',
      'call_history_resolved',
      'call_not_reached',
      'voximplant_webhook_event',
      'code_expired_or_missing',
      'code_abandoned',
      'phone_requirement_skipped'
    )
  ) NOT VALID;

ALTER TABLE public.phone_otp_events
  VALIDATE CONSTRAINT phone_otp_events_event_type_check;

COMMIT;
