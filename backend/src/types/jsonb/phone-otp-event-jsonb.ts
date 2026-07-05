export interface PhoneOtpEventDetailsJsonb {
  reason?: string;
  method?: string;
  channel?: string;
  client?: string;
  attempts?: number;
  attemptsAfter?: number;
  maxAttempts?: number;
  expiresAt?: string;
  expiresIn?: number;
  acceptedAt?: string;
  providerError?: string;
  sessionStartDate?: string;
  sessionDuration?: number;
  finishReason?: string;
  callId?: number;
  callStartTime?: string;
  callDuration?: number;
  callSuccessful?: boolean;
  endReasonCode?: number;
  endReasonDetails?: string;
  direction?: string;
  cost?: number;
  [key: string]: unknown;
}
