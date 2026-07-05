import type Bookings from '../generated/public/Bookings.js';
import type BookingStatusHistory from '../generated/public/BookingStatusHistory.js';
import type { BookingsId } from '../generated/public/Bookings.js';
import type StudioScheduleExceptions from '../generated/public/StudioScheduleExceptions.js';
import type Studios from '../generated/public/Studios.js';
import type Users from '../generated/public/Users.js';
import type { UsersId } from '../generated/public/Users.js';

/** Schedule exception lookup (closures, holidays) — SELECT is_closed, open_time::text, close_time::text, reason */
export interface ScheduleExceptionLookup {
  is_closed: StudioScheduleExceptions['is_closed'];
  open_time: string | null;
  close_time: string | null;
  reason: StudioScheduleExceptions['reason'];
}

/** Studio alert row — JOIN studio_schedule_exceptions + studios */
export interface StudioAlertRow {
  studio_id: StudioScheduleExceptions['studio_id'];
  location_code: Studios['location_code'];
  studio_name: string;
  exception_date: string;
  is_closed: StudioScheduleExceptions['is_closed'];
  open_time: string | null;
  close_time: string | null;
  reason: StudioScheduleExceptions['reason'];
}

/** Запись клиента с JOIN studio (для /bookings/my) */
export interface MyBookingRow {
  id: BookingsId;
  client_id: Bookings['client_id'];
  studio_name: string;
  studio_address: string | null;
  client_name: Bookings['client_name'];
  client_phone: Bookings['client_phone'];
  service_name: Bookings['service_name'];
  service_category_slug: Bookings['service_category_slug'];
  start_time: string;
  end_time: string;
  status: string;
  source: Bookings['source'];
  notes: Bookings['notes'];
  created_at: string;
}

/** Studio info lookup — SELECT name, status, status_message */
export interface StudioStatusLookup {
  name: Studios['name'];
  status: string;
  status_message: string | null;
}

/** Employee shift lookup for slot generation */
export interface BookingShiftLookup {
  start_time: string;
  end_time: string;
  employee_name: string | null;
}

/** Studio name lookup for booking responses and notifications */
export interface BookingStudioNameLookup {
  name: Studios['name'];
}

/** Studio working hours lookup for slot fallback */
export interface BookingWorkingHoursLookup {
  start_time: string;
  end_time: string;
  is_open: boolean;
}

/** Existing booking interval lookup for occupied slot detection */
export interface BookingOccupiedSlotLookup {
  start_time: string;
  end_time: string;
}

/** Existing user lookup by phone during booking creation */
export interface BookingUserIdLookup {
  id: UsersId;
}

/** Insert result for newly created booking */
export interface BookingInsertResult {
  id: BookingsId;
}

/** Aggregate count row */
export interface BookingCountLookup {
  count: string;
}

/** Previous booking status lookup */
export interface BookingStatusLookup {
  status: Bookings['status'];
}

/** Booking status history row with operator name */
export interface BookingStatusHistoryEventLookup {
  id: BookingStatusHistory['id'];
  old_status: BookingStatusHistory['old_status'];
  new_status: BookingStatusHistory['new_status'];
  changed_at: BookingStatusHistory['changed_at'];
  changed_by_name: Users['display_name'];
}

/** Conflict lookup by booking id */
export interface BookingConflictLookup {
  id: BookingsId;
}

/** Client search projection */
export interface ClientSearchLookup {
  name: string;
  phone: string;
  email: string | null;
  last_visit: string | null;
  visit_count: string;
}

export type { BookingsId };
