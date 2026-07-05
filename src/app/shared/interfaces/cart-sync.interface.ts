export interface CartDisplayLine {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  priceNote?: string | null;
  discountLabel?: string | null;
  discountAmount?: number;
}

export interface CartDisplayDetails {
  lines: CartDisplayLine[];
  subtotal?: number;
  savings?: number;
  priceNote?: string | null;
}

export interface SyncCartItem {
  serviceId: string;
  name: string;
  description?: string;
  price: number;
  nextPrice?: number;
  priceMax?: number;
  icon?: string;
  quantity: number;
  note?: string;
  metadata?: Record<string, unknown>;
  displayDetails?: CartDisplayDetails;
  backendOrderId?: string;
  /** ID из service_options (для waterfall v2 пересчёта) */
  serviceOptionId?: string;
}

export interface SyncCart {
  items: SyncCartItem[];
  updatedAt: string;
  updatedBy: 'visitor' | 'operator';
}
