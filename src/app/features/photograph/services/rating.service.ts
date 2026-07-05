import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { LoggerService } from '../../../core/services/logger.service';

export interface RatingStats {
  id: string;
  averageRating: number;
  totalReviews: number;
  lastUpdated: Date;
}

export interface PhotographerRatingStats {
  photographerId: string;
  photographerEmail: string;
  photographerPhone: string | null;
  averageRating: number;
  totalReviews: number;
  lastUpdated: Date;
  ratingDistribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
  recentReviews: Review[];
}

export interface Review {
  id: number;
  rating: number;
  review_text: string;
  created_at: Date;
  client_name: string;
  client_email: string;
}

export interface HeroRatingStats {
  rating: number;
  ratingText: string;
  ratingLabel: string;
  totalReviews: number;
}

@Injectable({
  providedIn: 'root'
})
export class RatingService {
  private http = inject(HttpClient);
  private log = inject(LoggerService);
  private apiUrl = '/api';
  
  constructor() {
    this.log.debug('RatingService инициализирован с API URL:', this.apiUrl);
  }
  
  // Cache для статистики (signals)
  private _generalStats = signal<RatingStats | null>(null);
  private _heroStats = signal<HeroRatingStats | null>(null);
  
  // Публичные readonly signals
  readonly generalStats = this._generalStats.asReadonly();
  readonly heroStats = this._heroStats.asReadonly();
  
  // Computed signals
  readonly hasGeneralStats = computed(() => this._generalStats() !== null);
  readonly hasHeroStats = computed(() => this._heroStats() !== null);
  
  // Legacy Observable API для обратной совместимости
  public generalStats$ = toObservable(this.generalStats);
  public heroStats$ = toObservable(this.heroStats);

  /**
   * Получить общую статистику рейтингов для hero секции
   */
  getHeroStats(): Observable<HeroRatingStats> {
    this.log.debug('RatingService: Загружаем hero статистику с URL:', `${this.apiUrl}/rating/hero-stats`);
    return this.http.get<HeroRatingStats>(`${this.apiUrl}/rating/hero-stats`);
  }

  /**
   * Получить детальную общую статистику рейтингов
   */
  getGeneralStats(): Observable<RatingStats> {
    return this.http.get<RatingStats>(`${this.apiUrl}/rating/stats`);
  }

  /**
   * Получить статистику рейтинга для конкретного фотографа
   */
  getPhotographerStats(photographerId: string): Observable<PhotographerRatingStats> {
    const url = `${this.apiUrl}/rating/stats/${photographerId}`;
    this.log.debug('RatingService: Загружаем статистику фотографа с URL:', url);
    return this.http.get<PhotographerRatingStats>(url);
  }

  /**
   * Добавить новый рейтинг
   */
  addRating(rating: number, comment?: string, clientId?: string): Observable<{success: boolean, newAverage: number, totalReviews: number}> {
    return this.http.post<{success: boolean, newAverage: number, totalReviews: number}>(`${this.apiUrl}/rating/add`, {
      rating,
      comment,
      clientId
    });
  }

  /**
   * Обновить кешированную общую статистику
   */
  refreshGeneralStats(): void {
    this.getGeneralStats().subscribe(stats => {
      this._generalStats.set(stats);
    });
  }

  /**
   * Обновить кешированную hero статистику
   */
  refreshHeroStats(): void {
    this.getHeroStats().subscribe(stats => {
      this._heroStats.set(stats);
    });
  }

  /**
   * Инициализировать сервис - загрузить начальные данные
   */
  initialize(): void {
    this.refreshGeneralStats();
    this.refreshHeroStats();
  }
}
