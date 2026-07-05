/** JSONB contracts for conversations.context and conversations.metadata */

export interface PendingOrder {
  serviceId?: string;
  categorySlug?: string;
  selectedDoc?: string;
  selectedTariff?: string;
  service?: string;
  tariff?: string;
  price?: number;
}

export interface PendingDelivery {
  method?: string;
  address?: string;
  postalCode?: string;
}

export interface SessionContext {
  hasPhoto?: boolean;
  photoCount?: number;
  selectedDoc?: string | null;
  selectedTariff?: string | null;
  orderNumber?: string | null;
  orderCycles?: number;
  categorySlug?: string | null;
  selectedOptions?: Record<string, string[]>;
  currentOptionStep?: string | null;
}

export interface ConversationMetadata {
  pendingOrder?: PendingOrder;
  pending_order?: PendingOrder;
  orderNumber?: string;
  order_number?: string;
  printAddon?: boolean;
  printPrice?: number;
  deliveryAddress?: string;
  phoneAsked?: boolean;
  preCreatedOrderNumber?: string;
  pendingDelivery?: PendingDelivery;
  borders?: string;
  perPhotoCopies?: Record<string, number>;
  upgradedTariff?: string;
}

/** Safely parse session context JSONB. */
export function parseSessionContext(raw: unknown): SessionContext {
  if (raw && typeof raw === 'object') return raw as SessionContext;
  return {};
}

/** Safely parse conversation JSONB metadata. */
export function parseConversationMetadata(raw: unknown): ConversationMetadata {
  if (raw && typeof raw === 'object') return raw as ConversationMetadata;
  return {};
}
