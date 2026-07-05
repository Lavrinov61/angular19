import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RatingService, ClientStats } from '../../../../core/services/rating.service';
import { TestimonialService } from '../../../../shared/components/testimonials/testimonial.service';

interface StatItem {
  value: string;
  label: string;
}

@Component({
  selector: 'app-social-proof',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="social-proof">

      <!-- Section header -->
      <div class="section-header">
        <h2 class="section-title">Отзывы клиентов</h2>
        <div class="review-badge" aria-label="5.0, все отзывы настоящие">
          <span class="review-badge__stars" aria-hidden="true">★★★★★</span>
          <span class="review-badge__meta">5.0 · Все отзывы настоящие</span>
        </div>
      </div>

      <!-- Review cards -->
      <div class="reviews-scroll">
        @for (review of displayReviews(); track review.id) {
          <article class="review-card">
            <div class="review-card__stars">
              @for (s of fiveStars; track s) {
                <mat-icon class="star star--filled">star</mat-icon>
              }
            </div>
            <p class="review-card__text">{{ review.content }}</p>
            <footer class="review-card__author">
, {{ review.author }}
              @if (review.source) {
                <span class="review-card__source">· {{ review.source.name }}</span>
              }
            </footer>
          </article>
        }
      </div>

      <!-- Stats strip -->
      <div class="stats-strip">
        @for (stat of stats(); track stat.label) {
          <div class="stat">
            <span class="stat__value">{{ stat.value }}</span>
            <span class="stat__label">{{ stat.label }}</span>
          </div>
          @if (!$last) {
            <span class="stats-strip__sep" aria-hidden="true">|</span>
          }
        }
      </div>

    </section>
  `,
  styles: [`
    :host {
      display: block;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }

    .social-proof {
      background: var(--ed-surface-container, #1e1e1e);
      border-top: 1px solid var(--ed-outline-variant, #333);
      padding-bottom: 4px;
    }

    /* ── Section header ─────────────────────────────────────── */
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      padding: 20px 24px 12px;
    }

    .section-title {
      font-family: 'Oswald', sans-serif;
      font-size: clamp(1rem, 2vw, 1.25rem);
      font-weight: 600;
      color: var(--ed-on-surface, #f0f0f0);
      margin: 0;
      letter-spacing: 0.01em;
    }

    /* ── Review badge ───────────────────────────────────────── */
    .review-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px 4px 10px;
      background: var(--ed-surface, #141414);
      border: 1px solid var(--ed-outline-variant, #333);
      border-radius: 20px;
    }

    .review-badge__stars {
      color: var(--ed-accent, #f59e0b);
      font-size: 0.8rem;
      letter-spacing: 1px;
      line-height: 1;
    }

    .review-badge__meta {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f0f0f0);
      white-space: nowrap;
    }

    /* ── Stars ──────────────────────────────────────────────── */
    .star {
      font-size: 12px;
      width: 12px;
      height: 12px;
      color: var(--ed-outline-variant, #555);
    }

    .star--filled {
      color: var(--ed-accent, #f59e0b);
    }

    /* ── Reviews scroll ─────────────────────────────────────── */
    .reviews-scroll {
      display: flex;
      gap: 12px;
      padding: 0 24px 16px;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }

    .reviews-scroll::-webkit-scrollbar {
      display: none;
    }

    /* ── Review card ────────────────────────────────────────── */
    .review-card {
      flex: 0 0 280px;
      scroll-snap-align: start;
      background: var(--ed-surface-container-high, #252525);
      border: 1px solid var(--ed-outline-variant, #333);
      border-radius: 12px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .review-card__stars {
      display: flex;
      gap: 2px;
    }

    .review-card__text {
      font-size: 0.8rem;
      line-height: 1.55;
      color: var(--ed-on-surface, #f0f0f0);
      margin: 0;
      flex: 1;
    }

    .review-card__author {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--ed-on-surface-variant, #aaa);
    }

    .review-card__source {
      font-weight: 400;
      opacity: 0.75;
    }

    /* ── Stats strip ────────────────────────────────────────── */
    .stats-strip {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px 14px;
      padding: 12px 24px 16px;
      border-top: 1px solid var(--ed-outline-variant, #333);
    }

    .stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }

    .stat__value {
      font-family: 'Oswald', sans-serif;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--ed-accent, #f59e0b);
      line-height: 1;
    }

    .stat__label {
      font-size: 0.7rem;
      color: var(--ed-on-surface-variant, #aaa);
      text-align: center;
    }

    .stats-strip__sep {
      color: var(--ed-outline-variant, #555);
      font-size: 1rem;
      line-height: 1;
      align-self: flex-start;
      margin-top: 4px;
    }

    /* ── Mobile ─────────────────────────────────────────────── */
    @media (max-width: 599px) {
      .section-header {
        padding: 16px 16px 10px;
      }

      .reviews-scroll {
        padding: 0 16px 14px;
      }

      .review-card {
        flex: 0 0 calc(85vw);
      }

      .stats-strip {
        padding: 10px 16px 14px;
      }
    }
  `],
})
export class SocialProofComponent implements OnInit {
  private readonly ratingService = inject(RatingService);

  readonly fiveStars = [1, 2, 3, 4, 5] as const;

  private readonly ratingStats = signal<{ averageRating: number; totalReviews: number } | null>(null);
  private readonly statsData = signal<ClientStats | null>(null);

  readonly ratingDisplay = computed(() => {
    const s = this.ratingStats();
    return s ? s.averageRating.toFixed(1) : '5.0';
  });

  readonly stats = computed<StatItem[]>(() => {
    const data = this.statsData();
    const clientStr = data?.clientCount ? `${this.formatCount(data.clientCount)}+` : '200 000+';
    return [
      { value: clientStr, label: 'клиентов' },
      { value: '100%', label: 'настоящие отзывы' },
      { value: `${this.ratingDisplay()} / 5`, label: 'рейтинг' },
    ];
  });

  private readonly testimonialService = inject(TestimonialService);

  readonly displayReviews = computed(() => {
    const all = this.testimonialService.testimonials();
    return all.length > 0 ? all.slice(0, 5) : [];
  });

  ngOnInit(): void {
    this.ratingService.getRatingStats().subscribe(s => {
      if (s) this.ratingStats.set(s);
    });
    this.ratingService.getClientCount().subscribe(stats => {
      this.statsData.set(stats);
    });
  }

  private formatCount(n: number): string {
    return n.toLocaleString('ru-RU');
  }
}
