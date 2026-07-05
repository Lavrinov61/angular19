import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { TestimonialsCardComponent } from './variants/testimonials-card.component';
import { TestimonialsSliderComponent } from './variants/testimonials-slider.component';
import { TestimonialsMinimalComponent } from './variants/testimonials-minimal.component';

/**
 * The available testimonial variants
 */
export type TestimonialVariant = 'card' | 'slider' | 'minimal';

@Component({
  selector: 'app-testimonials',
  
  imports: [
    TestimonialsCardComponent,
    TestimonialsSliderComponent,
    TestimonialsMinimalComponent
  ],
  template: `
    @switch (variant()) {
      @case ('card') {
        <app-testimonials-card [showBookingCta]="showBookingCta()" />
      }
      @case ('slider') {
        <app-testimonials-slider />
      }
      @case ('minimal') {
        <app-testimonials-minimal />
      }
      @default {
        <app-testimonials-card [showBookingCta]="showBookingCta()" />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TestimonialsComponent {
  /**
   * The design variant to use for testimonials
   * @default 'card'
   */
  variant = input<TestimonialVariant>('card');
  showBookingCta = input(true);
}
