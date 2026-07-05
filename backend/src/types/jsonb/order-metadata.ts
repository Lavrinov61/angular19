/** JSONB contract for orders.metadata */

import type { OrderItem } from '../../utils/order-item.js';

export interface OrderMetadata {
  items: OrderItem[];
  contact: { name: string; phone: string };
  deliveryMethod: 'pickup' | 'delivery';
  deliveryAddress: string | null;
  comment: string | null;
  promo_code?: string;
  partner_promo_code?: string;
  fingerprint_visitor_id?: string;
}
