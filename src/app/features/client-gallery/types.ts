// Shared types for client gallery components

import { Photo as BasePhoto } from '../../core/models/photo.model';

// Используем общий интерфейс Photo
export type Photo = BasePhoto;

export interface PhotoVersion {
  id: string;
  name: string;
  url: string;
  description?: string;
  isOriginal?: boolean;
}

export interface PhotoSession {
  id: string;
  clientId: string;
  title: string;
  description?: string;
  date: string;
  photographer: string;
  photos: Photo[];
  status: 'processing' | 'ready' | 'delivered';
  photoCount: number;
  processedPhotos: number;
}

export interface ClientPhotoSession {
  id: string;
  title: string;
  date: string;
  status: 'processing' | 'ready' | 'delivered';
  photoCount: number;
  thumbnailUrl?: string;
  sessionType: string;
  photographer: string;
  clientId: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface PhotoComparison {
  original: Photo;
  processed: Photo[];
  selectedVersion?: string;
  clientFeedback?: {
    rating: number;
    comment?: string;
    preferences?: string[];
  };
}

export interface PhotoFeedback {
  photoId: string;
  rating: number;
  comment?: string;
  preferences?: string[];
  submittedAt: string;
}
