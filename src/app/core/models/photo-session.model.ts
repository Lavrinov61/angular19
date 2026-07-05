export interface PhotoSession {
  id: string;
  title: string;
  description: string;
  price: number;
  durationMinutes: number;
  category: string;
  imageUrl: string;
  includesDigital: boolean;
  maxPersons: number;
  additionalInfo?: string;
}
