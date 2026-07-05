/** JSONB contracts for bookings.price and bookings.metadata */

interface ClientInfo {
  name: string;
  phone: string;
  email?: string;
}

// bookings.price — discriminated union
export interface StudioPrice {
  totalPrice: number;
  currency: 'RUB';
  basePrice: number;
}

export interface OnLocationPrice extends StudioPrice {
  travelCost: number;
  locationAdditionalCost?: number;
}

export type BookingPrice = StudioPrice | OnLocationPrice;

// bookings.metadata — discriminated by serviceType
export interface StudioBookingMeta {
  serviceType: 'studio';
  persons: number;
  clientInfo?: ClientInfo;
  comments?: string;
}

export interface OnLocationBookingMeta {
  serviceType: 'onLocation';
  persons: number;
  location: { address: string; city: string; coordinates: unknown | null };
  clientInfo?: ClientInfo;
  comments?: string;
}

export type BookingMetadata = StudioBookingMeta | OnLocationBookingMeta;
