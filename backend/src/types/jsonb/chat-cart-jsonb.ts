import type { PaymentLinkCartDetailsJson } from './payment-link-tip-jsonb.js';

export interface ChatCartItemMetadataJson {
  backendOrderId?: string;
  displayDetails?: PaymentLinkCartDetailsJson;
  [key: string]: unknown;
}
