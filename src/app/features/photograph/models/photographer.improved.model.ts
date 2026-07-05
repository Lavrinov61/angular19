import { ServiceCategory, StaffSpecialization } from '../../../shared/models/booking.shared.model';

export interface Photographer {
  id: string;
  slug: string;
  name: string;
  title: string;
  profileImage: string;
  specialization: {
    name: string;
    description?: string;
  }[];
  rating: number;
  reviewCount: number;
  isActive: boolean;
  staffType: StaffSpecialization;
  workingSchedule: {
    type: 'fixed' | 'flexible';
    workingDays?: number[]; // 0-6, где 0 - воскресенье, 1 - понедельник и т.д.
    workingHours?: {
      start: string;
      end: string;
    };
    description?: string;
  };
  availability: {
    studioOnly: boolean;
    locationOnly: boolean;
    bothOptions: boolean;
    maxTravelDistance?: number;
    note?: string;
  };
  contact: {
    phone?: string;
    email?: string;
    whatsapp?: string;
    telegram?: string;
    useStudioContacts: boolean;
  };
  uniqueApproach?: string;
  experience?: string;
  portfolioImages: {
    url: string;
    title?: string;
    category?: string;
    isCover?: boolean;
  }[];
  clientTestimonials?: {
    clientName: string;
    rating: number;
    text: string;
    date: string;
    serviceType: ServiceCategory;
  }[];
  priceRange?: {
    min: number;
    max: number;
    currency: string;
  };
}
