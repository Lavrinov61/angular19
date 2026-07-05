export interface PhotographerSchedule {
  id: string;
  photographerId: string;
  year: number;
  month: number; // 1-12
  scheduleType: 'studio' | 'location'; // студийное или выездное
  availableSlots: ScheduleSlot[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleSlot {
  id: string;
  date: Date;
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  duration: number; // в минутах
  isAvailable: boolean;
  isBooked: boolean;
  bookingId?: string;
  serviceTypes: string[]; // типы услуг, которые можно забронировать на этот слот
  price?: number;
  location?: string; // для выездных съемок
  notes?: string;
}

export interface PhotographerSchedulePreference {
  photographerId: string;
  workingDays: number[]; // 0-6 (воскресенье-суббота)
  workingHours: {
    start: string; // HH:MM
    end: string; // HH:MM
  };
  slotDuration: number; // стандартная продолжительность слота в минутах
  breakDuration: number; // перерыв между слотами в минутах
  studioServices: string[]; // услуги, доступные в студии
  locationServices: string[]; // услуги, доступные на выезде
  maxLocationDistance: number; // максимальное расстояние для выездных съемок
}

export interface Booking {
  id: string;
  photographerId: string;
  clientId: string;
  scheduleType: 'studio' | 'location';
  date: Date;
  startTime: string;
  endTime: string;
  duration: number;
  serviceType: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  price: number;
  location?: string;
  clientNotes?: string;
  photographerNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleConflict {
  id: string;
  type: 'overlap' | 'double_booking' | 'insufficient_break';
  studioSlot?: ScheduleSlot;
  locationSlot?: ScheduleSlot;
  message: string;
  details: string;
}

export interface ScheduleGenerationOptions {
  photographerId: string;
  year: number;
  month: number;
  scheduleType: 'studio' | 'location';
  overrideExisting?: boolean;
  preferences?: Partial<PhotographerSchedulePreference>;
}

export interface ScheduleStats {
  totalSlots: number;
  availableSlots: number;
  bookedSlots: number;
  revenue: number;
  utilizationRate: number; // в процентах
}
