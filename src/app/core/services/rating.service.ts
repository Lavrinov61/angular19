import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of, catchError } from 'rxjs';
import { map } from 'rxjs/operators';
import { RatingStats, HeroRatingData, PlatformSummary } from '../../shared/models/rating.model';
import { ApiService } from './api.service';

export interface ClientStats {
  clientCount: number;
  orderCount: number | null;
}

@Injectable({
  providedIn: 'root'
})
export class RatingService {
  private apiService = inject(ApiService);
  private platformId = inject(PLATFORM_ID);

  getHeroRatingData(): Observable<HeroRatingData> {
    return this.apiService.get<{ totalReviews: number; averageRating: number }>('/reviews/stats').pipe(
      map(response => {
        if (response.success && response.data) {
          return {
            rating: response.data.averageRating || 5.0,
            ratingText: 'Все отзывы настоящие',
            ratingLabel: 'довольных клиентов',
            totalReviews: response.data.totalReviews,
          };
        }
        return this.getFallbackRatingData();
      }),
      catchError(() => of(this.getFallbackRatingData())),
    );
  }

  getRatingStats(): Observable<RatingStats | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return of(this.getFallbackStats());
    }

    return this.apiService.get<{
      totalReviews: number;
      averageRating: number;
      platformSummary?: PlatformSummary[];
    }>('/reviews/stats').pipe(
      map(response => {
        if (response.success && response.data) {
          return {
            id: 'api',
            averageRating: response.data.averageRating || 5.0,
            totalReviews: response.data.totalReviews,
            lastUpdated: new Date(),
            platformSummary: response.data.platformSummary,
          } satisfies RatingStats;
        }
        return this.getFallbackStats();
      }),
      catchError(() => of(this.getFallbackStats())),
    );
  }

  getClientCount(): Observable<ClientStats> {
    if (!isPlatformBrowser(this.platformId)) {
      return of({ clientCount: this.getOfflineClientCount(), orderCount: null });
    }

    return this.apiService.get<{
      clientCount: number;
      orderCount: number;
    }>('/stats/clients').pipe(
      map(response => {
        if (response.success && response.data?.clientCount) {
          return {
            clientCount: response.data.clientCount,
            orderCount: response.data.orderCount ?? null,
          };
        }
        return { clientCount: this.getOfflineClientCount(), orderCount: null };
      }),
      catchError(() => of({ clientCount: this.getOfflineClientCount(), orderCount: null })),
    );
  }

  /** Локальный расчёт числа клиентов (fallback без HTTP) */
  private getOfflineClientCount(): number {
    const currentYear = new Date().getFullYear();
    const y2005 = Math.min(currentYear, 2005) - 1999;
    const yAfter = Math.max(0, currentYear - 2005);
    return y2005 * 365 * 50 + yAfter * 365 * 15;
  }

  private getFallbackRatingData(): HeroRatingData {
    return {
      rating: 5.0,
      ratingText: 'Все отзывы настоящие',
      ratingLabel: 'довольных клиентов',
      totalReviews: 515,
    };
  }

  private getFallbackStats(): RatingStats {
    return {
      id: 'fallback',
      averageRating: 5.0,
      totalReviews: 515,
      lastUpdated: new Date(),
      platformSummary: [
        { platform: 'yandex', rating: 5.0, reviewCount: 377, url: 'https://yandex.ru/maps/-/CHDBudSq' },
        { platform: '2gis',   rating: 4.8, reviewCount: 81,  url: 'https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews' },
        { platform: 'google', rating: 4.7, reviewCount: 57,  url: 'https://g.page/r/CdLAfLUuNAGrEBM/review' },
      ],
    };
  }
}
