/** View types for payment side-effect service projections. */

export interface ConversationIdRow {
  id: string;
}

export interface InsertedMessageRow {
  id: string;
  created_at: Date;
}

export interface OrderUserIdRow {
  user_id: string;
}

export interface LoyaltyOrderLookupRow {
  user_id: string | null;
  items: unknown;
  service_type: string | null;
  mode: string | null;
  created_at: string | null;
}

export interface PaymentConversationVisitorRow {
  visitor_id: string | null;
}
