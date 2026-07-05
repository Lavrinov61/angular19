import { Component, OnInit, inject, ElementRef, AfterViewInit, OnDestroy, signal, ChangeDetectionStrategy, viewChild, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TestimonialService } from '../testimonial.service';
import { TestimonialSection } from '../testimonial.model';
import { Subscription, interval } from 'rxjs';

@Component({
  selector: 'app-testimonials-slider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    <section class="testimonials-slider-section">
      @if (testimonialData(); as data) {
        <div class="container">
          <div class="section-header">
            <h2 class="mat-headline-4">{{ data.title }}</h2>
            <p class="mat-subtitle-1">{{ data.description }}</p>
            
            <div class="rating-container">
              <span class="rating-score">5.0</span>
              <div class="star-container">
                <mat-icon class="star-icon">star</mat-icon>
                <mat-icon class="star-icon">star</mat-icon>
                <mat-icon class="star-icon">star</mat-icon>
                <mat-icon class="star-icon">star</mat-icon>
                <mat-icon class="star-icon">star</mat-icon>
              </div>
              <span class="review-count">
                &middot;
                <a class="review-trust-link" routerLink="/testimonials">Все отзывы настоящие</a>
              </span>
            </div>
          </div>

          <div class="slider-container">
            <div class="slider" #slider>
              @for (testimonial of data.testimonials; track testimonial.author || testimonial.content || $index) {
                <div class="slide">
                  <div class="slide-content">
                    <div class="testimonial-rating">
                      @for (star of [1, 2, 3, 4, 5]; track star) {
                        <mat-icon class="star-icon-small">star</mat-icon>
                      }
                      <span class="rating-value">{{ testimonial.rating }}.0/5</span>
                    </div>
                    
                    <h3 class="slide-title mat-h2">{{ testimonial.author }}</h3>
                    <p class="testimonial-content">"{{ testimonial.content }}"</p>
                    <p class="testimonial-author">{{ testimonial.author }}, {{ testimonial.location }}</p>
                    
                    <a mat-button [href]="testimonial.source?.url" target="_blank" class="source-link">
                      Отзывы на {{ testimonial.source?.name }}
                      <mat-icon>chevron_right</mat-icon>
                    </a>
                  </div>
                </div>
              }
            </div>
            
            <button mat-mini-fab class="nav-button prev-button" (click)="prevSlide()" aria-label="Previous slide">
              <mat-icon>chevron_left</mat-icon>
            </button>
            
            <button mat-mini-fab class="nav-button next-button" (click)="nextSlide()" aria-label="Next slide">
              <mat-icon>chevron_right</mat-icon>
            </button>
          </div>

          <div class="slider-dots">
            @for (testimonial of data.testimonials; track testimonial.author || testimonial.content || $index; let i = $index) {
              <button 
                mat-mini-fab 
                [class.active]="i === currentSlide()"
                (click)="goToSlide(i)"
                [attr.aria-label]="'Go to slide ' + (i + 1)">
              </button>
            }
          </div>

          <div class="platforms-container">
            @for (platform of data.reviewPlatforms; track platform.name || platform.url || $index) {
              <a mat-stroked-button 
                 [href]="platform.url" target="_blank" class="platform-button">
                @if (platform.icon) {
                  <mat-icon>{{ platform.icon }}</mat-icon>
                }
                {{ platform.name }}
              </a>
            }
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .testimonials-slider-section {
      padding: 64px 0;
      background-color: var(--ed-surface-container, #1a1a1a);
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 16px;
      position: relative;
    }

    .section-header {
      text-align: center;
      margin-bottom: 48px;
    }

    .section-header h2 {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: -0.02em;
      margin-bottom: 16px;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .section-header p {
      margin-bottom: 24px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .rating-container {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 16px;
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

    .rating-score {
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .review-count {
      font-weight: 500;
      color: var(--ed-on-surface-muted, #666);

      .review-trust-link {
        color: inherit;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
    }

    .slider-container {
      position: relative;
      width: 100%;
      overflow: hidden;
      margin-bottom: 24px;
    }

    .slider {
      display: flex;
      transition: transform 0.5s var(--ed-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
    }

    .slide {
      min-width: 100%;
      box-sizing: border-box;
    }

    .slide-content {
      background-color: var(--ed-surface-container-high, #222);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: var(--ed-border-radius-md, 8px);
      padding: 24px 16px;
      margin: 0 8px;
      text-align: center;
    }

    .testimonial-rating {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      margin-bottom: 16px;
    }

    .rating-value {
      font-size: 0.85rem;
      color: var(--ed-on-surface-muted, #666);
      margin-left: 4px;
    }

    .slide-title {
      margin-bottom: 16px;
      color: var(--ed-on-surface, #f5f5f5);
      font-weight: 600;
    }

    .testimonial-content {
      font-style: italic;
      margin-bottom: 16px;
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 1.1rem;
      line-height: 1.7;
    }

    .testimonial-author {
      font-weight: 600;
      margin-bottom: 24px;
      color: var(--ed-on-surface-muted, #666);
    }

    .nav-button {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      z-index: 2;
      background-color: var(--ed-surface-container-high, #222);
      color: var(--ed-accent, #f59e0b);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .prev-button {
      left: 0;
    }

    .next-button {
      right: 0;
    }

    .slider-dots {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 32px;
    }

    .slider-dots button {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: var(--ed-outline, #3a3a3a);
      cursor: pointer;
      border: none;
      padding: 0;
      min-height: auto;
      transition: all 200ms;
    }

    .slider-dots button.active {
      background-color: var(--ed-accent, #f59e0b);
      transform: scale(1.3);
    }

    .platforms-container {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 12px;
      margin-top: 32px;
    }

    .platform-button {
      background-color: transparent;
      border: 1px solid var(--ed-outline, #3a3a3a);
      color: var(--ed-on-surface, #f5f5f5);
      border-radius: 24px;
      padding: 10px 20px;
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 200ms;
      font-weight: 500;
      font-size: 0.9rem;

      &:hover {
        border-color: var(--ed-accent, #f59e0b);
        color: var(--ed-accent, #f59e0b);
      }

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .source-link {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ed-accent, #f59e0b);
    }

    .nav-button {
      display: none;
    }

    @media (min-width: 840px) {
      .slide-content {
        padding: 40px 32px;
        margin: 0 16px;
      }

      .nav-button {
        display: inline-flex;
      }
    }
  `]
})
export class TestimonialsSliderComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly testimonialService = inject(TestimonialService);
  private readonly platformId = inject(PLATFORM_ID);
  
  // Signals for state management
  readonly testimonialData = signal<TestimonialSection | null>(null);
  readonly loading = signal<boolean>(false);
  
  readonly sliderElement = viewChild.required<ElementRef>('slider');
  
  readonly currentSlide = signal(0);
  slidesCount = 0;
  autoSlideSubscription?: Subscription;
  
  async ngOnInit(): Promise<void> {
    try {
      this.loading.set(true);
      const data = await this.testimonialService.getTestimonials();
      this.testimonialData.set(data);
      this.slidesCount = data.testimonials.length;
    } catch {
      // testimonials load failed
    } finally {
      this.loading.set(false);
    }
  }
  
  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.autoSlideSubscription = interval(5000).subscribe(() => {
        this.nextSlide();
      });
    }
  }
  
  ngOnDestroy(): void {
    if (this.autoSlideSubscription) {
      this.autoSlideSubscription.unsubscribe();
    }
  }
  
  updateSliderPosition(): void {
    const sliderElement = this.sliderElement();
    if (sliderElement) {
      const slider = sliderElement.nativeElement as HTMLElement;
      slider.style.transform = `translateX(-${this.currentSlide() * 100}%)`;
    }
  }

  nextSlide(): void {
    this.currentSlide.set((this.currentSlide() + 1) % this.slidesCount);
    this.updateSliderPosition();
  }

  prevSlide(): void {
    this.currentSlide.set((this.currentSlide() - 1 + this.slidesCount) % this.slidesCount);
    this.updateSliderPosition();
  }

  goToSlide(index: number): void {
    this.currentSlide.set(index);
    this.updateSliderPosition();
  }
}
