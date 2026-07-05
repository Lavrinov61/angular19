/** JSONB contracts used by app-order payment attribution. */

export interface AppOrderPaymentItemJson {
  name?: string;
  service?: string;
  tariff?: string;
  [key: string]: unknown;
}

export interface AppOrderPaymentMetadataJson {
  fingerprint_visitor_id?: string;
  items?: unknown;
  [key: string]: unknown;
}
