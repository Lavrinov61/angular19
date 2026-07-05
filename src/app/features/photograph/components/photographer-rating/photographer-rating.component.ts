import { Component, ChangeDetectionStrategy, input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RatingService, PhotographerRatingStats } from '../../services/rating.service';
import { LoggerService } from '../../../../core/services/logger.service';

@Component({
  selector: 'app-photographer-rating',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule
  ],
  template: `
    @if (ratingStats) {
      <div class="rating-container">
        <!-- Основная информация о рейтинге -->
        <div class="rating-main">
          <div class="stars-container">
            <div class="stars-display">
              @for (star of getStarsArray(); track star || $index; let i = $index) {
                <mat-icon 
                  [class.filled]="i < getFilledStars()"
                  [class.half]="i === getFilledStars() && hasHalfStar()"
                  class="star-icon">
                  {{ getStarIcon(i) }}
                </mat-icon>
              }
            </div>
            <span class="rating-value">{{ ratingStats.averageRating | number:'1.1-1' }}</span>
          </div>
          
          <div class="rating-info">
            <span class="reviews-count">
              {{ ratingStats.totalReviews }} {{ getReviewsWord(ratingStats.totalReviews) }}
            </span>
            @if (ratingStats.lastUpdated) {
              <span class="last-updated">
                Обновлено {{ formatDate(ratingStats.lastUpdated) }}
              </span>
            }
          </div>
        </div>

        <!-- Детальная информация (показывается при expanded=true) -->
        @if (_expanded() && ratingStats.ratingDistribution) {
          <div class="rating-details">
            <div class="distribution-title">Распределение оценок:</div>
            <div class="distribution-bars">
              @for (rating of [5,4,3,2,1]; track rating) {
                <div class="distribution-row">
                  <span class="rating-label">{{ rating }}★</span>
                  <div class="distribution-bar">
                    <div class="bar-fill" 
                         [style.width.%]="getDistributionPercentage(rating)">
                    </div>
                  </div>
                  <span class="rating-count">{{ getRatingCount(rating) }}</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- Последние отзывы (показываются при showReviews=true) -->
        @if (showReviews() && ratingStats.recentReviews.length > 0) {
          <div class="recent-reviews">
            <div class="reviews-title">Последние отзывы:</div>
            <div class="reviews-list">
              @for (review of ratingStats.recentReviews.slice(0, maxReviews()); track review.id || review.client_name || $index) {
                <div class="review-item">
                  <div class="review-header">
                    <div class="review-stars">
                      @for (star of getStarsArray(review.rating); track star || $index) {
                        <mat-icon class="review-star filled">
                          star
                        </mat-icon>
                      }
                    </div>
                    <span class="review-author">{{ review.client_name }}</span>
                    <span class="review-date">{{ formatDate(review.created_at) }}</span>
                  </div>
                  <p class="review-text">{{ review.review_text }}</p>
                </div>
              }
            </div>
          </div>
        }

        <!-- Кнопка для расширения -->
        @if (!_expanded() && ratingStats.totalReviews > 0) {
          <button 
            mat-button 
            (click)="toggleExpanded()"
            class="expand-button">
            <mat-icon>expand_more</mat-icon>
            Подробнее
          </button>
        }
      </div>
    }

    <!-- Состояние загрузки -->
    @if (loading) {
      <div class="rating-loading">
        <mat-icon class="loading-icon">hourglass_empty</mat-icon>
        <span>Загрузка рейтинга...</span>
      </div>
    }

    <!-- Состояние ошибки -->
    @if (error) {
      <div class="rating-error">
        <mat-icon class="error-icon">error_outline</mat-icon>
        <span>Не удалось загрузить рейтинг</span>
      </div>
    }
  `,
  styles: [`
    .rating-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .rating-main {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }

    .stars-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .stars-display {
      display: flex;
      gap: 2px;
    }

    .star-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #ddd;
      transition: color 0.2s ease;

      &.filled {
        color: #ffd700;
      }

      &.half {
        color: #ffd700;
      }
    }

    .rating-value {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .rating-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .reviews-count {
      font-size: 14px;
      color: var(--text-secondary);
      font-weight: 500;
    }

    .last-updated {
      font-size: 12px;
      color: var(--text-tertiary);
    }

    .rating-details {
      padding: 12px;
      background: var(--surface-variant);
      border-radius: 8px;
    }

    .distribution-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .distribution-bars {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .distribution-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }

    .rating-label {
      font-size: 12px;
      min-width: 24px;
      color: var(--text-secondary);
    }

    .distribution-bar {
      flex: 1;
      height: 8px;
      background: var(--surface-variant);
      border-radius: 4px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #ffd700, #ffed4e);
      border-radius: 4px;
      transition: width 0.3s ease;
    }

    .rating-count {
      font-size: 12px;
      min-width: 20px;
      text-align: right;
      color: var(--text-secondary);
    }

    .recent-reviews {
      padding: 12px;
      background: var(--surface-variant);
      border-radius: 8px;
    }

    .reviews-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 12px;
    }

    .reviews-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .review-item {
      padding: 8px;
      background: var(--surface);
      border-radius: 6px;
    }

    .review-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }

    .review-stars {
      display: flex;
      gap: 1px;
    }

    .review-star {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #ffd700;
    }

    .review-author {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
    }

    .review-date {
      font-size: 12px;
      color: var(--text-tertiary);
      margin-left: auto;
    }

    .review-text {
      font-size: 13px;
      line-height: 1.4;
      color: var(--text-secondary);
      margin: 0;
    }

    .expand-button {
      align-self: flex-start;
      font-size: 13px;
      color: var(--primary);
    }

    .rating-loading,
    .rating-error {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      border-radius: 8px;
      font-size: 14px;
    }

    .rating-loading {
      background: var(--surface-variant);
      color: var(--text-secondary);
    }

    .rating-error {
      background: var(--error-container);
      color: var(--error);
    }

    .loading-icon,
    .error-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    @media (min-width: 840px) {
      .rating-main {
        flex-direction: row;
        align-items: center;
        gap: 12px;
      }

      .distribution-row {
        font-size: 14px;
      }

      .review-header {
        flex-wrap: nowrap;
        gap: 8px;
      }
    }
  `]
})
export class PhotographerRatingComponent implements OnInit {
  photographerId = input.required<string>();
  readonly expanded = input(false);
  readonly showReviews = input(false);
  readonly maxReviews = input(3);

