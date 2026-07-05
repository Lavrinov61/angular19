import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TestimonialService } from '../testimonial.service';
import { TestimonialSection } from '../testimonial.model';

@Component({
  selector: 'app-testimonials-minimal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatDividerModule, MatIconModule, RouterLink],
  template: `
    <section class="testimonials-minimal-section">
      @if (testimonialData(); as data) {
        <div class="container">
          <div class="section-header">
            <h2 class="mat-headline-4">{{ data.title }}</h2>
            <p class="mat-subtitle-1">{{ data.description }}</p>
            
            <div class="rating-summary">
              <div class="rating-score-large">{{ data.overallRating }}</div>
              <div class="rating-details">
                <div class="star-container">
                  <mat-icon class="star-icon">star</mat-icon>
                  <mat-icon class="star-icon">star</mat-icon>
                  <mat-icon class="star-icon">star</mat-icon>
                  <mat-icon class="star-icon">star</mat-icon>
                  <mat-icon class="star-icon">star</mat-icon>
                </div>
                <span class="review-count">
                  5.0 &middot;
                  <a class="review-trust-link" routerLink="/testimonials">Все отзывы настоящие</a>
                </span>
              </div>
            </div>
          </div>

          <mat-divider />

          <div class="testimonials-list">
            @for (testimonial of data.testimonials; track testimonial.author || testimonial.content || $index) {
              <div class="testimonial-item">
                <div class="testimonial-quote-icon">
                  <mat-icon>format_quote</mat-icon>
                </div>
                
                <div class="testimonial-content-container">
                  <p class="testimonial-content">"{{ testimonial.content }}"</p>
                  
                  <div class="testimonial-footer">
                    <div class="testimonial-author-container">
                      <span class="testimonial-author">{{ testimonial.author }}</span>
                      <span class="testimonial-location">{{ testimonial.location }}</span>
                    </div>
                    
                    <div class="testimonial-rating">
                      @for (star of [1, 2, 3, 4, 5]; track star) {
                        <mat-icon class="star-icon-small">star</mat-icon>
                      }
                    </div>
                  </div>
                  
                  <div class="testimonial-source">
                    Источник: 
                    <a [href]="testimonial.source?.url" target="_blank">{{ testimonial.source?.name }}</a>
                  </div>
                </div>
              </div>
            }
          </div>

          <mat-divider />

          <div class="platforms-footer">
            <p class="read-more-text">Читайте больше отзывов на:</p>
            <div class="platforms-container">
              @for (platform of data.reviewPlatforms; track platform.name || platform.url || $index) {
                <a mat-button 
                   [href]="platform.url" target="_blank">
                  @if (platform.icon) {
                    <mat-icon>{{ platform.icon }}</mat-icon>
                  }
                  {{ platform.name }}
                </a>
              }
            </div>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .testimonials-minimal-section {
      padding: 80px 0;
      background-color: var(--ed-surface, #0a0a0a);
    }

    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: 0 16px;
    }

    .section-header {
      text-align: center;
      margin-bottom: 48px;
    }

    .section-header h2 {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 16px;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .section-header p {
      margin-bottom: 32px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .rating-summary {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin-bottom: 32px;
    }

    .rating-score-large {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 48px;
      font-weight: 800;
      line-height: 1;
      color: var(--ed-accent, #f59e0b);
    }

    .rating-details {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }

    .star-container {
      display: flex;
      gap: 2px;
    }

    .star-icon {
      color: var(--ed-accent, #f59e0b);
    }

    .star-icon-small {
      font-size: 16px;
      height: 16px;
      width: 16px;
      color: var(--ed-accent, #f59e0b);
    }

    .review-count {
      font-size: 14px;
      color: var(--ed-on-surface-muted, #666);

      .review-trust-link {
        color: inherit;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
    }

    .testimonials-list {
      padding: 40px 0;
    }

    .testimonial-item {
      display: flex;
      flex-direction: column;
      margin-bottom: 48px;
    }

    .testimonial-item:last-child {
      margin-bottom: 0;
    }

    .testimonial-quote-icon {
      margin-right: 0;
      margin-bottom: 16px;
      color: var(--ed-accent, #f59e0b);
    }

    .testimonial-quote-icon mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
    }

    .testimonial-content-container {
      flex: 1;
    }

    .testimonial-content {
      font-size: 1.1rem;
      line-height: 1.7;
      margin-bottom: 16px;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .testimonial-footer {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 8px;
    }

    .testimonial-author-container {
      display: flex;
      flex-direction: column;
    }

    .testimonial-author {
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .testimonial-location {
      font-size: 14px;
      color: var(--ed-on-surface-muted, #666);
    }

    .testimonial-rating {
      display: flex;
      gap: 2px;
    }

    .testimonial-source {
      font-size: 14px;
      color: var(--ed-on-surface-muted, #666);
    }

    .testimonial-source a {
      color: var(--ed-accent, #f59e0b);
      text-decoration: none;
    }

    .testimonial-source a:hover {
      text-decoration: underline;
    }

    .platforms-footer {
      padding: 40px 0 0;
      text-align: center;
    }

    .read-more-text {
      margin-bottom: 16px;
      color: var(--ed-on-surface-muted, #666);
    }

    .platforms-container {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
    }

    @media (min-width: 840px) {
      .testimonial-item {
        flex-direction: row;
      }

      .testimonial-quote-icon {
        margin-right: 16px;
        margin-bottom: 0;
      }

      .testimonial-footer {
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        gap: 0;
      }
    }
  `]
})
export class TestimonialsMinimalComponent implements OnInit {
  private readonly testimonialService = inject(TestimonialService);
  
  // Signals for state management
  readonly testimonialData = signal<TestimonialSection | null>(null);
  readonly loading = signal<boolean>(false);

  async ngOnInit(): Promise<void> {
    try {
      this.loading.set(true);
      const data = await this.testimonialService.getTestimonials();
      this.testimonialData.set(data);
    } catch {
      // testimonials load failed
    } finally {
      this.loading.set(false);
    }
  }
}
