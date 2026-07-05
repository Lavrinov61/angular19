/**
 * Interface for a testimonial item
 */
export interface Testimonial {
  /** Unique identifier for the testimonial */
  id?: string;
  
  /** The content of the testimonial */
  content: string;
  
  /** The author's name */
  author: string;
  
  /** The author's location */
  location: string;
  
  /** The rating (1-5) */
  rating: number;
  
  /** Optional image of the author */
  authorImage?: string;
  
  /** Optional source platform (Google Maps, 2GIS, etc.) */
  source?: {
    name: string;
    url: string;
  };

  /** Date the review was posted (ISO 8601) */
  date?: string;

  /** Optional: which service was used */
  service?: string;
}

/**
 * Interface for testimonial section data
 */
export interface TestimonialSection {
  /** Section title */
  title: string;
  
  /** Section subtitle or description */
  description: string;
  
  /** Overall rating */
  overallRating: number;
  
  /** Total number of reviews */
  reviewCount: number;
  
  /** List of testimonials to display */
  testimonials: Testimonial[];
  
  /** External review platform links */
  reviewPlatforms: {
    name: string;
    url: string;
    icon?: string;
  }[];
}