  ratingService = inject(RatingService);
  private log = inject(LoggerService);
  
  // Внутренний signal для управления состоянием расширения
  protected _expanded = signal(false);
  
  ratingStats: PhotographerRatingStats | null = null;
  loading = false;
  error = false;

  ngOnInit() {
    this.log.debug('PhotographerRatingComponent ngOnInit, photographerId:', this.photographerId());
    // Инициализируем внутренний signal значением из input
    this._expanded.set(this.expanded());
    if (this.photographerId()) {
      this.loadRatingStats();
    } else {
      this.log.warn('PhotographerRatingComponent: photographerId не передан');
    }
  }

  loadRatingStats() {
    this.log.debug('Загружаем статистику для фотографа:', this.photographerId());
    this.loading = true;
    this.error = false;
    
    this.ratingService.getPhotographerStats(this.photographerId()).subscribe({
      next: (stats) => {
        this.log.debug('Получена статистика для фотографа', this.photographerId(), ':', stats);
        this.ratingStats = stats;
        this.loading = false;
      },
      error: (err) => {
        this.log.error('Error loading photographer rating stats for', this.photographerId(), ':', err);
        this.error = true;
        this.loading = false;
      }
    });
  }

  toggleExpanded() {
    this._expanded.set(!this._expanded());
  }

  getStarsArray(_rating?: number): number[] {
    return Array(5).fill(0).map((_, i) => i + 1);
  }

  getFilledStars(): number {
    return Math.floor(this.ratingStats?.averageRating || 0);
  }

  hasHalfStar(): boolean {
    const rating = this.ratingStats?.averageRating || 0;
    return rating % 1 >= 0.5;
  }

  getStarIcon(index: number): string {
    const rating = this.ratingStats?.averageRating || 0;
    if (index < Math.floor(rating)) {
      return 'star';
    } else if (index === Math.floor(rating) && rating % 1 >= 0.5) {
      return 'star_half';
    } else {
      return 'star_border';
    }
  }

  getRatingCount(rating: number): number {
    if (!this.ratingStats?.ratingDistribution) return 0;
    return this.ratingStats.ratingDistribution[rating as keyof typeof this.ratingStats.ratingDistribution];
  }

  getDistributionPercentage(rating: number): number {
    if (!this.ratingStats?.ratingDistribution || this.ratingStats.totalReviews === 0) {
      return 0;
    }
    const count = this.ratingStats.ratingDistribution[rating as keyof typeof this.ratingStats.ratingDistribution];
    return (count / this.ratingStats.totalReviews) * 100;
  }

  getReviewsWord(count: number): string {
    if (count === 1) return 'отзыв';
    if (count >= 2 && count <= 4) return 'отзыва';
    return 'отзывов';
  }

  formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }
}
