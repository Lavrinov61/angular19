import { Component, ChangeDetectionStrategy, inject, input, signal, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TestimonialService } from '../testimonial.service';

@Component({
  selector: 'app-testimonials-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatCardModule, MatIconModule, RouterLink],
  template: `
    @if (data(); as d) {
      <div class="testimonials-block">
        <!-- Header: rating + trust -->
        <div class="block-header">
          <h2 class="block-title">{{ d.title }}</h2>
          <p class="block-subtitle">{{ d.description }}</p>

          <div class="rating-badge">
            <span class="rating-number">{{ d.overallRating }}</span>
            <div class="rating-stars">
              @for (s of stars; track s) {
                <mat-icon class="star">star</mat-icon>
              }
            </div>
            <span class="rating-count">
              5.0 &middot;
              <a class="rating-trust-link" routerLink="/testimonials">Все отзывы настоящие</a>
            </span>
          </div>
        </div>

        <!-- Review cards grid -->
        <div class="reviews-grid">
          @for (review of visibleReviews(); track review.id ?? $index) {
            <mat-card appearance="outlined" class="review-card">
              <mat-card-content>
                <div class="review-top">
                  <div class="review-stars">
                    @for (s of stars; track s) {
                      <mat-icon class="star-sm">star</mat-icon>
                    }
                  </div>
                  @if (review.source) {
                    <a class="source-badge"
                       [href]="review.source.url"
                       target="_blank"
                       rel="noopener noreferrer">
                      {{ review.source.name }}
                    </a>
                  }
                </div>

                <p class="review-text">{{ review.content }}</p>

                <div class="review-author">
                  <mat-icon class="author-icon">person</mat-icon>
                  <span class="author-name">{{ review.author }}</span>
                  <span class="author-sep">&middot;</span>
                  <span class="author-location">{{ review.location }}</span>
                </div>
              </mat-card-content>
            </mat-card>
          }
        </div>

        @if (!showAll() && d.testimonials.length > 6) {
          <button class="show-all-btn" (click)="toggleShowAll()">
            Ещё {{ d.testimonials.length - 6 }} {{ pluralizeReviews(d.testimonials.length - 6) }}
            <mat-icon>expand_more</mat-icon>
          </button>
        }

        @if (showBookingCta()) {
          <!-- CTA: conversion -->
          <div class="platforms-cta">
            <p class="cta-text">Убедитесь сами, запишитесь к нам</p>
            <div class="cta-actions">
              <a mat-flat-button href="/booking" class="cta-book">
                <mat-icon>calendar_today</mat-icon>
                Записаться онлайн
              </a>
            </div>
            <div class="platform-links">
              @for (platform of d.reviewPlatforms; track platform.url) {
                <a class="platform-link-text"
                   [href]="platform.url"
                   target="_blank"
                   rel="noopener noreferrer">
                  {{ platform.name }}
                </a>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      --testimonials-card-font-display: var(--font-family-display, Oswald, Impact, sans-serif);
      --testimonials-card-font-body: var(--font-family-primary, Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      --testimonials-card-surface: #ffffff;
      --testimonials-card-surface-muted: #f3f4f7;
      --testimonials-card-surface-soft: rgba(244, 43, 35, 0.08);
      --testimonials-card-on-surface: #14161c;
      --testimonials-card-on-surface-variant: #5f6470;
      --testimonials-card-on-surface-muted: #8b8d96;
      --testimonials-card-outline: rgba(20, 22, 28, 0.14);
      --testimonials-card-outline-variant: rgba(20, 22, 28, 0.1);
      --testimonials-card-accent: #f42b23;
      --testimonials-card-accent-hover: #c51f18;
      --testimonials-card-on-accent: #ffffff;
    }

    .testimonials-block {
      padding: 24px 0;
      max-width: 1200px;
      margin: 0 auto;

      @media (min-width: 600px) { padding: 64px 24px; }
      @media (min-width: 840px) { padding: 80px 32px; }
    }

    // Header
    .block-header {
      text-align: center;
      margin-bottom: 20px;
      padding: 0 16px;

      @media (min-width: 600px) {
        margin-bottom: 40px;
        padding: 0;
      }
    }

    .block-title {
      font-family: var(--testimonials-card-font-display);
      font-weight: 700;
      font-size: 1.5rem;
      letter-spacing: 0;
      text-transform: uppercase;
      color: var(--testimonials-card-on-surface);
      margin: 0 0 8px;

      @media (min-width: 600px) { font-size: 2rem; }
    }

    .block-subtitle {
      font-size: 1rem;
      color: var(--testimonials-card-on-surface-variant);
      margin: 0 0 24px;
    }

    // Aggregate rating badge
    .rating-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 100px;
      background: var(--testimonials-card-surface-soft);
      border: 1px solid var(--testimonials-card-outline-variant);
    }

    .rating-number {
      font-size: 1.25rem;
      color: var(--testimonials-card-on-surface);
      font-weight: 700;
    }

    .rating-stars {
      display: flex;
      gap: 1px;
    }

    .star {
      color: var(--testimonials-card-accent);
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .rating-count {
      font-size: 0.875rem;
      color: var(--testimonials-card-on-surface-variant);

      .rating-trust-link {
        color: inherit;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
    }

    // Grid, mobile: horizontal scroll, tablet+: grid
    .reviews-grid {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-snap-type: x mandatory;
      scroll-padding-left: 16px;
      padding: 0 16px;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;

      &::-webkit-scrollbar { display: none; }

      &::after {
        content: '';
        flex-shrink: 0;
        width: 16px;

        @media (min-width: 600px) { display: none; }
      }

      @media (min-width: 600px) {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 20px;
        overflow: visible;
        scroll-snap-type: none;
        padding: 0;
      }

      @media (min-width: 1024px) {
        grid-template-columns: repeat(3, 1fr);
        gap: 24px;
      }
    }

    // Review card, shared light brand
    .review-card {
      height: 100%;
      --mat-card-outlined-container-color: var(--testimonials-card-surface);
      --mat-card-outlined-outline-color: var(--testimonials-card-outline-variant);

      @media (max-width: 599px) {
        flex-shrink: 0;
        width: 80vw;
        scroll-snap-align: start;
      }

      mat-card-content {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px !important;

        @media (min-width: 600px) { padding: 24px !important; }
      }
    }

    .review-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .review-stars {
      display: flex;
      gap: 1px;
    }

    .star-sm {
      color: var(--testimonials-card-accent);
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .source-badge {
      font-size: 0.75rem;
      color: var(--testimonials-card-on-surface-variant);
      text-decoration: none;
      padding: 2px 8px;
      border-radius: 8px;
      background: var(--testimonials-card-surface-muted);
      transition: background 200ms;

      &:hover {
        background: var(--testimonials-card-surface-soft);
        color: var(--testimonials-card-on-surface);
      }
    }

    .review-text {
      font-size: 0.9rem;
      color: var(--testimonials-card-on-surface);
      line-height: 1.6;
      margin: 0;
      flex: 1;
    }

    .review-author {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      color: var(--testimonials-card-on-surface-variant);
    }

    .author-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--testimonials-card-on-surface-muted);
    }

    .author-name {
      font-weight: 500;
      color: var(--testimonials-card-on-surface);
    }

    .author-sep {
      color: var(--testimonials-card-outline);
    }

    // Show all toggle
    .show-all-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 24px auto 0;
      padding: 10px 24px;
      border-radius: 24px;
      border: 1px solid var(--testimonials-card-outline-variant);
      background: transparent;
      color: var(--testimonials-card-on-surface-variant);
      font-family: var(--testimonials-card-font-body);
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      &:hover {
        border-color: var(--testimonials-card-accent);
        color: var(--testimonials-card-accent);
      }
    }

    // CTA block
    .platforms-cta {
      margin-top: 24px;
      text-align: center;
      padding: 0 16px;

      @media (min-width: 600px) {
        margin-top: 40px;
        padding: 0;
      }
    }

    .cta-text {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--testimonials-card-on-surface);
      margin: 0 0 16px;
    }

    .cta-book {
      --mdc-filled-button-container-color: var(--testimonials-card-accent);
      --mdc-filled-button-label-text-color: var(--testimonials-card-on-accent);
      --mat-filled-button-hover-state-layer-opacity: 0.08;
    }

    .cta-actions {
      margin-bottom: 20px;
    }

    .platform-links {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px 16px;
    }

    .platform-link-text {
      font-size: 0.8rem;
      color: var(--testimonials-card-on-surface-variant);
      text-decoration: none;
      transition: color 200ms;

      &:hover {
        color: var(--testimonials-card-accent);
        text-decoration: underline;
      }
    }

  `]
})
export class TestimonialsCardComponent {
  private readonly testimonialService = inject(TestimonialService);
  readonly showBookingCta = input(true);

  readonly data = this.testimonialService.testimonialSection;
  readonly stars = [1, 2, 3, 4, 5];

  readonly showAll = signal(false);

  readonly visibleReviews = computed(() => {
    const d = this.data();
    if (!d) return [];
    return this.showAll() ? d.testimonials : d.testimonials.slice(0, 6);
  });

  toggleShowAll(): void {
    this.showAll.set(true);
  }

  pluralizeReviews(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return 'отзывов';
    if (mod10 === 1) return 'отзыв';
    if (mod10 >= 2 && mod10 <= 4) return 'отзыва';
    return 'отзывов';
  }
}
