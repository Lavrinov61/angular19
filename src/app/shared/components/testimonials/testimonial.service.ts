import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Testimonial, TestimonialSection } from './testimonial.model';

interface ReviewPlatformStat {
  platform: string;
  location: string;
  name: string;
  rating: number;
  reviewCount: number;
  lastSynced: string;
}

interface ReviewStatsResponse {
  totalReviews: number;
  averageRating: number;
  platforms: ReviewPlatformStat[];
  lastSynced: string | null;
}

function reviewStatsDescription(stats: ReviewStatsResponse): string {
  return `${stats.averageRating.toFixed(1)} · Все отзывы настоящие`;
}

@Injectable({
  providedIn: 'root'
})
export class TestimonialService {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);

  readonly loading = signal(false);
  readonly testimonials = signal<Testimonial[]>([]);
  readonly testimonialSection = signal<TestimonialSection | null>(null);

  // Данные с API (обновляются автоматически)
  private readonly reviewStats = signal<ReviewStatsResponse | null>(null);

  readonly isDataLoaded = computed(() => this.testimonialSection() !== null);

  // Рейтинг и количество: из API если есть, иначе fallback
  readonly averageRating = computed(() => {
    const stats = this.reviewStats();
    if (stats && stats.totalReviews > 0) return stats.averageRating;
    return this.testimonialSection()?.overallRating ?? 0;
  });

  readonly totalReviews = computed(() => {
    const stats = this.reviewStats();
    if (stats && stats.totalReviews > 0) return stats.totalReviews;
    return this.testimonialSection()?.reviewCount ?? 0;
  });

  readonly platformStats = computed(() => this.reviewStats()?.platforms ?? []);

  constructor() {
    this.getTestimonials();
    this.loadReviewStats();
  }

  async getTestimonials(): Promise<TestimonialSection> {
    this.loading.set(true);
    const data = this.buildTestimonialData();
    this.testimonialSection.set(data);
    this.testimonials.set(data.testimonials);
    this.loading.set(false);
    return data;
  }

  getTestimonialsSync(): TestimonialSection {
    const data = this.buildTestimonialData();

    // Подставляем актуальные данные из API если есть
    const stats = this.reviewStats();
    if (stats && stats.totalReviews > 0) {
      data.overallRating = stats.averageRating;
      data.reviewCount = stats.totalReviews;
      data.description = reviewStatsDescription(stats);
    }

    return data;
  }

  private loadReviewStats(): void {
    // Не делаем HTTP-запросы на сервере (SSR)
    if (!isPlatformBrowser(this.platformId)) return;

    this.http.get<ReviewStatsResponse>('/api/reviews/stats').subscribe({
      next: (stats) => {
        if (stats && stats.totalReviews > 0) {
          this.reviewStats.set(stats);

          // Обновляем testimonialSection с актуальными данными
          const current = this.testimonialSection();
          if (current) {
            this.testimonialSection.set({
              ...current,
              overallRating: stats.averageRating,
              reviewCount: stats.totalReviews,
              description: reviewStatsDescription(stats),
            });
          }
        }
      },
      error: () => {
        // API недоступен, используем fallback, не логируем ошибку
      },
    });
  }

  private buildTestimonialData(): TestimonialSection {
    return {
      title: 'Нам доверяют',
      description: 'Все отзывы на картах, только положительные',
      overallRating: 5.0,
      reviewCount: 515,
      testimonials: [
        {
          id: 'review-1',
          author: 'Виктория',
          content: 'Нашла вашу студию по отзывам, решила, что буду делать фото на паспорт здесь, и не прогадала! Обаятельные и вежливые сотрудники, уютная студия, доброжелательное отношение к клиенту! Замечательные фотографии получились, спасибо Вам огромное!',
          rating: 5,
          location: 'Ростов-на-Дону',
          date: '2024-05-01',
          service: 'Фото на документы',
          source: {
            name: 'Google Maps',
            url: 'https://g.page/r/CdLAfLUuNAGrEBM/'
          }
        },
        {
          id: 'review-2',
          author: 'Тёма',
          content: 'Сделали отличные фотки, несколько раз переделывали по моему желанию, потом отредактировали, предлагали разные варианты, что можно сделать, что добавить, атмосфера тоже отличная, все на веселе',
          rating: 5,
          location: 'Ростов-на-Дону',
          date: '2024-11-12',
          service: 'Художественная обработка',
          source: {
            name: 'Яндекс Карты',
            url: 'https://yandex.ru/maps/-/CHaIjZP9'
          }
        },
        {
          id: 'review-3',
          author: 'Анастасия Родионова',
          content: 'Спасибо Анне и Фёдору за прекрасные фото на документы, очень красиво вышло!',
          rating: 5,
          location: 'Ростов-на-Дону',
          date: '2024-09-03',
          service: 'Фото на документы',
          source: {
            name: '2ГИС',
            url: 'https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews'
          }
        },
        {
          id: 'review-4',
          author: 'Ксения',
          content: 'Студия, просто супер! Фотограф Ксения, умничка! Учла все пожелания, сделала очень удачные и качественные фото. Я ушла с прекрасным настроением и отличными снимками',
          rating: 5,
          location: 'Ростов-на-Дону',
          date: '2024-03-15',
          service: 'Фотосъёмка',
          source: {
            name: 'Яндекс Карты',
            url: 'https://yandex.ru/maps/org/magnusfoto/50414539463/reviews/'
          }
        },
        {
          id: 'review-5',
          author: 'Мария С.',
          content: 'Отличная студия для фотопечати! Постоянно сюда хожу, если нужно распечатать фотографии. Цены доступные, несмотря на то, что это центр Ростова. Ане вообще отдельное спасибо!',
          rating: 5,
          location: 'Ростов-на-Дону',
          date: '2024-07-20',
          service: 'Фотопечать',
          source: {
            name: '2ГИС',
            url: 'https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews'
          }
        },
        {
          id: 'review-6',
          author: 'Геля Риккерт',
          content: 'Аня, замечательный специалист! Проконсультировала, ответила на все мои вопросы, а я их задавала очень много. Хорошо сфотографировала меня для шенгенской визы. Рекомендую!',
          rating: 5,
          location: 'Ростов-на-Дону',
          date: '2024-06-10',
          service: 'Фото на визу',
          source: {
            name: 'Яндекс Карты',
            url: 'https://yandex.ru/maps/-/CHaIjZP9'
          }
        },
        {
          id: 'review-7',
          author: 'Мария Мельникова',
          content: 'Прекрасная фотостудия, сотруднице Анне огромная благодарность! Помогла и подсказала, сделала отличные и качественные фото, всё прошло очень быстро и с комфортом.',
          rating: 5,
          location: 'Ростов-на-Дону',
          date: '2024-08-18',
          service: 'Фото на документы',
          source: {
            name: '2ГИС',
            url: 'https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews'
          }
        },
        {
          id: 'review-8',
          author: 'Дарья',
          content: 'Отличная фотостудия, хорошее качество фотографий, приятные сотрудники. Проводят интересные конкурсы со стоящими призами!!!',
          rating: 5,
          location: 'Ростов-на-Дону',
          date: '2024-04-20',
          service: 'Фотопечать',
          source: {
            name: '2ГИС',
            url: 'https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews'
          }
        },
        {
          id: 'review-9',
          author: 'Мария Попова',
          content: 'Впервые классные фотки на документы, быстро, чётко, очень довольна!',
          rating: 5,
          location: 'Ростов-на-Дону',
          date: '2025-01-14',
          service: 'Фото на документы',
          source: {
            name: 'Яндекс Карты',
            url: 'https://yandex.ru/maps/-/CHaIjZP9'
          }
        }
      ],
      reviewPlatforms: [
        {
          name: '2ГИС, Соборный',
          url: 'https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews',
          icon: 'location_on'
        },
        {
          name: 'Яндекс, Соборный',
          url: 'https://yandex.ru/maps/-/CHaIjZP9',
          icon: 'explore'
        }
      ]
    };
  }
}
