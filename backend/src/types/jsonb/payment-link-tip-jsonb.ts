/** JSONB contracts used by payment link checkout tip/support flow. */

export interface PaymentLinkMetadataJson {
  supportTeamBaseAmount?: number;
  supportTeamTipAmount?: number;
  [key: string]: unknown;
}

export interface PaymentLinkServiceJson {
  id?: string;
  slug?: string;
  service_option_id?: string;
  name: string;
  service?: string;
  price: number;
  subtotal?: number;
  quantity: number;
  options?: unknown;
  [key: string]: unknown;
}

export interface PaymentLinkCreateServiceJson {
  id?: string;
  service?: string;
  service_option_id?: string;
  price?: number | string;
  subtotal?: number | string;
  quantity?: number | string;
  [key: string]: unknown;
}

export interface PaymentLinkCartDisplayLineJson {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  priceNote?: string | null;
  discountLabel?: string | null;
  discountAmount?: number;
}

export interface PaymentLinkCartDetailsJson {
  lines: PaymentLinkCartDisplayLineJson[];
  subtotal?: number;
  savings?: number;
  priceNote?: string | null;
}
