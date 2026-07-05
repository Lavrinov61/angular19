import type Studios from '../generated/public/Studios.js';

export interface PickupWorkingHourJson {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isOpen: boolean;
}

export interface PickupLocationRow {
  id: string;
  name: Studios['name'];
  address: Studios['address'];
  description: Studios['description'];
  amenities: Studios['amenities'];
  location_code: Studios['location_code'];
  status: string | null;
  status_message: string | null;
  status_until: string | null;
  hours: PickupWorkingHourJson[] | null;
}

export interface PickupStudioLookupRow {
  id: string;
  name: Studios['name'];
  address: Studios['address'];
  location_code: Studios['location_code'];
  status: string | null;
  status_message: string | null;
  status_until: string | null;
}

export interface StudioIdLookupRow {
  id: string;
}

export interface ShiftStudioRateRow {
  id: string;
  name: Studios['name'];
  address: Studios['address'];
  location_code: Studios['location_code'];
  status: string;
  shift_rate: number;
  is_virtual: boolean;
}
