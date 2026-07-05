export type PhoneOtpEventType =
  | 'code_requested'
  | 'delivery_started'
  | 'delivery_failed'
  | 'verify_failed'
  | 'verify_max_attempts'
  | 'verified'
  | 'call_history_resolved'
  | 'call_not_reached'
  | 'voximplant_webhook_event'
  | 'code_expired_or_missing'
  | 'code_abandoned'
  | 'phone_requirement_skipped';

export interface PhoneOtpEventCreatedRow {
  id: string;
}

export interface ExpiredPhoneOtpCodeRow {
  id: string;
  user_id: string | null;
  phone: string;
  method: string;
  purpose: string;
  attempts: number;
  expires_at: string | Date;
}
