import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PublicPhotographerProfile {
  id: string;
  username: string;
  displayName: string;
  name: string;
  bio?: string;
  experience: number;
  location?: string;
  specializations: string[];
  verified: boolean;
  avatarUrl?: string;
  portfolio: PublicPortfolioItem[];
  services: PublicService[];
}

export interface PublicPortfolioItem {
  id: string;
  imageUrl: string;
  thumbnailUrl?: string;
  serviceId?: string;
  serviceName?: string;
  serviceCategory?: string;
  createdAt: Date;
}

export interface PublicService {
  id: string;
  name: string;
  description?: string;
  category: string;
  displayCategory: string;
  price: number;
}

export interface PublicPhotographerCard {
  id: string;
  username: string;
  displayName: string;
  name: string;
  bio?: string;
  experience: number;
  location?: string;
  specializations: string[];
  verified: boolean;
  avatarUrl?: string;
  portfolioCount: number;
  minPrice?: number;
}

@Injectable({
  providedIn: 'root'
})
export class PhotographerPublicService {
  private http = inject(HttpClient);
  private apiUrl = `/api/public/photographers`;

  /**
   * Получить публичный профиль фотографа по username
   */
  getPhotographerByUsername(username: string): Observable<PublicPhotographerProfile> {
    return this.http.get<{success: boolean, data: PublicPhotographerProfile}>(`${this.apiUrl}/${username}`)
      .pipe(
        map(response => response.data)
      );
  }

  /**
   * Получить список всех фотографов
   */
  getAllPhotographers(): Observable<PublicPhotographerCard[]> {
    return this.http.get<{success: boolean, data: PublicPhotographerCard[]}>(`${this.apiUrl}`)
      .pipe(
        map(response => response.data)
      );
  }
}
